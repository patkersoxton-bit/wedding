-- Replace the typeahead-style search_guests (ILIKE partial match, up to 20
-- rows per keystroke) with an exact-name lookup that never reveals other
-- guests. search_guests was a real privacy leak, not just a UI annoyance:
-- the anon key is public, so anyone could call
-- supabase.rpc('search_guests', { search_name: 'a' }) directly from a
-- browser console (bypassing the frontend entirely) and harvest every
-- invited guest's name + household. Dropping the RPC, not just changing
-- how the frontend calls it, is what actually closes that hole.
revoke all on function search_guests(text) from public, anon, authenticated;
drop function if exists search_guests(text);

-- Exact (case-insensitive, trimmed) first+last name match only -- no
-- ILIKE/partial matching, so there's no way to page through the guest
-- list by typing fragments. Capped at 5 rows for the rare case of two
-- guests sharing an exact name (the current list has one: two separate
-- "Mike Motyka" rows) so the guest can pick between just those exact
-- matches -- never a broader list of unrelated people.
--
-- Returns food_preference/dietary_notes/rsvp_status too so a guest with no
-- party yet (party_id null -- see submit_solo_rsvp below) can be shown
-- their own fields straight from this call, without a second RPC that
-- would otherwise require a party_id they don't have.
create or replace function find_invitation(p_first_name text, p_last_name text)
returns table (
  guest_id uuid,
  first_name text,
  last_name text,
  party_id uuid,
  party_name text,
  food_preference text,
  dietary_notes text,
  rsvp_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select g.id, g.first_name, g.last_name, g.party_id, p.party_name,
         g.food_preference, g.dietary_notes, g.rsvp_status
  from guests g
  left join parties p on p.id = g.party_id
  where g.invited = true
    and lower(trim(g.first_name)) = lower(trim(p_first_name))
    and lower(trim(g.last_name)) = lower(trim(p_last_name))
  limit 5;
$$;

revoke all on function find_invitation(text, text) from public;
grant execute on function find_invitation(text, text) to anon, authenticated;

-- Submit path for a guest who isn't grouped into a household/party yet
-- (party_id is null -- true for most of the real guest list at the moment,
-- since party assignment is an ongoing manual admin task). Mirrors
-- submit_rsvp's per-guest update but doesn't require a party_id at all.
-- Guarded by `party_id is null` so this can never be used to edit a guest
-- who *does* have a party -- that must still go through submit_rsvp's
-- party-membership check.
create or replace function submit_solo_rsvp(
  p_guest_id uuid,
  p_rsvp_status text,
  p_food_preference text,
  p_dietary_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update guests set
    rsvp_status = coalesce(p_rsvp_status, rsvp_status),
    food_preference = coalesce(p_food_preference, food_preference),
    dietary_notes = coalesce(p_dietary_notes, dietary_notes),
    responded_at = now()
  where id = p_guest_id
    and invited = true
    and party_id is null;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'guest % not found, not invited, or no longer solo (party assigned)', p_guest_id;
  end if;
end;
$$;

revoke all on function submit_solo_rsvp(uuid, text, text, text) from public;
grant execute on function submit_solo_rsvp(uuid, text, text, text) to anon, authenticated;
