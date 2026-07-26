-- Pre-launch address collection: a standalone page (address.html) that lets
-- invitees submit their own mailing address before the real site/RSVP flow
-- exists. New columns for fields that page collects but weren't needed yet.
alter table guests
  add column if not exists title text,
  add column if not exists email text,
  add column if not exists phone text;

-- Guest-facing insert only. Unlike search_guests/get_party_members, this
-- function returns void and never selects guest/party rows back to the
-- caller — anon has no read path into the guest list at all here, so the
-- list stays secret even to someone submitting this exact form.
--
-- Household -> parties.party_name, matched case-insensitively so multiple
-- members of the same household land in one party; unmatched households
-- create a new party row. (Two people racing to submit the same brand-new
-- household name in the same instant could create a duplicate party — an
-- acceptable rare edge case, cleaned up later via the admin dashboard.)
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
  v_party_id uuid;
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

  select id into v_party_id
  from parties
  where lower(party_name) = lower(trim(p_household))
  limit 1;

  if v_party_id is null then
    insert into parties (party_name) values (trim(p_household))
    returning id into v_party_id;
  end if;

  insert into guests (
    party_id, title, first_name, last_name,
    address_line1, address_line2, city, state_province, postal_code,
    email, phone
  ) values (
    v_party_id, trim(p_title), trim(p_first_name), trim(p_last_name),
    trim(p_address_line1), nullif(trim(coalesce(p_address_line2, '')), ''),
    trim(p_city), trim(p_state), trim(p_zip),
    trim(p_email), trim(p_phone)
  );
end;
$$;

revoke all on function submit_address_entry(
  text, text, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function submit_address_entry(
  text, text, text, text, text, text, text, text, text, text, text
) to anon, authenticated;
