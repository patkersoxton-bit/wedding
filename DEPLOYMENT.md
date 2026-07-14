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
- [x] Do **not** load `seed.sql` into the hosted project — it's local
      prototype data (not loaded)
- [x] Create the admin auth user (`admin@parkerandjolan.com`, per
      `ADMIN_EMAIL` in `js/admin.js`) with a **strong** password — the local
      `admin` password must NOT go live. Real per-planner accounts (Parker,
      Jolan, Elizabeth Motyka) are still an open question in CLAUDE.md.

### Phase 3 — Point the frontend at production

- [x] Swap `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/supabase-client.js`
      to the hosted project's values (publishable key)
- [x] Push to `main` (triggers the Pages deploy)
- [ ] Enter/import the real guest list via the admin dashboard (replaces
      seed data)

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
