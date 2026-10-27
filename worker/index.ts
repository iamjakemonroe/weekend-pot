// Weekend Pot: a private pot for a group of friends who play Utopia together.
// Members sign in with a personal link; the holder (an admin) confirms deposits and
// sends payouts; the winner is read from Utopia's database (utopia.ts, decide.ts).
import { decide, split, type Outcome, type PotGame, type Rule } from './decide';
import { utopia, type Utopia } from './utopia';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** postgres://weekend_pot_reader.<project>:<password>@<pooler host>:6543/postgres */
  UTOPIA_DB_URL: string;
  /** Asked for once, to create the first admin. */
  SETUP_KEY: string;
}

interface Member {
  id: number;
  name: string;
  utopia_username: string;
  utopia_id: string;
  is_admin: number;
}

interface PotRow {
  id: number;
  title: string;
  game: PotGame;
  rule: Rule;
  stake: number;
  starts_at: string;
  ends_at: string;
  status: 'open' | 'decided' | 'settled' | 'cancelled';
  decision: string | null;
  checked_at: string | null;
  decided_at: string | null;
  created_by: number;
  created_at: string;
}

interface EntryRow {
  pot_id: number;
  member_id: number;
  state: 'joined' | 'sent' | 'paid';
  sent_note: string | null;
  sent_at: string | null;
  paid_at: string | null;
  payout: number;
  paid_out_at: string | null;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const COOKIE = 'wp_session';
const GAMES: PotGame[] = ['any', 'ludo', 'eights', 'chess', 'checkers'];
const RULES: Rule[] = ['first', 'most'];
const nowIso = () => new Date().toISOString();

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sessionCookie = (token: string) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${400 * 86400}`;

function cookieToken(req: Request): string | null {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return m ? m[1] : null;
}

async function whoIs(req: Request, env: Env): Promise<Member | null> {
  const token = cookieToken(req);
  if (!token) return null;
  return env.DB.prepare(
    'select id, name, utopia_username, utopia_id, is_admin from members where token_hash = ? and removed_at is null',
  )
    .bind(await sha256(token))
    .first<Member>();
}

async function log(env: Env, memberId: number | null, potId: number | null, action: string, detail?: unknown) {
  await env.DB.prepare('insert into log (at, member_id, pot_id, action, detail) values (?, ?, ?, ?, ?)')
    .bind(nowIso(), memberId, potId, action, detail === undefined ? null : JSON.stringify(detail))
    .run();
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Send JSON.');
  }
}

function text(v: unknown, field: string, max: number, required = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `Add ${field}.`);
  if (s.length > max) throw new HttpError(400, `Keep ${field} under ${max} characters.`);
  return s;
}

function phase(p: PotRow, now = Date.now()): string {
  if (p.status !== 'open') return p.status;
  return now < Date.parse(p.starts_at) ? 'joining' : 'playing';
}

async function getPot(env: Env, id: number): Promise<PotRow> {
  const pot = await env.DB.prepare('select * from pots where id = ?').bind(id).first<PotRow>();
  if (!pot) throw new HttpError(404, 'No such pot.');
  return pot;
}

async function getEntries(env: Env, potId: number): Promise<EntryRow[]> {
  const { results } = await env.DB.prepare('select * from entries where pot_id = ?').bind(potId).all<EntryRow>();
  return results;
}

// ── Checking a pot against Utopia ────────────────────────────────────────

/** Looks for the pot's games in Utopia and decides it if it can. Only for open pots that have started. */
async function checkPot(env: Env, pot: PotRow, u: Utopia, now = new Date()): Promise<void> {
  if (pot.status !== 'open' || now.getTime() < Date.parse(pot.starts_at)) return;
  const { results: paid } = await env.DB.prepare(
    `select e.member_id, m.utopia_id from entries e join members m on m.id = e.member_id
      where e.pot_id = ? and e.state = 'paid'`,
  )
    .bind(pot.id)
    .all<{ member_id: number; utopia_id: string }>();

  if (paid.length < 2) {
    const ended = now.getTime() >= Date.parse(pot.ends_at);
    // Two players are needed. Wait for a late confirmation until the end, then refund.
    if (!ended) {
      await env.DB.prepare('update pots set checked_at = ?, decision = ? where id = ?')
        .bind(now.toISOString(), JSON.stringify({ kind: 'waiting', games: [], note: 'Fewer than two confirmed players.' }), pot.id)
        .run();
      return;
    }
    await cancelPot(env, pot, null, 'Fewer than two confirmed players: the pot was cancelled.');
    return;
  }

  const players = paid.map((p) => ({ memberId: p.member_id, utopiaId: p.utopia_id }));
  const games = await u.games(players.map((p) => p.utopiaId), pot.starts_at, pot.ends_at);
  const outcome = decide(
    { rule: pot.rule, game: pot.game, stake: pot.stake, startsAt: pot.starts_at, endsAt: pot.ends_at },
    players,
    games,
    now,
  );
  await applyOutcome(env, pot, outcome, now, null);
}

async function applyOutcome(env: Env, pot: PotRow, outcome: Outcome, now: Date, by: number | null) {
  const at = now.toISOString();
  if (outcome.kind !== 'decided') {
    await env.DB.prepare('update pots set checked_at = ?, decision = ? where id = ?')
      .bind(at, JSON.stringify(outcome), pot.id)
      .run();
    return;
  }
  const stmts = [
    env.DB.prepare("update pots set status = 'decided', decided_at = ?, checked_at = ?, decision = ? where id = ? and status = 'open'").bind(
      at,
      at,
      JSON.stringify({ ...outcome, by }),
      pot.id,
    ),
    env.DB.prepare('update entries set payout = 0 where pot_id = ?').bind(pot.id),
    ...Object.entries(outcome.payouts).map(([memberId, amount]) =>
      env.DB.prepare("update entries set payout = ? where pot_id = ? and member_id = ? and state = 'paid'").bind(amount, pot.id, Number(memberId)),
    ),
  ];
  await env.DB.batch(stmts);
  await log(env, by, pot.id, 'decided', { winners: outcome.winners, refund: outcome.refund, reason: outcome.reason });
}

async function cancelPot(env: Env, pot: PotRow, by: number | null, reason: string) {
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare("update pots set status = 'cancelled', decided_at = ?, decision = ? where id = ? and status = 'open'").bind(
      at,
      JSON.stringify({ kind: 'cancelled', reason, by }),
      pot.id,
    ),
    // Everyone who paid gets their stake back.
    env.DB.prepare("update entries set payout = case when state = 'paid' then ? else 0 end where pot_id = ?").bind(pot.stake, pot.id),
  ]);
  await log(env, by, pot.id, 'cancelled', { reason });
}

async function settleIfDone(env: Env, potId: number) {
  const left = await env.DB.prepare('select count(*) as n from entries where pot_id = ? and payout > 0 and paid_out_at is null')
    .bind(potId)
    .first<{ n: number }>();
  if (left && left.n === 0) {
    await env.DB.prepare("update pots set status = 'settled' where id = ? and status = 'decided'").bind(potId).run();
  }
}

// ── State for the app ────────────────────────────────────────────────────

async function state(env: Env, me: Member) {
  const { results: settingRows } = await env.DB.prepare('select key, value from settings').all<{ key: string; value: string }>();
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  const { results: members } = await env.DB.prepare(
    'select id, name, utopia_username, is_admin from members where removed_at is null order by id',
  ).all();
  const { results: pots } = await env.DB.prepare(
    `select * from pots order by case status when 'open' then 0 when 'decided' then 1 else 2 end, starts_at desc limit 40`,
  ).all<PotRow>();
  const ids = pots.map((p) => p.id);
  const entries = ids.length
    ? (
        await env.DB.prepare(`select * from entries where pot_id in (${ids.map(() => '?').join(',')})`)
          .bind(...ids)
          .all<EntryRow>()
      ).results
    : [];
  // Totals over every pot that's been decided or settled (cancelled ones only give money back).
  const { results: ledger } = await env.DB.prepare(
    `select e.member_id,
            sum(case when p.status in ('decided', 'settled') and e.state = 'paid' then p.stake else 0 end) as staked,
            sum(case when p.status in ('decided', 'settled') then e.payout else 0 end) as won,
            sum(case when e.payout > 0 and e.paid_out_at is null and p.status in ('decided', 'settled', 'cancelled') then e.payout else 0 end) as owed,
            sum(case when p.status in ('decided', 'settled') and e.state = 'paid' then 1 else 0 end) as played,
            sum(case when p.status in ('decided', 'settled') and e.payout > p.stake then 1 else 0 end) as pots_won
       from entries e join pots p on p.id = e.pot_id
      group by e.member_id`,
  ).all();
  const now = Date.now();
  return {
    me: { id: me.id, name: me.name, is_admin: !!me.is_admin, utopia_username: me.utopia_username },
    settings,
    members,
    ledger,
    pots: pots.map((p) => ({
      ...p,
      decision: p.decision ? JSON.parse(p.decision) : null,
      phase: phase(p, now),
      entries: entries.filter((e) => e.pot_id === p.id),
    })),
  };
}

// ── Routes ───────────────────────────────────────────────────────────────

async function api(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  if (method === 'POST') {
    // Only this site's pages may post (the session cookie is Lax, and this blocks the rest).
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Wrong origin.');
    if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
  }

  let reader: Utopia | null = null;
  const u = () => (reader ??= utopia(env.UTOPIA_DB_URL));
  try {
    if (path === '/api/hello' && method === 'GET') {
      const count = await env.DB.prepare('select count(*) as n from members').first<{ n: number }>();
      const me = await whoIs(req, env);
      return json({ setup: (count?.n ?? 0) === 0, signed_in: !!me });
    }

    if (path === '/api/setup' && method === 'POST') {
      const count = await env.DB.prepare('select count(*) as n from members').first<{ n: number }>();
      if ((count?.n ?? 0) > 0) throw new HttpError(403, 'Already set up.');
      const b = await body<{ key: string; name: string; username: string }>(req);
      if (!env.SETUP_KEY || !sameText(String(b.key ?? ''), env.SETUP_KEY)) throw new HttpError(403, 'That setup key isn’t right.');
      const name = text(b.name, 'your name', 40);
      const [player] = await u().players([String(b.username ?? '')]);
      if (!player) throw new HttpError(400, 'No Utopia player has that username.');
      const token = newToken();
      await env.DB.prepare(
        'insert into members (name, utopia_username, utopia_id, is_admin, token_hash, created_at) values (?, ?, ?, 1, ?, ?)',
      )
        .bind(name, player.username, player.id, await sha256(token), nowIso())
        .run();
      return json({ link: `${url.origin}/in/${token}` }, 200, { 'set-cookie': sessionCookie(token) });
    }

    if (path === '/api/signout' && method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    }

    const me = await whoIs(req, env);
    if (!me) throw new HttpError(401, 'Open your personal link to sign in.');
    const admin = () => {
      if (!me.is_admin) throw new HttpError(403, 'Only the holder can change things.');
    };
    // Friends only look: everything that changes something is the holder's.
    if (method === 'POST') admin();

    if (path === '/api/state' && method === 'GET') return json(await state(env, me));

    if (path === '/api/pots' && method === 'POST') {
      admin();
      const b = await body<{ title: string; game: PotGame; rule: Rule; stake: number; starts_at: string; ends_at: string }>(req);
      const title = text(b.title, 'a title', 60);
      if (!GAMES.includes(b.game)) throw new HttpError(400, 'Choose a game.');
      if (!RULES.includes(b.rule)) throw new HttpError(400, 'Choose how it’s won.');
      const stake = Number(b.stake);
      if (!Number.isInteger(stake) || stake < 1 || stake > 100_000_000) throw new HttpError(400, 'The stake should be a whole amount.');
      const starts = Date.parse(b.starts_at);
      const ends = Date.parse(b.ends_at);
      if (!Number.isFinite(starts) || !Number.isFinite(ends)) throw new HttpError(400, 'Choose when it starts and ends.');
      if (starts < Date.now() - 10 * 60_000) throw new HttpError(400, 'The start should be in the future.');
      if (ends <= starts) throw new HttpError(400, 'It should end after it starts.');
      if (ends - starts > 7 * 86_400_000) throw new HttpError(400, 'A pot can run for 7 days at most.');
      const row = await env.DB.prepare(
        'insert into pots (title, game, rule, stake, starts_at, ends_at, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?) returning id',
      )
        .bind(title, b.game, b.rule, stake, new Date(starts).toISOString(), new Date(ends).toISOString(), me.id, nowIso())
        .first<{ id: number }>();
      await log(env, me.id, row!.id, 'created', { title, stake });
      return json({ id: row!.id });
    }

    const potRoute = path.match(/^\/api\/pots\/(\d+)\/(add|remove|check|decide|cancel|payout)$/);
    if (potRoute && method === 'POST') {
      const pot = await getPot(env, Number(potRoute[1]));
      const action = potRoute[2];
      const started = Date.now() >= Date.parse(pot.starts_at);

      if (action === 'check') {
        if (pot.status !== 'open') return json({ ok: true });
        if (pot.checked_at && Date.now() - Date.parse(pot.checked_at) < 15_000) return json({ ok: true, recent: true });
        await checkPot(env, pot, u());
        return json({ ok: true });
      }

      // The holder puts in each player who has paid them (and can take one out while the pot is open).
      if (action === 'add' || action === 'remove') {
        const b = await body<{ member_id: number }>(req);
        if (pot.status !== 'open') throw new HttpError(400, 'This pot is already decided.');
        const member = await env.DB.prepare('select id, name from members where id = ? and removed_at is null')
          .bind(Number(b.member_id))
          .first<{ id: number; name: string }>();
        if (!member) throw new HttpError(404, 'No such member.');
        if (action === 'add') {
          await env.DB.prepare(
            `insert into entries (pot_id, member_id, state, paid_at, confirmed_by) values (?, ?, 'paid', ?, ?)
             on conflict (pot_id, member_id) do update set state = 'paid', paid_at = excluded.paid_at, confirmed_by = excluded.confirmed_by`,
          )
            .bind(pot.id, member.id, nowIso(), me.id)
            .run();
        } else {
          await env.DB.prepare('delete from entries where pot_id = ? and member_id = ?').bind(pot.id, member.id).run();
        }
        await log(env, me.id, pot.id, action === 'add' ? 'added' : 'removed', { member: member.id });
        return json({ ok: true });
      }
      if (action === 'decide') {
        if (pot.status !== 'open') throw new HttpError(400, 'This pot is already decided.');
        if (!started) throw new HttpError(400, 'This pot hasn’t started.');
        const b = await body<{ winners: number[]; reason: string }>(req);
        const reason = text(b.reason, 'a reason', 200);
        const players = (await getEntries(env, pot.id)).filter((e) => e.state === 'paid').map((e) => e.member_id);
        const winners = [...new Set((b.winners ?? []).map(Number))];
        if (!winners.length || winners.some((w) => !players.includes(w))) throw new HttpError(400, 'Choose winners from the paid players.');
        const outcome: Outcome = {
          kind: 'decided',
          winners,
          refund: winners.length === players.length,
          reason: `Decided by ${me.name}: ${reason}`,
          payouts: split(pot.stake * players.length, winners),
          games: (pot.decision ? JSON.parse(pot.decision).games : null) ?? [],
        };
        await applyOutcome(env, pot, outcome, new Date(), me.id);
        return json({ ok: true });
      }
      if (action === 'cancel') {
        if (pot.status !== 'open') throw new HttpError(400, 'This pot is already decided.');
        const b = await body<{ reason?: string }>(req);
        await cancelPot(env, pot, me.id, text(b.reason, 'a reason', 200, false) || `Cancelled by ${me.name}.`);
        return json({ ok: true });
      }
      if (action === 'payout') {
        const b = await body<{ member_id: number; sent: boolean }>(req);
        if (!['decided', 'settled', 'cancelled'].includes(pot.status)) throw new HttpError(400, 'Nothing to pay out yet.');
        await env.DB.prepare('update entries set paid_out_at = ?, paid_out_by = ? where pot_id = ? and member_id = ? and payout > 0')
          .bind(b.sent ? nowIso() : null, b.sent ? me.id : null, pot.id, b.member_id)
          .run();
        if (!b.sent) await env.DB.prepare("update pots set status = 'decided' where id = ? and status = 'settled'").bind(pot.id).run();
        else await settleIfDone(env, pot.id);
        await log(env, me.id, pot.id, b.sent ? 'paid_out' : 'unpaid_out', { member: b.member_id });
        return json({ ok: true });
      }
    }

    if (path === '/api/members' && method === 'POST') {
      admin();
      const b = await body<{ name: string; username: string }>(req);
      const name = text(b.name, 'a name', 40);
      const [player] = await u().players([String(b.username ?? '')]);
      if (!player) throw new HttpError(400, 'No Utopia player has that username.');
      const taken = await env.DB.prepare('select id from members where utopia_id = ? and removed_at is null').bind(player.id).first();
      if (taken) throw new HttpError(400, 'They’re already in the group.');
      const token = newToken();
      await env.DB.prepare('insert into members (name, utopia_username, utopia_id, token_hash, created_at) values (?, ?, ?, ?, ?)')
        .bind(name, player.username, player.id, await sha256(token), nowIso())
        .run();
      await log(env, me.id, null, 'member_added', { name, username: player.username });
      return json({ link: `${url.origin}/in/${token}` });
    }

    const memberRoute = path.match(/^\/api\/members\/(\d+)\/(link|remove|admin)$/);
    if (memberRoute && method === 'POST') {
      admin();
      const id = Number(memberRoute[1]);
      const target = await env.DB.prepare('select * from members where id = ? and removed_at is null').bind(id).first<Member>();
      if (!target) throw new HttpError(404, 'No such member.');
      if (memberRoute[2] === 'link') {
        const token = newToken();
        await env.DB.prepare('update members set token_hash = ? where id = ?').bind(await sha256(token), id).run();
        await log(env, me.id, null, 'new_link', { member: id });
        return json({ link: `${url.origin}/in/${token}` });
      }
      if (id === me.id) throw new HttpError(400, 'Ask another holder to do that for you.');
      if (memberRoute[2] === 'remove') {
        await env.DB.prepare('update members set removed_at = ?, token_hash = null where id = ?').bind(nowIso(), id).run();
        await log(env, me.id, null, 'member_removed', { member: id });
        return json({ ok: true });
      }
      const b = await body<{ on: boolean }>(req);
      await env.DB.prepare('update members set is_admin = ? where id = ?').bind(b.on ? 1 : 0, id).run();
      await log(env, me.id, null, b.on ? 'admin_on' : 'admin_off', { member: id });
      return json({ ok: true });
    }

    if (path === '/api/settings' && method === 'POST') {
      admin();
      const b = await body<Record<string, string>>(req);
      const values: [string, string][] = [];
      if (b.group_name !== undefined) values.push(['group_name', text(b.group_name, 'a group name', 40)]);
      if (b.currency !== undefined) {
        const c = String(b.currency).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(c)) throw new HttpError(400, 'Use a 3-letter currency code, like NGN or USD.');
        values.push(['currency', c]);
      }
      if (b.timezone !== undefined) {
        const tz = String(b.timezone).trim();
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
        } catch {
          throw new HttpError(400, 'That time zone isn’t right (like Africa/Lagos).');
        }
        values.push(['timezone', tz]);
      }
      if (b.treasurer !== undefined) values.push(['treasurer', text(b.treasurer, 'the payment details', 300, false)]);
      await env.DB.batch(values.map(([k, v]) => env.DB.prepare('insert or replace into settings (key, value) values (?, ?)').bind(k, v)));
      await log(env, me.id, null, 'settings', Object.fromEntries(values));
      return json({ ok: true });
    }

    throw new HttpError(404, 'Not found.');
  } finally {
    if (reader) ctx.waitUntil((reader as Utopia).close().catch(() => undefined));
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const link = url.pathname.match(/^\/in\/([A-Za-z0-9_-]{20,64})$/);
    if (link) {
      const member = await env.DB.prepare('select id from members where token_hash = ? and removed_at is null')
        .bind(await sha256(link[1]))
        .first();
      if (!member) return Response.redirect(`${url.origin}/?link=old`, 302);
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': sessionCookie(link[1]), 'cache-control': 'no-store' } });
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, env, ctx, url);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: 'Something went wrong. Try again in a minute.' }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  /** Every 10 minutes: look for the games of every pot that has started. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { results } = await env.DB.prepare("select * from pots where status = 'open' and starts_at <= ?").bind(nowIso()).all<PotRow>();
    if (!results.length) return;
    const u = utopia(env.UTOPIA_DB_URL);
    try {
      for (const pot of results) {
        try {
          await checkPot(env, pot, u);
        } catch (e) {
          console.error(`pot ${pot.id}`, e);
        }
      }
    } finally {
      ctx.waitUntil(u.close().catch(() => undefined));
    }
  },
};

