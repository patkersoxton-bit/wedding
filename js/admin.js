import { supabase } from './supabase-client.js';

const loginSection = document.getElementById('admin-login');
const dashboardSection = document.getElementById('admin-dashboard');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutLink = document.getElementById('logout-link');
const statsEl = document.getElementById('admin-stats');
const guestTableBody = document.getElementById('guest-table-body');
const addPartyForm = document.getElementById('add-party-form');
const addGuestForm = document.getElementById('add-guest-form');
const newGuestPartySelect = document.getElementById('new-guest-party');
const exportBtn = document.getElementById('export-csv');

const FOOD_OPTIONS = ['', 'Chicken', 'Beef', 'Fish', 'Vegetarian'];
const RSVP_OPTIONS = ['pending', 'yes', 'no'];

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
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
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.hidden = false;
    loginError.textContent = error.message;
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
  const { data, error } = await supabase.from('guests').select('rsvp_status, invited');
  if (error) {
    console.error(error);
    return;
  }
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
}

async function loadParties() {
  const { data, error } = await supabase.from('parties').select('id, party_name').order('party_name');
  if (error) {
    console.error(error);
    return;
  }
  newGuestPartySelect.innerHTML = data
    .map((p) => `<option value="${p.id}">${p.party_name}</option>`)
    .join('');
  return data;
}

async function loadGuests() {
  const { data, error } = await supabase
    .from('guests')
    .select('id, first_name, last_name, invited, rsvp_status, food_preference, dietary_notes, parties(party_name)')
    .order('last_name');
  if (error) {
    console.error(error);
    return;
  }

  guestTableBody.innerHTML = '';
  for (const guest of data) {
    guestTableBody.appendChild(buildGuestRow(guest));
  }
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

  tr.innerHTML = `
    <td>${guest.parties?.party_name ?? ''}</td>
    <td>${guest.first_name}</td>
    <td>${guest.last_name}</td>
    <td><input type="checkbox" class="field-invited" ${guest.invited ? 'checked' : ''}></td>
    <td><select class="field-rsvp">${rsvpOptions}</select></td>
    <td><select class="field-food">${foodOptions}</select></td>
    <td><input type="text" class="field-dietary" value="${guest.dietary_notes ?? ''}"></td>
    <td><button type="button" class="admin-delete">Delete</button></td>
  `;

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
  tr.querySelector('.admin-delete').addEventListener('click', () => deleteGuest(guest.id));

  return tr;
}

async function updateGuest(id, fields) {
  const { error } = await supabase.from('guests').update(fields).eq('id', id);
  if (error) console.error(error);
  await loadStats();
}

async function deleteGuest(id) {
  if (!confirm('Remove this guest?')) return;
  const { error } = await supabase.from('guests').delete().eq('id', id);
  if (error) {
    console.error(error);
    return;
  }
  await Promise.all([loadStats(), loadGuests()]);
}

addPartyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('new-party-name');
  const { error } = await supabase.from('parties').insert({ party_name: nameInput.value });
  if (error) {
    console.error(error);
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

  const { error } = await supabase.from('guests').insert({
    party_id: newGuestPartySelect.value,
    first_name: firstInput.value,
    last_name: lastInput.value,
    invited: invitedInput.checked,
  });
  if (error) {
    console.error(error);
    return;
  }
  firstInput.value = '';
  lastInput.value = '';
  await Promise.all([loadStats(), loadGuests()]);
});

exportBtn.addEventListener('click', async () => {
  const { data, error } = await supabase
    .from('guests')
    .select('first_name, last_name, invited')
    .order('last_name');
  if (error) {
    console.error(error);
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
