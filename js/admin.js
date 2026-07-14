import { supabase, safeQuery, friendlyErrorMessage } from './supabase-client.js';
import { buildPieCard, buildMeterCard } from './charts.js';
import { escapeHtml } from './escape.js';

const loginSection = document.getElementById('admin-login');
const dashboardSection = document.getElementById('admin-dashboard');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const dashboardError = document.getElementById('dashboard-error');
const logoutLink = document.getElementById('logout-link');
const statsEl = document.getElementById('admin-stats');
const chartRow = document.getElementById('chart-row');
const guestTableBody = document.getElementById('guest-table-body');
const addPartyForm = document.getElementById('add-party-form');
const addGuestForm = document.getElementById('add-guest-form');
const newGuestPartySelect = document.getElementById('new-guest-party');
const exportBtn = document.getElementById('export-csv');
const tabButtons = document.querySelectorAll('.admin-tab');
const partyDatalist = document.getElementById('party-options');
const guestSearchInput = document.getElementById('guest-search');
const filterFieldSelect = document.getElementById('filter-field');
const filterValueSelect = document.getElementById('filter-value');
const filterClearBtn = document.getElementById('filter-clear');
const guestCountEl = document.getElementById('guest-count');

const FOOD_OPTIONS = ['', 'Chicken', 'Beef', 'Fish', 'Vegetarian'];
const RSVP_OPTIONS = ['pending', 'yes', 'no'];

// Columns the filter bar can match on. `get` normalizes a guest row to the
// display value shown in the value dropdown ('' = blank/unset).
const FILTER_FIELDS = {
  party: { label: 'Party', get: (g) => g.parties?.party_name ?? '' },
  invited: { label: 'Invited', get: (g) => (g.invited ? 'Yes' : 'No') },
  rsvp_status: { label: 'RSVP', get: (g) => g.rsvp_status ?? '' },
  food_preference: { label: 'Meal', get: (g) => g.food_preference ?? '' },
  dietary_notes: { label: 'Dietary Notes', get: (g) => g.dietary_notes ?? '' },
  city: { label: 'City', get: (g) => g.city ?? '' },
  state_province: { label: 'State', get: (g) => g.state_province ?? '' },
  country: { label: 'Country', get: (g) => g.country ?? '' },
};
// Sentinel for "field is blank" in the value dropdown — can't use '' because
// that's the "any value" placeholder.
const FILTER_BLANK = '__blank__';

let allGuests = [];
let partyList = [];

// Deepened, CVD-validated variants of the site's brand hues — the soft
// pastel theme palette fails the categorical contrast/chroma checks for
// small chart marks. Order is fixed per chart; never reassigned by value.
const CHART_COLORS = {
  red: '#ef5356', // copper (brand primary, unchanged)
  orange: '#d97a3c', // apricot, deepened
  amber: '#c9861d', // golden hour, deepened
  green: '#75731f', // moss, deepened
  blue: '#3f6bb0', // misty blue, deepened
  gray: '#a49c92', // muted "none/not selected"
};

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => {
      b.classList.toggle('is-active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    document.querySelectorAll('.admin-tab-panel').forEach((panel) => {
      panel.hidden = panel.id !== `tab-${btn.dataset.tab}`;
    });
  });
});

// Single shared master-password login for testing — this is one fixed
// Supabase Auth account behind the scenes (RLS grants full access to any
// authenticated session, so which account it is doesn't matter for
// security). Swap for per-planner accounts before going live.
const ADMIN_EMAIL = 'admin@parkerandjolan.com';

function showDashboardError(message) {
  dashboardError.textContent = message;
  dashboardError.hidden = false;
}

function clearDashboardError() {
  dashboardError.hidden = true;
}

async function init() {
  const { data, error } = await safeQuery(supabase.auth.getSession());
  if (error) {
    console.error(error);
    showLogin();
    loginError.hidden = false;
    loginError.textContent = friendlyErrorMessage(error, 'Could not check your session.');
    return;
  }
  const { session } = data;
  if (session) {
    showDashboard();
  } else {
    showLogin();
  }
}

function showLogin() {
  loginSection.hidden = false;
  dashboardSection.hidden = true;
  logoutLink.hidden = true;
}

async function showDashboard() {
  loginSection.hidden = true;
  dashboardSection.hidden = false;
  logoutLink.hidden = false;
  await Promise.all([loadStats(), loadParties(), loadGuests()]);
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  const { error } = await safeQuery(supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password }));
  if (error) {
    loginError.hidden = false;
    loginError.textContent = friendlyErrorMessage(error, 'Login failed. Please try again.');
    return;
  }
  loginError.hidden = true;
  showDashboard();
});

logoutLink.addEventListener('click', async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  showLogin();
});

async function loadStats() {
  const { data, error } = await safeQuery(supabase.from('guests').select('rsvp_status, invited, food_preference'));
  if (error) {
    console.error(error);
    showDashboardError(friendlyErrorMessage(error, 'Could not load stats.'));
    return;
  }
  clearDashboardError();
  const invited = data.filter((g) => g.invited);
  const yes = invited.filter((g) => g.rsvp_status === 'yes').length;
  const no = invited.filter((g) => g.rsvp_status === 'no').length;
  const pending = invited.filter((g) => g.rsvp_status === 'pending').length;

  statsEl.innerHTML = `
    <div class="detail-card"><h3>${invited.length}</h3><p>Invited</p></div>
    <div class="detail-card"><h3>${yes}</h3><p>Attending</p></div>
    <div class="detail-card"><h3>${no}</h3><p>Declined</p></div>
    <div class="detail-card"><h3>${pending}</h3><p>Awaiting response</p></div>
  `;

  renderCharts(invited, yes, no, pending);
}

function renderCharts(invited, yes, no, pending) {
  chartRow.innerHTML = '';

  chartRow.appendChild(
    buildPieCard({
      title: 'RSVP Responses',
      slices: [
        { label: 'Attending', value: yes, color: CHART_COLORS.green },
        { label: 'Declined', value: no, color: CHART_COLORS.red },
        { label: 'Awaiting response', value: pending, color: CHART_COLORS.blue },
      ],
    })
  );

  const mealCounts = { Chicken: 0, Beef: 0, Fish: 0, Vegetarian: 0 };
  let noMeal = 0;
  invited.forEach((g) => {
    if (g.food_preference && mealCounts.hasOwnProperty(g.food_preference)) {
      mealCounts[g.food_preference] += 1;
    } else {
      noMeal += 1;
    }
  });

  chartRow.appendChild(
    buildPieCard({
      title: 'Meal Preference',
      slices: [
        { label: 'Chicken', value: mealCounts.Chicken, color: CHART_COLORS.red },
        { label: 'Beef', value: mealCounts.Beef, color: CHART_COLORS.orange },
        { label: 'Fish', value: mealCounts.Fish, color: CHART_COLORS.blue },
        { label: 'Vegetarian', value: mealCounts.Vegetarian, color: CHART_COLORS.green },
        { label: 'Not selected', value: noMeal, color: CHART_COLORS.gray },
      ],
    })
  );

  chartRow.appendChild(
    buildMeterCard({
      title: 'Response Rate',
      value: yes + no,
      total: invited.length,
      color: CHART_COLORS.red,
      trackColor: '#f2e3da',
    })
  );
}

async function loadParties() {
  const { data, error } = await safeQuery(supabase.from('parties').select('id, party_name').order('party_name'));
  if (error) {
    console.error(error);
    showDashboardError(friendlyErrorMessage(error, 'Could not load parties.'));
    return;
  }
  clearDashboardError();
  partyList = data;
  newGuestPartySelect.innerHTML = data
    .map((p) => `<option value="${p.id}">${escapeHtml(p.party_name)}</option>`)
    .join('');
  partyDatalist.innerHTML =
    '<option value="No party"></option>' +
    data.map((p) => `<option value="${escapeHtml(p.party_name)}"></option>`).join('');
  return data;
}

async function loadGuests() {
  const { data, error } = await safeQuery(
    supabase.from('guests').select('*, parties(party_name)').order('last_name')
  );
  if (error) {
    console.error(error);
    showDashboardError(friendlyErrorMessage(error, 'Could not load the guest list.'));
    return;
  }

  clearDashboardError();
  allGuests = data;
  renderGuestTable();
}

function renderGuestTable() {
  const query = guestSearchInput.value.trim().toLowerCase();
  const fieldKey = filterFieldSelect.value;
  const fieldValue = filterValueSelect.value;
  const fieldFilterActive = fieldKey && fieldValue !== '';

  const filtered = allGuests.filter((guest) => {
    if (query) {
      const haystack = `${guest.first_name} ${guest.last_name} ${guest.parties?.party_name ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (fieldFilterActive) {
      const actual = FILTER_FIELDS[fieldKey].get(guest);
      if (fieldValue === FILTER_BLANK ? actual !== '' : actual !== fieldValue) return false;
    }
    return true;
  });

  guestTableBody.innerHTML = '';
  for (const guest of filtered) {
    guestTableBody.appendChild(buildGuestRow(guest));
  }

  guestCountEl.textContent =
    filtered.length === allGuests.length
      ? `${allGuests.length} guest${allGuests.length === 1 ? '' : 's'}`
      : `${filtered.length} of ${allGuests.length} guests`;
  filterClearBtn.hidden = !query && !fieldFilterActive;
}

for (const [key, field] of Object.entries(FILTER_FIELDS)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = field.label;
  filterFieldSelect.appendChild(option);
}

filterFieldSelect.addEventListener('change', () => {
  const fieldKey = filterFieldSelect.value;
  filterValueSelect.innerHTML = '';
  filterValueSelect.hidden = !fieldKey;
  if (fieldKey) {
    const distinct = [...new Set(allGuests.map((g) => FILTER_FIELDS[fieldKey].get(g)))].sort();
    const anyOption = document.createElement('option');
    anyOption.value = '';
    anyOption.textContent = 'Any value';
    filterValueSelect.appendChild(anyOption);
    for (const value of distinct) {
      const option = document.createElement('option');
      option.value = value === '' ? FILTER_BLANK : value;
      option.textContent = value === '' ? '(blank)' : value;
      filterValueSelect.appendChild(option);
    }
  }
  renderGuestTable();
});

filterValueSelect.addEventListener('change', renderGuestTable);
guestSearchInput.addEventListener('input', renderGuestTable);

filterClearBtn.addEventListener('click', () => {
  guestSearchInput.value = '';
  filterFieldSelect.value = '';
  filterValueSelect.innerHTML = '';
  filterValueSelect.hidden = true;
  renderGuestTable();
});

function formatTimestamp(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function buildGuestRow(guest) {
  const tr = document.createElement('tr');
  tr.dataset.guestId = guest.id;

  const foodOptions = FOOD_OPTIONS.map(
    (opt) => `<option value="${opt}" ${guest.food_preference === opt ? 'selected' : ''}>${opt || '—'}</option>`
  ).join('');
  const rsvpOptions = RSVP_OPTIONS.map(
    (opt) => `<option value="${opt}" ${guest.rsvp_status === opt ? 'selected' : ''}>${opt}</option>`
  ).join('');
  const extraJson = JSON.stringify(guest.extra ?? {});

  tr.innerHTML = `
    <td class="admin-table__id" title="${guest.id}">${guest.id.slice(0, 8)}</td>
    <td><input type="text" class="field-party" list="party-options" value="${escapeHtml(guest.parties?.party_name)}" placeholder="No party — type to assign"></td>
    <td>${escapeHtml(guest.first_name)}</td>
    <td>${escapeHtml(guest.last_name)}</td>
    <td><input type="checkbox" class="field-invited" ${guest.invited ? 'checked' : ''}></td>
    <td><select class="field-rsvp">${rsvpOptions}</select></td>
    <td><select class="field-food">${foodOptions}</select></td>
    <td><input type="text" class="field-dietary" value="${escapeHtml(guest.dietary_notes)}"></td>
    <td><input type="text" class="field-address1" value="${escapeHtml(guest.address_line1)}"></td>
    <td><input type="text" class="field-address2" value="${escapeHtml(guest.address_line2)}"></td>
    <td><input type="text" class="field-city" value="${escapeHtml(guest.city)}"></td>
    <td><input type="text" class="field-state" value="${escapeHtml(guest.state_province)}"></td>
    <td><input type="text" class="field-postal" value="${escapeHtml(guest.postal_code)}"></td>
    <td><input type="text" class="field-country" value="${escapeHtml(guest.country)}"></td>
    <td><input type="text" class="field-extra" value="${escapeHtml(extraJson)}"></td>
    <td>${formatTimestamp(guest.responded_at)}</td>
    <td>${formatTimestamp(guest.created_at)}</td>
    <td><button type="button" class="admin-delete">Delete</button></td>
  `;

  tr.querySelector('.field-party').addEventListener('change', async (e) => {
    const name = e.target.value.trim();
    const currentName = guest.parties?.party_name ?? '';
    // Picking the "No party" option unassigns immediately; blanking the
    // field also unassigns but asks first, since it's easy to do by accident.
    const unassign = !name || name.toLowerCase() === 'no party';
    if (unassign && !currentName) {
      e.target.value = '';
      return;
    }
    if (!unassign && name === currentName) return;
    let partyId = null;
    if (!unassign) {
      const match = partyList.find((p) => p.party_name.toLowerCase() === name.toLowerCase());
      if (!match) {
        alert(`No party named "${name}" — pick one from the list, or create it with the Add Party form first.`);
        e.target.value = currentName;
        return;
      }
      partyId = match.id;
    } else if (!name && !confirm(`Remove ${guest.first_name} ${guest.last_name} from "${currentName}"?`)) {
      e.target.value = currentName;
      return;
    }
    await updateGuest(guest.id, { party_id: partyId });
    // Reload so the row reflects the joined party name, not just the id.
    await loadGuests();
  });
  tr.querySelector('.field-invited').addEventListener('change', (e) =>
    updateGuest(guest.id, { invited: e.target.checked })
  );
  tr.querySelector('.field-rsvp').addEventListener('change', (e) =>
    updateGuest(guest.id, { rsvp_status: e.target.value })
  );
  tr.querySelector('.field-food').addEventListener('change', (e) =>
    updateGuest(guest.id, { food_preference: e.target.value || null })
  );
  tr.querySelector('.field-dietary').addEventListener('change', (e) =>
    updateGuest(guest.id, { dietary_notes: e.target.value || null })
  );
  tr.querySelector('.field-address1').addEventListener('change', (e) =>
    updateGuest(guest.id, { address_line1: e.target.value || null })
  );
  tr.querySelector('.field-address2').addEventListener('change', (e) =>
    updateGuest(guest.id, { address_line2: e.target.value || null })
  );
  tr.querySelector('.field-city').addEventListener('change', (e) =>
    updateGuest(guest.id, { city: e.target.value || null })
  );
  tr.querySelector('.field-state').addEventListener('change', (e) =>
    updateGuest(guest.id, { state_province: e.target.value || null })
  );
  tr.querySelector('.field-postal').addEventListener('change', (e) =>
    updateGuest(guest.id, { postal_code: e.target.value || null })
  );
  tr.querySelector('.field-country').addEventListener('change', (e) =>
    updateGuest(guest.id, { country: e.target.value || null })
  );
  tr.querySelector('.field-extra').addEventListener('change', (e) => {
    try {
      const parsed = JSON.parse(e.target.value || '{}');
      updateGuest(guest.id, { extra: parsed });
    } catch {
      alert('Extra field must be valid JSON, e.g. {"plus_one": true}');
      e.target.value = extraJson;
    }
  });
  tr.querySelector('.admin-delete').addEventListener('click', () => deleteGuest(guest.id));

  return tr;
}

async function updateGuest(id, fields) {
  const { error } = await safeQuery(supabase.from('guests').update(fields).eq('id', id));
  if (error) {
    console.error(error);
    alert(`Saving that change failed: ${friendlyErrorMessage(error, 'Unknown error.')}`);
    // Re-render the table so the cell shows what's actually stored, not the
    // edit that didn't stick.
    await Promise.all([loadStats(), loadGuests()]);
    return;
  }
  // Keep the local copy in sync so re-renders (filter changes) don't revert
  // the cell to a stale value.
  const cached = allGuests.find((g) => g.id === id);
  if (cached) Object.assign(cached, fields);
  await loadStats();
}

async function deleteGuest(id) {
  if (!confirm('Remove this guest?')) return;
  const { error } = await safeQuery(supabase.from('guests').delete().eq('id', id));
  if (error) {
    console.error(error);
    showDashboardError(friendlyErrorMessage(error, 'Could not delete that guest.'));
    return;
  }
  await Promise.all([loadStats(), loadGuests()]);
}

addPartyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('new-party-name');
  const { error } = await safeQuery(supabase.from('parties').insert({ party_name: nameInput.value }));
  if (error) {
    console.error(error);
    showDashboardError(friendlyErrorMessage(error, 'Could not add that party.'));
    return;
  }
  nameInput.value = '';
  await loadParties();
});

addGuestForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const firstInput = document.getElementById('new-guest-first');
  const lastInput = document.getElementById('new-guest-last');
  const invitedInput = document.getElementById('new-guest-invited');

  const { error } = await safeQuery(
    supabase.from('guests').insert({
      party_id: newGuestPartySelect.value,
      first_name: firstInput.value,
      last_name: lastInput.value,
      invited: invitedInput.checked,
    })
  );
  if (error) {
    console.error(error);
    showDashboardError(friendlyErrorMessage(error, 'Could not add that guest.'));
    return;
  }
  firstInput.value = '';
  lastInput.value = '';
  await Promise.all([loadStats(), loadGuests()]);
});

exportBtn.addEventListener('click', async () => {
  const { data, error } = await safeQuery(
    supabase.from('guests').select('first_name, last_name, invited').order('last_name')
  );
  if (error) {
    console.error(error);
    showDashboardError(friendlyErrorMessage(error, 'Could not export the guest list.'));
    return;
  }

  const rows = [['Title', 'First Name', 'Last Name', 'Suffix', 'The Day!']];
  for (const g of data) {
    rows.push(['', g.first_name, g.last_name, '', g.invited ? '1' : '']);
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'zola-guest-export.csv';
  a.click();
  URL.revokeObjectURL(url);
});

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

init();
