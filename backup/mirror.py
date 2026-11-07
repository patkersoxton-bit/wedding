#!/usr/bin/env python3
"""Live mirror + snapshot history of the hosted Supabase guest list.

Free-tier Supabase has no backups, so this PC keeps two things:

- a **mirror**: the local Supabase stack (`npx supabase start` in ~/wedding)
  holds a copy of `parties` and `guests`, refreshed every minute by
  wedding-mirror.timer. Its schema comes from supabase/migrations/, the same
  as hosted.
- **history**: every time the hosted data changes, a timestamped gzipped
  JSON snapshot is written to ~/wedding-backups/snapshots/. A mirror copies
  mistakes too (a bad delete is mirrored within a minute); the snapshots are
  what let you undo one.

Guest data is PII and this repo is public: snapshots and state live outside
the repo, and nothing here may write data into ~/wedding.

Usage:
  mirror.py sync                           # one sync pass (what the timer runs)
  mirror.py status                         # last sync, row counts, snapshots
  mirror.py restore SNAPSHOT --to local    # load a snapshot into the mirror
  mirror.py restore SNAPSHOT --to hosted   # overwrite hosted with a snapshot

Config (env, from ~/.config/wedding-mirror/env under systemd):
  SUPABASE_ACCESS_TOKEN  personal access token (Management API), required
  SUPABASE_PROJECT_REF   default erkiyfvinmhduztnzecd
  WEDDING_BACKUP_DIR     default ~/wedding-backups
  WEDDING_DB_CONTAINER   default supabase_db_wedding
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "erkiyfvinmhduztnzecd")
BACKUP_DIR = Path(os.environ.get("WEDDING_BACKUP_DIR", "~/wedding-backups")).expanduser()
SNAPSHOT_DIR = BACKUP_DIR / "snapshots"
STATE_FILE = BACKUP_DIR / "state.json"
DB_CONTAINER = os.environ.get("WEDDING_DB_CONTAINER", "supabase_db_wedding")
TETHER_ENV = Path("~/Desktop/tasks/tether/.env").expanduser()

# Mirrored tables, in insert order (guests.party_id references parties).
TABLES = ["parties", "guests"]

# Consecutive failed syncs (one per minute) before a phone push.
ALERT_AFTER_FAILURES = 5

EXPORT_QUERY = (
    "select json_build_object("
    + ", ".join(
        f"'{t}', coalesce((select json_agg(t order by t.id) from public.{t} t), '[]'::json)"
        for t in TABLES
    )
    + ", 'migrations', coalesce((select json_agg(version order by version)"
    " from supabase_migrations.schema_migrations), '[]'::json)) as data"
)


class SyncError(Exception):
    pass


# --- hosted (Management API) ----------------------------------------------

def management_query(sql: str) -> list:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        raise SyncError("SUPABASE_ACCESS_TOKEN is not set (see backup/README.md)")
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            # api.supabase.com sits behind Cloudflare, which rejects urllib's default UA.
            "User-Agent": "wedding-mirror/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        raise SyncError(f"Management API HTTP {e.code}: {body}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise SyncError(f"Management API unreachable: {e}") from None


def fetch_hosted() -> dict:
    rows = management_query(EXPORT_QUERY)
    try:
        data = rows[0]["data"]
    except (IndexError, KeyError, TypeError):
        raise SyncError(f"unexpected Management API response: {str(rows)[:300]}") from None
    if isinstance(data, str):
        data = json.loads(data)
    return data


def data_hash(data: dict) -> str:
    payload = json.dumps({t: data[t] for t in TABLES}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


# --- local mirror (psql inside the Supabase db container) -----------------

def local_psql(sql: str, *, single_transaction: bool = False) -> str:
    cmd = ["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
           "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1"]
    if single_transaction:
        cmd.append("-1")
    try:
        out = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        raise SyncError("docker not found") from None
    except subprocess.TimeoutExpired:
        raise SyncError("local psql timed out") from None
    if out.returncode != 0:
        raise SyncError(f"local mirror unavailable (is `npx supabase start` running?): "
                        f"{out.stderr.strip()[:300]}")
    return out.stdout.strip()


LOCAL_META_SQL = """
create schema if not exists mirror;
create table if not exists mirror.state (
  id int primary key default 1 check (id = 1),
  hash text not null,
  synced_at timestamptz not null default now()
);
"""


def local_state() -> tuple[str | None, list[str]]:
    out = local_psql(
        LOCAL_META_SQL
        + "select coalesce((select hash from mirror.state), '') || '|' ||"
        " coalesce((select json_agg(version order by version)"
        " from supabase_migrations.schema_migrations), '[]'::json)::text;"
    )
    last = out.splitlines()[-1]
    h, migrations = last.split("|", 1)
    return (h or None), json.loads(migrations)


def dollar_quote(payload: str) -> str:
    """Dollar-quote a JSON literal with a random tag the payload can't contain.

    Guests write dietary_notes/food_preference through the public RPC, so the
    payload is untrusted; a fixed tag could be closed from inside a guest value.
    """
    while True:
        tag = f"$m{secrets.token_hex(8)}$"
        if tag not in payload:
            return f"{tag}{payload}{tag}"


def replace_tables_sql(data: dict) -> str:
    """SQL that replaces the mirrored tables' contents with `data` (run in one transaction)."""
    stmts = ["truncate " + ", ".join(f"public.{t}" for t in reversed(TABLES)) + ";"]
    for t in TABLES:
        stmts.append(
            f"insert into public.{t} select * from json_populate_recordset("
            f"null::public.{t}, {dollar_quote(json.dumps(data[t]))});"
        )
    return "\n".join(stmts) + "\n"


def apply_local(data: dict, h: str) -> None:
    sql = (
        LOCAL_META_SQL
        + replace_tables_sql(data)
        + f"insert into mirror.state (id, hash, synced_at) values (1, '{h}', now())"
        " on conflict (id) do update set hash = excluded.hash, synced_at = excluded.synced_at;\n"
    )
    local_psql(sql, single_transaction=True)


# --- snapshots + state ----------------------------------------------------

def private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700)


def write_snapshot(data: dict, h: str) -> Path:
    private_dir(BACKUP_DIR)
    private_dir(SNAPSHOT_DIR)
    now = dt.datetime.now(dt.timezone.utc)
    path = SNAPSHOT_DIR / f"{now:%Y-%m-%dT%H-%M-%SZ}.json.gz"
    doc = {"taken_at": now.isoformat(), "project_ref": PROJECT_REF, "hash": h, **data}
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb") as f:
        f.write(json.dumps(doc, indent=1).encode())
    tmp.rename(path)
    return path


def read_snapshot(path: Path) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        doc = json.load(f)
    missing = [t for t in TABLES if t not in doc]
    if missing:
        raise SyncError(f"{path} is missing tables: {missing}")
    return doc


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    private_dir(BACKUP_DIR)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    tmp.chmod(0o600)
    tmp.rename(STATE_FILE)


def push_phone(title: str, message: str) -> None:
    """Best-effort phone push through Armen's Tether (same channel Armen uses)."""
    env = {}
    try:
        for line in TETHER_ENV.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.split(" #")[0].strip().strip("\"'")
    except FileNotFoundError:
        return
    if not env.get("TETHER_TOKEN"):
        return
    req = urllib.request.Request(
        f"http://127.0.0.1:{env.get('TETHER_PORT', '8787')}/api/notify",
        data=json.dumps({"title": title, "message": message, "priority": 4, "tags": ["ring"]}).encode(),
        headers={"Authorization": f"Bearer {env['TETHER_TOKEN']}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10).close()
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"phone push failed: {e}", file=sys.stderr)


# --- commands -------------------------------------------------------------

def sync_once(state: dict) -> str:
    data = fetch_hosted()
    h = data_hash(data)
    notes = []

    if h != state.get("last_snapshot_hash"):
        path = write_snapshot(data, h)
        state["last_snapshot_hash"] = h
        notes.append(f"snapshot {path.name}")

    local_hash, local_migrations = local_state()
    if data["migrations"] != local_migrations:
        missing = sorted(set(data["migrations"]) - set(local_migrations))
        extra = sorted(set(local_migrations) - set(data["migrations"]))
        # json_populate_recordset silently drops columns the local schema
        # lacks, so a drifted mirror is incomplete. The snapshot above is
        # still lossless; flag it rather than pretend the mirror is whole.
        state["schema_drift"] = {"hosted_only": missing, "local_only": extra}
        notes.append(f"SCHEMA DRIFT hosted-only={missing} local-only={extra} "
                     "(run `npx supabase migration up` in ~/wedding)")
    else:
        state.pop("schema_drift", None)

    if local_hash != h:
        apply_local(data, h)
        notes.append("mirror updated")

    counts = ", ".join(f"{len(data[t])} {t}" for t in TABLES)
    return f"ok ({counts}){': ' + '; '.join(notes) if notes else ''}"


def cmd_sync(_args) -> int:
    state = load_state()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        msg = sync_once(state)
    except SyncError as e:
        state["consecutive_failures"] = state.get("consecutive_failures", 0) + 1
        state["last_error"] = f"{now} {e}"
        if state["consecutive_failures"] == ALERT_AFTER_FAILURES:
            push_phone("Wedding backup failing",
                       f"{ALERT_AFTER_FAILURES} syncs in a row failed. Latest: {e}"[:400])
        save_state(state)
        print(f"FAILED ({state['consecutive_failures']} in a row): {e}", file=sys.stderr)
        return 1
    if state.get("consecutive_failures", 0) >= ALERT_AFTER_FAILURES:
        push_phone("Wedding backup recovered", "Syncing with hosted Supabase again.")
    state["consecutive_failures"] = 0
    state["last_ok"] = now
    save_state(state)
    print(msg)
    return 2 if "schema_drift" in state else 0


def cmd_status(_args) -> int:
    state = load_state()
    snaps = sorted(SNAPSHOT_DIR.glob("*.json.gz")) if SNAPSHOT_DIR.exists() else []
    print(f"last ok sync:       {state.get('last_ok', 'never')}")
    print(f"failures in a row:  {state.get('consecutive_failures', 0)}")
    if state.get("last_error"):
        print(f"last error:         {state['last_error']}")
    if state.get("schema_drift"):
        print(f"schema drift:       {state['schema_drift']}")
    print(f"snapshots:          {len(snaps)} in {SNAPSHOT_DIR}"
          + (f" (latest {snaps[-1].name})" if snaps else ""))
    try:
        out = local_psql(
            "select " + " || ' / ' || ".join(
                f"(select count(*) from public.{t})::text || ' {t}'" for t in TABLES)
            + " || ' / synced ' || coalesce((select synced_at::text from mirror.state), 'never');"
        )
        print(f"local mirror:       {out.splitlines()[-1]}")
    except SyncError as e:
        print(f"local mirror:       {e}")
    return 0


def cmd_restore(args) -> int:
    path = Path(args.snapshot).expanduser()
    doc = read_snapshot(path)
    counts = ", ".join(f"{len(doc[t])} {t}" for t in TABLES)
    print(f"Snapshot {path.name}: taken {doc.get('taken_at')}, {counts}")

    if args.to == "local":
        apply_local(doc, data_hash(doc))
        print("Loaded into the local mirror. The next sync (within a minute) overwrites it with\n"
              "hosted data again; stop it first with `systemctl --user stop wedding-mirror.timer`\n"
              "if you want to keep it.")
        return 0

    print(f"\nThis REPLACES every row of {', '.join(TABLES)} in the hosted project "
          f"{PROJECT_REF} (the live site).")
    if input("Type 'restore hosted' to continue: ").strip() != "restore hosted":
        print("Aborted.")
        return 1
    # Snapshot what's there now first, so the restore itself can be undone.
    current = fetch_hosted()
    before = write_snapshot(current, data_hash(current))
    print(f"Saved current hosted data to {before.name}")
    management_query("begin;\n" + replace_tables_sql(doc) + "commit;")
    print("Hosted data restored. Re-check the admin dashboard.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync").set_defaults(fn=cmd_sync)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    r = sub.add_parser("restore")
    r.add_argument("snapshot")
    r.add_argument("--to", choices=["local", "hosted"], required=True)
    r.set_defaults(fn=cmd_restore)
    args = p.parse_args()
    try:
        return args.fn(args)
    except SyncError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
