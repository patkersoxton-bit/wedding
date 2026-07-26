# Deployment — GitHub Pages (+ hosted Supabase)

Tracking doc for taking the site live. Any agent (or human) working on this:
check items off as they're completed, and add a dated note under
**Progress log** at the bottom when you finish a phase or hit a blocker.
Don't check an item you didn't verify.

> **Change of plans (2026-07-13):** hosting moved from Hostinger to
> **GitHub Pages**. The earlier Hostinger research is preserved in git
> history (`git log -- DEPLOYMENT.md`) in case we ever switch back. The
> custom domain (parkerandjolan.com) is no longer bundled with hosting —
> it must be purchased separately at a registrar when we're ready.

## Context

### What's being deployed

A static HTML/CSS/JS site (no build step) plus a Supabase backend for the
custom RSVP system. GitHub Pages serves only the static files; the database
moves from the local Docker Supabase stack to a hosted Supabase project
(free tier). See `CLAUDE.md` for full architecture.

Current state: everything runs locally (`start-local.bat`), and
`js/supabase-client.js` points at `http://127.0.0.1:54321` — the site will
not work for the public until that's swapped to a hosted Supabase project.

### Hosting decision (made)

- **GitHub Pages**, free, deployed from the existing repo
  (`patkersoxton-bit/wedding`, already public).
- **Deploy method**: GitHub Actions workflow
  (`.github/workflows/deploy-pages.yml`) on every push to `main`. The
  workflow stages **only the public site files** into an artifact and
  deploys that — nothing else in the repo reaches the live site.
- **URL**: `https://patkersoxton-bit.github.io/wedding/` until a custom
  domain is added. All site paths are relative, so the `/wedding/` subpath
  works as-is.
- **Custom domain (later)**: buy parkerandjolan.com at any registrar
  (~$10–15/yr), then: repo → Settings → Pages → Custom domain, plus a CNAME
  DNS record pointing `www` at `patkersoxton-bit.github.io` and A/ALIAS
  records for the apex per GitHub's docs. HTTPS is automatic.

### What gets deployed (and what must not be)

**In the Pages artifact** (see the workflow's "Stage site files" step):

- all root `*.html` pages
- `css/`, `js/`
- `assets/images/photos/`

**Never deploy** (excluded by the workflow — keep it that way):

- `assets/images/inspiration/` — Pinterest reference images; publishing
  them on the site violates the project's image-sourcing rule. Note: the
  repo itself is public, so these are visible on github.com regardless —
  scrubbing them from the repo/history is a separate open question.
- `supabase/` (migrations/seed are for the CLI, not the web server)
- `CLAUDE.md`, `DEPLOYMENT.md`, `start-local.bat`, `.github/`

---

## Checklist

### Phase 1 — GitHub Pages plumbing (agent-doable)

- [x] Deploy workflow committed (`.github/workflows/deploy-pages.yml`),
      staging only the allowlisted site files
- [x] Verified all HTML/CSS asset paths are relative (no root-absolute
      `/css/...` links that would break under the `/wedding/` subpath)
- [x] First workflow run green; site loads at
      `https://patkersoxton-bit.github.io/wedding/`

### Phase 2 — Hosted Supabase project (browser; Parker)

- [x] Create a project at [supabase.com](https://supabase.com) (free tier)
      — ref `erkiyfvinmhduztnzecd`, us-east-1
- [x] Apply migrations 0001–0004: either `npx supabase link` +
      `npx supabase db push`, or paste each file from
      `supabase/migrations/` into the dashboard SQL Editor in order
- [x] Verify: migrations in sync (`supabase migration list`), RPCs respond
      via the publishable key, anon direct-table INSERT denied by RLS
- [x] ~~Do **not** load `seed.sql` into the hosted project — it's local
      prototype data (not loaded)~~ **Corrected 2026-07-26**: this was
      wrong — `seed.sql`'s guest INSERT is the real 119-guest list, not
      disposable prototype data. It's now loaded into the hosted project
      (only the "Test Party" fixture at the bottom of the file stays
      local-only). See progress log.
- [x] Create the admin auth user (`admin@parkerandjolan.com`, per
      `ADMIN_EMAIL` in `js/admin.js`) with a **strong** password — the local
      `admin` password must NOT go live. Real per-planner accounts (Parker,
      Jolan, Elizabeth Motyka) are still an open question in CLAUDE.md.

### Phase 3 — Point the frontend at production

- [x] Swap `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/supabase-client.js`
      to the hosted project's values (publishable key)
- [x] Push to `main` (triggers the Pages deploy)
- [x] Enter/import the real guest list via the admin dashboard (replaces
      seed data) — done 2026-07-26, see progress log

### Phase 4 — Verify live site

- [x] `https://patkersoxton-bit.github.io/wedding/` loads (homepage, rsvp,
      admin, photos all HTTP 200)
- [x] RSVP search works on the live URL against hosted Supabase (empty
      guest list → graceful "No matches found", zero console errors);
      full respond/submit path untestable until real guests exist
- [x] Admin login on the live URL rejects the old weak `admin` password
      ("Invalid login credentials"); stats/CRUD/CSV still to be smoke-tested
      by a planner logging in with the real password
- [x] Confirm nothing from the "never deploy" list is publicly reachable on
      the site (verified 404: `/CLAUDE.md`, `/DEPLOYMENT.md`,
      `/supabase/migrations/0001_init.sql`, `/assets/images/inspiration/…`)
- [ ] Mobile check: pages usable under 900px (doodles hidden as designed)

### Phase 5 — Post-launch

- [ ] Buy parkerandjolan.com at a registrar and connect it (see "Custom
      domain" above); after it's live, update the Supabase Auth **Site URL**
      to the custom domain
- [ ] Decide whether local dev keeps pointing at hosted Supabase or stays on
      the local stack (if local, document how to switch
      `js/supabase-client.js` between the two)
- [ ] Decide what to do about the Pinterest inspiration images being visible
      in the public repo (private mirror? history scrub? accept it?)
- [ ] Add Zola registry embed once the Zola account/page exists (see
      CLAUDE.md open questions)

---

## Progress log

_Add entries as `YYYY-MM-DD — who/agent — what was done / what's blocked._

- 2026-07-12 — Claude — Researched Hostinger plans and upload methods;
  created this doc (Hostinger version, see git history). No purchase made.
- 2026-07-12 — Claude — Audited the local Supabase stack via the MCP server
  (`.mcp.json` → `http://127.0.0.1:54321/mcp`, i.e. the local Docker stack
  only — hosted-project creation still needs Parker's Supabase account).
  Verified: migrations 0001–0003 applied and in sync with the repo,
  `parties`/`guests` schema matches (RLS on, `party_id` nullable,
  `food_preference` check in place), all three RPCs deployed, admin auth
  account exists. Ran the security/performance advisors: the always-true
  RLS policies for `authenticated` and the anon-executable SECURITY DEFINER
  RPCs are flagged but intentional (see CLAUDE.md security model); the one
  real finding — `pg_trgm` installed in `public` — is fixed by
  `0004_move_pg_trgm_to_extensions.sql` (apply with
  `npx supabase migration up` locally).
- 2026-07-13 — Claude + Parker — **Site is live and wired to hosted
  Supabase.** Parker created the hosted project (`erkiyfvinmhduztnzecd`),
  ran `supabase login` and `db push` (0001–0004 applied), and created the
  admin auth user. Claude linked the repo (worked around a CLI
  `AlreadyExists supabase\.temp` bug by writing `.temp/project-ref`
  manually), swapped `js/supabase-client.js` to the hosted URL +
  publishable key, and verified live in a real browser: RSVP search hits
  hosted DB cleanly, old `admin` password rejected, never-deploy files
  404. **Outstanding:** Parker pasted the `sb_secret_*` key into chat —
  rotate it in dashboard → Project Settings → API Keys if not already
  done. Guest list still empty; admin stats/CRUD/CSV need a smoke test by
  someone with the real password.
- 2026-07-13 — Claude — **Switched hosting plan to GitHub Pages** (repo is
  already public at github.com/patkersoxton-bit/wedding). Added the deploy
  workflow with a staged allowlist artifact, rewrote this doc, gitignored
  `.playwright-mcp/` + `.mcp.json` and untracked old playwright snapshots.
  Remaining human steps: Phase 2 (hosted Supabase, browser) and Phase 3
  (swap client credentials).
- 2026-07-13 — Claude — **Added a site-wide password gate** (`js/gate.js`,
  loaded blocking in the `<head>` of all three pages). Visitors must enter
  the shared password (ask Parker; only its SHA-256 hash is in source,
  entry is case-insensitive) before any content paints; unlock is
  remembered per device via localStorage (key `pj_gate_v1` — clear it to
  re-lock a browser). This is a **client-side deterrent only** — GitHub
  Pages has no server, so anyone reading page source or fetching files
  directly can bypass it; guest data remains protected by the Supabase
  RLS/RPC model, and the admin dashboard still has its own real login on
  top. Verified in a local browser: content hidden before unlock, wrong
  password rejected, unlock persists across pages.
- 2026-07-26 — Claude — **Custom domain (parkerandjolan.com) connected**
  via Cloudflare DNS (4 apex A records to GitHub's Pages IPs + `www` CNAME,
  all DNS-only/grey-cloud) and GitHub Pages custom domain settings. Added
  `CNAME` file to the repo and to the deploy workflow's staged artifact
  (previously missing, which could have caused the domain association to
  drop on a future deploy). HTTPS enforced; both apex and `www` verified
  live over HTTPS with `www` redirecting to the apex.
- 2026-07-26 — Claude — **Root-caused and fixed the empty admin
  dashboard/guest list.** Parker reported the live admin dashboard showed
  no guests and suspected the hosted Supabase project had been paused and
  lost data. Investigation (using a Supabase personal access token to
  query the Management API directly, bypassing the site/RLS entirely):
  only one project exists in the account (`erkiyfvinmhduztnzecd`, the same
  one the site already points to), it was `ACTIVE_HEALTHY` at the time of
  investigation, and `pg_stat_user_tables.n_tup_ins = 0` for both `guests`
  and `parties` — proof no row had ever been inserted into the hosted
  tables (that counter doesn't reset on delete, only on a stats reset).
  **Actual root cause**: `supabase/seed.sql` contains the real 119-guest
  list (imported from Parker's actual guest-list doc), but a past pass
  (2026-07-13 log entry, Phase 2 checklist) misread its header comment as
  disposable "test data" and deliberately never loaded it into the hosted
  project — it had been sitting correctly in the repo the whole time,
  just never pushed to the database the live site reads from. Fixed by
  extracting the real-guest INSERT (excluding the local-only "Test Party"
  fixture at the bottom of `seed.sql`) and running it against the hosted
  project via the Management API; verified 119 guests now visible in the
  live admin dashboard. Also corrected `seed.sql`'s misleading comment and
  the Phase 2 checklist item so this can't be misread the same way again.
  **Prevention for the actual "paused project" risk** (real, even though
  it wasn't this incident's cause): free-tier Supabase projects auto-pause
  after 7 days with no API activity, which would make the live site
  unreachable until someone manually restores it in the dashboard. Added
  `.github/workflows/keep-supabase-awake.yml`, a scheduled Action pinging
  the REST API twice a week to keep the project active. Note: free tier
  still has no PITR/backups (`pitr_enabled: false`, no backup snapshots) —
  Parker should periodically use the admin dashboard's "Export CSV" button
  as a personal backup, or consider Supabase Pro closer to the wedding for
  real backup coverage; don't back up guest data into this repo, it's
  public.
