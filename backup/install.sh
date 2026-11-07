#!/usr/bin/env bash
# Installs the wedding backup mirror as systemd user units (run as parker, no sudo).
# Prereqs (see backup/README.md): docker group membership, and the access token in
# ~/.config/wedding-mirror/env.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
unit_dir="$HOME/.config/systemd/user"
env_file="$HOME/.config/wedding-mirror/env"

if ! docker info >/dev/null 2>&1; then
  echo "docker isn't usable as $USER yet (add yourself to the docker group, then reboot)." >&2
  exit 1
fi
if ! grep -qs '^SUPABASE_ACCESS_TOKEN=.' "$env_file"; then
  echo "Put SUPABASE_ACCESS_TOKEN=... in $env_file first (chmod 600)." >&2
  exit 1
fi
chmod 600 "$env_file"

mkdir -p "$unit_dir"
cp "$here"/systemd/wedding-supabase.service "$here"/systemd/wedding-mirror.service \
   "$here"/systemd/wedding-mirror.timer "$unit_dir"/
systemctl --user daemon-reload
echo "Starting the local Supabase stack (first run downloads images)..."
systemctl --user enable --now wedding-supabase.service
systemctl --user enable --now wedding-mirror.timer
systemctl --user start wedding-mirror.service || true
python3 "$here/mirror.py" status
