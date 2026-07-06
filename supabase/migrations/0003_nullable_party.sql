-- Party assignment for the real guest list isn't decided yet (the "who's in
-- which party" tree is being reworked). Allow guests to exist without a
-- party so the list can be imported now and organized into parties later.
alter table guests alter column party_id drop not null;
