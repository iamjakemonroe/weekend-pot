-- Weekend Pot's own data (Cloudflare D1). Times are ISO 8601 in UTC.

-- group_name, currency (ISO code), timezone (IANA), treasurer (how to pay the pot holder)
create table settings (
  key   text primary key,
  value text not null
);
insert into settings (key, value) values
  ('group_name', 'Weekend Pot'),
  ('currency', 'NGN'),
  ('timezone', 'Africa/Lagos'),
  ('treasurer', '');

create table members (
  id              integer primary key,
  name            text not null,
  utopia_username text not null,
  utopia_id       text not null,
  is_admin        integer not null default 0,
  -- SHA-256 of the token in their personal link; null once removed.
  token_hash      text unique,
  created_at      text not null,
  removed_at      text
);
create unique index members_username on members (utopia_username) where removed_at is null;
create unique index members_utopia_id on members (utopia_id) where removed_at is null;

create table pots (
  id          integer primary key,
  title       text not null,
  -- any, ludo, eights, chess or checkers
  game        text not null,
  -- first: the first game between all the players decides; most: most wins by the end
  rule        text not null,
  stake       integer not null,
  -- Joining and paying close at starts_at; games count from starts_at to ends_at.
  starts_at   text not null,
  ends_at     text not null,
  -- open, decided, settled or cancelled
  status      text not null default 'open',
  -- The latest check: the games found, the outcome, and anything the admin must decide.
  decision    text,
  checked_at  text,
  decided_at  text,
  created_by  integer not null references members (id),
  created_at  text not null
);

create table entries (
  pot_id       integer not null references pots (id),
  member_id    integer not null references members (id),
  -- joined → sent (they say they've paid the holder) → paid (the holder confirmed it)
  state        text not null default 'joined',
  sent_note    text,
  sent_at      text,
  paid_at      text,
  confirmed_by integer references members (id),
  -- What the holder owes them once decided: winnings, a share, or their stake back.
  payout       integer not null default 0,
  paid_out_at  text,
  paid_out_by  integer references members (id),
  primary key (pot_id, member_id)
);

create table log (
  id        integer primary key,
  at        text not null,
  member_id integer,
  pot_id    integer,
  action    text not null,
  detail    text
);
