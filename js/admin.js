// Planner dashboard (admin.html).
//
// Every DB value that reaches innerHTML goes through escapeHtml() — guests
// can write several of these fields through public RPCs (address page,
// RSVP), so unescaped interpolation here would be a stored-XSS hole in an
// authenticated session. Prefer textContent where markup isn't needed.
import { supabase, safeQuery, friendlyErrorMessage } from './supabase-client.js';
import { buildPieCard, buildMeterCard } from './charts.js';
import { escapeHtml } from './escape.js';

const $ = (id) => document.getElementById(id);

// Single shared master-password login: one fixed Supabase Auth account
// behind the scenes (RLS grants full access to any authenticated session).
// Swap for per-planner accounts before going live.
const ADMIN_EMAIL = 'admin@parkerandjolan.com';

const FOOD_OPTIONS = ['', 'Chicken', 'Beef', 'Fish', 'Vegetarian'];
const TITLE_OPTIONS = ['', 'Mr.', 'Mrs.', 'Ms.', 'Mx.', 'Dr.', 'Miss'];
const RSVP_OPTIONS = ['pending', 'yes', 'no'];

// Chart colors: deepened, CVD-checked inks from the site palette. Fixed per
// category, never reassigned by value.
const CHART_COLORS = {
  rose: '#bf2859',
  amber: '#c97f0c',
  olive: '#74712f',
  sky: '#4f7d9c',
  gray: '#b3ab9c',
};

const SMS_LINK_KEY = 'pj_admin_sms_link';
const SMS_TEMPLATE_KEY = 'pj_admin_sms_template';
const DEFAULT_SMS_TEMPLATE =
  "Hi {first}! It's Parker & Jolan 💐 We're getting our wedding invitations ready — could you send us your mailing address here? {link} Thank you!";

const state = {
  guests: [],
  parties: [],
  submissions: [],
  guestById: new Map(),
  partyById: new Map(),
  guestLabelToId: new Map(),
  guestIdToLabel: new Map(),
  selected: new Set(),
  visibleIds: [],
  quick: 'all',
  phoneImport: null,
};

// ================================================================
// Small helpers
// ================================================================

const fullName = (g) => `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim();
const partyName = (g) => state.partyById.get(g.party_id)?.party_name ?? '';
const hasAddress = (g) => Boolean(g.address_line1 && g.city);
const hasPhone = (g) => Boolean(normalizePhone(g.phone));
const textedAt = (g) => g.extra?.address_texted_at ?? null;

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-10) : '';
}

function formatTimestamp(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

let toastTimer;
function toast(message, kind = 'ok') {
  const el = $('admin-toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 2200);
}

function showDashboardError(message) {
  $('dashboard-error').textContent = message;
  $('dashboard-error').hidden = false;
}

function clearDashboardError() {
  $('dashboard-error').hidden = true;
}

function reportError(error, fallback) {
  console.error(error);
  toast(friendlyErrorMessage(error, fallback), 'error');
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

// Shutterfly's importer rejects quoted fields; only quote when a
// comma/quote/newline would otherwise break the column split.
function bareCsvCell(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCsv(filename, rows, cell = csvCell) {
  const csv = rows.map((row) => row.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Minimal CSV line parser (handles quoted fields and "" escapes); also
// accepts tab-separated lines pasted from a spreadsheet.
function parseDelimitedLine(line) {
  const delimiter = line.includes('\t') ? '\t' : ',';
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

// ================================================================
// Tabs
// ================================================================

function switchTab(name) {
  document.querySelectorAll('.admin-tab').forEach((b) => {
    const active = b.dataset.tab === name;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.admin-tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== `tab-${name}`;
  });
}

document.querySelectorAll('.admin-tab').forEach((btn) =>
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
);

// ================================================================
// Auth
// ================================================================

async function init() {
  const { data, error } = await safeQuery(supabase.auth.getSession());
  if (error) {
    console.error(error);
    showLogin();
    $('login-error').hidden = false;
    $('login-error').textContent = friendlyErrorMessage(error, 'Could not check your session.');
    return;
  }
  if (data.session) showDashboard();
  else showLogin();

  // Expired/revoked session → back to the login form instead of a
  // dashboard where every save silently fails.
  supabase.auth.onAuthStateChange((event, session) => {
    if (!session && !$('admin-dashboard').hidden) showLogin();
  });
}

function showLogin() {
  $('admin-login').hidden = false;
  $('admin-dashboard').hidden = true;
  $('logout-link').hidden = true;
  $('login-password').focus();
}

async function showDashboard() {
  $('admin-login').hidden = true;
  $('admin-dashboard').hidden = false;
  $('logout-link').hidden = false;
  await loadAll();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('login-password').value;
  const { error } = await safeQuery(supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password }));
  if (error) {
    $('login-error').hidden = false;
    $('login-error').textContent =
      /invalid login/i.test(error.message || '') ? 'That password isn’t right.' : friendlyErrorMessage(error, 'Login failed. Please try again.');
    return;
  }
  $('login-error').hidden = true;
  $('login-password').value = '';
  showDashboard();
});

$('logout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  showLogin();
});

$('refresh-btn').addEventListener('click', () => loadAll());

// ================================================================
// Data loading
// ================================================================

async function loadAll() {
  const [g, p, s] = await Promise.all([
    safeQuery(supabase.from('guests').select('*').order('last_name').order('first_name')),
    safeQuery(supabase.from('parties').select('*').order('party_name')),
    safeQuery(supabase.from('address_submissions').select('*').order('created_at', { ascending: false })),
  ]);
  const failed = [g, p, s].find((r) => r.error);
  if (failed) {
    console.error(failed.error);
    showDashboardError(friendlyErrorMessage(failed.error, 'Could not load the guest list.'));
    return;
  }
  clearDashboardError();
  // Sort by last name, falling back to first name for first-name-only
  // guests so they interleave instead of piling up at the top.
  const sortKey = (x) => `${(x.last_name || x.first_name || '').trim().toLowerCase()} ${(x.first_name || '').toLowerCase()}`;
  state.guests = g.data.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  state.parties = p.data;
  state.submissions = s.data;
  reindex();
  for (const id of [...state.selected]) if (!state.guestById.has(id)) state.selected.delete(id);
  renderAll();
  $('last-loaded').textContent = `Loaded ${new Date().toLocaleTimeString(undefined, { timeStyle: 'short' })}`;
}

function reindex() {
  state.guestById = new Map(state.guests.map((g) => [g.id, g]));
  state.partyById = new Map(state.parties.map((p) => [p.id, p]));
  state.parties.sort((a, b) => a.party_name.localeCompare(b.party_name));

  // Unique, human-readable labels for the guest picker datalist. Two
  // guests can share a name (e.g. two "Mike Motyka"), so the party (and,
  // if still ambiguous, a short id) disambiguates.
  state.guestLabelToId = new Map();
  state.guestIdToLabel = new Map();
  const counts = new Map();
  for (const g of state.guests) {
    const key = fullName(g).toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const g of state.guests) {
    let label = fullName(g);
    if (counts.get(label.toLowerCase()) > 1) {
      label += ` — ${partyName(g) || 'no party'} · #${g.id.slice(0, 4)}`;
    }
    state.guestLabelToId.set(label.toLowerCase(), g.id);
    state.guestIdToLabel.set(g.id, label);
  }
}

function renderAll() {
  renderGuestTable();
  renderDerived();
}

// Everything except the guest table — safe to call after an inline cell
// edit without stealing focus from the table.
function renderDerived() {
  renderDatalists();
  renderOverview();
  renderParties();
  renderSuggestions();
  renderSms();
  renderInbox();
  renderBadges();
}

function renderDatalists() {
  $('party-options').innerHTML =
    '<option value="No party"></option>' +
    state.parties.map((p) => `<option value="${escapeHtml(p.party_name)}"></option>`).join('');
  $('guest-options').innerHTML = state.guests
    .map((g) => `<option value="${escapeHtml(state.guestIdToLabel.get(g.id))}"></option>`)
    .join('');
}

function renderBadges() {
  const unassigned = state.guests.filter((g) => g.invited && !g.party_id).length;
  const pending = state.submissions.filter((s) => s.status === 'pending').length;
  $('badge-unassigned').textContent = unassigned;
  $('badge-unassigned').hidden = unassigned === 0;
  $('badge-unassigned').title = `${unassigned} invited guests not in a party`;
  $('badge-inbox').textContent = pending;
  $('badge-inbox').hidden = pending === 0;
}

// ================================================================
// Writes
// ================================================================

async function updateGuest(id, fields, { quiet = false } = {}) {
  const { error } = await safeQuery(supabase.from('guests').update(fields).eq('id', id));
  if (error) {
    reportError(error, 'Saving that change failed.');
    await loadAll(); // show what's actually stored, not the edit that didn't stick
    return false;
  }
  const g = state.guestById.get(id);
  if (g) Object.assign(g, fields);
  if ('party_id' in fields || 'first_name' in fields || 'last_name' in fields) reindex();
  renderDerived();
  if (!quiet) toast('Saved');
  return true;
}

async function updateGuests(ids, fields, message) {
  if (!ids.length) return false;
  const { error } = await safeQuery(supabase.from('guests').update(fields).in('id', ids));
  if (error) {
    reportError(error, 'Saving those changes failed.');
    await loadAll();
    return false;
  }
  for (const id of ids) Object.assign(state.guestById.get(id) ?? {}, fields);
  reindex();
  renderAll();
  toast(message ?? `Updated ${plural(ids.length, 'guest')}`);
  return true;
}

function findPartyByName(name) {
  const key = name.trim().toLowerCase();
  return state.parties.find((p) => p.party_name.trim().toLowerCase() === key) ?? null;
}

// Returns the id of the party with this name, creating it if needed (after
// asking, when `confirmCreate`). Returns null if the planner cancelled.
async function ensureParty(name, { confirmCreate = true } = {}) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = findPartyByName(trimmed);
  if (existing) return existing.id;
  if (confirmCreate && !confirm(`There's no party called "${trimmed}" yet. Create it?`)) return null;
  const { data, error } = await safeQuery(
    supabase.from('parties').insert({ party_name: trimmed }).select().single()
  );
  if (error) {
    reportError(error, 'Could not create that party.');
    return null;
  }
  state.parties.push(data);
  reindex();
  return data.id;
}

// ================================================================
// Overview
// ================================================================

function renderOverview() {
  const invited = state.guests.filter((g) => g.invited);
  const n = invited.length;
  const inParty = invited.filter((g) => g.party_id).length;
  const withPhone = invited.filter(hasPhone).length;
  const withAddress = invited.filter(hasAddress).length;
  const yes = invited.filter((g) => g.rsvp_status === 'yes').length;
  const no = invited.filter((g) => g.rsvp_status === 'no').length;
  const pendingRsvp = n - yes - no;
  const inbox = state.submissions.filter((s) => s.status === 'pending').length;
  const texted = invited.filter((g) => textedAt(g)).length;

  const steps = [
    {
      title: 'Finalize the guest list',
      done: inParty,
      total: n,
      detail: `${plural(n, 'invited guest')} · ${plural(state.parties.length, 'party', 'parties')} · ${n - inParty} not in a party yet`,
      tab: 'parties',
      cta: 'Group into parties',
    },
    {
      title: 'Collect phone numbers',
      done: withPhone,
      total: n,
      detail: `${withPhone} of ${n} have a phone number · ${texted} texted the address link`,
      tab: 'phones',
      cta: 'Import & text',
    },
    {
      title: 'Collect mailing addresses',
      done: withAddress,
      total: n,
      detail: `${withAddress} of ${n} have an address${inbox ? ` · ${plural(inbox, 'submission')} waiting in the inbox` : ''}`,
      tab: 'inbox',
      cta: inbox ? 'Review inbox' : 'Open inbox',
    },
    {
      title: 'RSVPs',
      done: yes + no,
      total: n,
      detail: `${yes} attending · ${no} declined · ${pendingRsvp} awaiting`,
      tab: 'guests',
      cta: 'View guests',
    },
  ];

  $('admin-steps').innerHTML = steps
    .map((s, i) => {
      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      return `
      <div class="admin-step">
        <div class="admin-step__num">${i + 1}</div>
        <div class="admin-step__body">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="admin-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
          <p class="admin-hint">${escapeHtml(s.detail)}</p>
        </div>
        <button type="button" class="admin-btn" data-goto="${s.tab}">${escapeHtml(s.cta)}</button>
      </div>`;
    })
    .join('');

  const stats = [
    [state.guests.length, 'On the list'],
    [n, 'Invited'],
    [yes, 'Attending'],
    [no, 'Declined'],
    [pendingRsvp, 'Awaiting RSVP'],
  ];
  $('admin-stats').innerHTML = stats
    .map(([v, label]) => `<div class="admin-stat"><strong>${v}</strong><span>${escapeHtml(label)}</span></div>`)
    .join('');

  renderCharts(invited, yes, no, pendingRsvp);
}

$('admin-steps').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if (btn) switchTab(btn.dataset.goto);
});

function renderCharts(invited, yes, no, pending) {
  const row = $('chart-row');
  row.innerHTML = '';
  row.appendChild(
    buildPieCard({
      title: 'RSVP responses',
      slices: [
        { label: 'Attending', value: yes, color: CHART_COLORS.olive },
        { label: 'Declined', value: no, color: CHART_COLORS.rose },
        { label: 'Awaiting response', value: pending, color: CHART_COLORS.sky },
      ],
    })
  );

  const meals = { Chicken: 0, Beef: 0, Fish: 0, Vegetarian: 0 };
  let noMeal = 0;
  invited.forEach((g) => {
    if (g.food_preference in meals) meals[g.food_preference] += 1;
    else noMeal += 1;
  });
  row.appendChild(
    buildPieCard({
      title: 'Meal preference',
      slices: [
        { label: 'Chicken', value: meals.Chicken, color: CHART_COLORS.amber },
        { label: 'Beef', value: meals.Beef, color: CHART_COLORS.rose },
        { label: 'Fish', value: meals.Fish, color: CHART_COLORS.sky },
        { label: 'Vegetarian', value: meals.Vegetarian, color: CHART_COLORS.olive },
        { label: 'Not selected', value: noMeal, color: CHART_COLORS.gray },
      ],
    })
  );
  row.appendChild(
    buildMeterCard({
      title: 'Response rate',
      value: yes + no,
      total: invited.length,
      color: CHART_COLORS.rose,
      trackColor: '#efe6d8',
    })
  );
}

// ================================================================
// Guests table
// ================================================================

const COLUMNS = [
  { key: 'first_name', label: 'First', kind: 'text', required: true, sticky: 1 },
  { key: 'last_name', label: 'Last', kind: 'text', sticky: 2 },
  { key: 'party', label: 'Party', kind: 'party' },
  { key: 'invited', label: 'Invited', kind: 'bool' },
  { key: 'phone', label: 'Phone', kind: 'text', type: 'tel' },
  { key: 'email', label: 'Email', kind: 'text', type: 'email' },
  { key: 'title', label: 'Title', kind: 'select', options: TITLE_OPTIONS },
  { key: 'address_line1', label: 'Address 1', kind: 'text', wide: true },
  { key: 'address_line2', label: 'Address 2', kind: 'text' },
  { key: 'city', label: 'City', kind: 'text' },
  { key: 'state_province', label: 'State', kind: 'text', narrow: true },
  { key: 'postal_code', label: 'Zip', kind: 'text', narrow: true },
  { key: 'country', label: 'Country', kind: 'text', narrow: true },
  { key: 'rsvp_status', label: 'RSVP', kind: 'select', options: RSVP_OPTIONS },
  { key: 'food_preference', label: 'Meal', kind: 'select', options: FOOD_OPTIONS },
  { key: 'dietary_notes', label: 'Dietary notes', kind: 'text', wide: true },
  { key: 'extra', label: 'Extra (JSON)', kind: 'json' },
  { key: 'responded_at', label: 'Responded', kind: 'time' },
  { key: 'created_at', label: 'Added', kind: 'time' },
];

const QUICK_FILTERS = {
  all: { label: 'All', test: () => true },
  invited: { label: 'Invited', test: (g) => g.invited },
  noparty: { label: 'No party', test: (g) => !g.party_id },
  nophone: { label: 'No phone', test: (g) => g.invited && !hasPhone(g) },
  noaddress: { label: 'No address', test: (g) => g.invited && !hasAddress(g) },
  awaiting: { label: 'Awaiting RSVP', test: (g) => g.invited && g.rsvp_status === 'pending' },
  notinvited: { label: 'Not invited', test: (g) => !g.invited },
};

// Extra per-field filters ("More filters…"). '' = blank/unset.
const FILTER_FIELDS = {
  party: { label: 'Party', get: (g) => partyName(g), blank: 'No party' },
  rsvp_status: { label: 'RSVP', get: (g) => g.rsvp_status ?? '' },
  food_preference: { label: 'Meal', get: (g) => g.food_preference ?? '' },
  title: { label: 'Title', get: (g) => g.title ?? '' },
  city: { label: 'City', get: (g) => g.city ?? '' },
  state_province: { label: 'State', get: (g) => g.state_province ?? '' },
  country: { label: 'Country', get: (g) => g.country ?? '' },
};
const FILTER_BLANK = '__blank__';

function buildGuestTableHead() {
  $('guest-table-head').innerHTML = `<tr>
    <th class="is-sticky is-sticky-0"><input type="checkbox" id="select-all" aria-label="Select all shown guests"></th>
    ${COLUMNS.map((c) => `<th class="${c.sticky ? `is-sticky is-sticky-${c.sticky}` : ''}">${escapeHtml(c.label)}</th>`).join('')}
    <th></th>
  </tr>`;
  $('select-all').addEventListener('change', (e) => {
    for (const id of state.visibleIds) {
      if (e.target.checked) state.selected.add(id);
      else state.selected.delete(id);
    }
    renderGuestTable();
  });
}

function buildQuickFilters() {
  $('quick-filters').innerHTML = Object.entries(QUICK_FILTERS)
    .map(([key, f]) => `<button type="button" class="admin-chip" data-quick="${key}" aria-pressed="${key === state.quick}">${escapeHtml(f.label)}</button>`)
    .join('');
}

$('quick-filters').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-quick]');
  if (!chip) return;
  setQuickFilter(chip.dataset.quick);
});

function setQuickFilter(key) {
  state.quick = key;
  document.querySelectorAll('.admin-chip[data-quick]').forEach((c) =>
    c.setAttribute('aria-pressed', c.dataset.quick === key ? 'true' : 'false')
  );
  renderGuestTable();
}

function renderCell(g, col) {
  const cls = [col.sticky ? `is-sticky is-sticky-${col.sticky}` : '', col.wide ? 'is-wide' : '', col.narrow ? 'is-narrow' : '']
    .filter(Boolean)
    .join(' ');
  const td = (inner) => `<td class="${cls}">${inner}</td>`;
  const aria = `aria-label="${escapeHtml(`${col.label} for ${fullName(g)}`)}"`;
  switch (col.kind) {
    case 'text':
      return td(`<input type="${col.type ?? 'text'}" data-field="${col.key}" value="${escapeHtml(g[col.key])}" ${col.required ? 'required' : ''} ${aria}>`);
    case 'select': {
      const current = g[col.key] ?? '';
      const opts = col.options
        .map((o) => `<option value="${escapeHtml(o)}" ${current === o ? 'selected' : ''}>${escapeHtml(o || '—')}</option>`)
        .join('');
      // Keep an unexpected stored value visible instead of silently showing "—".
      const extra = current && !col.options.includes(current) ? `<option selected>${escapeHtml(current)}</option>` : '';
      return td(`<select data-field="${col.key}" ${aria}>${extra}${opts}</select>`);
    }
    case 'bool':
      return td(`<input type="checkbox" data-field="${col.key}" ${g[col.key] ? 'checked' : ''} ${aria}>`);
    case 'party':
      return td(`<input type="text" data-field="party" list="party-options" value="${escapeHtml(partyName(g))}" placeholder="No party" ${aria}>`);
    case 'json':
      return td(`<input type="text" class="is-mono" data-field="extra" value="${escapeHtml(JSON.stringify(g.extra ?? {}))}" ${aria}>`);
    case 'time':
      return td(`<span class="admin-muted" data-time="${col.key}">${escapeHtml(formatTimestamp(g[col.key]))}</span>`);
    default:
      return td('');
  }
}

function guestMatchesFilters(g) {
  if (!QUICK_FILTERS[state.quick].test(g)) return false;
  const q = $('guest-search').value.trim().toLowerCase();
  if (q) {
    const qDigits = q.replace(/\D/g, '');
    const hay = `${fullName(g)} ${partyName(g)} ${g.email ?? ''}`.toLowerCase();
    const phoneHit = qDigits.length >= 3 && normalizePhone(g.phone).includes(qDigits);
    if (!hay.includes(q) && !phoneHit) return false;
  }
  const fieldKey = $('filter-field').value;
  const fieldValue = $('filter-value').value;
  if (fieldKey && fieldValue !== '') {
    const actual = FILTER_FIELDS[fieldKey].get(g);
    if (fieldValue === FILTER_BLANK ? actual !== '' : actual !== fieldValue) return false;
  }
  return true;
}

function renderGuestTable() {
  const rows = state.guests.filter(guestMatchesFilters);
  state.visibleIds = rows.map((g) => g.id);

  $('guest-table-body').innerHTML = rows.length
    ? rows
        .map(
          (g) => `<tr data-id="${escapeHtml(g.id)}" class="${state.selected.has(g.id) ? 'is-selected' : ''} ${g.invited ? '' : 'is-uninvited'}">
            <td class="is-sticky is-sticky-0"><input type="checkbox" class="row-select" ${state.selected.has(g.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(fullName(g))}"></td>
            ${COLUMNS.map((c) => renderCell(g, c)).join('')}
            <td><button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-action="delete-guest">Delete</button></td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="${COLUMNS.length + 2}" class="admin-empty">No guests match these filters.</td></tr>`;

  const total = state.guests.length;
  $('guest-count').textContent = rows.length === total ? plural(total, 'guest') : `${rows.length} of ${total} guests`;
  const filtersActive = state.quick !== 'all' || $('guest-search').value.trim() || ($('filter-field').value && $('filter-value').value);
  $('filter-clear').hidden = !filtersActive;

  const selectAll = $('select-all');
  const selectedVisible = state.visibleIds.filter((id) => state.selected.has(id)).length;
  selectAll.checked = rows.length > 0 && selectedVisible === rows.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < rows.length;
  renderBulkBar();
}

function renderBulkBar() {
  const n = state.selected.size;
  $('bulk-bar').hidden = n === 0;
  $('bulk-count').textContent = `${plural(n, 'guest')} selected`;
}

for (const [key, field] of Object.entries(FILTER_FIELDS)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = field.label;
  $('filter-field').appendChild(option);
}

$('filter-field').addEventListener('change', () => {
  const key = $('filter-field').value;
  const valueSelect = $('filter-value');
  valueSelect.innerHTML = '';
  valueSelect.hidden = !key;
  if (key) {
    const field = FILTER_FIELDS[key];
    const distinct = [...new Set(state.guests.map(field.get))].sort((a, b) => a.localeCompare(b));
    valueSelect.add(new Option('Any value', ''));
    for (const v of distinct) valueSelect.add(new Option(v === '' ? `(${field.blank ?? 'blank'})` : v, v === '' ? FILTER_BLANK : v));
  }
  renderGuestTable();
});
$('filter-value').addEventListener('change', renderGuestTable);
$('guest-search').addEventListener('input', renderGuestTable);
$('filter-clear').addEventListener('click', () => {
  $('guest-search').value = '';
  $('filter-field').value = '';
  $('filter-value').innerHTML = '';
  $('filter-value').hidden = true;
  setQuickFilter('all');
});

// One delegated listener for every editable cell.
$('guest-table-body').addEventListener('change', async (e) => {
  const input = e.target;
  const tr = input.closest('tr[data-id]');
  if (!tr) return;
  const id = tr.dataset.id;
  const g = state.guestById.get(id);
  if (!g) return;

  if (input.classList.contains('row-select')) {
    if (input.checked) state.selected.add(id);
    else state.selected.delete(id);
    tr.classList.toggle('is-selected', input.checked);
    renderGuestTable();
    return;
  }

  const field = input.dataset.field;
  switch (field) {
    case 'party':
      await changeGuestParty(g, input);
      return;
    case 'invited':
      await updateGuest(id, { invited: input.checked });
      tr.classList.toggle('is-uninvited', !input.checked);
      return;
    case 'extra': {
      let parsed;
      try {
        parsed = JSON.parse(input.value.trim() || '{}');
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        toast('Extra must be a JSON object, e.g. {"plus_one": true}', 'error');
        input.value = JSON.stringify(g.extra ?? {});
        return;
      }
      await updateGuest(id, { extra: parsed });
      return;
    }
    case 'rsvp_status': {
      // Keep responded_at consistent with the status (stats and the
      // "Responded" column both rely on it).
      const respondedAt = input.value === 'pending' ? null : new Date().toISOString();
      if (await updateGuest(id, { rsvp_status: input.value, responded_at: respondedAt })) {
        const cell = tr.querySelector('[data-time="responded_at"]');
        if (cell) cell.textContent = formatTimestamp(respondedAt);
      }
      return;
    }
    case 'last_name':
      // Some guests are first-name-only (e.g. "Zoe's Boyfriend"); the
      // column is NOT NULL, so blank is stored as ''.
      await updateGuest(id, { last_name: input.value.trim() });
      return;
    case 'first_name': {
      const value = input.value.trim();
      if (!value) {
        toast('First name can’t be blank.', 'error');
        input.value = g[field];
        return;
      }
      await updateGuest(id, { [field]: value });
      return;
    }
    default:
      await updateGuest(id, { [field]: input.value.trim() || null });
  }
});

async function changeGuestParty(g, input) {
  const name = input.value.trim();
  const current = partyName(g);
  const unassign = !name || name.toLowerCase() === 'no party';
  if (unassign) {
    input.value = '';
    if (!g.party_id) return;
    await updateGuest(g.id, { party_id: null }, { quiet: true });
    toast(`Removed ${fullName(g)} from ${current}`);
    return;
  }
  if (name.toLowerCase() === current.toLowerCase()) {
    input.value = current;
    return;
  }
  const partyId = await ensureParty(name);
  if (!partyId) {
    input.value = current;
    return;
  }
  await updateGuest(g.id, { party_id: partyId }, { quiet: true });
  input.value = partyName(g);
  toast(`${fullName(g)} → ${partyName(g)}`);
}

$('guest-table-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-guest"]');
  if (!btn) return;
  const g = state.guestById.get(btn.closest('tr').dataset.id);
  if (!g || !confirm(`Delete ${fullName(g)} from the guest list? This can't be undone.`)) return;
  const { error } = await safeQuery(supabase.from('guests').delete().eq('id', g.id));
  if (error) return reportError(error, 'Could not delete that guest.');
  state.selected.delete(g.id);
  toast(`Deleted ${fullName(g)}`);
  await loadAll();
});

// ---------- bulk actions ----------

$('bulk-assign').addEventListener('click', async () => {
  const name = $('bulk-party').value.trim();
  if (!name || name.toLowerCase() === 'no party') {
    toast('Type or pick a party name first.', 'error');
    $('bulk-party').focus();
    return;
  }
  const partyId = await ensureParty(name);
  if (!partyId) return;
  const ids = [...state.selected];
  if (await updateGuests(ids, { party_id: partyId }, `Moved ${plural(ids.length, 'guest')} to ${state.partyById.get(partyId).party_name}`)) {
    state.selected.clear();
    $('bulk-party').value = '';
    renderGuestTable();
  }
});

$('bulk-unassign').addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!confirm(`Remove ${plural(ids.length, 'guest')} from their parties?`)) return;
  if (await updateGuests(ids, { party_id: null })) {
    state.selected.clear();
    renderGuestTable();
  }
});

$('bulk-invite').addEventListener('click', () => updateGuests([...state.selected], { invited: true }));
$('bulk-uninvite').addEventListener('click', () => updateGuests([...state.selected], { invited: false }));
$('bulk-clear').addEventListener('click', () => {
  state.selected.clear();
  renderGuestTable();
});

// ---------- add guest ----------

$('new-guest-title').innerHTML = TITLE_OPTIONS.map((o) => `<option value="${o}">${o || 'Title'}</option>`).join('');

$('add-guest-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const first = $('new-guest-first').value.trim();
  const last = $('new-guest-last').value.trim();
  if (!first) return;
  const partyText = $('new-guest-party').value.trim();
  let partyId = null;
  if (partyText && partyText.toLowerCase() !== 'no party') {
    partyId = await ensureParty(partyText);
    if (!partyId) return;
  }
  const duplicate = state.guests.find((g) => fullName(g).toLowerCase() === `${first} ${last}`.toLowerCase());
  if (duplicate && !confirm(`${first} ${last} is already on the list. Add another guest with the same name?`)) return;

  const { error } = await safeQuery(
    supabase.from('guests').insert({
      party_id: partyId,
      title: $('new-guest-title').value || null,
      first_name: first,
      last_name: last,
      phone: $('new-guest-phone').value.trim() || null,
      invited: $('new-guest-invited').checked,
    })
  );
  if (error) return reportError(error, 'Could not add that guest.');
  e.target.reset();
  $('new-guest-invited').checked = true;
  toast(`Added ${first} ${last}`);
  await loadAll();
  $('new-guest-first').focus();
});

// ---------- exports ----------

$('export-csv').addEventListener('click', () => {
  const rows = [['Title', 'First Name', 'Last Name', 'Suffix', 'The Day!']];
  for (const g of state.guests) rows.push([g.title ?? '', g.first_name, g.last_name, '', g.invited ? '1' : '']);
  downloadCsv('zola-guest-export.csv', rows);
});

// Shutterfly is for mailing, so: invited guests only, one row per household
// (party) — one envelope each — using the first member with an address.
// Guests not in a party yet each count as their own household.
$('export-csv-shutterfly').addEventListener('click', () => {
  const households = new Map();
  for (const g of state.guests) {
    if (!g.invited) continue;
    const key = g.party_id ?? `solo:${g.id}`;
    if (!households.has(key)) households.set(key, []);
    households.get(key).push(g);
  }
  const rows = [[
    'First Name*', 'Last Name*', 'Display Name*', 'Address Line 1*', 'Address Line 2',
    'City*', 'Commune', 'State*', 'Zip Code*', 'Country*', 'Email', 'Phones',
  ]];
  let skipped = 0;
  for (const [key, members] of households) {
    const g = members.find(hasAddress);
    if (!g) { skipped++; continue; }
    const display = key.startsWith('solo:') ? `${g.title ? `${g.title} ` : ''}${fullName(g)}` : state.partyById.get(key)?.party_name ?? fullName(g);
    rows.push([
      g.first_name, g.last_name, display, g.address_line1, g.address_line2 ?? '',
      g.city, '', g.state_province ?? '', g.postal_code ?? '', g.country || 'USA',
      g.email ?? '', g.phone ?? '',
    ]);
  }
  downloadCsv('shutterfly-address-export.csv', rows, bareCsvCell);
  toast(`Exported ${plural(rows.length - 1, 'household')}${skipped ? ` · ${skipped} skipped (no address yet)` : ''}`);
});

// ================================================================
// Parties
// ================================================================

$('add-party-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('new-party-name').value.trim();
  if (!name) return;
  if (findPartyByName(name)) {
    toast(`"${name}" already exists.`, 'error');
    return;
  }
  const id = await ensureParty(name, { confirmCreate: false });
  if (!id) return;
  $('new-party-name').value = '';
  toast(`Created ${name}`);
  renderAll();
});

function renderParties() {
  const q = $('party-search').value.trim().toLowerCase();
  const members = new Map(state.parties.map((p) => [p.id, []]));
  for (const g of state.guests) if (g.party_id && members.has(g.party_id)) members.get(g.party_id).push(g);

  const parties = state.parties.filter((p) => {
    if (!q) return true;
    if (p.party_name.toLowerCase().includes(q)) return true;
    return members.get(p.id).some((g) => fullName(g).toLowerCase().includes(q));
  });

  if (!parties.length) {
    $('party-list').innerHTML = `<p class="admin-empty">${state.parties.length ? 'No parties match that search.' : 'No parties yet — create one above, or group unassigned guests.'}</p>`;
    return;
  }

  $('party-list').innerHTML = parties
    .map((p) => {
      const list = members.get(p.id);
      const invited = list.filter((g) => g.invited);
      const yes = invited.filter((g) => g.rsvp_status === 'yes').length;
      const no = invited.filter((g) => g.rsvp_status === 'no').length;
      const withAddr = invited.filter(hasAddress).length;
      const summary = list.length
        ? `${plural(invited.length, 'invited guest')} · ${withAddr}/${invited.length} with address · RSVP ${yes} yes, ${no} no, ${invited.length - yes - no} awaiting`
        : 'Empty party';
      return `
      <article class="admin-party" data-party-id="${escapeHtml(p.id)}">
        <div class="admin-party__head">
          <input type="text" class="admin-party__name" data-party-field="party_name" value="${escapeHtml(p.party_name)}" aria-label="Party name">
          <button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-action="delete-party">Delete party</button>
        </div>
        <p class="admin-hint">${escapeHtml(summary)}</p>
        <ul class="admin-members">
          ${list
            .map(
              (g) => `<li class="admin-member ${g.invited ? '' : 'is-uninvited'}">
                ${escapeHtml(fullName(g))}${g.invited ? '' : ' <small>(not invited)</small>'}${hasAddress(g) ? ' <span class="admin-dot" title="Address on file">●</span>' : ''}
                <button type="button" data-action="remove-member" data-guest-id="${escapeHtml(g.id)}" aria-label="Remove ${escapeHtml(fullName(g))} from ${escapeHtml(p.party_name)}">×</button>
              </li>`
            )
            .join('')}
        </ul>
        <div class="admin-party__foot">
          <input type="text" list="guest-options" data-action="add-member" placeholder="Add a guest by name…" aria-label="Add a guest to ${escapeHtml(p.party_name)}">
          <input type="text" data-party-field="notes" value="${escapeHtml(p.notes)}" placeholder="Notes (e.g. plus-one allowed, kids' names)" aria-label="Notes for ${escapeHtml(p.party_name)}">
        </div>
      </article>`;
    })
    .join('');
}

$('party-search').addEventListener('input', renderParties);

$('party-list').addEventListener('change', async (e) => {
  const input = e.target;
  const card = input.closest('[data-party-id]');
  if (!card) return;
  const party = state.partyById.get(card.dataset.partyId);
  if (!party) return;

  if (input.dataset.partyField === 'party_name') {
    const name = input.value.trim();
    const clash = findPartyByName(name);
    if (!name || (clash && clash.id !== party.id)) {
      toast(name ? `"${name}" already exists — use a different name.` : 'Party names can’t be blank.', 'error');
      input.value = party.party_name;
      return;
    }
    await updateParty(party, { party_name: name });
  } else if (input.dataset.partyField === 'notes') {
    await updateParty(party, { notes: input.value.trim() || null });
  } else if (input.dataset.action === 'add-member') {
    const id = state.guestLabelToId.get(input.value.trim().toLowerCase());
    if (!id) {
      toast('Pick a guest from the suggestions list.', 'error');
      return;
    }
    const g = state.guestById.get(id);
    if (g.party_id === party.id) return;
    if (g.party_id && !confirm(`${fullName(g)} is in ${partyName(g)}. Move them to ${party.party_name}?`)) return;
    await updateGuests([id], { party_id: party.id }, `${fullName(g)} → ${party.party_name}`);
  }
});

$('party-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.tagName !== 'BUTTON') return;
  const party = state.partyById.get(btn.closest('[data-party-id]').dataset.partyId);
  if (!party) return;

  if (btn.dataset.action === 'remove-member') {
    const g = state.guestById.get(btn.dataset.guestId);
    await updateGuests([g.id], { party_id: null }, `Removed ${fullName(g)} from ${party.party_name}`);
  } else if (btn.dataset.action === 'delete-party') {
    const count = state.guests.filter((g) => g.party_id === party.id).length;
    const msg = count
      ? `Delete "${party.party_name}"? Its ${plural(count, 'guest')} stay on the list, just without a party.`
      : `Delete the empty party "${party.party_name}"?`;
    if (!confirm(msg)) return;
    const { error } = await safeQuery(supabase.from('parties').delete().eq('id', party.id));
    if (error) return reportError(error, 'Could not delete that party.');
    toast(`Deleted ${party.party_name}`);
    await loadAll();
  }
});

async function updateParty(party, fields) {
  const { error } = await safeQuery(supabase.from('parties').update(fields).eq('id', party.id));
  if (error) {
    reportError(error, 'Could not save that party.');
    await loadAll();
    return;
  }
  Object.assign(party, fields);
  reindex();
  renderAll();
  toast('Saved');
}

// ---------- grouping suggestions ----------

function renderSuggestions() {
  const unassigned = state.guests.filter((g) => !g.party_id);
  const groups = new Map();
  for (const g of unassigned) {
    const key = (g.last_name ?? '').trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  // First-name-only guests share the '' key but aren't a household.
  const noLast = groups.get('')?.length ?? 0;
  groups.delete('');
  const multi = [...groups.values()].filter((list) => list.length > 1).sort((a, b) => b.length - a.length);
  const singles = unassigned.length - noLast - multi.reduce((n, l) => n + l.length, 0);

  if (!unassigned.length) {
    $('suggest-list').innerHTML = '<p class="admin-empty">Everyone is in a party. 🎉</p>';
    return;
  }

  $('suggest-list').innerHTML =
    multi
      .map((list) => {
        const last = list[0].last_name.trim();
        const suggested = findPartyByName(`The ${last} Family`) ? '' : `The ${last} Family`;
        return `
        <div class="admin-suggest">
          <div class="admin-suggest__members">
            ${list
              .map(
                (g) => `<label class="admin-check"><input type="checkbox" checked data-guest-id="${escapeHtml(g.id)}"> ${escapeHtml(fullName(g))}</label>`
              )
              .join('')}
          </div>
          <div class="admin-inline-form">
            <input type="text" class="admin-suggest__name" list="party-options" value="${escapeHtml(suggested)}" placeholder="Party name" aria-label="Party name for the ${escapeHtml(last)} group">
            <button type="button" class="admin-btn admin-btn--primary" data-action="create-group">Group</button>
          </div>
        </div>`;
      })
      .join('') +
    (singles || noLast
      ? `<p class="admin-hint">${[
          singles ? `${plural(singles, 'other unassigned guest')} ${singles === 1 ? 'has' : 'have'} a unique last name` : '',
          noLast ? `${plural(noLast, 'unassigned guest')} ${noLast === 1 ? 'has' : 'have'} only a first name` : '',
        ].filter(Boolean).join(', and ')}.
          <button type="button" class="admin-link" data-action="show-unassigned">Show them in the guest list</button> to tick and group them by hand.</p>`
      : '');
}

$('suggest-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'show-unassigned') {
    switchTab('guests');
    setQuickFilter('noparty');
    return;
  }
  const box = btn.closest('.admin-suggest');
  const ids = [...box.querySelectorAll('input[data-guest-id]:checked')].map((i) => i.dataset.guestId);
  const name = box.querySelector('.admin-suggest__name').value.trim();
  if (!ids.length) return toast('Tick at least one guest.', 'error');
  if (!name) return toast('Give the party a name.', 'error');
  const existing = findPartyByName(name);
  if (existing && !confirm(`Add ${plural(ids.length, 'guest')} to the existing party "${existing.party_name}"?`)) return;
  const partyId = await ensureParty(name, { confirmCreate: false });
  if (!partyId) return;
  await updateGuests(ids, { party_id: partyId }, `Grouped ${plural(ids.length, 'guest')} into ${name}`);
});

// ================================================================
// Phones: import
// ================================================================

$('phone-import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('phone-import-text').value = await file.text();
  previewPhoneImport();
});

$('phone-import-preview').addEventListener('click', previewPhoneImport);

function parsePhoneImport(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  let cols = null;
  const header = parseDelimitedLine(lines[0]).map((h) => h.toLowerCase());
  if (header.some((h) => /phone|mobile|cell/.test(h))) {
    cols = {
      first: header.findIndex((h) => /first/.test(h)),
      last: header.findIndex((h) => /last/.test(h)),
      name: header.findIndex((h) => /^(name|full name|guest|guest name)$/.test(h)),
      phone: header.findIndex((h) => /phone|mobile|cell/.test(h)),
    };
    lines.shift();
  }
  return lines.map((line) => {
    const cells = parseDelimitedLine(line);
    let first;
    let last;
    let phone;
    if (cols) {
      phone = cells[cols.phone] ?? '';
      if (cols.first >= 0 && cols.last >= 0) {
        first = cells[cols.first] ?? '';
        last = cells[cols.last] ?? '';
      } else {
        [first, last] = splitName(cells[cols.name >= 0 ? cols.name : 0] ?? '');
      }
    } else if (cells.length >= 3) {
      [first, last, phone] = [cells[0], cells[1], cells[cells.length - 1]];
    } else {
      [first, last] = splitName(cells[0] ?? '');
      phone = cells[1] ?? '';
    }
    return { line, first: first.trim(), last: last.trim(), phone: phone.trim() };
  });
}

// "Mary Ann Smith" → ["Mary Ann", "Smith"]
function splitName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return [parts[0] ?? '', ''];
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
}

function previewPhoneImport() {
  const entries = parsePhoneImport($('phone-import-text').value);
  if (!entries.length) {
    $('phone-import-result').innerHTML = '<p class="admin-empty">Paste some lines first.</p>';
    return;
  }
  const rows = entries.map((entry, i) => {
    const matches = state.guests.filter(
      (g) =>
        g.first_name.trim().toLowerCase() === entry.first.toLowerCase() &&
        g.last_name.trim().toLowerCase() === entry.last.toLowerCase()
    );
    const validPhone = normalizePhone(entry.phone).length === 10;
    let status;
    if (!validPhone) status = 'bad-phone';
    else if (!matches.length) status = 'not-found';
    else if (matches.length > 1) status = 'ambiguous';
    else if (normalizePhone(matches[0].phone) === normalizePhone(entry.phone)) status = 'same';
    else status = matches[0].phone ? 'replace' : 'new';
    return { ...entry, i, matches, status };
  });
  state.phoneImport = rows;

  const label = {
    new: 'Will add',
    replace: 'Will replace',
    same: 'Already saved',
    ambiguous: 'Pick which guest',
    'not-found': 'No guest with this name',
    'bad-phone': 'Phone doesn’t look like 10 digits',
  };
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const unmatched = rows.filter((r) => r.status === 'not-found');

  $('phone-import-result').innerHTML = `
    <p class="admin-hint">${rows.length} lines · ${counts.new ?? 0} new · ${counts.replace ?? 0} replacing · ${counts.same ?? 0} unchanged · ${counts.ambiguous ?? 0} need a pick · ${(counts['not-found'] ?? 0) + (counts['bad-phone'] ?? 0)} problems</p>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Save?</th><th>Name</th><th>Phone</th><th>Guest</th><th>Current phone</th><th>Status</th></tr></thead>
        <tbody>
          ${rows
            .map((r) => {
              const canSave = r.status === 'new' || r.status === 'replace' || r.status === 'ambiguous';
              const guestCell =
                r.status === 'ambiguous'
                  ? `<select data-import-pick="${r.i}"><option value="">Choose…</option>${r.matches
                      .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(state.guestIdToLabel.get(g.id))}</option>`)
                      .join('')}</select>`
                  : r.matches.length === 1
                    ? escapeHtml(state.guestIdToLabel.get(r.matches[0].id))
                    : '—';
              return `<tr class="admin-import--${r.status}">
                <td><input type="checkbox" data-import-row="${r.i}" ${canSave && r.status !== 'ambiguous' ? 'checked' : ''} ${canSave ? '' : 'disabled'} aria-label="Save this line"></td>
                <td>${escapeHtml(`${r.first} ${r.last}`)}</td>
                <td>${escapeHtml(r.phone)}</td>
                <td>${guestCell}</td>
                <td>${escapeHtml(r.matches.length === 1 ? r.matches[0].phone ?? '—' : '—')}</td>
                <td>${escapeHtml(label[r.status])}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
    ${unmatched.length ? `<p class="admin-hint">Not on the list (fix the spelling in your paste, or add them on the Guests tab): ${escapeHtml(unmatched.map((r) => `${r.first} ${r.last}`).join(', '))}</p>` : ''}
    <button type="button" class="admin-btn admin-btn--primary" id="phone-import-save">Save checked phone numbers</button>`;
}

$('phone-import-result').addEventListener('change', (e) => {
  const pick = e.target.closest('[data-import-pick]');
  if (pick) {
    const box = $('phone-import-result').querySelector(`[data-import-row="${pick.dataset.importPick}"]`);
    box.checked = Boolean(pick.value);
  }
});

$('phone-import-result').addEventListener('click', async (e) => {
  if (e.target.id !== 'phone-import-save') return;
  const updates = [];
  for (const box of $('phone-import-result').querySelectorAll('[data-import-row]:checked')) {
    const r = state.phoneImport[Number(box.dataset.importRow)];
    const guestId =
      r.status === 'ambiguous'
        ? $('phone-import-result').querySelector(`[data-import-pick="${r.i}"]`).value
        : r.matches[0]?.id;
    if (guestId) updates.push({ id: guestId, phone: r.phone });
  }
  if (!updates.length) return toast('Nothing checked to save.', 'error');
  e.target.disabled = true;
  const results = await Promise.all(
    updates.map((u) => safeQuery(supabase.from('guests').update({ phone: u.phone }).eq('id', u.id)))
  );
  const failed = results.filter((r) => r.error);
  if (failed.length) reportError(failed[0].error, `${failed.length} phone numbers failed to save.`);
  else toast(`Saved ${plural(updates.length, 'phone number')}`);
  $('phone-import-result').innerHTML = '';
  $('phone-import-text').value = '';
  $('phone-import-file').value = '';
  await loadAll();
});

// ================================================================
// Phones: texting the address link
// ================================================================

function defaultAddressLink() {
  if (location.protocol.startsWith('http') && !/^(localhost|127\.)/.test(location.hostname)) {
    return new URL('address.html', location.href).href;
  }
  return 'https://parkerandjolan.com/address.html';
}

$('sms-link').value = localStorage.getItem(SMS_LINK_KEY) || defaultAddressLink();
$('sms-template').value = localStorage.getItem(SMS_TEMPLATE_KEY) || DEFAULT_SMS_TEMPLATE;

$('sms-link').addEventListener('input', () => {
  localStorage.setItem(SMS_LINK_KEY, $('sms-link').value.trim());
  renderSms();
});
$('sms-template').addEventListener('input', () => {
  localStorage.setItem(SMS_TEMPLATE_KEY, $('sms-template').value);
  renderSms();
});
$('sms-only-missing').addEventListener('change', renderSms);
$('sms-hide-texted').addEventListener('change', renderSms);

function smsMessage(g) {
  return $('sms-template')
    .value.replaceAll('{first}', g.first_name ?? '')
    .replaceAll('{name}', fullName(g))
    .replaceAll('{link}', $('sms-link').value.trim());
}

function smsRows() {
  return state.guests.filter(
    (g) =>
      g.invited &&
      hasPhone(g) &&
      (!$('sms-only-missing').checked || !hasAddress(g)) &&
      (!$('sms-hide-texted').checked || !textedAt(g))
  );
}

function renderSms() {
  const rows = smsRows();
  $('sms-count').textContent = plural(rows.length, 'guest');
  $('sms-table-body').innerHTML = rows.length
    ? rows
        .map((g) => {
          const msg = smsMessage(g);
          const href = `sms:${normalizePhone(g.phone)}?&body=${encodeURIComponent(msg)}`;
          const sent = textedAt(g);
          return `<tr data-id="${escapeHtml(g.id)}">
            <td>${escapeHtml(fullName(g))}</td>
            <td>${escapeHtml(partyName(g) || '—')}</td>
            <td>${escapeHtml(g.phone)}</td>
            <td class="admin-sms-msg" title="${escapeHtml(msg)}">${escapeHtml(msg)}</td>
            <td>${sent ? escapeHtml(formatDate(sent)) : '—'}</td>
            <td class="admin-row-actions">
              <a class="admin-btn admin-btn--primary admin-btn--sm" href="${escapeHtml(href)}" data-action="text">Text</a>
              <button type="button" class="admin-btn admin-btn--sm" data-action="copy">Copy</button>
              <button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-action="toggle-texted">${sent ? 'Unmark' : 'Mark texted'}</button>
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="admin-empty">Nobody to text with these filters.</td></tr>';

  const noPhone = state.guests.filter((g) => g.invited && !hasPhone(g));
  $('sms-missing-phone').innerHTML = noPhone.length
    ? `${plural(noPhone.length, 'invited guest')} ${noPhone.length === 1 ? 'has' : 'have'} no phone number yet. <button type="button" class="admin-link" data-action="show-nophone">Show them</button>`
    : 'Every invited guest has a phone number.';
}

$('sms-missing-phone').addEventListener('click', (e) => {
  if (e.target.dataset.action !== 'show-nophone') return;
  switchTab('guests');
  setQuickFilter('nophone');
});

async function setTexted(g, on) {
  const extra = { ...(g.extra ?? {}) };
  if (on) extra.address_texted_at = new Date().toISOString();
  else delete extra.address_texted_at;
  await updateGuest(g.id, { extra }, { quiet: true });
}

$('sms-table-body').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const g = state.guestById.get(el.closest('tr').dataset.id);
  if (!g) return;
  if (el.dataset.action === 'text') {
    // Let the sms: link open normally; record it in the background.
    if (!textedAt(g)) setTexted(g, true);
  } else if (el.dataset.action === 'copy') {
    try {
      await navigator.clipboard.writeText(smsMessage(g));
      toast(`Copied message for ${g.first_name}`);
    } catch {
      toast('Couldn’t copy — select the message text instead.', 'error');
    }
  } else if (el.dataset.action === 'toggle-texted') {
    await setTexted(g, !textedAt(g));
    toast(textedAt(g) ? `Marked ${g.first_name} as texted` : `Unmarked ${g.first_name}`);
  }
});

$('sms-export').addEventListener('click', () => {
  const rows = [['First Name', 'Last Name', 'Phone', 'Message']];
  for (const g of smsRows()) rows.push([g.first_name, g.last_name, g.phone, smsMessage(g)]);
  downloadCsv('address-text-list.csv', rows);
});

// ================================================================
// Address inbox
// ================================================================

function renderInbox() {
  const pending = state.submissions.filter((s) => s.status === 'pending');
  const reviewed = state.submissions.filter((s) => s.status !== 'pending');

  $('inbox-list').innerHTML = pending.length
    ? pending.map(renderSubmission).join('')
    : '<p class="admin-empty">Nothing waiting. New submissions from the address page show up here.</p>';

  $('inbox-history-count').textContent = `(${reviewed.length})`;
  $('inbox-history-body').innerHTML = reviewed.length
    ? reviewed
        .map((s) => {
          const applied = state.guestById.get(s.applied_guest_id);
          return `<tr data-sub-id="${escapeHtml(s.id)}">
            <td>${escapeHtml(formatDate(s.created_at))}</td>
            <td>${escapeHtml(`${s.first_name} ${s.last_name}`)}</td>
            <td>${escapeHtml(s.household)}</td>
            <td>${escapeHtml([s.address_line1, s.city, s.state_province].filter(Boolean).join(', '))}</td>
            <td>${escapeHtml(s.status)}</td>
            <td>${escapeHtml(applied ? fullName(applied) : '—')}</td>
            <td><button type="button" class="admin-btn admin-btn--sm" data-action="reopen">Move back to inbox</button></td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="admin-empty">None yet.</td></tr>';
}

function describeAddress(o) {
  return [o.address_line1, o.address_line2, [o.city, o.state_province].filter(Boolean).join(', ') + (o.postal_code ? ` ${o.postal_code}` : '')]
    .filter((x) => x && x.trim())
    .join(', ');
}

function renderSubmission(s) {
  const match = state.guestById.get(s.matched_guest_id);
  let reason;
  if (match) {
    const byPhone = normalizePhone(match.phone) && normalizePhone(match.phone) === normalizePhone(s.phone);
    reason = byPhone ? 'Suggested match: same phone number.' : 'Suggested match: same name.';
    if (hasAddress(match)) reason += ` Their current address (${describeAddress(match)}) will be replaced.`;
  } else {
    reason = 'No automatic match — pick the guest, or add them as a new guest.';
  }
  const householdParty = findPartyByName(s.household);
  const defaultUseHousehold = !match?.party_id;
  return `
  <article class="admin-inbox-item" data-sub-id="${escapeHtml(s.id)}">
    <div class="admin-inbox-item__body">
      <h3>${escapeHtml([s.title, s.first_name, s.last_name].filter(Boolean).join(' '))}</h3>
      <p><strong>Household:</strong> ${escapeHtml(s.household)}</p>
      <p>${escapeHtml(s.address_line1)}${s.address_line2 ? `<br>${escapeHtml(s.address_line2)}` : ''}<br>${escapeHtml(s.city)}, ${escapeHtml(s.state_province)} ${escapeHtml(s.postal_code)}</p>
      <p>${escapeHtml(s.email ?? '')}${s.email && s.phone ? ' · ' : ''}${escapeHtml(s.phone ?? '')}</p>
      <p class="admin-hint">Submitted ${escapeHtml(formatTimestamp(s.created_at))}</p>
    </div>
    <div class="admin-inbox-item__actions">
      <label class="admin-label">Apply to guest
        <input type="text" class="inbox-guest" list="guest-options" value="${escapeHtml(match ? state.guestIdToLabel.get(match.id) : '')}" placeholder="Start typing a name…">
      </label>
      <p class="admin-hint">${escapeHtml(reason)}</p>
      <label class="admin-check"><input type="checkbox" class="inbox-household" ${defaultUseHousehold ? 'checked' : ''}>
        Also put them in party “${escapeHtml(s.household)}” ${householdParty ? '(already exists)' : '(will be created)'}</label>
      <p class="admin-hint inbox-party-note">${match?.party_id ? escapeHtml(`Currently in ${partyName(match)} — ticking the box above moves them.`) : ''}</p>
      <div class="admin-row-actions">
        <button type="button" class="admin-btn admin-btn--primary" data-action="apply">Apply</button>
        <button type="button" class="admin-btn" data-action="add-new">Add as new guest</button>
        <button type="button" class="admin-btn admin-btn--ghost" data-action="dismiss">Dismiss</button>
      </div>
    </div>
  </article>`;
}

// Picking a different guest: only default to the household party when that
// guest isn't already in a party, so applying never silently moves someone.
$('inbox-list').addEventListener('change', (e) => {
  if (!e.target.classList.contains('inbox-guest')) return;
  const card = e.target.closest('[data-sub-id]');
  const g = state.guestById.get(state.guestLabelToId.get(e.target.value.trim().toLowerCase()));
  card.querySelector('.inbox-household').checked = !g?.party_id;
  card.querySelector('.inbox-party-note').textContent = g?.party_id
    ? `Currently in ${partyName(g)} — ticking the box above moves them.`
    : '';
});

$('inbox-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('[data-sub-id]');
  const s = state.submissions.find((x) => x.id === card.dataset.subId);
  if (!s) return;
  const useHousehold = card.querySelector('.inbox-household').checked;

  if (btn.dataset.action === 'dismiss') {
    if (!confirm(`Dismiss the submission from ${s.first_name} ${s.last_name}? (You can move it back later.)`)) return;
    const { error } = await safeQuery(
      supabase.from('address_submissions').update({ status: 'dismissed', reviewed_at: new Date().toISOString() }).eq('id', s.id)
    );
    if (error) return reportError(error, 'Could not dismiss that submission.');
    toast('Dismissed');
    return loadAll();
  }

  let guestId = null;
  if (btn.dataset.action === 'apply') {
    guestId = state.guestLabelToId.get(card.querySelector('.inbox-guest').value.trim().toLowerCase());
    if (!guestId) {
      toast('Pick the guest from the suggestions list (or use “Add as new guest”).', 'error');
      card.querySelector('.inbox-guest').focus();
      return;
    }
  } else if (!confirm(`Add ${s.first_name} ${s.last_name} to the guest list as a new invited guest?`)) {
    return;
  }

  btn.disabled = true;
  const { error } = await safeQuery(
    supabase.rpc('apply_address_submission', {
      p_submission_id: s.id,
      p_guest_id: guestId,
      p_use_household: useHousehold,
    })
  );
  btn.disabled = false;
  if (error) return reportError(error, 'Could not apply that submission.');
  toast(guestId ? `Saved address for ${fullName(state.guestById.get(guestId))}` : `Added ${s.first_name} ${s.last_name}`);
  await loadAll();
});

$('inbox-history-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="reopen"]');
  if (!btn) return;
  const id = btn.closest('[data-sub-id]').dataset.subId;
  const { error } = await safeQuery(
    supabase.from('address_submissions').update({ status: 'pending', reviewed_at: null, applied_guest_id: null }).eq('id', id)
  );
  if (error) return reportError(error, 'Could not move that back to the inbox.');
  toast('Moved back to the inbox');
  await loadAll();
});

// ================================================================

buildGuestTableHead();
buildQuickFilters();
init();
