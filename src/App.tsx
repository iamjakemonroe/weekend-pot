import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import {
  LuCheck,
  LuCircleAlert,
  LuClock,
  LuCoins,
  LuCopy,
  LuGamepad2,
  LuLoaderCircle,
  LuPlus,
  LuRefreshCw,
  LuShare2,
  LuSparkles,
  LuTrophy,
  LuUsers,
  LuWallet,
} from 'react-icons/lu';
import { api, type Entry, type Game, type Member, type Pot, type Rule, type State } from './api';

// ── Formatting ────────────────────────────────────────────────────────────

const GAME_LABEL: Record<Game, string> = { any: 'Any game', ludo: 'Ludo', eights: 'Crazy Eights', chess: 'Chess', checkers: 'Checkers' };
const RULE_LABEL: Record<Rule, string> = { first: 'First game wins', most: 'Most wins by the end' };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

const buzz = () => navigator.vibrate?.(8);

// ── Toasts and confirmations, instead of the browser's alert and confirm ──

type Toast = { id: number; text: string; tone: 'ok' | 'error' };
let toasts: Toast[] = [];
const toastSubs = new Set<() => void>();
function toast(text: string, tone: Toast['tone'] = 'ok') {
  const id = Date.now() + Math.random();
  toasts = [...toasts.slice(-2), { id, text, tone }];
  toastSubs.forEach((f) => f());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastSubs.forEach((f) => f());
  }, tone === 'error' ? 4500 : 2600);
}
const subscribeToasts = (f: () => void) => (toastSubs.add(f), () => void toastSubs.delete(f));

function Toasts() {
  const list = useSyncExternalStore(subscribeToasts, () => toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`toast-in flex max-w-sm items-center gap-2 rounded-2xl border px-4 py-2.5 text-[14px] font-medium shadow-2xl ${
            t.tone === 'error' ? 'border-danger/30 bg-[#2a1114]/95 text-danger' : 'border-win/25 bg-[#0d2119]/95 text-win'
          }`}
        >
          {t.tone === 'error' ? <LuCircleAlert className="shrink-0" /> : <LuCheck className="shrink-0" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

type Asking = { title: string; detail?: string; yes: string; danger?: boolean; done: (ok: boolean) => void } | null;
let asking: Asking = null;
const askSubs = new Set<() => void>();
const setAsking = (a: Asking) => {
  asking = a;
  askSubs.forEach((f) => f());
};
function ask(title: string, opts: { detail?: string; yes?: string; danger?: boolean } = {}) {
  return new Promise<boolean>((resolve) =>
    setAsking({ title, detail: opts.detail, yes: opts.yes ?? 'Yes', danger: opts.danger, done: (ok) => (setAsking(null), resolve(ok)) }),
  );
}

function AskSheet() {
  const a = useSyncExternalStore((f) => (askSubs.add(f), () => void askSubs.delete(f)), () => asking);
  if (!a) return null;
  return (
    <div className="fade fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => a.done(false)}>
      <div className="card sheet-in w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={a.title}>
        <p className="display text-[18px] font-bold">{a.title}</p>
        {a.detail && <p className="mt-1.5 text-[14px] leading-6 text-muted">{a.detail}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="btn-line" onClick={() => a.done(false)}>
            Not now
          </button>
          <button type="button" className={a.danger ? 'btn border border-danger/40 bg-danger/15 text-danger' : 'btn-gold'} onClick={() => a.done(true)}>
            {a.yes}
          </button>
        </div>
      </div>
    </div>
  );
}

async function share(text: string) {
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    }
  } catch {
    /* closed the share sheet */
  }
}

// ── Small pieces ──────────────────────────────────────────────────────────

/** Money that counts to its new value (from zero the first time it shows). */
function Money({ value, format, className = '' }: { value: number; format: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const at = useRef(shown);
  useEffect(() => {
    const from = at.current;
    if (from === value) return;
    if (reducedMotion()) {
      at.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 750);
      const n = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)));
      at.current = n;
      setShown(n);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`tabular-nums ${className}`}>{format(shown)}</span>;
}

function Badge({ tone, children }: { tone: 'gold' | 'win' | 'warn' | 'muted' | 'danger' | 'cyan'; children: ReactNode }) {
  const tones = {
    gold: 'bg-gold/12 text-gold ring-1 ring-gold/20',
    win: 'bg-win/12 text-win ring-1 ring-win/20',
    warn: 'bg-warn/12 text-warn ring-1 ring-warn/20',
    muted: 'bg-white/[0.06] text-muted ring-1 ring-white/[0.06]',
    danger: 'bg-danger/12 text-danger ring-1 ring-danger/20',
    cyan: 'bg-cyan/10 text-cyan ring-1 ring-cyan/25',
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

const HUES = ['from-[#f2c14e] to-[#e08a2c]', 'from-[#38d6ff] to-[#3b82f6]', 'from-[#2fd497] to-[#0ea371]', 'from-[#c084fc] to-[#7c3aed]', 'from-[#fb7185] to-[#e11d48]'];
function Initial({ name, id = 0 }: { name: string; id?: number }) {
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br ${HUES[id % HUES.length]} text-[14px] font-bold text-black/80 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.6)]`}>
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function Busy({
  onClick,
  children,
  className = 'btn-line',
  disabled,
  done,
}: {
  onClick: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** Said in a toast once it worked. */
  done?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy || disabled}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
          buzz();
          if (done) toast(done);
        } catch (e) {
          toast((e as Error).message, 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <LuLoaderCircle className="spin" /> : null}
      {children}
    </button>
  );
}

function LinkBox({ link, name }: { link: string; name: string }) {
  return (
    <div className="rise mt-3 rounded-2xl border border-gold/25 bg-gold/[0.06] p-4">
      <p className="text-[13px] leading-5 text-muted">
        {name}’s personal link. Send it to them privately: whoever opens it is signed in as {name}.
      </p>
      <p className="mt-2 break-all rounded-xl bg-black/30 px-3 py-2 font-mono text-[12.5px] text-ink">{link}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-gold h-9" onClick={() => void share(`Your Weekend Pot link (keep it to yourself): ${link}`)}>
          <LuShare2 /> Send
        </button>
        <button
          type="button"
          className="btn-line h-9"
          onClick={() => {
            void navigator.clipboard.writeText(link);
            toast('Link copied');
          }}
        >
          <LuCopy /> Copy
        </button>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ['#f2c14e', '#38d6ff', '#2fd497', '#ffffff', '#ffd978'];
function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 70 + Math.random() * 70;
        return {
          '--x': `${Math.cos(a) * dist}px`,
          '--y': `${Math.sin(a) * dist - 30}px`,
          '--r': `${(Math.random() - 0.5) * 540}deg`,
          '--d': `${Math.random() * 120}ms`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        } as CSSProperties;
      }),
    [],
  );
  return (
    <span className="confetti" aria-hidden>
      {bits.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </span>
  );
}

/** Confetti for a win, once per phone. */
function useFirstView(key: string, active: boolean) {
  const [show] = useState(() => {
    if (!active || reducedMotion()) return false;
    try {
      if (localStorage.getItem(key)) return false;
      localStorage.setItem(key, '1');
      return true;
    } catch {
      return false;
    }
  });
  return show;
}

// ── The page around everything ────────────────────────────────────────────

function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <div className="aurora" />
      <div className="grid-lines" />
    </div>
  );
}

function Mark({ size = 40 }: { size?: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center rounded-[30%] bg-gradient-to-br from-[#1b1f2b] to-[#0c0f16] ring-1 ring-white/10" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-[30%] bg-[radial-gradient(circle_at_30%_20%,rgba(242,193,78,0.35),transparent_60%)]" />
      <LuCoins className="relative text-gold" style={{ fontSize: size * 0.5 }} />
    </span>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Backdrop />
      <Toasts />
      <AskSheet />
      <div className="relative z-10 mx-auto min-h-dvh max-w-xl px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
        {children}
        <p className="mt-12 text-center text-[11.5px] leading-5 text-faint">
          A private pot between friends · 18+ · nobody takes a cut
          <br />
          Winners come from Utopia’s game records
        </p>
      </div>
    </>
  );
}

function Skeletons() {
  return (
    <Shell>
      <div className="mb-6 flex items-center gap-3 pt-2">
        <div className="skeleton h-11 w-11 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-20 rounded-full" />
          <div className="skeleton h-6 w-40 rounded-full" />
        </div>
      </div>
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <div key={i} className="card skeleton h-40" />
        ))}
      </div>
    </Shell>
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
      <div className="card card-live rise mt-[8vh] p-6">
        <Mark size={48} />
        <h1 className="display mt-5 text-[28px] font-bold leading-tight">Set up Weekend Pot</h1>
        <p className="mt-2 text-[14px] leading-6 text-muted">You’re the first holder: you confirm deposits and send the winnings. Add your friends next.</p>
        {link ? (
          <>
            <LinkBox link={link} name={name} />
            <p className="mt-3 text-[13px] text-muted">Keep your link somewhere safe: it’s how you sign in on another phone.</p>
            <button type="button" className="btn-gold mt-5 w-full" onClick={done}>
              Continue
            </button>
          </>
        ) : (
          <div className="mt-6 space-y-4">
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
            <Busy className="btn-gold w-full" disabled={!key || !name || !username} onClick={async () => setLink((await api.setup(key, name, username)).link)}>
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
      <div className="card card-live rise mt-[18vh] p-7 text-center">
        <span className="mx-auto block w-fit">
          <Mark size={56} />
        </span>
        <h1 className="display mt-5 text-[24px] font-bold">Weekend Pot is private</h1>
        <p className="mx-auto mt-2 max-w-xs text-[14px] leading-6 text-muted">
          {old ? 'That link has been replaced. Ask the holder for your new one.' : 'Open the personal link the holder sent you to sign in.'}
        </p>
      </div>
    </Shell>
  );
}

// ── A pot ─────────────────────────────────────────────────────────────────

function PotCard({ pot, s, refresh, index }: { pot: Pot; s: State; refresh: () => Promise<void>; index: number }) {
  const f = useFormat(s.settings);
  // Open while there's something to do or see: joining, playing, and the result until it's paid out.
  const [open, setOpen] = useState(pot.phase === 'joining' || pot.phase === 'playing' || pot.phase === 'decided');
  // A folded pot's insides are only built once it's first opened (and kept, to fold away smoothly).
  const [built, setBuilt] = useState(open);
  const [manual, setManual] = useState<number[]>([]);
  const [why, setWhy] = useState('');
  const admin = s.me.is_admin;
  const name = (id: number | null | undefined) => s.members.find((m) => m.id === id)?.name ?? 'Someone';
  const mine = pot.entries.find((e) => e.member_id === s.me.id);
  const paid = pot.entries.filter((e) => e.state === 'paid');
  const total = pot.stake * paid.length;
  const d = pot.decision;
  const won = d?.kind === 'decided' && !d.refund;
  const confetti = useFirstView(`wp.won.${pot.id}`, won && pot.phase === 'decided');
  const live = pot.phase === 'joining' || pot.phase === 'playing';
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    await api.pot(pot.id, action, body);
    await refresh();
  };

  const phaseBadge =
    pot.phase === 'joining' ? (
      <Badge tone="gold">
        <LuClock /> Starts {f.when(pot.starts_at)}
      </Badge>
    ) : pot.phase === 'playing' ? (
      <Badge tone="cyan">
        <span className="live-dot mr-1" /> Playing · until {f.when(pot.ends_at)}
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

  const shareText = () => {
    const lines = [`💰 ${pot.title}: ${f.money(pot.stake)} each, ${GAME_LABEL[pot.game]} (${RULE_LABEL[pot.rule].toLowerCase()})`];
    if (pot.phase === 'joining') lines.push(`Join and pay before ${f.when(pot.starts_at)}: ${location.origin}`);
    if (pot.phase === 'playing') lines.push(`${paid.length} players in, ${f.money(total)} pot. Games count until ${f.when(pot.ends_at)}.`);
    if (d?.kind === 'decided') lines.push(d.refund ? `Result: everyone gets their stake back. ${d.reason ?? ''}` : `🏆 ${(d.winners ?? []).map(name).join(' & ')}: ${f.money(total)}. ${d.reason ?? ''}`);
    return lines.join('\n');
  };

  return (
    <article className={`rise overflow-hidden ${live || pot.phase === 'decided' ? 'card card-live' : 'card'}`} style={{ '--d': `${Math.min(index, 6) * 70}ms` } as CSSProperties}>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-start gap-3.5 p-5 text-left"
        onClick={() => {
          setBuilt(true);
          setOpen((o) => !o);
        }}
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-gold/25 to-gold/5 text-[21px] text-gold ring-1 ring-gold/20">
          {pot.game === 'any' ? <LuCoins /> : <LuGamepad2 />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="display block truncate text-[18px] font-bold">{pot.title}</span>
          <span className="mt-0.5 block text-[13px] text-muted">
            {GAME_LABEL[pot.game]} · {RULE_LABEL[pot.rule]} · {f.money(pot.stake)} each
          </span>
          <span className="mt-2.5 flex flex-wrap gap-1.5">
            {phaseBadge}
            {d?.kind === 'decided' && (
              <Badge tone="gold">
                <LuTrophy /> {d.refund ? 'Stakes back' : (d.winners ?? []).map(name).join(' & ')}
              </Badge>
            )}
          </span>
        </span>
        <span className="text-right">
          <Money value={total} format={f.money} className="display block text-[22px] font-bold leading-tight" />
          <span className="block text-[11.5px] text-faint">{paid.length} paid</span>
        </span>
      </button>

      <div className={`expand ${open ? 'open' : ''}`}>
        <div>
          {built && (
          <div className="border-t border-white/[0.06] px-5 pb-5 pt-4">
            {d && (d.kind === 'decided' || d.kind === 'cancelled') && (
              <div className="relative mb-4 overflow-visible rounded-2xl bg-gradient-to-br from-gold/[0.12] to-transparent p-4 ring-1 ring-gold/15">
                {confetti && <Confetti />}
                {d.kind === 'decided' && !d.refund ? (
                  <p className="display flex items-center gap-2 text-[19px] font-bold">
                    <LuTrophy className="shrink-0 text-gold" />
                    <span className="shine">
                      {(d.winners ?? []).map(name).join(' & ')} {(d.winners ?? []).length > 1 ? 'share' : 'wins'} {f.money(total)}
                    </span>
                  </p>
                ) : (
                  <p className="display text-[17px] font-bold">Everyone gets their stake back</p>
                )}
                {d.reason && <p className="mt-1 text-[13.5px] text-muted">{d.reason}</p>}
              </div>
            )}

            {d?.kind === 'needs_admin' && (
              <div className="mb-4 rounded-2xl border border-warn/30 bg-warn/[0.07] p-4 text-[14px]">
                <p className="font-semibold text-warn">The holder needs to decide this one</p>
                <p className="mt-1 text-muted">{d.reason}</p>
              </div>
            )}

            {/* Where you stand. Friends only look: the holder puts in each player who has paid. */}
            {pot.status === 'open' &&
              (mine?.state === 'paid' ? (
                <p className="rounded-2xl bg-win/[0.08] p-4 text-[14px] leading-6 text-win ring-1 ring-win/15">
                  <b>You’re in.</b> Play {pot.game === 'any' ? 'Ludo, Crazy Eights, Chess or Checkers' : GAME_LABEL[pot.game]} in Utopia with exactly
                  the players below, between {f.when(pot.starts_at)} and {f.when(pot.ends_at)}.
                </p>
              ) : pot.phase === 'joining' && !admin ? (
                <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/[0.05]">
                  <p className="text-[14px] font-semibold">To play, send {f.money(pot.stake)} to the holder</p>
                  {s.settings.treasurer && <p className="mt-2 whitespace-pre-line text-[13.5px] leading-6 text-muted">{s.settings.treasurer}</p>}
                  <p className="mt-1.5 text-[12.5px] text-faint">
                    Reference: <span className="font-mono text-muted">POT-{pot.id} {s.me.name}</span>. The holder puts you in once it arrives.
                  </p>
                </div>
              ) : !admin ? (
                <p className="rounded-2xl bg-white/[0.03] p-4 text-[14px] text-muted ring-1 ring-white/[0.05]">You’re not playing in this one.</p>
              ) : null)}

            {/* Players */}
            <h3 className="label mb-2 mt-5">Players</h3>
            {pot.entries.length === 0 ? (
              <p className="text-[14px] text-muted">{admin ? 'Nobody’s in yet. Put players in below once they’ve paid you.' : 'Nobody’s in yet.'}</p>
            ) : (
              <ul className="space-y-2">
                {pot.entries.map((e) => (
                  <PlayerRow key={e.member_id} e={e} pot={pot} name={name(e.member_id)} admin={admin} money={f.money} act={act} />
                ))}
              </ul>
            )}
            {admin && pot.status === 'open' && (
              <AddPlayers pot={pot} members={s.members} act={act} />
            )}

            {/* Games found */}
            {pot.phase !== 'joining' && pot.status !== 'cancelled' && (
              <>
                <div className="mb-2 mt-5 flex items-center justify-between">
                  <h3 className="label mb-0">Games in Utopia</h3>
                  {admin && pot.status === 'open' && (
                    <Busy className="btn-ghost h-7 px-2 text-[12px]" onClick={() => act('check')}>
                      <LuRefreshCw /> Check now
                    </Busy>
                  )}
                </div>
                {d?.games?.length ? (
                  <ul className="space-y-1.5 text-[14px]">
                    {d.games.map((g) => (
                      <li key={g.matchId} className="fade flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2 ring-1 ring-white/[0.04]">
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
              <details className="mt-5 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.05]" open={d?.kind === 'needs_admin'}>
                <summary className="cursor-pointer text-[14px] font-semibold">Decide by hand</summary>
                <p className="mt-2 text-[13px] text-muted">For a disputed game, or anything the app can’t see. Everyone sees your reason.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {paid.map((e) => (
                    <button
                      key={e.member_id}
                      type="button"
                      className={`btn h-9 border ${manual.includes(e.member_id) ? 'border-gold bg-gold/15 text-gold' : 'border-white/10 text-muted'}`}
                      onClick={() => setManual((m) => (m.includes(e.member_id) ? m.filter((x) => x !== e.member_id) : [...m, e.member_id]))}
                    >
                      {name(e.member_id)}
                    </button>
                  ))}
                </div>
                <input className="field mt-3" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why, e.g. Tobi won the disputed Ludo game, all agreed" />
                <Busy className="btn-gold mt-3" disabled={!manual.length || !why.trim()} onClick={() => act('decide', { winners: manual, reason: why })} done="Decided">
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
                    if (await ask('Cancel this pot?', { detail: 'Everyone who paid gets their stake back.', yes: 'Cancel pot', danger: true })) {
                      await act('cancel', {});
                      toast('Pot cancelled');
                    }
                  }}
                >
                  Cancel pot
                </Busy>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
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
    <li className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-2.5 ring-1 ring-white/[0.04] transition-colors">
      <Initial name={name} id={e.member_id} />
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
      {admin && pot.status === 'open' && (
        <Busy
          className="btn-ghost h-8 px-2 text-[12px] text-danger"
          onClick={async () => {
            if (await ask(`Take ${name} out of this pot?`, { detail: 'If they paid you, send their stake back yourself.', yes: 'Take out', danger: true })) {
              await act('remove', { member_id: e.member_id });
            }
          }}
        >
          Remove
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

/** For the holder: the group members not in the pot yet, to put in once they've paid. */
function AddPlayers({ pot, members, act }: { pot: Pot; members: Member[]; act: (action: string, body?: Record<string, unknown>) => Promise<void> }) {
  const out = members.filter((m) => !pot.entries.some((e) => e.member_id === m.id && e.state === 'paid'));
  if (!out.length) return null;
  return (
    <div className="mt-4 rounded-2xl bg-gold/[0.05] p-4 ring-1 ring-gold/15">
      <p className="text-[13px] font-semibold text-gold">Paid you? Put them in</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {out.map((m) => (
          <Busy key={m.id} className="btn-line h-9 px-3 text-[13px]" onClick={() => act('add', { member_id: m.id })} done={`${m.name} is in`}>
            <LuPlus /> {m.name}
          </Busy>
        ))}
      </div>
      {pot.phase === 'playing' && <p className="mt-2.5 text-[12px] leading-5 text-faint">Games have started: only games between exactly the players in count.</p>}
    </div>
  );
}

// ── New pot ───────────────────────────────────────────────────────────────

function nextAt(dayOffset: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function NewPot({ s, done, close }: { s: State; done: () => Promise<void>; close: () => void }) {
  const [title, setTitle] = useState('Saturday Ludo');
  const [game, setGame] = useState<Game>('ludo');
  const [rule, setRule] = useState<Rule>('first');
  const [stake, setStake] = useState('5000');
  const saturday = (6 - new Date().getDay() + 7) % 7;
  const [starts, setStarts] = useState(localInput(nextAt(saturday, 19)));
  const [ends, setEnds] = useState(localInput(nextAt(saturday + 1, 23)));
  return (
    <div className="card card-live rise p-5">
      <div className="flex items-center justify-between">
        <h2 className="display text-[19px] font-bold">New pot</h2>
        <button type="button" className="btn-ghost h-8 px-2 text-[13px]" onClick={close}>
          Close
        </button>
      </div>
      <div className="mt-4 space-y-4">
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
                aria-pressed={rule === r}
                className={`rounded-2xl border p-3 text-left text-[13px] transition-colors ${rule === r ? 'border-gold/70 bg-gold/10' : 'border-white/10 bg-black/20'}`}
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
          className="btn-gold h-12 w-full text-[15px]"
          disabled={!title.trim() || !Number(stake)}
          done="Pot created"
          onClick={async () => {
            await api.newPot({ title, game, rule, stake: Number(stake), starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString() });
            await done();
          }}
        >
          <LuSparkles /> Create the pot
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
    <div className="card rise overflow-hidden">
      <div className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-white/[0.06] px-5 py-3 min-[440px]:grid-cols-[1fr_auto_auto]">
        <span className="label mb-0">Player</span>
        <span className="label mb-0 hidden text-right min-[440px]:block">Won</span>
        <span className="label mb-0 w-24 text-right">Net</span>
      </div>
      {rows.map(({ m, won, net, owed, played, potsWon }, i) => (
        <div key={m.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-b border-white/[0.04] px-5 py-3 last:border-0 min-[440px]:grid-cols-[1fr_auto_auto]">
          <span className="flex min-w-0 items-center gap-3">
            <span className="w-4 text-center text-[12px] font-bold text-faint">{i + 1}</span>
            <Initial name={m.name} id={m.id} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{m.name}</span>
              <span className="block truncate text-[12px] text-faint">
                won {potsWon} of {played} {played === 1 ? 'pot' : 'pots'}
                {owed > 0 ? ` · owed ${f.money(owed)}` : ''}
              </span>
            </span>
          </span>
          <span className="hidden text-right tabular-nums text-muted min-[440px]:block">{f.money(won)}</span>
          <span className={`display w-24 text-right font-bold tabular-nums ${net > 0 ? 'text-win' : net < 0 ? 'text-danger' : 'text-muted'}`}>
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
      <div className="card rise p-5">
        <h2 className="display flex items-center gap-2 text-[19px] font-bold">
          <LuUsers className="text-gold" /> The group
        </h2>
        <ul className="mt-3 space-y-2">
          {s.members.map((m: Member) => (
            <li key={m.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-2.5 ring-1 ring-white/[0.04]">
              <Initial name={m.name} id={m.id} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate font-semibold">
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
                    const on = !m.is_admin;
                    if (!(await ask(on ? `Make ${m.name} a holder?` : `Stop ${m.name} being a holder?`, { detail: 'Holders confirm deposits and send payouts.', yes: on ? 'Make holder' : 'Stop' }))) return;
                    await api.member(m.id, 'admin', { on });
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
                    if (!(await ask(`Remove ${m.name}?`, { detail: 'Their link stops working. Their history stays.', yes: 'Remove', danger: true }))) return;
                    await api.member(m.id, 'remove');
                    await refresh();
                    toast(`${m.name} removed`);
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

      <div className="card rise p-5" style={{ '--d': '80ms' } as CSSProperties}>
        <h2 className="display flex items-center gap-2 text-[19px] font-bold">
          <LuWallet className="text-gold" /> Settings
        </h2>
        <div className="mt-4 space-y-4">
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
            done="Saved"
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
          if (!(await ask('Sign out on this phone?', { detail: 'You’ll need your personal link to sign back in.', yes: 'Sign out' }))) return;
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

function Tabs({ tabs, tab, setTab }: { tabs: [Tab, string][]; tab: Tab; setTab: (t: Tab) => void }) {
  const i = Math.max(0, tabs.findIndex(([id]) => id === tab));
  return (
    <nav className="relative grid rounded-full border border-white/10 bg-black/40 p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="absolute bottom-1 left-1 top-1 rounded-full bg-gradient-to-b from-[#ffd978] to-[#f2b63e] shadow-[0_6px_20px_-8px_rgba(242,193,78,0.8)]"
        style={{ width: `calc((100% - 8px) / ${tabs.length})`, transform: `translateX(${i * 100}%)`, transition: 'transform 0.38s var(--ease)' }}
      />
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          aria-current={tab === id ? 'page' : undefined}
          className={`relative z-10 h-9 rounded-full px-3.5 text-[13.5px] font-semibold transition-colors ${tab === id ? 'text-[#1a1406]' : 'text-muted hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const [hello, setHello] = useState<{ setup: boolean; signed_in: boolean } | null>(null);
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pots');
  const [creating, setCreating] = useState(false);
  const last = useRef('');

  // Only a change redraws the page: the 30-second refresh usually brings nothing new.
  const refresh = useCallback(async () => {
    try {
      const next = await api.state();
      const key = JSON.stringify(next);
      if (key !== last.current) {
        last.current = key;
        setS(next);
      }
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

  // Fresh numbers every 30 seconds while the page is open, and on coming back to it.
  useEffect(() => {
    if (!hello?.signed_in) return;
    const id = setInterval(() => document.visibilityState === 'visible' && void refresh(), 30_000);
    const back = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', back);
    };
  }, [hello, refresh]);

  if (!hello || (hello.signed_in && !s)) {
    if (error) {
      return (
        <Shell>
          <div className="card rise mt-[18vh] p-6 text-center">
            <p className="text-danger">{error}</p>
            <button type="button" className="btn-line mt-4" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </Shell>
      );
    }
    return <Skeletons />;
  }
  if (hello.setup) return <Setup done={() => location.reload()} />;
  if (!hello.signed_in || !s) return <SignedOut />;

  const tabs: [Tab, string][] = [
    ['pots', 'Pots'],
    ['table', 'Table'],
    ...(s.me.is_admin ? ([['holder', 'Holder']] as [Tab, string][]) : []),
  ];
  return (
    <Shell>
      <header className="sticky top-0 z-20 -mx-4 mb-5 bg-bg/85 px-4 pb-3 pt-2 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <Mark />
          <div className="min-w-0">
            <p className="text-[12px] text-muted">Hi {s.me.name}</p>
            <h1 className="display truncate text-[22px] font-bold leading-tight">{s.settings.group_name}</h1>
          </div>
        </div>
        <div className="mt-3">
          <Tabs tabs={tabs} tab={tab} setTab={setTab} />
        </div>
      </header>
      {error && <p className="fade mb-4 rounded-2xl bg-danger/10 p-3 text-[14px] text-danger ring-1 ring-danger/20">{error}</p>}

      {tab === 'pots' && (
        <div className="space-y-4">
          {s.me.is_admin &&
            (creating ? (
              <NewPot
                s={s}
                close={() => setCreating(false)}
                done={async () => {
                  setCreating(false);
                  await refresh();
                }}
              />
            ) : (
              <button type="button" className="btn-line h-12 w-full border-dashed text-[14.5px]" onClick={() => setCreating(true)}>
                <LuPlus /> New pot
              </button>
            ))}
          {s.pots.length === 0 ? (
            <div className="card rise p-8 text-center">
              <span className="mx-auto block w-fit">
                <Mark size={52} />
              </span>
              <p className="display mt-4 text-[18px] font-bold">No pots yet</p>
              <p className="mt-1 text-[14px] text-muted">{s.me.is_admin ? 'Start one for this weekend.' : 'The holder will start one soon.'}</p>
            </div>
          ) : (
            s.pots.map((p, i) => <PotCard key={p.id} pot={p} s={s} refresh={refresh} index={i} />)
          )}
        </div>
      )}
      {tab === 'table' && <Table s={s} />}
      {tab === 'holder' && s.me.is_admin && <Holder s={s} refresh={refresh} />}
    </Shell>
  );
}
