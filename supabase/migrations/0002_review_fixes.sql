-- Review fixes:
--   1. Constrain food_preference at the database level — the RPC previously
--      accepted any string from the (public) anon role, so the fixed option
--      list only existed client-side.
--   2. submit_rsvp: writing an explicit null now clears food_preference /
--      dietary_notes (the old coalesce() made a chosen meal permanent), and
--      responded_at is only stamped once a guest has actually answered
--      yes/no, so it can't disagree with the pending count.

alter table guests
  add constraint guests_food_preference_check
  check (food_preference is null or food_preference in ('Chicken', 'Beef', 'Fish', 'Vegetarian'));

-- create or replace keeps the existing grants (anon/authenticated execute)
-- from 0001, so no re-grant is needed.
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
      -- "key present" (r ? 'field') rather than coalesce: a payload that
      -- includes the field with a null/empty value clears it, while a
      -- payload that omits the field leaves the stored value alone.
      food_preference = case
        when r ? 'food_preference' then nullif(r ->> 'food_preference', '')
        else food_preference
      end,
      dietary_notes = case
        when r ? 'dietary_notes' then nullif(r ->> 'dietary_notes', '')
        else dietary_notes
      end,
      responded_at = case
        when coalesce(r ->> 'rsvp_status', rsvp_status) in ('yes', 'no') then now()
        else responded_at
      end
    where id = v_guest_id;
  end loop;
end;
$$;
