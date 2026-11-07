import { supabase, safeQuery, friendlyErrorMessage } from './supabase-client.js';
import { escapeHtml } from './escape.js';

const findForm = document.getElementById('find-form');
const firstNameInput = document.getElementById('find-first-name');
const lastNameInput = document.getElementById('find-last-name');
const searchResults = document.getElementById('search-results');
const searchEmpty = document.getElementById('search-empty');
const stepSearch = document.getElementById('step-search');
const stepParty = document.getElementById('step-party');
const stepDone = document.getElementById('step-done');
const partyName = document.getElementById('party-name');
const partyMembers = document.getElementById('party-members');
const rsvpForm = document.getElementById('rsvp-form');
const backToSearch = document.getElementById('back-to-search');
const rsvpError = document.getElementById('rsvp-error');

const FOOD_OPTIONS = ['Chicken', 'Beef', 'Fish', 'Vegetarian'];

function showRsvpError(message) {
  rsvpError.textContent = message;
  rsvpError.hidden = false;
}

function clearRsvpError() {
  rsvpError.hidden = true;
}

function clearResults() {
  searchResults.innerHTML = '';
  searchResults.hidden = true;
  searchEmpty.hidden = true;
}

// Exact first+last name match only, submitted on demand (not live-as-you-type)
// — find_invitation never returns a broader list of other guests, so there's
// nothing to browse. See supabase/migrations/0006_private_lookup.sql.
findForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const first = firstNameInput.value.trim();
  const last = lastNameInput.value.trim();
  if (!first || !last) return;

  clearResults();
  const { data, error } = await safeQuery(
    supabase.rpc('find_invitation', { p_first_name: first, p_last_name: last })
  );
  if (error) {
    console.error(error);
    showRsvpError(friendlyErrorMessage(error, "We couldn't look that up. Please try again."));
    return;
  }
  clearRsvpError();

  if (!data || data.length === 0) {
    searchEmpty.hidden = false;
    return;
  }

  if (data.length === 1) {
    openInvitation(data[0]);
    return;
  }

  // Rare: more than one invited guest shares this exact name (e.g. two
  // "Mike Motyka" on the current guest list). Only the exact matches for
  // the name just typed are ever shown — never anyone else.
  searchResults.hidden = false;
  for (const guest of data) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rsvp-result';
    const partyLabel = guest.party_name ? escapeHtml(guest.party_name) : 'No household yet';
    button.innerHTML = `<span>${escapeHtml(guest.first_name)} ${escapeHtml(guest.last_name)}</span><span class="rsvp-result__party">${partyLabel}</span>`;
    button.addEventListener('click', () => openInvitation(guest));
    li.appendChild(button);
    searchResults.appendChild(li);
  }
});

// `guest` is one row from find_invitation. If it has a party, load and show
// the whole household (get_party_members, scoped to that opaque party_id —
// unrelated guests still can't be reached this way). If it has no party yet
// (party_id null — true for most of the list until parties are assigned),
// show just that one guest's own fields; submit goes through
// submit_solo_rsvp instead of submit_rsvp.
async function openInvitation(guest) {
  clearRsvpError();
  partyMembers.innerHTML = '';

  if (guest.party_id) {
    const { data, error } = await safeQuery(supabase.rpc('get_party_members', { p_party_id: guest.party_id }));
    if (error) {
      console.error(error);
      showRsvpError(friendlyErrorMessage(error, "We couldn't load your party. Please try again."));
      return;
    }
    partyName.textContent = guest.party_name || '';
    for (const member of data) {
      partyMembers.appendChild(buildMemberRow(member));
    }
    rsvpForm.dataset.mode = 'party';
    rsvpForm.dataset.partyId = guest.party_id;
    delete rsvpForm.dataset.guestId;
  } else {
    partyName.textContent = `${guest.first_name} ${guest.last_name}`;
    partyMembers.appendChild(buildMemberRow(guest));
    rsvpForm.dataset.mode = 'solo';
    rsvpForm.dataset.guestId = guest.guest_id;
    delete rsvpForm.dataset.partyId;
  }

  stepSearch.hidden = true;
  stepParty.hidden = false;
}

function buildMemberRow(member) {
  const wrap = document.createElement('div');
  wrap.className = 'rsvp-member';
  wrap.dataset.guestId = member.guest_id;

  const foodOptions = FOOD_OPTIONS.map(
    (opt) => `<option value="${opt}" ${member.food_preference === opt ? 'selected' : ''}>${opt}</option>`
  ).join('');

  wrap.innerHTML = `
    <div class="rsvp-member__name">${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}</div>
    <div class="rsvp-member__attending">
      <label><input type="radio" name="attending-${member.guest_id}" value="yes" ${member.rsvp_status === 'yes' ? 'checked' : ''}> Joyfully attending</label>
      <label><input type="radio" name="attending-${member.guest_id}" value="no" ${member.rsvp_status === 'no' ? 'checked' : ''}> Regretfully declines</label>
    </div>
    <div class="rsvp-member__details">
      <label>Meal preference
        <select name="food-${member.guest_id}">
          <option value="">Select…</option>
          ${foodOptions}
        </select>
      </label>
      <label>Dietary notes
        <input type="text" name="dietary-${member.guest_id}" value="${escapeHtml(member.dietary_notes)}" placeholder="Allergies, restrictions, etc.">
      </label>
    </div>
  `;
  return wrap;
}

rsvpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = rsvpForm.dataset.mode;
  const formData = new FormData(rsvpForm);

  if (mode === 'solo') {
    const guestId = rsvpForm.dataset.guestId;
    const { error } = await safeQuery(supabase.rpc('submit_solo_rsvp', {
      p_guest_id: guestId,
      p_rsvp_status: formData.get(`attending-${guestId}`) || 'pending',
      p_food_preference: formData.get(`food-${guestId}`) || null,
      p_dietary_notes: formData.get(`dietary-${guestId}`) || null,
    }));
    if (error) {
      console.error(error);
      showRsvpError(friendlyErrorMessage(error, 'Something went wrong submitting your RSVP. Please try again.'));
      return;
    }
  } else {
    const partyId = rsvpForm.dataset.partyId;
    const responses = [];
    document.querySelectorAll('.rsvp-member').forEach((row) => {
      const guestId = row.dataset.guestId;
      responses.push({
        guest_id: guestId,
        rsvp_status: formData.get(`attending-${guestId}`) || 'pending',
        food_preference: formData.get(`food-${guestId}`) || null,
        dietary_notes: formData.get(`dietary-${guestId}`) || null,
      });
    });

    const { error } = await safeQuery(supabase.rpc('submit_rsvp', { p_party_id: partyId, responses }));
    if (error) {
      console.error(error);
      showRsvpError(friendlyErrorMessage(error, 'Something went wrong submitting your RSVP. Please try again.'));
      return;
    }
  }

  clearRsvpError();
  stepParty.hidden = true;
  stepDone.hidden = false;
});

backToSearch.addEventListener('click', () => {
  clearRsvpError();
  stepParty.hidden = true;
  stepSearch.hidden = false;
  firstNameInput.value = '';
  lastNameInput.value = '';
  clearResults();
});
