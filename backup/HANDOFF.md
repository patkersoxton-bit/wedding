# Handoff: OptiPlex backup mirror + remote dev

Context for picking up or debugging this setup from the laptop, or in a
fresh Claude Code session. Last updated 2026-11-07. See also
`backup/README.md` (how-to) and `DEPLOYMENT.md` (progress log).

## The machines

| Machine | Role | Tailnet name / IP |
|---|---|---|
| `parker-optiplex-7060` (Ubuntu 24.04) | Always-on PC: backup mirror, Armen, runs Claude Code | `parker-optiplex-7060.tail0ec459.ts.net` / `100.66.5.43` |
| `desktop-v1so20h` (Windows laptop) | Where Parker works day to day | `100.79.200.29` |
| `iphone173` | Gets Armen/Tether push alerts | — |

The site itself: static files on **GitHub Pages** (repo
`patkersoxton-bit/wedding`, deployed by `.github/workflows/deploy-pages.yml`
on push to `main`), domain `parkerandjolan.com` via Cloudflare DNS. Backend:
hosted Supabase project `erkiyfvinmhduztnzecd` (free tier, us-east-1).
Note: `CLAUDE.md`'s "Hosting: Hostinger" section is stale; GitHub Pages is
correct.

## Connecting from the laptop

```bash
ssh -t parker@parker-optiplex-7060.tail0ec459.ts.net "tmux new -A -s wedding -c ~/wedding 'bash -lc claude'"
```

- Uses **Tailscale SSH** (`tailscale set --ssh` is on), so no password. A
  password prompt means you reached OpenSSH over the home LAN instead: use
  the full `.ts.net` name and check that Tailscale is running on the laptop.
- `tmux new -A` reattaches to the existing `wedding` session, so work
  survives the laptop closing. Detach with `Ctrl-b d`; list with `tmux ls`.
- `bash -lc` is required. Without it `~/.profile` isn't loaded,
  `~/.local/bin/claude` isn't on PATH, and tmux fails with "No such file
  or directory".
- A plain shell instead: `ssh parker@parker-optiplex-7060.tail0ec459.ts.net`.

## What runs on the OptiPlex

All are **systemd user units** (`~/.config/systemd/user/`). Linger is on for
`parker`, so they start at boot without anyone logging in.

| Unit | What it does |
|---|---|
| `wedding-supabase.service` | `npx supabase@3.0.0 start` in `~/wedding`: the local Docker Supabase stack (API 54321, DB 54322, Studio 54323, all bound to localhost). Retries every 30s until Docker is up. |
| `wedding-mirror.timer` → `.service` | Every minute: `backup/mirror.py sync` |
| `armen.service` | Parker's voice/dashboard assistant (separate project, `~/Desktop/tasks/armen`). Unrelated except that its Tether is used for phone alerts. |

**One sync pass** (`backup/mirror.py`):
1. One Management API query (`POST api.supabase.com/v1/projects/<ref>/database/query`)
   returns `parties`, `guests`, and hosted's migration versions as JSON.
2. If the data hash changed since the last snapshot, write
   `~/wedding-backups/snapshots/<UTC timestamp>.json.gz` (mode 600, dir 700).
3. Compare hosted migrations with local `supabase_migrations.schema_migrations`.
   If they differ, record the drift and exit 2.
4. If the local mirror's hash (`mirror.state` table, local DB only) differs,
   truncate and reload both tables in one transaction via
   `docker exec supabase_db_wedding psql`.
5. After 5 failures in a row, push to the phone through Tether
   (`~/Desktop/tasks/tether/.env`), then once more on recovery.

**Files outside the repo** (never commit these; the repo is public and the
data is guest PII):
- `~/.config/wedding-mirror/env`: `SUPABASE_ACCESS_TOKEN=sbp_...` (mode
  600). A personal access token with full control of the Supabase account.
- `~/wedding-backups/state.json`: last ok sync, failure count, drift
  status, last snapshot hash.
- `~/wedding-backups/snapshots/`: history; one file per hosted change.

Not mirrored: `auth.users` (the admin login). Password hashes stay on
hosted.

## Current state (2026-11-07)

- Setup complete and verified: sync ok every minute, 1 party / 119 guests,
  first snapshot `2026-11-07T20-02-27Z.json.gz`, no schema drift, units
  enabled and confirmed to come back after a reboot.
- Commits `fe00bfb` (mirror) and `736f61b` (SSH command fix) are on
  `origin/main`. `gh` is logged in on the OptiPlex, so Claude can push from
  here. Git identity is set repo-locally to Parker Sexton
  <parkersexton@gmail.com>.

## Open items

1. **Scheduled GitHub workflows are disabled** (`disabled_inactivity`): no
   commits from 2026-07-26 until 2026-11-07, so GitHub turned off
   `keep-supabase-awake.yml` and `backup-guest-list.yml`, and the hosted
   project paused (found `INACTIVE` on 2026-11-07; Parker restored it).
   Their last runs (Sept 27/28) also failed, cause unknown since the logs
   are gone. Fix: `gh workflow enable keep-supabase-awake.yml`,
   `gh workflow enable backup-guest-list.yml`, then `gh workflow run` each
   and check the result. If the backup fails, the repo secret
   `SUPABASE_ACCESS_TOKEN` probably needs replacing (`gh secret set`).
2. **Rotate the access token.** It was pasted into a Claude chat. Make a
   new one at supabase.com/dashboard/account/tokens, put it in
   `~/.config/wedding-mirror/env`, then revoke the old one.
3. **OpenSSH still accepts passwords on the LAN.** Tailscale SSH doesn't
   need them. To turn them off (Parker runs this; it needs sudo):
   `printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' | sudo tee /etc/ssh/sshd_config.d/10-no-passwords.conf && sudo systemctl reload ssh`

## Debugging runbook

Start with:

```bash
python3 ~/wedding/backup/mirror.py status
journalctl --user -u wedding-mirror -n 30 --no-pager
systemctl --user status wedding-supabase wedding-mirror.timer --no-pager
```

| Symptom | Likely cause | Fix |
|---|---|---|
| `HTTP 400 ... Database is possibly not accessible` | Hosted project paused or restarting | Check status: `curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/erkiyfvinmhduztnzecd` (`"status"`). If `INACTIVE`, restore it in the Supabase dashboard; that's Parker's call, since it changes the live site. |
| `HTTP 401` / `403` | Token expired or revoked | New token into `~/.config/wedding-mirror/env` |
| `SUPABASE_ACCESS_TOKEN is not set` | Env file empty or missing. Running `install -D ... /dev/null` on it empties it. | Rewrite the file, `chmod 600` |
| `local mirror unavailable ... permission denied ... docker.sock` | Not in the `docker` group, or the systemd user manager predates the group change | `id -nG` should list docker. Reboot (logout isn't enough because of linger). |
| `local mirror unavailable ... No such container` | Local stack not running | `systemctl --user restart wedding-supabase`; check `journalctl --user -u wedding-supabase` |
| `sync` exits 2 / `SCHEMA DRIFT` | A migration was pushed to hosted but not applied locally, or the reverse | `cd ~/wedding && npx supabase migration up`. Snapshots stay complete; only the mirror is missing columns. |
| Phone alert "Wedding backup failing" | 5+ failed syncs | Run `status` for the last error, then use this table |
| tmux "No such file or directory" over SSH | Missing `bash -lc` | Use the command in "Connecting from the laptop" |

To source the token in a shell (for `curl` or manual restores):
`set -a; . ~/.config/wedding-mirror/env; set +a`. Never echo it.

**Restoring data** (see README): `mirror.py restore <snapshot> --to local`
(stop `wedding-mirror.timer` first, or the next sync overwrites it), or
`--to hosted`, which saves the current hosted data as a snapshot, then asks
for `restore hosted` before replacing the live tables. Only restore hosted
when Parker explicitly asks.

**Local Studio** (browse the mirror) from the laptop:
`ssh -L 54323:127.0.0.1:54323 parker@parker-optiplex-7060.tail0ec459.ts.net`,
then open http://localhost:54323.

## Rules for a Claude session picking this up

- No guest data, tokens, or snapshots in `~/wedding`. The repo is public.
- Hand sudo and security changes (sshd, docker group, Tailscale settings)
  to Parker as commands. Don't run them, even though passwordless sudo works.
- Don't restore or pause the hosted project, or restore `--to hosted`,
  without Parker's explicit OK.
- Schema changes: add a migration, `supabase db push` to hosted, then
  `npx supabase migration up` locally so the mirror keeps every column.
