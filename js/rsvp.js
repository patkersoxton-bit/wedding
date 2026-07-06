import { supabase, safeQuery, friendlyErrorMessage } from './supabase-client.js';
import { escapeHtml } from './escape.js';

const searchInput = document.getElementById('search-input');
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

let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const term = searchInput.value.trim();
  if (term.length < 2) {
    searchResults.innerHTML = '';
    searchEmpty.hidden = true;
    return;
  }
  searchDebounce = setTimeout(() => runSearch(term), 250);
});

async function runSearch(term) {
  const { data, error } = await safeQuery(supabase.rpc('search_guests', { search_name: term }));
  if (error) {
    console.error(error);
    showRsvpError(friendlyErrorMessage(error, "We couldn't search the guest list. Please try again."));
    return;
  }
  clearRsvpError();
  searchResults.innerHTML = '';
  searchEmpty.hidden = data.length > 0;
  for (const guest of data) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rsvp-result';
    button.innerHTML = `<span>${escapeHtml(guest.first_name)} ${escapeHtml(guest.last_name)}</span><span class="rsvp-result__party">${escapeHtml(guest.party_name)}</span>`;
    button.addEventListener('click', () => selectParty(guest.party_id, guest.party_name));
    li.appendChild(button);
    searchResults.appendChild(li);
  }
}

async function selectParty(partyId, name) {
  const { data, error } = await safeQuery(supabase.rpc('get_party_members', { p_party_id: partyId }));
  if (error) {
    console.error(error);
    showRsvpError(friendlyErrorMessage(error, "We couldn't load your party. Please try again."));
    return;
  }
  clearRsvpError();

  partyName.textContent = name;
  partyMembers.innerHTML = '';

  for (const member of data) {
    partyMembers.appendChild(buildMemberRow(member));
  }

  stepSearch.hidden = true;
  stepParty.hidden = false;
  rsvpForm.dataset.partyId = partyId;
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
  const partyId = rsvpForm.dataset.partyId;
  const formData = new FormData(rsvpForm);
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

  clearRsvpError();
  stepParty.hidden = true;
  stepDone.hidden = false;
});

backToSearch.addEventListener('click', () => {
  clearRsvpError();
  stepParty.hidden = true;
  stepSearch.hidden = false;
  searchInput.value = '';
  searchResults.innerHTML = '';
});
