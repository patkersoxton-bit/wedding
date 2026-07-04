-- Prototype seed data: one party (Parker & Jolan) to walk through the RSVP flow.
insert into parties (id, party_name) values
  ('00000000-0000-0000-0000-000000000001', 'Parker & Jolan')
on conflict (id) do nothing;

insert into guests (party_id, first_name, last_name, invited) values
  ('00000000-0000-0000-0000-000000000001', 'Parker', 'Sexton', true),
  ('00000000-0000-0000-0000-000000000001', 'Jolan', 'Motyka', true)
on conflict do nothing;
