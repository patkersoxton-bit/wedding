# Backup mirror (this PC)

The OptiPlex (`parker-optiplex-7060`) keeps a live copy of the hosted
Supabase backend so the guest list and RSVPs survive a bad edit, a paused
free-tier project, or Supabase losing the data.

- **Mirror**: the local Supabase stack (Docker, `npx supabase start` in
  `~/wedding`) runs the same migrations as hosted. Every minute
  `wedding-mirror.timer` pulls `parties` + `guests` from hosted through the
  Management API and replaces the local copy if anything changed.
- **History**: every change on hosted also writes a timestamped snapshot to
  `~/wedding-backups/snapshots/*.json.gz` (owner-only). The mirror copies
  mistakes within a minute; snapshots are how you undo them.
- **Alerts**: after 5 failed syncs in a row (hosted down or paused, token
  expired, Docker stopped) a push goes to your phone through Armen's Tether,
  plus one more when it recovers.
- Polling every minute also keeps the free-tier project from auto-pausing.
  The GitHub keep-awake workflow stays in place for when this PC is off.

Guest data is PII and the `wedding` repo is public, so **no data ever goes
in the repo**. Only this code does.

Not mirrored: `auth.users` (the admin login). To use the local admin
dashboard, create the admin user in local Studio (http://127.0.0.1:54323).

## One-time setup

1. Let your user run Docker (root-equivalent, so do it yourself), then
   **reboot**: `sudo usermod -aG docker parker`. Logging out isn't enough.
   Linger keeps the systemd user manager running across logouts, so the
   timer wouldn't pick up the new group.
2. Create a Supabase personal access token at
   https://supabase.com/dashboard/account/tokens (name it
   `optiplex-mirror`). Store it owner-only in
   `~/.config/wedding-mirror/env` as `SUPABASE_ACCESS_TOKEN=sbp_...`
   (`chmod 600`). Don't recreate that file with `install /dev/null`;
   that empties an existing one. The token can do anything
   on your Supabase account, so keep it out of the repo and out of chat.
3. `~/wedding/backup/install.sh`: installs and starts the user units.
   Linger is on for `parker`, so they start at boot without a login.

## Day to day

```bash
python3 ~/wedding/backup/mirror.py status
journalctl --user -u wedding-mirror -n 20
ls ~/wedding-backups/snapshots/
```

Restore (each one prints a summary and asks before doing anything big):

```bash
# load an old snapshot into the local mirror (stop the timer first to keep it)
python3 ~/wedding/backup/mirror.py restore ~/wedding-backups/snapshots/<file> --to local
# overwrite the LIVE hosted tables (saves a snapshot of the current hosted data first)
set -a; . ~/.config/wedding-mirror/env; set +a
python3 ~/wedding/backup/mirror.py restore ~/wedding-backups/snapshots/<file> --to hosted
```

If hosted is gone for good: create a new Supabase project, `supabase link`
+ `db push` the migrations, restore the latest snapshot `--to hosted` with
`SUPABASE_PROJECT_REF` set to the new ref, and swap the URL/key in
`js/supabase-client.js`.

**Schema changes**: after adding a migration and pushing it to hosted, run
`npx supabase migration up` here too. If the mirror's migrations differ from
hosted, `sync` exits with code 2 and `status` shows the drift. Snapshots stay
complete either way.

## Remote access from the laptop

Use Tailscale SSH. It logs in with your tailnet identity, so there are no
keys to manage and nothing is exposed outside the tailnet.

On this PC (once):

```bash
sudo tailscale set --ssh
sudo apt install -y tmux
```

On the laptop: install Tailscale, sign in with the same account
(parkersexton@), then:

```bash
ssh -t parker@parker-optiplex-7060.tail0ec459.ts.net "tmux new -A -s wedding -c ~/wedding 'bash -lc claude'"
```

Use the full `.ts.net` name. The bare hostname can resolve over the home
LAN instead, which goes to OpenSSH and asks for a password rather than
using Tailscale SSH. `bash -lc` matters: a command passed to ssh skips
`~/.profile`, so `~/.local/bin/claude` isn't on PATH without it.

That attaches to a persistent `claude` session in `~/wedding` that survives
the laptop closing; detach with `Ctrl-b d`. Tailscale's default policy may
ask you to re-confirm in the browser now and then ("check" mode).
