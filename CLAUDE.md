# Parker & Jolan — Wedding Website

## What this is

A custom wedding website for Parker & Jolan, live at **parkerandjolan.com**. It is a
hand-built HTML/CSS/JS site (no framework, no build step) that handles the design,
storytelling, and content. RSVP is a custom-built system on top of Supabase
(guest database, search-and-respond flow, admin dashboard); registry
functionality is still offloaded to **Zola** via embedded widgets/snippets
rather than reimplemented.

The goal is a site that looks and feels custom-designed (specific theme, palette,
and animations pulled from inspiration references), while owning the guest list
and RSVP data outright instead of handing it to a third party.

## Tech stack

- **Frontend**: plain HTML, CSS, JavaScript. No framework, no bundler, no npm
  build step. Keep it simple enough to FTP/upload straight to static hosting.
- **Animations/interactions**: hand-written CSS transitions/keyframes and vanilla
  JS (e.g. scroll reveals, hover states). Avoid pulling in animation libraries
  unless a specific effect genuinely needs one.
- **Backend/database**: Supabase (Postgres + auto REST API + Auth), used for
  the guest list, RSVP responses, and the admin dashboard's login. Accessed
  from the static frontend via the `@supabase/supabase-js` client loaded as a
  plain ES module `<script>` (CDN import, no bundler) — this keeps the RSVP
  pages consistent with the rest of the site's no-build-step approach.
- **Third-party integration**: Zola, embedded via their widget/embed snippets
  (not raw iframes), used for the **registry only** (no longer RSVP — that's
  now custom, see "RSVP system" below). The guest database can export a CSV
  formatted for Zola's guest-list import, kept as a fallback/parallel option,
  not a dependency.
- **Hosting**: GitHub Pages, deployed by `.github/workflows/deploy-pages.yml`
  on every push to `main`. The workflow stages only the public site files
  (root `*.html`, `css/`, `js/`, `assets/images/design/`,
  `assets/images/canva/`, `assets/fonts/`) — never `assets/Design_Language/`
  sources, inspiration images, `supabase/`, or docs. See `DEPLOYMENT.md`.
  Supabase is the only backend infrastructure, managed/hosted separately.
- **Domain**: parkerandjolan.com (`CNAME`).

## Project structure

```
/
├── index.html          # Home (save the date, weekend, contact)
├── venue.html          # Venue (painted farm map)
├── travel.html         # Travel (airports, lodging)
├── rsvp.html           # RSVP — phase 1 "coming soon", phase 2 lookup + response
├── address.html        # pre-invite address collector — standalone, unlinked, noindex
├── admin.html          # planner dashboard (auth-gated)
├── css/
│   ├── site.css        # public-page design system: tokens, fonts, components
│   ├── style.css       # legacy theme, now used only by admin.html
│   └── admin.css       # admin-only dashboard styles (self-contained)
├── js/
│   ├── site-config.js   # SITE_PHASE switch (1 = save the date, 2 = RSVP live)
│   ├── gate.js          # client-side site password gate (deterrent, not security)
│   ├── main.js          # nav, scroll reveals, countdown
│   ├── supabase-client.js  # shared Supabase client init (URL + anon key)
│   ├── escape.js        # escapeHtml() — required for any DB value rendered via innerHTML
│   ├── rsvp.js          # rsvp.html logic (exact-name lookup, party, submit)
│   ├── address.js       # address.html submit
│   ├── admin.js         # admin.html logic (auth, stats, CRUD, CSV export)
│   └── charts.js        # hand-rolled SVG pie/meter charts for the dashboard
├── backup/              # live mirror + snapshot history on the OptiPlex (see backup/README.md)
│   ├── mirror.py        # sync/status/restore; data goes to ~/wedding-backups, never the repo
│   ├── HANDOFF.md       # remote-dev + debugging context for this setup (start here)
│   ├── install.sh       # installs the systemd user units below
│   └── systemd/         # wedding-supabase.service, wedding-mirror.{service,timer}
├── supabase/
│   ├── config.toml      # Supabase CLI local-dev config
│   ├── migrations/      # schema: tables, RLS policies, RPC functions (0001_init.sql, …)
│   └── seed.sql         # local prototype seed data
├── assets/
│   ├── Design_Language/  # SOURCE artwork + font zips from Parker (not deployed)
│   ├── images/
│   │   ├── design/       # web-ready derivatives of Design_Language (deployed)
│   │   │   └── florals/  # individual stems split from 1flowers.png
│   │   ├── canva/elements/  # Canva export (couple photos used on Home)
│   │   ├── photos/       # proposal photos (not currently deployed)
│   │   └── inspiration/  # old Pinterest references (never deployed)
│   └── fonts/           # self-hosted WOFF2 (Latin subset) + licenses/
└── CLAUDE.md
```

Phase 1 nav is exactly Home / Venue / Travel / RSVP. New public pages live at
the root, use `css/site.css` + `js/site-config.js` + `js/gate.js` +
`js/main.js`, and copy the nav/footer markup from an existing page.

## Site phases

`js/site-config.js` sets `SITE_PHASE` and stamps `<html data-phase="N">`.
Phase-specific markup uses `.phase-1-only` / `.phase-2-only` (hidden via CSS)
rather than being deleted, so moving phases is a one-line change.
- **Phase 1 (current) — save the date**: Home, Venue, Travel, RSVP tabs. RSVP
  shows "RSVPs open with the formal invitation"; no lookup form.
- **Phase 2 — invitations out**: set `SITE_PHASE = 2`; RSVP lookup/response
  goes live. The address collector (`address.html`) is for *pre-invite*
  gathering, sits outside all phases: no nav, no site gate, `noindex`, only
  ever shared by direct link.

## RSVP system

Custom-built (not Zola) on top of Supabase. Design rationale: guests should
only ever be able to read/write their own party's data, even though the
Supabase anon key is public in page source — so guest-facing access goes
through restricted Postgres RPC functions (`SECURITY DEFINER`), never raw
table `SELECT`/`UPDATE`. RLS on the tables themselves stays deny-by-default
for the anon role; only authenticated admin users get direct table access.

**Data model** (`supabase/migrations/`)
- `parties` — `id`, `party_name`, `notes`
- `guests` — `id`, `party_id` (FK), `first_name`, `last_name`, `invited` (bool
  — a party can have members not invited to this event), address fields,
  `food_preference`, `dietary_notes`, `rsvp_status` (`pending`/`yes`/`no`),
  `responded_at`, `extra` (jsonb, for fields added later)

**Guest flow** (`rsvp.html` / `js/rsvp.js`)
1. Guest enters their first + last name exactly and submits (not a
   live/typeahead search) → RPC `find_invitation(first_name, last_name)`
   does an exact, case-insensitive match and returns at most a handful of
   rows — never a broader list. There used to be a `search_guests(name)`
   ILIKE-partial-match RPC here; it was removed (not just replaced in the
   frontend) because it let anyone with the public anon key enumerate the
   entire guest list by calling the RPC directly from a browser console,
   regardless of what the UI did. Don't reintroduce partial/prefix matching
   on a guest-facing RPC.
2. If the matched guest has a `party_id` → RPC `get_party_members(party_id)`
   returns only that party's `invited = true` members, and submission goes
   through `submit_rsvp(party_id, responses[])`, which validates
   server-side that every guest id in the payload belongs to `party_id`
   before writing — the actual enforcement point for "can't RSVP on behalf
   of people outside your party," never rely on the client for it.
   If the matched guest has no `party_id` yet (common until parties are
   manually assigned in the admin dashboard — see `supabase/seed.sql`),
   `find_invitation` already returned that guest's own fields, so the page
   shows just their own row and submits via
   `submit_solo_rsvp(guest_id, ...)` instead — guarded server-side to only
   ever update a guest whose `party_id` is still null.
3. `find_invitation` can return more than one row only when two *invited*
   guests share the exact typed name (e.g. two "Mike Motyka" on the current
   list) — in that case the guest picks between just those exact matches,
   never anyone else.

**Admin dashboard** (`admin.html` / `js/admin.js`)
- Gated by a single shared master password (currently `admin`, for ease of
  testing), not per-planner accounts — the login form only asks for a
  password, which signs in to one fixed Supabase Auth account
  (`ADMIN_EMAIL` in `js/admin.js`) behind the scenes. RLS grants full table
  access to any `authenticated` session, so this is a credentials/UI
  simplification, not a security regression — swap for real per-planner
  accounts (Parker, Jolan, Elizabeth Motyka) before going live.
- Tabs follow the planning stages: **Overview** (progress per stage +
  RSVP/meal charts), **Guests** (inline-edit table, quick filters, tick rows
  → bulk move into a party, Zola + Shutterfly CSV exports — Shutterfly is
  invited-only, one row per household), **Parties** (rename/notes/members,
  delete = ungroup, "group unassigned guests by last name" helper),
  **Phones & Texting** (paste/CSV phone import with match preview; per-guest
  `sms:` links with the address-page link, "texted" stored in
  `guests.extra.address_texted_at`), **Address Inbox** (review submissions).
- Address page submissions (`submit_address_entry`) land in
  `address_submissions`, never directly in `guests` (migration 0007) — the
  old direct insert let anyone add themselves as an invited guest. A
  planner applies each one via `apply_address_submission` (fills the
  matched guest's address, or creates a new guest; optionally moves them
  into the submitted household's party). The suggested match is a unique
  phone match, then a unique exact-name match.
- `guests.party_id` is `ON DELETE SET NULL`: deleting a party ungroups its
  members, it doesn't delete them.
- Some guests are first-name-only (`last_name = ''`, e.g. "Zoe's
  Boyfriend"); the column is NOT NULL so blank is stored as `''`.

## Design language

The site's look comes **only** from Parker's artwork in
`assets/Design_Language/` (hand-painted watercolor florals, paper-cut
bouquets, blue line-drawn doodles, the J·P monogram, the painted venue map)
plus the Canva couple photos. Don't add Claude-drawn SVG flourishes, emoji, or
other ad hoc art — if a section needs decoration, use a piece from
`assets/images/design/`. To add new artwork: drop the source in
`Design_Language/`, then export a trimmed, resized `.webp` into
`assets/images/design/` (sources there are multi-MB PNGs and aren't
deployed). `1flowers.png` was split into individual stems in
`design/florals/` (foxglove, delphinium, rose, rhododendron, orchid, ferns,
leaf-sprig); more individual flower images are coming.

**Fonts** (self-hosted in `assets/fonts/`, from the Design_Language zips):
| Token | Font | Use |
|---|---|---|
| `--font-script` | Parisienne | names, page titles, card titles |
| `--font-display` | Cinzel Decorative | formal small-caps lines, nav, labels, buttons |
| `--font-serif` | Cormorant Garamond | body copy |
| `--font-hand` | Homemade Apple | small handwritten eyebrows/notes only |

**Palette** (sampled from the artwork; tokens in `css/site.css`):
| Token | Hex | Source / role |
|---|---|---|
| `--paper` | `#fcf8f1` | page background |
| `--ink` | `#33402c` | body text |
| `--moss` | `#648a43` | monogram wreath green — primary |
| `--moss-deep` | `#4a6a30` | headings, hover |
| `--delphinium` | `#32a6c4` | doodle blue; `--delphinium-deep` for links |
| `--rose` | `#d4688c` | rose/rhododendron pink — eyebrows, accents |
| `--coral` / `--marigold` / `--orchid` | `#ec7a5e` / `#efb23e` / `#a96cb0` | bouquet accents |

Recurring motifs: arched-top cards/photos, the `.flourish` leaf-sprig divider,
painted stems flanking the hero, the wide flower basket above the footer.

**Image rules**: `assets/images/inspiration/` (old Pinterest board) is
reference only — never embed it. The old bright-boho palette (Copper/Golden
Hour/Apricot…) and Caveat/Fraunces/Poppins fonts are retired for public
pages; `css/style.css` still carries them for the admin dashboard only.

## Open questions / not yet decided

- **Full guest field list**: address, food preference, and RSVP y/n are
  confirmed; remaining fields (e.g. plus-ones, song requests, table
  assignment) still need to be enumerated before finalizing the schema
  migrations in `supabase/migrations/`.
- **Zola CSV export format**: the exact column mapping Zola expects for guest
  list import is unknown until the Zola account/page exists to check against.
- **Admin users**: who beyond Parker and Jolan gets a Supabase Auth login to
  the admin dashboard is undecided.
- **Exact Zola embed snippets** (registry): pending — Zola account/page needs
  to exist first before embed codes can be pulled in.

## Working conventions

- Keep the site static and dependency-free unless a real requirement forces
  otherwise (e.g. don't add a bundler or framework "just in case"). The RSVP
  system is the one deliberate exception (Supabase) — don't add further
  backend dependencies beyond it speculatively.
- RSVP/admin functionality is now custom-built (see "RSVP system" above), not
  Zola's job. Zola is only for the registry.
- Never grant the anon/public Supabase role direct table access to `guests`
  or `parties` — guest-facing reads/writes must go through the RPC functions
  in `supabase/migrations/` so guests can't see or edit data outside their
  own party.
- Any database value rendered through `innerHTML` must pass through
  `escapeHtml()` (`js/escape.js`). Guests can write `dietary_notes` and
  `food_preference` through the public RPC, and those values are rendered in
  the authenticated admin dashboard — unescaped interpolation there is a
  stored-XSS vector, not just a rendering glitch.
- When adding new sections/pages, use the tokens and components in
  `css/site.css` rather than introducing new ad hoc colors/fonts/art.
