#!/usr/bin/env python3
"""A throwaway Utopia database for testing Weekend Pot's read-only access.

  python3 test/utopia_db.py check  [--pg-bin DIR] [--utopia ../utopia]   # prove reader.sql, then stop
  python3 test/utopia_db.py serve  [--pg-bin DIR] [--port 55433]           # keep it running for the app
  python3 test/utopia_db.py game   --port 55433 ludo alice,bob,carol bob   # record a finished game

It starts Postgres on 127.0.0.1 (password logins over TCP, like Supabase), applies every
Utopia migration with the stand-ins from Utopia's tool/db_test/harness.py, runs
utopia/reader.sql and gives weekend_pot_reader the password "reader-test-password".
Needs psycopg2 (pip install psycopg2-binary) and Postgres binaries (initdb, pg_ctl, postgres),
e.g. from Wavee's tool/db_test/fetch_postgres.sh.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
READER_PASSWORD = "reader-test-password"
ADMIN_PASSWORD = "admin-test-password"
USERS = ["alice", "bob", "carol", "dave", "erin", "outsider"]


def start(pg_bin, port):
    data = tempfile.mkdtemp(prefix="weekend-pot-utopia-")
    pw = os.path.join(data, "pw")
    with open(pw, "w") as f:
        f.write(ADMIN_PASSWORD)
    cluster = os.path.join(data, "data")
    subprocess.run([os.path.join(pg_bin, "initdb"), "-D", cluster, "-U", "postgres", "--pwfile", pw,
                    "--auth-local=trust", "--auth-host=scram-sha-256", "-E", "UTF8", "--no-locale"],
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run([os.path.join(pg_bin, "pg_ctl"), "-D", cluster, "-w", "-l", os.path.join(data, "log"),
                    "-o", f"-p {port} -k {data} -c listen_addresses=127.0.0.1 -c fsync=off", "start"],
                   check=True, stdout=subprocess.DEVNULL)
    return data, cluster


def stop(pg_bin, data, cluster):
    subprocess.run([os.path.join(pg_bin, "pg_ctl"), "-D", cluster, "-m", "fast", "-w", "stop"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shutil.rmtree(data, ignore_errors=True)


def admin_conn(port, db="postgres"):
    c = psycopg2.connect(host="127.0.0.1", port=port, user="postgres", password=ADMIN_PASSWORD, dbname=db)
    c.autocommit = True
    return c


def reader_conn(port):
    c = psycopg2.connect(host="127.0.0.1", port=port, user="weekend_pot_reader", password=READER_PASSWORD,
                         dbname="utopia")
    c.autocommit = True
    return c


def build(port, utopia):
    """Utopia's schema (every migration), reader.sql, and six players."""
    harness = open(os.path.join(utopia, "tool", "db_test", "harness.py")).read()
    shim = re.search(r'SHIM = r"""(.*?)"""', harness, re.S).group(1)
    with admin_conn(port).cursor() as c:
        c.execute("drop database if exists utopia")
        c.execute("create database utopia")
    db = admin_conn(port, "utopia")
    with db.cursor() as c:
        c.execute(shim)
    paths = sorted(glob.glob(os.path.join(utopia, "supabase", "migrations", "*.sql")))
    for path in paths:
        sql = re.sub(r"create extension if not exists (pg_cron|pgcrypto|pg_net)[^;]*;", "", open(path).read(), flags=re.I)
        with db.cursor() as c:
            try:
                c.execute("begin")
                c.execute(sql)
                c.execute("commit")
            except Exception as e:
                c.execute("rollback")
                raise RuntimeError(f"{os.path.basename(path)}: {e}") from e
    with db.cursor() as c:
        c.execute(open(os.path.join(ROOT, "utopia", "reader.sql")).read())
        c.execute(open(os.path.join(ROOT, "utopia", "reader.sql")).read())  # safe to run twice
        c.execute(f"alter role weekend_pot_reader password '{READER_PASSWORD}'")
        for name in USERS:
            c.execute("insert into auth.users (email) values (%s) returning id", (f"{name}@example.com",))
            uid = c.fetchone()[0]
            c.execute("insert into public.profiles (id) values (%s) on conflict (id) do nothing", (uid,))
            c.execute("update public.profiles set username = %s, display_name = %s where id = %s",
                      (name, name.title(), uid))
    print(f"Utopia schema ready: {len(paths)} migrations, reader.sql, players {', '.join(USERS)}")
    return db


def ids(db, names):
    with db.cursor() as c:
        c.execute("select username, id::text from public.profiles where username = any(%s)", (names,))
        found = dict(c.fetchall())
    return [found[n] for n in names]


def record(db, game, names, winner, ended_at=None, status="completed"):
    """A finished game, the way Utopia stores it."""
    players = ids(db, names)
    win = ids(db, [winner])[0] if winner else None
    ended = ended_at or "now()"
    with db.cursor() as c:
        c.execute("set session_replication_role = replica")  # Utopia's triggers aren't the point here
        if game in ("chess", "checkers"):
            c.execute(f"""insert into public.matches (game, status, stake, player_white, player_black, winner_id, result,
                            started_at, ended_at) values (%s, %s, 0, %s, %s, %s, %s, now(), {'%s' if ended_at else 'now()'}) returning id""",
                      [game, status, players[0], players[1], win, "checkmate" if win else "draw"] + ([ended_at] if ended_at else []))
        elif game == "ludo":
            colors = ["red", "green", "yellow", "blue", "purple", "orange"][:len(players)]
            c.execute(f"""insert into public.ludo_matches (status, stake, player_red, player_yellow, players, colors, state, winner_id,
                            result, started_at, ended_at) values (%s, 0, %s, %s, %s::uuid[], %s, '{{}}'::jsonb, %s, 'win', now(),
                            {'%s' if ended_at else 'now()'}) returning id""",
                      [status, players[0], players[1], players, colors, win] + ([ended_at] if ended_at else []))
        elif game == "eights":
            c.execute(f"""insert into public.eights_matches (status, players, mode, state, winner_id, result, ended_at)
                            values (%s, %s::uuid[], 'friends', '{{}}'::jsonb, %s, 'win', {'%s' if ended_at else 'now()'}) returning id""",
                      [status, players, win] + ([ended_at] if ended_at else []))
        else:
            raise SystemExit(f"unknown game {game}")
        mid = c.fetchone()[0]
        c.execute("set session_replication_role = origin")
    return str(mid)


def check(port, utopia):
    db = build(port, utopia)
    passed, failed = 0, []

    def ok(name, cond, detail=""):
        nonlocal passed
        if cond:
            passed += 1
            print(f"  PASS  {name}")
        else:
            failed.append(name)
            print(f"  FAIL  {name} {detail}")

    t0, t1 = "2026-10-31T18:00:00Z", "2026-10-31T23:00:00Z"
    five = ["alice", "bob", "carol", "dave", "erin"]
    ludo = record(db, "ludo", five, "carol", "2026-10-31T19:30:00Z")
    eights = record(db, "eights", five, "bob", "2026-10-31T20:30:00Z")
    chess = record(db, "chess", ["alice", "bob"], "alice", "2026-10-31T21:00:00Z")
    record(db, "ludo", ["alice", "bob", "outsider"], "alice", "2026-10-31T19:45:00Z")   # an outsider
    record(db, "eights", five, "erin", "2026-10-30T20:00:00Z")                           # the day before
    record(db, "ludo", five, None, "2026-10-31T21:30:00Z", status="aborted")             # abandoned

    r = reader_conn(port)
    with r.cursor() as c:
        c.execute("select weekend_pot.players(array['alice', 'BOB', ' carol ', 'nobody'])")
        found = sorted(p["username"] for p in c.fetchone()[0])
        ok("the reader finds players by username (any case), and nobody else", found == ["alice", "bob", "carol"], found)

        c.execute("select weekend_pot.games(%s::uuid[], %s, %s)", (ids(db, five), t0, t1))
        games = c.fetchone()[0]
        got = [(g["game"], g["match_id"]) for g in games]
        ok("games: only those among the five, inside the window, oldest first",
           [m for _, m in got][:3] == [ludo, eights, chess] and len(games) == 4, got)
        ok("…with the winner and status", games[0]["winner"] == ids(db, ["carol"])[0] and games[3]["status"] == "aborted",
           games)
        ok("…and the players", sorted(games[0]["players"]) == sorted(ids(db, five)))

        c.execute("select weekend_pot.games(%s::uuid[], %s, %s)", (ids(db, ["alice"]), t0, t1))
        ok("one player alone gets nothing", c.fetchone()[0] == [])
        c.execute("select weekend_pot.games(%s::uuid[], '2026-10-01', '2026-10-31')", (ids(db, five),))
        ok("windows are capped at 7 days", c.fetchone()[0] == [])

        def denied(sql):
            try:
                with r.cursor() as cc:
                    cc.execute(sql)
                return False
            except psycopg2.Error:
                return True

        ok("can't read profiles", denied("select * from public.profiles"))
        ok("can't read matches", denied("select * from public.ludo_matches"))
        ok("can't read balances or the ledger", denied("select * from public.ledger_entries"))
        ok("can't write", denied("update public.profiles set display_name = 'x'"))
        ok("can't read auth", denied("select * from auth.users"))
        c.execute("show statement_timeout")
        ok("queries stop after 5 seconds", c.fetchone()[0] == "5s")

    # Functions anyone may run (PUBLIC) are a risk for any new login: list Utopia's that the reader could run.
    with db.cursor() as c:
        c.execute("""
          select p.oid::regprocedure::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname not in ('pg_catalog', 'information_schema', 'weekend_pot')
             and n.nspname not like 'pg_%%'
             and p.prosecdef
             and p.prorettype <> 'trigger'::regtype   -- trigger functions can only run as triggers
             and has_function_privilege('weekend_pot_reader', p.oid, 'execute')
           order by 1""")
        open_fns = [r[0] for r in c.fetchall()]
    ok("no Utopia security-definer function is runnable by the reader", not open_fns, open_fns[:20])
    with r.cursor() as c:
        ok("…and the trigger functions open to everyone can't be called directly", denied("select public.handle_new_user()"))

    print(f"\n{passed} passed, {len(failed)} failed")
    return not failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["check", "serve", "game"])
    ap.add_argument("rest", nargs="*")
    ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", ""))
    ap.add_argument("--port", type=int, default=55433)
    ap.add_argument("--utopia", default=os.path.join(ROOT, "..", "utopia"))
    a = ap.parse_intermixed_args()

    if a.mode == "game":
        game, names, winner = a.rest[0], a.rest[1].split(","), (a.rest[2] if len(a.rest) > 2 and a.rest[2] != "-" else None)
        mid = record(admin_conn(a.port, "utopia"), game, names, winner)
        print(json.dumps({"match_id": mid}))
        return

    if not a.pg_bin:
        sys.exit("Pass --pg-bin (a folder with initdb, pg_ctl and postgres) or set PG_BIN.")
    data, cluster = start(a.pg_bin, a.port)
    try:
        if a.mode == "check":
            sys.exit(0 if check(a.port, a.utopia) else 1)
        build(a.port, a.utopia)
        print(f"UTOPIA_DB_URL=postgres://weekend_pot_reader:{READER_PASSWORD}@127.0.0.1:{a.port}/utopia", flush=True)
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        stop(a.pg_bin, data, cluster)


if __name__ == "__main__":
    main()
