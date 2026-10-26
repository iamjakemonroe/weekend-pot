-- Weekend Pot: read-only access to finished Utopia games, and nothing else.
--
-- Run this once in Utopia's Supabase project: Dashboard → SQL Editor → paste → Run.
-- It's safe to run again. Then give the reader a password (the last line, with your
-- own long random password) and put the connection string in Weekend Pot's secrets
-- (see the README).
--
-- What the login weekend_pot_reader can do: call the two functions below.
--   weekend_pot.players(usernames)        → id, username and display name of those players
--   weekend_pot.games(ids, from, to)      → finished games that ended in [from, to) where
--                                           every player is one of [ids]: the game, when it
--                                           ended, its players, the winner and the result
-- What it can't do: read or change any table, see balances, emails, chats or moves.

create schema if not exists weekend_pot;
revoke all on schema weekend_pot from public;

create or replace function weekend_pot.players(p_usernames text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'username', p.username, 'display_name', p.display_name)), '[]'::jsonb)
    from public.profiles p
   where cardinality(p_usernames) <= 50
     and lower(p.username) in (select lower(btrim(u)) from unnest(p_usernames) u);
$$;

-- Chess and checkers (matches), Ludo (ludo_matches) and Crazy Eights (eights_matches).
-- Doodle isn't here: a rematch reuses the same game, so its games can't be told apart.
-- At most 7 days and 10 players per call.
create or replace function weekend_pot.games(p_players uuid[], p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select p_players as ids, p_from as t0, least(p_to, p_from + interval '7 days') as t1
     where cardinality(p_players) between 2 and 10 and p_to > p_from
  ),
  g as (
    select m.game::text as game, m.id, m.ended_at,
           array_remove(array[m.player_white, m.player_black], null) as players,
           m.winner_id, m.status::text as status, m.result
      from public.matches m, w
     where m.ended_at >= w.t0 and m.ended_at < w.t1
       and m.player_white = any (w.ids) and m.player_black = any (w.ids)
    union all
    select 'ludo', l.id, l.ended_at,
           coalesce(l.players, array_remove(array[l.player_red, l.player_yellow], null)),
           l.winner_id, l.status::text, l.result
      from public.ludo_matches l, w
     where l.ended_at >= w.t0 and l.ended_at < w.t1
       and coalesce(l.players, array_remove(array[l.player_red, l.player_yellow], null)) <@ w.ids
    union all
    select 'eights', e.id, e.ended_at, e.players, e.winner_id, e.status::text, e.result
      from public.eights_matches e, w
     where e.ended_at >= w.t0 and e.ended_at < w.t1
       and e.players <@ w.ids
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'game', g.game, 'match_id', g.id, 'ended_at', g.ended_at, 'players', to_jsonb(g.players),
           'winner', g.winner_id, 'status', g.status, 'result', g.result) order by g.ended_at), '[]'::jsonb)
    from g;
$$;

revoke all on function weekend_pot.players(text[]) from public;
revoke all on function weekend_pot.games(uuid[], timestamptz, timestamptz) from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'weekend_pot_reader') then
    create role weekend_pot_reader login noinherit connection limit 5;
  end if;
end $$;
alter role weekend_pot_reader set statement_timeout = '5s';
alter role weekend_pot_reader set search_path = weekend_pot;

grant usage on schema weekend_pot to weekend_pot_reader;
grant execute on function weekend_pot.players(text[]) to weekend_pot_reader;
grant execute on function weekend_pot.games(uuid[], timestamptz, timestamptz) to weekend_pot_reader;

-- Then, once, with your own password (letters and numbers, 30+ characters):
--   alter role weekend_pot_reader password 'PUT-A-LONG-RANDOM-PASSWORD-HERE';
