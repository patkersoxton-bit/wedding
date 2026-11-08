-- Address inbox + party FK fix.
--
-- 1. Address submissions go to a staging table instead of straight into
--    `guests`. The old submit_address_entry inserted a brand-new guest row
--    (invited = true by default) for every submission, which meant:
--      * anyone holding the public anon key could add themselves to the
--        guest list as an *invited* guest and then RSVP through
--        find_invitation / submit_solo_rsvp, and
--      * a real invitee who was already on the imported list got a second,
--        duplicate row instead of their existing row being filled in.
--    Now a submission only lands in `address_submissions`; a planner reviews
--    it in the admin dashboard ("Address inbox") and applies it to the
--    matching guest (or adds a new guest) explicitly.
--
-- 2. guests.party_id was ON DELETE CASCADE, so deleting a party deleted
--    every guest in it. Switch to ON DELETE SET NULL: deleting a party just
--    ungroups its members.
--
-- The RPC's signature is unchanged, so address.html / js/address.js need no
-- changes.

alter table guests drop constraint if exists guests_party_id_fkey;
alter table guests
  add constraint guests_party_id_fkey
  foreign key (party_id) references parties(id) on delete set null;

create table if not exists address_submissions (
  id uuid primary key default gen_random_uuid(),
  household text not null,
  title text,
  first_name text not null,
  last_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state_province text not null,
  postal_code text not null,
  email text,
  phone text,
  -- Best guess at which existing guest this is, computed at submit time
  -- (unique phone match first, then unique exact-name match). Only a
  -- suggestion: the planner confirms or overrides it when applying.
  matched_guest_id uuid references guests(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'dismissed')),
  applied_guest_id uuid references guests(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists address_submissions_status_idx
  on address_submissions(status, created_at);

alter table address_submissions enable row level security;

create policy "authenticated full access to address_submissions"
  on address_submissions for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on address_submissions to authenticated;
-- No anon policy/grant: anon writes only via submit_address_entry below.

-- Digits-only phone, last 10 digits (drops a leading US "1" / "+1"), for
-- matching submissions against phone numbers the planners imported.
create or replace function normalize_phone(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '');
$$;

create or replace function submit_address_entry(
  p_household text,
  p_title text,
  p_first_name text,
  p_last_name text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_zip text,
  p_email text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match uuid;
  v_count int;
  v_phone text := normalize_phone(p_phone);
begin
  if trim(coalesce(p_household, '')) = '' then
    raise exception 'household is required';
  end if;
  if trim(coalesce(p_title, '')) = '' then
    raise exception 'title is required';
  end if;
  if trim(coalesce(p_first_name, '')) = '' or trim(coalesce(p_last_name, '')) = '' then
    raise exception 'first and last name are required';
  end if;
  if trim(coalesce(p_address_line1, '')) = '' or trim(coalesce(p_city, '')) = ''
    or trim(coalesce(p_state, '')) = '' or trim(coalesce(p_zip, '')) = '' then
    raise exception 'full address is required';
  end if;
  if trim(coalesce(p_email, '')) = '' or trim(coalesce(p_phone, '')) = '' then
    raise exception 'email and phone are required';
  end if;
  -- Public endpoint: cap field sizes so it can't be used to stuff the table
  -- with huge blobs.
  if greatest(
       length(p_household), length(p_title), length(p_first_name), length(p_last_name),
       length(p_address_line1), length(coalesce(p_address_line2, '')), length(p_city),
       length(p_state), length(p_zip), length(p_email), length(p_phone)
     ) > 200 then
    raise exception 'one of the fields is too long';
  end if;

  -- Suggested match: a unique phone match is the strongest signal (phones
  -- are imported before the address texts go out), then a unique exact name.
  if v_phone is not null then
    select count(*), min(id::text)::uuid into v_count, v_match
    from guests where normalize_phone(phone) = v_phone;
    if v_count <> 1 then v_match := null; end if;
  end if;
  if v_match is null then
    select count(*), min(id::text)::uuid into v_count, v_match
    from guests
    where lower(trim(first_name)) = lower(trim(p_first_name))
      and lower(trim(last_name)) = lower(trim(p_last_name));
    if v_count <> 1 then v_match := null; end if;
  end if;

  insert into address_submissions (
    household, title, first_name, last_name,
    address_line1, address_line2, city, state_province, postal_code,
    email, phone, matched_guest_id
  ) values (
    trim(p_household), trim(p_title), trim(p_first_name), trim(p_last_name),
    trim(p_address_line1), nullif(trim(coalesce(p_address_line2, '')), ''),
    trim(p_city), trim(p_state), trim(p_zip),
    trim(p_email), trim(p_phone), v_match
  );
end;
$$;

-- create or replace keeps 0005's grants (anon/authenticated execute).

-- Planner action: apply a submission to a guest (p_guest_id), or create a
-- new guest from it (p_guest_id null). Optionally also put that guest into
-- the party named by the submitted household (found case-insensitively, or
-- created). Atomic, so a half-applied submission can't happen.
-- SECURITY INVOKER: runs with the caller's own RLS, i.e. authenticated
-- planners only; anon has no execute grant and no table access anyway.
create or replace function apply_address_submission(
  p_submission_id uuid,
  p_guest_id uuid,
  p_use_household boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  s address_submissions%rowtype;
  v_guest_id uuid := p_guest_id;
  v_party_id uuid;
begin
  select * into s from address_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;

  if p_use_household then
    select id into v_party_id from parties
    where lower(trim(party_name)) = lower(trim(s.household))
    order by created_at limit 1;
    if v_party_id is null then
      insert into parties (party_name) values (s.household) returning id into v_party_id;
    end if;
  end if;

  if v_guest_id is null then
    insert into guests (
      party_id, title, first_name, last_name,
      address_line1, address_line2, city, state_province, postal_code,
      email, phone
    ) values (
      v_party_id, s.title, s.first_name, s.last_name,
      s.address_line1, s.address_line2, s.city, s.state_province, s.postal_code,
      s.email, s.phone
    ) returning id into v_guest_id;
  else
    update guests set
      title = coalesce(s.title, title),
      address_line1 = s.address_line1,
      address_line2 = s.address_line2,
      city = s.city,
      state_province = s.state_province,
      postal_code = s.postal_code,
      email = coalesce(s.email, email),
      phone = coalesce(s.phone, phone),
      party_id = coalesce(v_party_id, party_id)
    where id = v_guest_id;
    if not found then
      raise exception 'guest % not found', v_guest_id;
    end if;
  end if;

  update address_submissions set
    status = 'applied',
    applied_guest_id = v_guest_id,
    reviewed_at = now()
  where id = p_submission_id;

  return v_guest_id;
end;
$$;

revoke all on function apply_address_submission(uuid, uuid, boolean) from public, anon;
grant execute on function apply_address_submission(uuid, uuid, boolean) to authenticated;
revoke all on function normalize_phone(text) from public, anon;
grant execute on function normalize_phone(text) to authenticated;
