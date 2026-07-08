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
- **Hosting**: Hostinger, static file hosting only (not Hostinger's drag-and-drop
  website builder). Deployment is uploading built HTML/CSS/JS/assets directly —
  no server-side rendering, no backend process to keep running on Hostinger
  itself (Supabase is the only piece of actual backend infrastructure, and it's
  managed/hosted separately).
- **Domain**: parkerandjolan.com, pointed at Hostinger.

## Project structure

```
/
├── index.html          # main landing page
├── rsvp.html            # guest-facing search + RSVP response flow
├── admin.html           # planner dashboard (auth-gated)
├── css/
│   └── style.css       # global styles, theme variables, animations
├── js/
│   ├── main.js          # interactions, scroll effects, Zola embed init if needed
│   ├── supabase-client.js  # shared Supabase client init (URL + anon key)
│   ├── escape.js        # escapeHtml() — required for any DB value rendered via innerHTML
│   ├── rsvp.js          # rsvp.html logic (search, party lookup, submit)
│   ├── admin.js         # admin.html logic (auth, stats, CRUD, CSV export)
│   └── charts.js        # hand-rolled SVG pie/meter charts for the dashboard
├── supabase/
│   ├── config.toml      # Supabase CLI local-dev config
│   ├── migrations/      # schema: tables, RLS policies, RPC functions (0001_init.sql, …)
│   └── seed.sql         # local prototype seed data
├── assets/
│   ├── images/
│   │   └── inspiration/  # reference screenshots/mockups driving the design
│   └── fonts/           # any self-hosted font files
└── CLAUDE.md
```

Additional HTML pages (e.g. `story.html`, `travel.html`, `registry.html`) should
live at the root alongside `index.html` and share `css/style.css` and
`js/main.js` unless a page needs page-specific logic.

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
1. Search by name → RPC `search_guests(name)` returns only
   `first_name, last_name, party_name, party_id` — never full guest rows.
2. Guest picks their party → RPC `get_party_members(party_id)` returns only
   that party's `invited = true` members.
3. Guest submits responses for the whole party in one call → RPC
   `submit_rsvp(party_id, responses[])`, which validates server-side that
   every guest id in the payload belongs to `party_id` before writing. This
   validation is the actual enforcement point for "can't RSVP on behalf of
   people outside your party" — never rely on the client for it.

**Admin dashboard** (`admin.html` / `js/admin.js`)
- Gated by a single shared master password (currently `admin`, for ease of
  testing), not per-planner accounts — the login form only asks for a
  password, which signs in to one fixed Supabase Auth account
  (`ADMIN_EMAIL` in `js/admin.js`) behind the scenes. RLS grants full table
  access to any `authenticated` session, so this is a credentials/UI
  simplification, not a security regression — swap for real per-planner
  accounts (Parker, Jolan, Elizabeth Motyka) before going live.
- Stats (invited/responded/attending/declined counts, meal breakdown), full
  CRUD editor for parties/guests, CSV export (see Zola CSV format below).

## Design process

1. Inspiration references get dropped into `assets/images/inspiration/` along
   with notes on which elements (palette, type, layout, motion) to pull from
   each.
2. Theme gets distilled into CSS custom properties in `css/style.css` (colors,
   fonts, spacing scale) so the look stays consistent across pages.
3. Content (copy, photos, event details, schedule) gets filled in once
   structure/theme are settled — placeholders until then.

### Theme: bright floral (boho garden)

Direction pulled from the Pinterest board in `assets/images/inspiration/Theme/`
— dahlias/wildflowers, hanging floral installations, mixed-color bridesmaid
palettes — warm and floral rather than muted/minimalist.

Canonical color palette comes from
`assets/images/inspiration/Theme/Pinterest_files/THEME.png` (supersedes the
earlier `colors.jpg` "Summer 2025" palette — that file is kept only for
historical reference, don't pull colors from it anymore), implemented as CSS
custom properties in `css/style.css`:

| Name | Hex | Role |
|---|---|---|
| Copper | `#ef5356` | primary accent — headings, script names, primary buttons |
| Golden Hour | `#f2af3f` | secondary accent — buttons, highlights |
| Apricot | `#fda170` | soft accent — backgrounds, card borders |
| Blush | `#f2c1c1` | soft accent — backgrounds, subtle fills |
| Misty Blue | `#c0cfe0` | secondary accent — links, cool contrast |
| Moss | `#9f985c` | deep green accent — dividers, icons, floral leaves |
| Moss Light | `#c5c463` | lighter green accent |

This palette is warmer/softer than the old neon "Summer 2025" set — background,
shadow, and text tones were adjusted (color-corrected) to sit comfortably next
to it rather than clash.

Floral accents on the site (section-heading flourishes, the corner bloom
behind the Our Story photo) are original hand-drawn inline SVGs built from
this palette — not traced from or copies of the Pinterest photos.

Beyond the palette, the site's graphic language comes from two specific
references in `Theme/Pinterest_files/`:
`0b0446e046fc81b53ae8267efcd6a753.jpg` (doodle-covered invitation: wavy
border frame, hatched-tick oval badge, scattered hand-drawn doodles) and
`d844ca7d57113572487b0a1d55f5eaa4_002.jpg` (golden wavy-edged bar sign with
copper border and script lettering). Implemented as: the hero eyebrow's
hatched oval (`.hero__eyebrow-oval`), wavy-edged sign cards (`.detail-card`,
`.rsvp-sign` — a stretched SVG background, `100% 100%`, drawn per accent
color; note plain `border-image` left tiling artifacts in Chrome, hence the
background approach), wavy section-edge transitions (`.hero::after`, the
homepage `.site-footer::before`), and scattered `.doodle` SVGs (tulip,
daisy, sprig, toasting glasses — original artwork, hidden under 900px).
Reuse these motifs (not new ad hoc ones) when adding pages or sections.

Fonts: a hand-lettered script for the couple's names/big display text (echoing
the Pinterest board's hand-drawn signage), a serif for section headings, and a
clean rounded sans for body copy. Loaded via Google Fonts `<link>` tag (no
bundler needed).

**Image sourcing rule**: Pinterest board images (`Theme/Pinterest_files/`) are
inspiration references ONLY — never embed them directly on the site, they
exist purely to inform palette/vibe. The actual proposal photos in
`assets/images/photos/` (copied from `inspiration/PHOTOS/`) are real site
assets and are fair game to use directly in the hero, story, and gallery
sections.

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
- When adding new sections/pages, match the existing theme variables in
  `css/style.css` rather than introducing new ad hoc colors/fonts.
