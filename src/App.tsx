import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LuCheck,
  LuClock,
  LuCoins,
  LuCopy,
  LuGamepad2,
  LuPlus,
  LuRefreshCw,
  LuShare2,
  LuTrophy,
  LuUsers,
  LuWallet,
} from 'react-icons/lu';
import { api, type Entry, type Game, type Member, type Pot, type Rule, type State } from './api';

// ── Formatting ────────────────────────────────────────────────────────────

const GAME_LABEL: Record<Game, string> = { any: 'Any game', ludo: 'Ludo', eights: 'Crazy Eights', chess: 'Chess', checkers: 'Checkers' };
const RULE_LABEL: Record<Rule, string> = { first: 'First game wins', most: 'Most wins by the end' };

function useFormat(s: State['settings']) {
  return useMemo(() => {
    const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: s.currency || 'NGN', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
    const when = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: s.timezone || undefined,
    });
    const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: s.timezone || undefined });
    return { money: (n: number) => money.format(n), when: (iso: string) => when.format(new Date(iso)), clock: (iso: string) => clock.format(new Date(iso)) };
  }, [s.currency, s.timezone]);
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

/** A local date-time input value ("2026-10-31T19:00") for a Date. */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function share(text: string) {
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      alert('Copied');
    }
  } catch {
    /* closed the share sheet */
  }
}

// ── Small pieces ──────────────────────────────────────────────────────────

function Badge({ tone, children }: { tone: 'gold' | 'win' | 'warn' | 'muted' | 'danger'; children: ReactNode }) {
  const tones = {
    gold: 'bg-gold/15 text-gold',
    win: 'bg-win/15 text-win',
    warn: 'bg-warn/15 text-warn',
    muted: 'bg-white/[0.07] text-muted',
    danger: 'bg-danger/15 text-danger',
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

function Initial({ name }: { name: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[14px] font-semibold text-ink">
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function Busy({ onClick, children, className = 'btn-line', disabled }: { onClick: () => Promise<unknown>; children: ReactNode; className?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } catch (e) {
          alert((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

function LinkBox({ link, name }: { link: string; name: string }) {
  return (
    <div className="mt-3 rounded-2xl border border-gold/30 bg-gold/[0.06] p-3.5">
      <p className="text-[13px] text-muted">
        {name}’s personal link. Send it to them privately: whoever opens it is signed in as {name}.
      </p>
      <p className="mt-2 break-all font-mono text-[12.5px] text-ink">{link}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-gold h-9" onClick={() => void share(`Your Weekend Pot link (keep it to yourself): ${link}`)}>
          <LuShare2 /> Send
        </button>
        <button type="button" className="btn-line h-9" onClick={() => void navigator.clipboard.writeText(link)}>
          <LuCopy /> Copy
        </button>
      </div>
    </div>
  );
}

// ── Screens before signing in ─────────────────────────────────────────────

function Setup({ done }: { done: () => void }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [link, setLink] = useState<string | null>(null);
  return (
    <Shell>
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Set up Weekend Pot</h1>
        <p className="mt-2 text-[14px] leading-6 text-muted">You’re the first holder: you confirm deposits and send the winnings. Add your friends next.</p>
        {link ? (
          <>
            <LinkBox link={link} name={name} />
            <p className="mt-3 text-[13px] text-muted">Keep your link somewhere safe: it’s how you sign in on another phone.</p>
            <button type="button" className="btn-gold mt-4" onClick={done}>
              Continue
            </button>
          </>
        ) : (
          <div className="mt-5 space-y-3.5">
            <label className="block">
              <span className="label">Setup key (from the secrets)</span>
              <input className="field" value={key} onChange={(e) => setKey(e.target.value)} type="password" autoComplete="off" />
            </label>
            <label className="block">
              <span className="label">Your name</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jake" />
            </label>
            <label className="block">
              <span className="label">Your Utopia username</span>
              <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" placeholder="iamjake" />
            </label>
            <Busy className="btn-gold" disabled={!key || !name || !username} onClick={async () => setLink((await api.setup(key, name, username)).link)}>
              Create the group
            </Busy>
          </div>
        )}
      </div>
    </Shell>
  );
}

function SignedOut() {
  const old = new URLSearchParams(location.search).get('link') === 'old';
  return (
    <Shell>
      <div className="card p-6 text-center">
        <LuWallet className="mx-auto text-[34px] text-gold" />
        <h1 className="mt-4 text-xl font-bold">Weekend Pot is private</h1>
        <p className="mt-2 text-[14px] leading-6 text-muted">
          {old ? 'That link has been replaced. Ask the holder for your new one.' : 'Open the personal link the holder sent you to sign in.'}
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      {children}
      <p className="mt-10 text-center text-[11.5px] leading-5 text-faint">
        A private pot between friends, 18+. Nobody takes a cut.
        <br />
        Winners come from Utopia’s game records.
      </p>
    </div>
  );
}

// ── A pot ─────────────────────────────────────────────────────────────────

function PotCard({ pot, s, refresh }: { pot: Pot; s: State; refresh: () => Promise<void> }) {
  const f = useFormat(s.settings);
  // Open while there's something to do or see: joining, playing, and the result until it's paid out.
  const [open, setOpen] = useState(pot.phase === 'joining' || pot.phase === 'playing' || pot.phase === 'decided');
  const [note, setNote] = useState('');
  const [manual, setManual] = useState<number[]>([]);
  const [why, setWhy] = useState('');
  const admin = s.me.is_admin;
  const name = (id: number | null | undefined) => s.members.find((m) => m.id === id)?.name ?? 'Someone';
  const mine = pot.entries.find((e) => e.member_id === s.me.id);
  const paid = pot.entries.filter((e) => e.state === 'paid');
  const total = pot.stake * paid.length;
  const d = pot.decision;
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    await api.pot(pot.id, action, body);
    await refresh();
  };

  const phaseBadge =
    pot.phase === 'joining' ? (
      <Badge tone="gold">
        <LuClock /> Joining · closes {f.when(pot.starts_at)}
      </Badge>
    ) : pot.phase === 'playing' ? (
      <Badge tone="win">
        <LuGamepad2 /> Playing · until {f.when(pot.ends_at)}
      </Badge>
    ) : pot.phase === 'decided' ? (
      <Badge tone="warn">Decided · paying out</Badge>
    ) : pot.phase === 'settled' ? (
      <Badge tone="muted">
        <LuCheck /> Paid out
      </Badge>
    ) : (
      <Badge tone="danger">Cancelled</Badge>
    );

  const result =
    d && (d.kind === 'decided' || d.kind === 'cancelled') ? (
      <div className="mt-4 rounded-2xl bg-white/[0.04] p-4">
        {d.kind === 'decided' && !d.refund ? (
          <p className="flex items-center gap-2 text-[17px] font-bold">
            <LuTrophy className="text-gold" />
            {(d.winners ?? []).map(name).join(' & ')} {(d.winners ?? []).length > 1 ? 'share' : 'wins'} {f.money(total)}
          </p>
        ) : (
          <p className="text-[16px] font-bold">Everyone gets their stake back</p>
        )}
        {d.reason && <p className="mt-1 text-[13.5px] text-muted">{d.reason}</p>}
      </div>
    ) : null;

  const shareText = () => {
    const lines = [`💰 ${pot.title}: ${f.money(pot.stake)} each, ${GAME_LABEL[pot.game]} (${RULE_LABEL[pot.rule].toLowerCase()})`];
    if (pot.phase === 'joining') lines.push(`Join and pay before ${f.when(pot.starts_at)}: ${location.origin}`);
    if (pot.phase === 'playing') lines.push(`${paid.length} players in, ${f.money(total)} pot. Games count until ${f.when(pot.ends_at)}.`);
    if (d?.kind === 'decided') lines.push(d.refund ? `Result: everyone gets their stake back. ${d.reason ?? ''}` : `🏆 ${(d.winners ?? []).map(name).join(' & ')}: ${f.money(total)}. ${d.reason ?? ''}`);
    return lines.join('\n');
  };

  return (
    <article className="card overflow-hidden">
      <button type="button" className="flex w-full items-start gap-3 p-5 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/15 text-[20px] text-gold">
          <LuCoins />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-bold">{pot.title}</span>
          <span className="mt-0.5 block text-[13px] text-muted">
            {GAME_LABEL[pot.game]} · {RULE_LABEL[pot.rule]} · {f.money(pot.stake)} each
          </span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            {phaseBadge}
            {d?.kind === 'decided' && (
              <Badge tone="gold">
                <LuTrophy /> {d.refund ? 'Stakes back' : (d.winners ?? []).map(name).join(' & ')}
              </Badge>
            )}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[18px] font-bold tabular-nums">{f.money(total)}</span>
          <span className="block text-[11.5px] text-faint">{paid.length} paid</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-5 pb-5 pt-4">
          {result}

          {d?.kind === 'needs_admin' && (
            <div className="mb-4 rounded-2xl border border-warn/30 bg-warn/[0.07] p-4 text-[14px]">
              <p className="font-semibold text-warn">The holder needs to decide this one</p>
              <p className="mt-1 text-muted">{d.reason}</p>
            </div>
          )}

          {/* Your part */}
          {pot.phase === 'joining' && !mine && (
            <Busy className="btn-gold w-full" onClick={() => act('join')}>
              Join for {f.money(pot.stake)}
            </Busy>
          )}
          {pot.phase === 'joining' && mine && mine.state !== 'paid' && (
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-[14px] font-semibold">
                {mine.state === 'sent' ? 'Waiting for the holder to confirm your payment' : `Send ${f.money(pot.stake)} to the holder`}
              </p>
              {s.settings.treasurer && <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-6 text-muted">{s.settings.treasurer}</p>}
              <p className="mt-1.5 text-[13px] text-faint">
                Reference: POT-{pot.id} {s.me.name}
              </p>
              {mine.state === 'joined' && (
                <div className="mt-3 flex gap-2">
                  <input className="field h-10" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. sent from OPay" />
                  <Busy className="btn-gold shrink-0" onClick={() => act('sent', { note })}>
                    I’ve sent it
                  </Busy>
                </div>
              )}
              <Busy className="btn-ghost -ml-3 mt-1 h-8 text-[13px]" onClick={() => act('leave')}>
                Leave this pot
              </Busy>
            </div>
          )}
          {pot.status === 'open' && mine?.state === 'paid' && (
            <p className="rounded-2xl bg-win/10 p-4 text-[14px] text-win">
              <b>You’re in.</b> Play {pot.game === 'any' ? 'Ludo, Crazy Eights, Chess or Checkers' : GAME_LABEL[pot.game]} in Utopia with exactly the
              paid players below, between {f.when(pot.starts_at)} and {f.when(pot.ends_at)}.
            </p>
          )}

          {/* Players */}
          <h3 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-faint">Players</h3>
          {pot.entries.length === 0 ? (
            <p className="text-[14px] text-muted">Nobody has joined yet.</p>
          ) : (
            <ul className="space-y-2">
              {pot.entries.map((e) => (
                <PlayerRow key={e.member_id} e={e} pot={pot} name={name(e.member_id)} admin={admin} money={f.money} act={act} />
              ))}
            </ul>
          )}

          {/* Games found */}
          {pot.phase !== 'joining' && pot.status !== 'cancelled' && (
            <>
              <h3 className="mb-2 mt-5 flex items-center justify-between text-[12px] font-semibold uppercase tracking-wide text-faint">
                Games in Utopia
                {pot.status === 'open' && (
                  <Busy className="btn-ghost h-7 px-2 text-[12px] normal-case tracking-normal" onClick={() => act('check')}>
                    <LuRefreshCw /> Check now
                  </Busy>
                )}
              </h3>
              {d?.games?.length ? (
                <ul className="space-y-1.5 text-[14px]">
                  {d.games.map((g) => (
                    <li key={g.matchId} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                      <span>
                        {GAME_LABEL[g.game]} · {f.clock(g.endedAt)}
                      </span>
                      <span className={g.verdict === 'counted' ? 'font-semibold' : 'text-faint'}>
                        {g.verdict === 'abandoned' ? 'Abandoned, doesn’t count' : g.verdict === 'disputed' ? 'Disputed' : g.winner ? `${name(g.winner)} won` : 'Draw'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] text-muted">
                  {d?.note ?? 'No game between exactly the paid players yet.'} {pot.checked_at ? `Checked ${ago(pot.checked_at)}.` : ''}
                </p>
              )}
            </>
          )}

          {/* The holder deciding by hand */}
          {admin && pot.status === 'open' && pot.phase === 'playing' && (
            <details className="mt-5 rounded-2xl bg-white/[0.03] p-4" open={d?.kind === 'needs_admin'}>
              <summary className="cursor-pointer text-[14px] font-semibold">Decide by hand</summary>
              <p className="mt-2 text-[13px] text-muted">For a disputed game, or anything the app can’t see. Everyone sees your reason.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {paid.map((e) => (
                  <button
                    key={e.member_id}
                    type="button"
                    className={`btn h-9 border ${manual.includes(e.member_id) ? 'border-gold bg-gold/15 text-gold' : 'border-line text-muted'}`}
                    onClick={() => setManual((m) => (m.includes(e.member_id) ? m.filter((x) => x !== e.member_id) : [...m, e.member_id]))}
                  >
                    {name(e.member_id)}
                  </button>
                ))}
              </div>
              <input className="field mt-3" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why, e.g. Tobi won the disputed Ludo game, all agreed" />
              <Busy className="btn-gold mt-3" disabled={!manual.length || !why.trim()} onClick={() => act('decide', { winners: manual, reason: why })}>
                {manual.length === paid.length ? 'Refund everyone' : 'Pay the winner'}
                {manual.length > 1 && manual.length < paid.length ? 's' : ''}
              </Busy>
            </details>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="btn-line h-9" onClick={() => void share(shareText())}>
              <LuShare2 /> Share
            </button>
            {admin && pot.status === 'open' && (
              <Busy
                className="btn-ghost h-9 text-danger"
                onClick={async () => {
                  if (confirm('Cancel this pot? Everyone who paid gets their stake back.')) await act('cancel', {});
                }}
              >
                Cancel pot
              </Busy>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function PlayerRow({
  e,
  pot,
  name,
  admin,
  money,
  act,
}: {
  e: Entry;
  pot: Pot;
  name: string;
  admin: boolean;
  money: (n: number) => string;
  act: (action: string, body?: Record<string, unknown>) => Promise<void>;
}) {
  const out = pot.status !== 'open' || pot.phase === 'playing';
  const state =
    e.state === 'paid' ? (
      <Badge tone="win">
        <LuCheck /> Paid
      </Badge>
    ) : out ? (
      <Badge tone="muted">Not in (unpaid)</Badge>
    ) : e.state === 'sent' ? (
      <Badge tone="warn">Says sent</Badge>
    ) : (
      <Badge tone="muted">Joined</Badge>
    );
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-2.5">
      <Initial name={name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-semibold">{name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {state}
          {e.sent_note && e.state !== 'paid' && <span className="truncate text-[12px] text-faint">“{e.sent_note}”</span>}
          {e.payout > 0 && (
            <Badge tone={e.paid_out_at ? 'muted' : 'gold'}>
              {e.payout > pot.stake ? 'Wins' : 'Gets'} {money(e.payout)}
              {e.paid_out_at ? ' · sent' : ''}
            </Badge>
          )}
        </div>
      </div>
      {admin && pot.status === 'open' && e.state !== 'paid' && (
        <Busy className="btn-gold h-8 px-3 text-[12.5px]" onClick={() => act('confirm', { member_id: e.member_id, paid: true })}>
          Confirm paid
        </Busy>
      )}
      {admin && pot.status === 'open' && e.state === 'paid' && (
        <Busy className="btn-ghost h-8 px-2 text-[12px]" onClick={() => act('confirm', { member_id: e.member_id, paid: false })}>
          Undo
        </Busy>
      )}
      {admin && pot.status !== 'open' && e.payout > 0 && (
        <Busy
          className={e.paid_out_at ? 'btn-ghost h-8 px-2 text-[12px]' : 'btn-gold h-8 px-3 text-[12.5px]'}
          onClick={() => act('payout', { member_id: e.member_id, sent: !e.paid_out_at })}
        >
          {e.paid_out_at ? 'Undo' : 'Mark sent'}
        </Busy>
      )}
    </li>
  );
}

// ── New pot ───────────────────────────────────────────────────────────────

function nextAt(dayOffset: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function NewPot({ s, done }: { s: State; done: () => Promise<void> }) {
  const [title, setTitle] = useState('Saturday Ludo');
  const [game, setGame] = useState<Game>('ludo');
  const [rule, setRule] = useState<Rule>('first');
  const [stake, setStake] = useState('5000');
  const saturday = (6 - new Date().getDay() + 7) % 7;
  const [starts, setStarts] = useState(localInput(nextAt(saturday, 19)));
  const [ends, setEnds] = useState(localInput(nextAt(saturday + 1, 23)));
  return (
    <div className="card p-5">
      <h2 className="text-lg font-bold">New pot</h2>
      <div className="mt-4 space-y-3.5">
        <label className="block">
          <span className="label">Title</span>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Game</span>
            <select className="field" value={game} onChange={(e) => setGame(e.target.value as Game)}>
              {(Object.keys(GAME_LABEL) as Game[]).map((g) => (
                <option key={g} value={g}>
                  {GAME_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Stake each ({s.settings.currency})</span>
            <input className="field" value={stake} onChange={(e) => setStake(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
          </label>
        </div>
        <div>
          <p className="label">How it’s won</p>
          <div className="grid grid-cols-2 gap-2">
            {(['first', 'most'] as Rule[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRule(r)}
                className={`rounded-2xl border p-3 text-left text-[13px] ${rule === r ? 'border-gold bg-gold/10' : 'border-line'}`}
              >
                <b className="block text-[14px]">{RULE_LABEL[r]}</b>
                <span className="text-muted">
                  {r === 'first' ? 'The first game between all the players decides it.' : 'Play all weekend: the most wins takes the pot (ties share).'}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Games count from</span>
            <input className="field text-[14px]" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Until</span>
            <input className="field text-[14px]" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </label>
        </div>
        <p className="text-[12.5px] leading-5 text-faint">Joining and paying close when the games start. Only games between exactly the paid players count.</p>
        <Busy
          className="btn-gold w-full"
          disabled={!title.trim() || !Number(stake)}
          onClick={async () => {
            await api.newPot({ title, game, rule, stake: Number(stake), starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString() });
            await done();
          }}
        >
          Create the pot
        </Busy>
      </div>
    </div>
  );
}

// ── Table and holder tools ────────────────────────────────────────────────

function Table({ s }: { s: State }) {
  const f = useFormat(s.settings);
  const rows = s.members
    .map((m) => {
      const l = s.ledger.find((x) => x.member_id === m.id);
      const staked = l?.staked ?? 0;
      const won = l?.won ?? 0;
      return { m, staked, won, net: won - staked, owed: l?.owed ?? 0, played: l?.played ?? 0, potsWon: l?.pots_won ?? 0 };
    })
    .sort((a, b) => b.net - a.net);
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-line px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
        <span>Player</span>
        <span className="text-right">Won</span>
        <span className="w-24 text-right">Net</span>
      </div>
      {rows.map(({ m, won, net, owed, played, potsWon }) => (
        <div key={m.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-line/60 px-5 py-3 last:border-0">
          <span className="flex min-w-0 items-center gap-3">
            <Initial name={m.name} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{m.name}</span>
              <span className="block text-[12px] text-faint">
                won {potsWon} of {played} {played === 1 ? 'pot' : 'pots'}{owed > 0 ? ` · owed ${f.money(owed)}` : ''}
              </span>
            </span>
          </span>
          <span className="text-right tabular-nums text-muted">{f.money(won)}</span>
          <span className={`w-24 text-right font-bold tabular-nums ${net > 0 ? 'text-win' : net < 0 ? 'text-danger' : 'text-muted'}`}>
            {net > 0 ? '+' : ''}
            {f.money(net)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Holder({ s, refresh }: { s: State; refresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [link, setLink] = useState<{ name: string; link: string } | null>(null);
  const [settings, setSettings] = useState(s.settings);
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <LuUsers className="text-gold" /> The group
        </h2>
        <ul className="mt-3 space-y-2">
          {s.members.map((m: Member) => (
            <li key={m.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-2.5">
              <Initial name={m.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {m.name} {m.is_admin ? <Badge tone="gold">Holder</Badge> : null}
                </span>
                <span className="block text-[12.5px] text-faint">@{m.utopia_username} in Utopia</span>
              </span>
              <Busy
                className="btn-ghost h-8 px-2 text-[12.5px]"
                onClick={async () => {
                  const r = await api.member(m.id, 'link');
                  if (r.link) setLink({ name: m.name, link: r.link });
                }}
              >
                New link
              </Busy>
              {m.id !== s.me.id && (
                <Busy
                  className="btn-ghost h-8 px-2 text-[12.5px]"
                  onClick={async () => {
                    if (!confirm(`${m.is_admin ? 'Stop' : 'Make'} ${m.name} ${m.is_admin ? 'being a holder' : 'a holder'}? Holders confirm deposits and payouts.`)) return;
                    await api.member(m.id, 'admin', { on: !m.is_admin });
                    await refresh();
                  }}
                >
                  {m.is_admin ? 'Not holder' : 'Holder'}
                </Busy>
              )}
              {m.id !== s.me.id && (
                <Busy
                  className="btn-ghost h-8 px-2 text-[12.5px] text-danger"
                  onClick={async () => {
                    if (!confirm(`Remove ${m.name}? Their link stops working.`)) return;
                    await api.member(m.id, 'remove');
                    await refresh();
                  }}
                >
                  Remove
                </Busy>
              )}
            </li>
          ))}
        </ul>
        {link && <LinkBox link={link.link} name={link.name} />}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tobi" />
          </label>
          <label className="block">
            <span className="label">Utopia username</span>
            <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" placeholder="tobi_plays" />
          </label>
        </div>
        <Busy
          className="btn-gold mt-3"
          disabled={!name.trim() || !username.trim()}
          onClick={async () => {
            const r = await api.addMember(name, username);
            setLink({ name, link: r.link });
            setName('');
            setUsername('');
            await refresh();
          }}
        >
          <LuPlus /> Add to the group
        </Busy>
      </div>

      <div className="card p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <LuWallet className="text-gold" /> Settings
        </h2>
        <div className="mt-4 space-y-3.5">
          <label className="block">
            <span className="label">Group name</span>
            <input className="field" value={settings.group_name} onChange={(e) => setSettings({ ...settings, group_name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Currency</span>
              <input className="field" value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} maxLength={3} />
            </label>
            <label className="block">
              <span className="label">Time zone</span>
              <input className="field" value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="label">How to pay the holder (shown to everyone who joins)</span>
            <textarea
              className="field h-24 py-2.5"
              value={settings.treasurer}
              onChange={(e) => setSettings({ ...settings, treasurer: e.target.value })}
              placeholder={'Bank: …\nAccount number: …\nName: …'}
            />
          </label>
          <Busy
            className="btn-gold"
            onClick={async () => {
              await api.settings(settings);
              await refresh();
            }}
          >
            Save
          </Busy>
        </div>
      </div>

      <Busy
        className="btn-ghost"
        onClick={async () => {
          await api.signOut();
          location.reload();
        }}
      >
        Sign out on this phone
      </Busy>
    </div>
  );
}

// ── The app ───────────────────────────────────────────────────────────────

type Tab = 'pots' | 'table' | 'holder';

export function App() {
  const [hello, setHello] = useState<{ setup: boolean; signed_in: boolean } | null>(null);
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pots');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setS(await api.state());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api
      .hello()
      .then((h) => {
        setHello(h);
        if (h.signed_in) void refresh();
      })
      .catch((e) => setError((e as Error).message));
  }, [refresh]);

  // Fresh numbers every 30 seconds while the page is open.
  useEffect(() => {
    if (!hello?.signed_in) return;
    const id = setInterval(() => document.visibilityState === 'visible' && void refresh(), 30_000);
    return () => clearInterval(id);
  }, [hello, refresh]);

  if (!hello) return <Shell>{error ? <p className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>}</Shell>;
  if (hello.setup) return <Setup done={() => location.reload()} />;
  if (!hello.signed_in) return <SignedOut />;
  if (!s) return <Shell>{error ? <p className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>}</Shell>;

  const tabs: [Tab, string][] = [
    ['pots', 'Pots'],
    ['table', 'Table'],
    ...(s.me.is_admin ? ([['holder', 'Holder']] as [Tab, string][]) : []),
  ];
  return (
    <Shell>
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] text-muted">Hi {s.me.name}</p>
          <h1 className="text-[26px] font-bold leading-tight">{s.settings.group_name}</h1>
        </div>
        <nav className="flex rounded-full border border-line bg-raised p-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`h-8 rounded-full px-3.5 text-[13px] font-semibold ${tab === id ? 'bg-gold text-[#1a1406]' : 'text-muted'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      {error && <p className="mb-4 rounded-2xl bg-danger/10 p-3 text-[14px] text-danger">{error}</p>}

      {tab === 'pots' && (
        <div className="space-y-4">
          {s.me.is_admin &&
            (creating ? (
              <NewPot
                s={s}
                done={async () => {
                  setCreating(false);
                  await refresh();
                }}
              />
            ) : (
              <button type="button" className="btn-line w-full" onClick={() => setCreating(true)}>
                <LuPlus /> New pot
              </button>
            ))}
          {s.pots.length === 0 ? (
            <div className="card p-6 text-center text-muted">No pots yet.{s.me.is_admin ? ' Start one for this weekend.' : ''}</div>
          ) : (
            s.pots.map((p) => <PotCard key={p.id} pot={p} s={s} refresh={refresh} />)
          )}
        </div>
      )}
      {tab === 'table' && <Table s={s} />}
      {tab === 'holder' && s.me.is_admin && <Holder s={s} refresh={refresh} />}
    </Shell>
  );
}
