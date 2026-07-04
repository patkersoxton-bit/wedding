-- RSVP system schema: parties, guests, RLS, and guest-facing RPC functions.
--
-- Security model: the anon key is public (ships in page source), so the
-- `guests` and `parties` tables have RLS enabled with NO policies for
-- anon/authenticated on direct table access. All guest-facing reads/writes
-- go through the SECURITY DEFINER functions below, which control exactly
-- what's exposed and validate every write server-side. Authenticated users
-- (the three admin logins) get full direct table access for the dashboard.

create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  party_name text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  invited boolean not null default true,
  address_line1 text,
  address_line2 text,
  city text,
  state_province text,
  postal_code text,
  country text,
  food_preference text,
  dietary_notes text,
  rsvp_status text not null default 'pending' check (rsvp_status in ('pending', 'yes', 'no')),
  responded_at timestamptz,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create extension if not exists pg_trgm;

create index if not exists guests_party_id_idx on guests(party_id);
create index if not exists guests_name_idx on guests using gin (
  (first_name || ' ' || last_name) gin_trgm_ops
);

alter table parties enable row level security;
alter table guests enable row level security;

-- Admin dashboard: authenticated users (Parker, Jolan, Elizabeth) get full access.
create policy "authenticated full access to parties"
  on parties for all
  to authenticated
  using (true)
  with check (true);

create policy "authenticated full access to guests"
  on guests for all
  to authenticated
  using (true)
  with check (true);

-- RLS policies only control row visibility — the authenticated role also
-- needs the underlying table-level grants, or every query 403s regardless
-- of policy.
grant select, insert, update, delete on parties to authenticated;
grant select, insert, update, delete on guests to authenticated;

-- No policies or grants for anon on parties/guests: direct table access is
-- denied entirely. Guests interact only through the RPCs below, which run
-- as the function owner (SECURITY DEFINER) and so don't need anon grants.

-- 1. Search by name. Returns only what's needed to identify a party, never
-- full guest rows (address, food preference, etc.).
create or replace function search_guests(search_name text)
returns table (
  guest_id uuid,
  first_name text,
  last_name text,
  party_id uuid,
  party_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select g.id, g.first_name, g.last_name, g.party_id, p.party_name
  from guests g
  join parties p on p.id = g.party_id
  where g.invited = true
    and (g.first_name || ' ' || g.last_name) ilike '%' || search_name || '%'
  order by g.last_name, g.first_name
  limit 20;
$$;

revoke all on function search_guests(text) from public;
grant execute on function search_guests(text) to anon, authenticated;

-- 2. Once a guest picks their party, list only the invited members of it.
create or replace function get_party_members(p_party_id uuid)
returns table (
  guest_id uuid,
  first_name text,
  last_name text,
  food_preference text,
  dietary_notes text,
  rsvp_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select g.id, g.first_name, g.last_name, g.food_preference, g.dietary_notes, g.rsvp_status
  from guests g
  where g.party_id = p_party_id
    and g.invited = true
  order by g.last_name, g.first_name;
$$;

revoke all on function get_party_members(uuid) from public;
grant execute on function get_party_members(uuid) to anon, authenticated;

-- 3. Submit RSVP responses for a whole party in one call. `responses` is a
-- jsonb array: [{"guest_id": "...", "rsvp_status": "yes", "food_preference": "...", "dietary_notes": "..."}]
-- Every guest_id is validated against p_party_id (and invited = true) before
-- any write happens — this is the actual enforcement that a guest can't
-- RSVP on behalf of someone outside their own party, regardless of what a
-- tampered client sends.
create or replace function submit_rsvp(p_party_id uuid, responses jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_guest_id uuid;
  v_count int;
begin
  for r in select * from jsonb_array_elements(responses)
  loop
    v_guest_id := (r ->> 'guest_id')::uuid;

    select count(*) into v_count
    from guests
    where id = v_guest_id
      and party_id = p_party_id
      and invited = true;

    if v_count = 0 then
      raise exception 'guest % is not an invited member of party %', v_guest_id, p_party_id;
    end if;

    update guests set
      rsvp_status = coalesce(r ->> 'rsvp_status', rsvp_status),
      food_preference = coalesce(r ->> 'food_preference', food_preference),
      dietary_notes = coalesce(r ->> 'dietary_notes', dietary_notes),
      responded_at = now()
    where id = v_guest_id;
  end loop;
end;
$$;

revoke all on function submit_rsvp(uuid, jsonb) from public;
grant execute on function submit_rsvp(uuid, jsonb) to anon, authenticated;
