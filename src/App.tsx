import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import {
  LuArrowRight,
  LuCheck,
  LuCircleAlert,
  LuCircleCheck,
  LuClock,
  LuCoins,
  LuCopy,
  LuGamepad2,
  LuLandmark,
  LuLoaderCircle,
  LuMessageCircle,
  LuPlus,
  LuRefreshCw,
  LuSend,
  LuShare2,
  LuShieldCheck,
  LuSparkles,
  LuTrophy,
  LuUsers,
  LuWallet,
} from 'react-icons/lu';
import { api, type Entry, type Game, type Member, type Payout, type Pot, type Rule, type State } from './api';

// ── Formatting ────────────────────────────────────────────────────────────

const GAME_LABEL: Record<Game, string> = { any: 'Any game', ludo: 'Ludo', eights: 'Crazy Eights', chess: 'Chess', checkers: 'Checkers' };
const RULE_LABEL: Record<Rule, string> = { first: 'First game wins', most: 'Most wins by the end' };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Times are shown in each person's own time zone (the group spans countries). A message posted
// to the group chat names its zone (whenZ), since everyone reading it is somewhere else.
function useFormat(s: State['settings']) {
  return useMemo(() => {
    const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: s.currency || 'NGN', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
    const day = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } as const;
    const when = new Intl.DateTimeFormat('en-GB', day);
    const whenZ = new Intl.DateTimeFormat('en-GB', { ...day, timeZoneName: 'short' });
    const date = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
    return {
      money: (n: number) => money.format(n),
      when: (iso: string) => when.format(new Date(iso)),
      whenZ: (iso: string) => whenZ.format(new Date(iso)),
      date: (iso: string) => date.format(new Date(iso)),
      clock: (iso: string) => clock.format(new Date(iso)),
      /** This phone's zone, like GMT+1. */
      zone: whenZ.formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '',
    };
  }, [s.currency]);
}

/** "Good evening · 21:14" where you are, kept current. No name: a phone may be passed around. */
function Now() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  const h = now.getHours();
  const hello = h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      {hello} · <span className="tabular-nums">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
    </>
  );
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

/** Opens WhatsApp with the message written, to pick the group chat. */
const whatsapp = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** 0123456789 → 012 345 6789, easier to read out; copying gives the plain digits. */
const spaced = (n: string) => (/^\d{10}$/.test(n) ? n.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3') : n.replace(/(.{4})(?=.)/g, '$1 '));

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

function LinkBox({ link, name, mine = false }: { link: string; name: string; mine?: boolean }) {
  return (
    <div className="rise mt-3 rounded-2xl border border-gold/25 bg-gold/[0.06] p-4">
      <p className="text-[13px] leading-5 text-muted">
        {mine
          ? 'Your new personal link. The old one has stopped working; this phone stays signed in. Keep it to yourself.'
          : `${name}’s personal link. Send it to them privately: whoever opens it is signed in as ${name}.`}
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

/** A value you tap to copy, for pasting into a bank app. */
function CopyChip({ text, what, children }: { text: string; what: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={`Copy ${what}`}
      className="group inline-flex h-9 max-w-full items-center gap-2 rounded-xl bg-black/35 px-3 text-[14px] font-semibold tabular-nums ring-1 ring-white/10 transition-[box-shadow,transform] duration-150 hover:ring-gold/40 active:scale-[0.97]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          buzz();
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1600);
          toast(`${what[0].toUpperCase()}${what.slice(1)} copied`);
        } catch {
          toast('Couldn’t copy: hold to select it instead', 'error');
        }
      }}
    >
      <span className="truncate">{children ?? text}</span>
      {copied ? <LuCheck className="shrink-0 text-win" /> : <LuCopy className="shrink-0 text-faint transition-colors group-hover:text-gold" />}
    </button>
  );
}

/** Someone's bank details, with the account number ready to copy. */
function BankCard({ p }: { p: Payout }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <CopyChip text={p.account_number} what="account number">
        <span className="font-mono tracking-wide">{spaced(p.account_number)}</span>
      </CopyChip>
      <span className="min-w-0 text-[13px] leading-5 text-muted">
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          <LuLandmark className="shrink-0 text-faint" /> {p.bank_name}
        </span>
        <span className="block truncate">{p.account_name}</span>
      </span>
    </div>
  );
}

const NG_BANKS = [
  'Access Bank', 'Ecobank', 'Fidelity Bank', 'First Bank', 'FCMB', 'GTBank', 'Jaiz Bank', 'Keystone Bank', 'Kuda', 'Moniepoint',
  'OPay', 'PalmPay', 'Polaris Bank', 'Providus Bank', 'Stanbic IBTC', 'Sterling Bank', 'UBA', 'Union Bank', 'Unity Bank', 'Wema Bank (ALAT)', 'Zenith Bank',
];

/** Bank, account number and the name on the account: where someone's winnings go. */
function PayoutForm({ initial, currency, save, cancel }: { initial: Payout | null; currency: string; save: (p: Payout) => Promise<void>; cancel?: () => void }) {
  const [p, setP] = useState<Payout>(initial ?? { bank_name: '', account_number: '', account_name: '' });
  const ng = currency === 'NGN';
  const digits = p.account_number.replace(/[\s-]/g, '');
  const ready = p.bank_name.trim() && p.account_name.trim() && (ng ? /^\d{10}$/.test(digits) : digits.length >= 6);
  return (
    <div className="space-y-3.5">
      <label className="block">
        <span className="label">Bank</span>
        <input className="field" value={p.bank_name} onChange={(e) => setP({ ...p, bank_name: e.target.value })} list={ng ? 'ng-banks' : undefined} placeholder={ng ? 'GTBank, Opay, Kuda…' : 'Your bank'} autoComplete="off" />
        {ng && (
          <datalist id="ng-banks">
            {NG_BANKS.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        )}
      </label>
      <label className="block">
        <span className="label">Account number</span>
        <input
          className="field font-mono tracking-wide"
          value={p.account_number}
          onChange={(e) => setP({ ...p, account_number: ng ? e.target.value.replace(/\D/g, '').slice(0, 10) : e.target.value })}
          inputMode={ng ? 'numeric' : 'text'}
          placeholder={ng ? '10 digits' : ''}
          autoComplete="off"
        />
        {ng && digits.length > 0 && digits.length < 10 && <span className="mt-1 block text-[12px] text-faint">{10 - digits.length} more digits</span>}
      </label>
      <label className="block">
        <span className="label">Name on the account</span>
        <input className="field" value={p.account_name} onChange={(e) => setP({ ...p, account_name: e.target.value })} placeholder="As your bank shows it" autoComplete="off" />
      </label>
      <div className="flex gap-2 pt-1">
        <Busy className="btn-gold" disabled={!ready} onClick={() => save({ ...p, account_number: digits })} done="Bank details saved">
          <LuShieldCheck /> Save
        </Busy>
        {cancel && (
          <button type="button" className="btn-ghost" onClick={cancel}>
            Cancel
          </button>
        )}
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
        <p className="mt-2 text-[14px] leading-6 text-muted">You’re the organiser: you add your friends, start pots, and choose who holds each pot’s money.</p>
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
          {old ? 'That link has been replaced. Ask the organiser for your new one.' : 'Open the personal link the organiser sent you to sign in.'}
        </p>
      </div>
    </Shell>
  );
}

// ── A pot ─────────────────────────────────────────────────────────────────

/** A pot to scroll to and open (n changes on every ask, so asking twice works). */
type Focus = { id: number; n: number } | null;

function PotCard({ pot, s, refresh, index, focus, go }: { pot: Pot; s: State; refresh: () => Promise<void>; index: number; focus: Focus; go: (t: Tab) => void }) {
  const f = useFormat(s.settings);
  const owing = pot.entries.some((e) => e.payout > 0 && !e.paid_out_at);
  // Paid out in the last day: kept open so the winner sees it was sent.
  const justPaid = pot.entries.some((e) => e.paid_out_at && Date.now() - Date.parse(e.paid_out_at) < 86_400_000);
  // Open while there's something to do or see: joining, playing, and the result until a day after it's paid out.
  const [open, setOpen] = useState(pot.phase === 'joining' || pot.phase === 'playing' || pot.phase === 'decided' || owing || justPaid);
  // A folded pot's insides are only built once it's first opened (and kept, to fold away smoothly).
  const [built, setBuilt] = useState(open);
  const [manual, setManual] = useState<number[]>([]);
  const [why, setWhy] = useState('');
  const ref = useRef<HTMLElement>(null);
  const organiser = s.me.is_admin;
  const holding = pot.holder_id === s.me.id;
  // The holder runs their pot (who's in, and the payouts); an organiser can step in.
  const runs = organiser || holding;
  const member = (id: number | null | undefined) => s.members.find((m) => m.id === id);
  const name = (id: number | null | undefined) => member(id)?.name ?? 'Someone';
  const holder = member(pot.holder_id);
  const holderName = holder?.name ?? 'the holder';
  const mine = pot.entries.find((e) => e.member_id === s.me.id);
  const paid = pot.entries.filter((e) => e.state === 'paid');
  const total = pot.stake * paid.length;
  const d = pot.decision;
  const won = d?.kind === 'decided' && !d.refund;
  const result = d?.kind === 'decided' || d?.kind === 'cancelled';
  const confetti = useFirstView(`wp.won.${pot.id}`, won && pot.phase === 'decided');
  const live = pot.phase === 'joining' || pot.phase === 'playing';
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    await api.pot(pot.id, action, body);
    await refresh();
  };

  useEffect(() => {
    if (focus?.id !== pot.id) return;
    setBuilt(true);
    setOpen(true);
    ref.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [focus, pot.id]);

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
        <LuCheck /> Paid out · {f.date(pot.starts_at)}
      </Badge>
    ) : (
      <Badge tone="danger">Cancelled · {f.date(pot.starts_at)}</Badge>
    );

  const winners = (d?.winners ?? []).map(name).join(' & ');
  const playLine = `Play ${pot.game === 'any' ? 'Ludo, Crazy Eights, Chess or Checkers' : GAME_LABEL[pot.game]} in Utopia with exactly the players below, between ${f.when(pot.starts_at)} and ${f.when(pot.ends_at)}.`;

  /** For the group chat: how to join, how it's going, or the result. */
  const shareText = () => {
    const lines: string[] = [];
    if (d?.kind === 'cancelled') lines.push(`↩️ ${pot.title} was cancelled: everyone gets their ${f.money(pot.stake)} back.`);
    else if (d?.kind === 'decided' && d.refund) lines.push(`↩️ ${pot.title}: no winner. ${d.reason ?? ''}`.trim());
    else if (d?.kind === 'decided') {
      lines.push(`🏆 ${pot.title}: ${winners} ${(d.winners ?? []).length > 1 ? 'share' : 'wins'} ${f.money(total)}`);
      lines.push(`${paid.length} players × ${f.money(pot.stake)}, ${GAME_LABEL[pot.game]}. ${d.reason ?? ''}`.trim());
    } else if (pot.phase === 'joining') {
      const p = holder?.payout;
      lines.push(`💰 ${pot.title}: ${f.money(pot.stake)} each, ${GAME_LABEL[pot.game]} (${RULE_LABEL[pot.rule].toLowerCase()})`);
      lines.push(
        `Pay ${holderName} before ${f.whenZ(pot.starts_at)}${p ? `: ${p.bank_name} ${p.account_number} (${p.account_name})` : ''}. Reference: POT-${pot.id} and your name.`,
      );
    } else {
      lines.push(`🎮 ${pot.title} is on: ${paid.map((e) => name(e.member_id)).join(', ')}. ${f.money(total)} to win.`);
      lines.push(`Games count until ${f.whenZ(pot.ends_at)}.`);
    }
    if (result) lines.push(owing ? `${holderName} is sending the money now.` : '✅ All paid out.');
    lines.push(location.origin);
    return lines.join('\n');
  };

  return (
    <article
      ref={ref}
      className={`rise scroll-mt-36 overflow-hidden ${live || pot.phase === 'decided' ? 'card card-live' : 'card'}`}
      style={{ '--d': `${Math.min(index, 6) * 70}ms` } as CSSProperties}
    >
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
                <LuTrophy /> {d.refund ? 'Stakes back' : winners}
              </Badge>
            )}
            {(live || owing) && (
              <Badge tone="muted">
                <LuWallet /> {holding ? 'Money with you' : `Money with ${holderName}`}
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
            <p className="mb-4 flex items-start gap-2 text-[13px] leading-5 text-muted">
              <LuClock className="mt-[3px] shrink-0 text-faint" />
              <span>
                Games count <span className="font-semibold text-ink">{f.when(pot.starts_at)}</span> to{' '}
                <span className="font-semibold text-ink">{f.when(pot.ends_at)}</span>
                <span className="text-faint"> · your time{f.zone ? ` (${f.zone})` : ''}</span>
              </span>
            </p>
            {result && d && (
              <div className="relative mb-4 overflow-visible rounded-2xl bg-gradient-to-br from-gold/[0.12] to-transparent p-4 ring-1 ring-gold/15">
                {confetti && <Confetti />}
                {won ? (
                  <p className="display flex items-center gap-2 text-[19px] font-bold">
                    <LuTrophy className="shrink-0 text-gold" />
                    <span className="shine">
                      {winners} {(d.winners ?? []).length > 1 ? 'share' : 'wins'} {f.money(total)}
                    </span>
                  </p>
                ) : (
                  <p className="display text-[17px] font-bold">Everyone gets their stake back</p>
                )}
                {d.reason && <p className="mt-1 text-[13.5px] text-muted">{d.reason}</p>}
                {/* Straight to the group chat: WhatsApp opens with the message written. */}
                <div className="mt-3.5 flex flex-wrap gap-2">
                  <a className={`${runs ? 'btn-gold' : 'btn-line'} h-9`} href={whatsapp(shareText())} target="_blank" rel="noopener noreferrer">
                    <LuMessageCircle /> Post the result
                  </a>
                  <button type="button" className="btn-line h-9" onClick={() => void share(shareText())}>
                    <LuShare2 /> Share
                  </button>
                </div>
              </div>
            )}

            {d?.kind === 'needs_admin' && (
              <div className="mb-4 rounded-2xl border border-warn/30 bg-warn/[0.07] p-4 text-[14px]">
                <p className="font-semibold text-warn">The organiser needs to decide this one</p>
                <p className="mt-1 text-muted">{d.reason}</p>
              </div>
            )}

            {/* The payouts: the holder copies each account number, pays, and marks it sent. */}
            {runs && result && <PayOuts pot={pot} s={s} act={act} money={f.money} />}

            {/* Your winnings (or stake) on its way, for a player who isn't running the pot. */}
            {!runs && mine && mine.payout > 0 && (
              mine.paid_out_at ? (
                <p className="fade mb-4 flex items-start gap-2 rounded-2xl bg-win/[0.08] p-4 text-[14px] leading-6 text-win ring-1 ring-win/15">
                  <LuCircleCheck className="mt-1 shrink-0" />
                  <span>
                    {holderName} sent you {f.money(mine.payout)} {ago(mine.paid_out_at)}. Check your bank.
                  </span>
                </p>
              ) : (
                <div className="mb-4 rounded-2xl bg-gold/[0.06] p-4 text-[14px] leading-6 ring-1 ring-gold/15">
                  <p className="font-semibold">
                    {holderName} is sending you {f.money(mine.payout)}
                  </p>
                  {s.me.payout ? (
                    <p className="text-muted">
                      To {s.me.payout.bank_name} {spaced(s.me.payout.account_number)}. It shows here as sent once it’s on its way.
                    </p>
                  ) : (
                    <>
                      <p className="text-muted">Add your bank details so they know where to send it.</p>
                      <button type="button" className="btn-gold mt-3 h-9" onClick={() => go('you')}>
                        <LuLandmark /> Add bank details
                      </button>
                    </>
                  )}
                </div>
              )
            )}

            {/* Where you stand while it's open. Only the holder (or an organiser) puts players in. */}
            {pot.status === 'open' &&
              (holding ? (
                <div className="rounded-2xl bg-gold/[0.06] p-4 text-[14px] leading-6 ring-1 ring-gold/15">
                  <p className="flex items-center gap-2 font-semibold text-gold">
                    <LuWallet className="shrink-0" /> You’re holding this pot’s money
                  </p>
                  <p className="mt-1 text-muted">
                    {pot.phase === 'joining'
                      ? `Friends send ${f.money(pot.stake)} to your account. When it arrives, put them in below${mine?.state === 'paid' ? '.' : ', and put yourself in to play.'}`
                      : 'When the app finds the winner, you’ll pay them from here in a few taps.'}
                  </p>
                  {mine?.state === 'paid' && <p className="mt-2 text-win">You’re in too. {playLine}</p>}
                  {!s.me.payout && (
                    <button type="button" className="btn-line mt-3 h-9" onClick={() => go('you')}>
                      Add your bank details so they can pay you <LuArrowRight />
                    </button>
                  )}
                </div>
              ) : mine?.state === 'paid' ? (
                <p className="rounded-2xl bg-win/[0.08] p-4 text-[14px] leading-6 text-win ring-1 ring-win/15">
                  <b>You’re in.</b> {playLine}
                </p>
              ) : pot.phase === 'joining' ? (
                <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/[0.05]">
                  <p className="text-[14px] font-semibold">
                    To play, send {f.money(pot.stake)} to {holderName}
                  </p>
                  {holder?.payout ? (
                    <div className="mt-3">
                      <BankCard p={holder.payout} />
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[13.5px] text-muted">{holderName} hasn’t added their bank details yet. Ask them in the group.</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-faint">
                    Reference
                    <CopyChip text={`POT-${pot.id}`} what="reference">
                      <span className="font-mono text-[13px]">POT-{pot.id}</span>
                    </CopyChip>
                    and your name
                  </div>
                  <p className="mt-2 text-[12.5px] text-faint">{holderName} puts you in once it arrives.</p>
                </div>
              ) : (
                <p className="rounded-2xl bg-white/[0.03] p-4 text-[14px] text-muted ring-1 ring-white/[0.05]">You’re not playing in this one.</p>
              ))}

            {/* Players */}
            <h3 className="label mb-2 mt-5">Players</h3>
            {pot.entries.length === 0 ? (
              <p className="text-[14px] text-muted">{runs ? 'Nobody’s in yet. Put players in below once they’ve paid.' : 'Nobody’s in yet.'}</p>
            ) : (
              <ul className="space-y-2">
                {pot.entries.map((e) => (
                  <PlayerRow key={e.member_id} e={e} pot={pot} name={name(e.member_id)} runs={runs} money={f.money} act={act} />
                ))}
              </ul>
            )}
            {runs && pot.status === 'open' && <AddPlayers pot={pot} members={s.members} holding={holding} holderName={holderName} act={act} />}

            {/* Games found */}
            {pot.phase !== 'joining' && pot.status !== 'cancelled' && (
              <>
                <div className="mb-2 mt-5 flex items-center justify-between">
                  <h3 className="label mb-0">Games in Utopia</h3>
                  {runs && pot.status === 'open' && (
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

            {/* The organiser deciding by hand */}
            {organiser && pot.status === 'open' && pot.phase === 'playing' && (
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

            {!result && (
              <div className="mt-5 flex flex-wrap gap-2">
                <a className="btn-line h-9" href={whatsapp(shareText())} target="_blank" rel="noopener noreferrer">
                  <LuMessageCircle /> Post to the group
                </a>
                <button type="button" className="btn-line h-9" onClick={() => void share(shareText())}>
                  <LuShare2 /> Share
                </button>
                {organiser && pot.status === 'open' && (
                  <Busy
                    className="btn-ghost h-9 text-danger"
                    onClick={async () => {
                      if (await ask('Cancel this pot?', { detail: `Everyone who paid gets their stake back from ${holderName}.`, yes: 'Cancel pot', danger: true })) {
                        await act('cancel', {});
                        toast('Pot cancelled');
                      }
                    }}
                  >
                    Cancel pot
                  </Busy>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** For whoever runs the pot: each payout with the account to send it to, then Mark sent. */
function PayOuts({ pot, s, act, money }: { pot: Pot; s: State; act: (action: string, body?: Record<string, unknown>) => Promise<void>; money: (n: number) => string }) {
  const payees = pot.entries.filter((e) => e.payout > 0);
  if (!payees.length) return null;
  const holding = pot.holder_id === s.me.id;
  const holderName = s.members.find((m) => m.id === pot.holder_id)?.name ?? 'The holder';
  const left = payees.filter((e) => !e.paid_out_at);
  const refund = pot.status === 'cancelled' || pot.decision?.refund;
  return (
    <section aria-label="Payouts" className="mb-4 rounded-2xl bg-black/25 p-4 ring-1 ring-white/[0.06]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="display flex items-center gap-2 text-[16px] font-bold">
          {left.length ? <LuSend className="text-gold" /> : <LuCircleCheck className="text-win" />}
          {!left.length ? 'All paid out' : holding ? (refund ? 'Send the stakes back' : 'Send the winnings') : `${holderName} is paying out`}
        </h3>
        {left.length > 0 && <span className="text-[12px] font-semibold text-faint">{left.length} to send</span>}
      </div>
      {left.length > 0 && <p className="mt-1 text-[13px] leading-5 text-muted">Copy the account number into your bank app, send the amount, then tap Mark sent.</p>}
      <ul className="mt-3 space-y-2">
        {payees.map((e) => {
          const m = s.members.find((x) => x.id === e.member_id);
          const who = m?.name ?? 'Someone';
          if (e.member_id === pot.holder_id) {
            return (
              <li key={e.member_id} className="flex items-center gap-3 rounded-xl px-1 py-1 text-[13.5px] text-muted">
                <Initial name={who} id={e.member_id} />
                <span className="min-w-0 flex-1">
                  {e.member_id === s.me.id ? `You keep ${money(e.payout)}: it’s already with you.` : `${who} keeps ${money(e.payout)}: it’s already with them.`}
                </span>
                <LuCircleCheck className="shrink-0 text-win" />
              </li>
            );
          }
          if (e.paid_out_at) {
            return (
              <li key={e.member_id} className="fade flex items-center gap-3 rounded-xl px-1 py-1 text-[13.5px]">
                <Initial name={who} id={e.member_id} />
                <span className="min-w-0 flex-1 text-muted">
                  <b className="text-ink">{money(e.payout)}</b> sent to {who} · {ago(e.paid_out_at)}
                </span>
                <Busy className="btn-ghost h-8 px-2 text-[12px]" onClick={() => act('payout', { member_id: e.member_id, sent: false })}>
                  Undo
                </Busy>
              </li>
            );
          }
          return (
            <li key={e.member_id} className="rise rounded-2xl bg-white/[0.035] p-3.5 ring-1 ring-gold/20">
              <div className="flex items-center gap-3">
                <Initial name={who} id={e.member_id} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-faint">Send to</p>
                  <p className="truncate font-semibold">{who}</p>
                </div>
                <CopyChip text={String(e.payout)} what="amount">
                  <span className="display text-[17px] font-bold text-gold">{money(e.payout)}</span>
                </CopyChip>
              </div>
              <div className="mt-3">
                {m?.payout ? (
                  <BankCard p={m.payout} />
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-warn">
                    <LuCircleAlert className="shrink-0" /> {who} hasn’t added bank details yet.
                    <button
                      type="button"
                      className="btn-line h-8 px-3 text-[12.5px]"
                      onClick={() => void share(`${who}, add your bank details in Weekend Pot (the You tab) so I can send your ${money(e.payout)}: ${location.origin}`)}
                    >
                      <LuMessageCircle /> Ask {who}
                    </button>
                  </div>
                )}
              </div>
              <Busy className="btn-gold mt-3 h-10 w-full" onClick={() => act('payout', { member_id: e.member_id, sent: true })} done={`Marked sent to ${who}`}>
                <LuCheck /> Mark sent
              </Busy>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlayerRow({
  e,
  pot,
  name,
  runs,
  money,
  act,
}: {
  e: Entry;
  pot: Pot;
  name: string;
  runs: boolean;
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
        <p className="truncate text-[14.5px] font-semibold">
          {name}
          {e.member_id === pot.holder_id && <span className="ml-1.5 text-[12px] font-medium text-faint">holder</span>}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {state}
          {e.sent_note && e.state !== 'paid' && <span className="truncate text-[12px] text-faint">“{e.sent_note}”</span>}
          {e.payout > 0 && (
            <Badge tone={e.paid_out_at ? 'muted' : 'gold'}>
              {e.payout > pot.stake ? 'Wins' : 'Gets'} {money(e.payout)}
              {e.paid_out_at ? (e.member_id === pot.holder_id ? ' · kept' : ' · sent') : ''}
            </Badge>
          )}
        </div>
      </div>
      {runs && pot.status === 'open' && (
        <Busy
          className="btn-ghost h-8 px-2 text-[12px] text-danger"
          onClick={async () => {
            if (await ask(`Take ${name} out of this pot?`, { detail: 'If they paid in, send their stake back yourself.', yes: 'Take out', danger: true })) {
              await act('remove', { member_id: e.member_id });
            }
          }}
        >
          Remove
        </Busy>
      )}
    </li>
  );
}

/** For whoever runs the pot: the group members not in it yet, to put in once they've paid. */
function AddPlayers({
  pot,
  members,
  holding,
  holderName,
  act,
}: {
  pot: Pot;
  members: Member[];
  holding: boolean;
  holderName: string;
  act: (action: string, body?: Record<string, unknown>) => Promise<void>;
}) {
  const out = members.filter((m) => !pot.entries.some((e) => e.member_id === m.id && e.state === 'paid'));
  if (!out.length) return null;
  return (
    <div className="mt-4 rounded-2xl bg-gold/[0.05] p-4 ring-1 ring-gold/15">
      <p className="text-[13px] font-semibold text-gold">{holding ? 'Paid you? Put them in' : `Paid ${holderName}? Put them in`}</p>
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

/** What's waiting on you: payouts to send for a pot you hold, and your bank details if they're missing. */
function ToDo({ s, go, focus }: { s: State; go: (t: Tab) => void; focus: (id: number) => void }) {
  const f = useFormat(s.settings);
  const sends = s.pots
    .filter((p) => p.holder_id === s.me.id)
    .flatMap((p) => p.entries.filter((e) => e.payout > 0 && !e.paid_out_at && e.member_id !== p.holder_id).map((e) => ({ p, e })));
  if (!sends.length && s.me.payout) return null;
  const name = (id: number) => s.members.find((m) => m.id === id)?.name ?? 'someone';
  const pots = [...new Set(sends.map((x) => x.p.title))];
  return (
    <div className="space-y-2.5">
      {sends.length > 0 && (
        <button type="button" onClick={() => focus(sends[0].p.id)} className="card card-live rise flex w-full items-center gap-3.5 p-4 text-left">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/15 text-[19px] text-gold ring-1 ring-gold/25">
            <LuSend />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-gold">To send</span>
            <span className="block truncate font-semibold">
              {sends.length === 1
                ? `${f.money(sends[0].e.payout)} to ${name(sends[0].e.member_id)}`
                : `${sends.length} payouts, ${f.money(sends.reduce((n, x) => n + x.e.payout, 0))}`}
            </span>
            <span className="block truncate text-[12.5px] text-faint">{pots.join(', ')}</span>
          </span>
          <LuArrowRight className="shrink-0 text-muted" />
        </button>
      )}
      {!s.me.payout && (
        <button type="button" onClick={() => go('you')} className="card rise flex w-full items-center gap-3.5 p-4 text-left" style={{ '--d': '60ms' } as CSSProperties}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan/10 text-[19px] text-cyan ring-1 ring-cyan/25">
            <LuLandmark />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Add your bank details</span>
            <span className="block text-[12.5px] leading-5 text-muted">So whoever holds the pot can pay you the moment you win.</span>
          </span>
          <LuArrowRight className="shrink-0 text-muted" />
        </button>
      )}
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

/** Who holds the next pot: the same person as last time or, taking turns, the next member with bank details. */
function suggestHolder(s: State): number {
  const last = s.pots.reduce<Pot | null>((a, p) => (!a || p.id > a.id ? p : a), null)?.holder_id;
  if (s.settings.rotate !== '1') return s.members.some((m) => m.id === last) ? last! : s.me.id;
  const ready = s.members.filter((m) => m.has_payout);
  const turn = ready.length ? ready : s.members;
  return (turn.find((m) => last !== undefined && m.id > last) ?? turn[0]).id;
}

function NewPot({ s, done, close }: { s: State; done: () => Promise<void>; close: () => void }) {
  const [holderId, setHolderId] = useState(() => suggestHolder(s));
  const holder = s.members.find((m) => m.id === holderId);
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
        <label className="block">
          <span className="label">Who holds the money</span>
          <select className="field" value={holderId} onChange={(e) => setHolderId(Number(e.target.value))}>
            {s.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === s.me.id ? ' (you)' : ''}
                {m.has_payout ? '' : ' · no bank details yet'}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-[12.5px] leading-5 text-faint">
            {holder && !holder.has_payout
              ? `${holder.name} hasn’t saved bank details yet, so friends won’t see where to pay.`
              : `Everyone pays ${holderId === s.me.id ? 'you' : holder?.name}; ${holderId === s.me.id ? 'you pay' : 'they pay'} the winner.${s.settings.rotate === '1' ? ' Taking turns: this is whose turn it is.' : ''}`}
          </span>
        </label>
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
        <p className="text-[12.5px] leading-5 text-faint">
          In your time; everyone sees it in theirs. Joining and paying close when the games start. Only games between exactly the paid players count.
        </p>
        <Busy
          className="btn-gold h-12 w-full text-[15px]"
          disabled={!title.trim() || !Number(stake)}
          done="Pot created"
          onClick={async () => {
            await api.newPot({ title, game, rule, stake: Number(stake), starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(), holder_id: holderId });
            await done();
          }}
        >
          <LuSparkles /> Create the pot
        </Busy>
      </div>
    </div>
  );
}

// ── Table, you, and the group ─────────────────────────────────────────────

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

/** Everyone's own page: where their winnings go, and signing out. */
function You({ s, refresh }: { s: State; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const saved = s.me.payout;
  return (
    <div className="space-y-4">
      <div className={`card rise p-5 ${saved ? '' : 'card-live'}`}>
        <h2 className="display flex items-center gap-2 text-[19px] font-bold">
          <LuLandmark className="text-gold" /> Where your winnings go
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-6 text-muted">Save it once. When you win, the holder sees it with a copy button and pays you in seconds.</p>
        <div className="mt-4">
          {saved && !editing ? (
            <div className="fade">
              <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/[0.06]">
                <BankCard p={saved} />
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn-line h-9" onClick={() => setEditing(true)}>
                  Change
                </button>
                <Busy
                  className="btn-ghost h-9 text-danger"
                  onClick={async () => {
                    if (!(await ask('Remove your bank details?', { detail: 'Holders won’t know where to send your winnings until you add them again.', yes: 'Remove', danger: true }))) return;
                    await api.myPayout({ clear: true });
                    await refresh();
                  }}
                >
                  Remove
                </Busy>
              </div>
            </div>
          ) : (
            <PayoutForm
              initial={saved}
              currency={s.settings.currency}
              cancel={saved ? () => setEditing(false) : undefined}
              save={async (p) => {
                await api.myPayout(p);
                await refresh();
                setEditing(false);
              }}
            />
          )}
        </div>
        <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-5 text-faint">
          <LuShieldCheck className="mt-0.5 shrink-0" />
          Private: the organiser and the holder of a pot you play in see it, to pay you. While you hold a pot, its players see it too, to pay you in.
        </p>
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

/** The organiser's page: the members, their links and bank details, and the group's settings. */
function Group({ s, refresh }: { s: State; refresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [link, setLink] = useState<{ name: string; link: string; mine?: boolean } | null>(null);
  const [bank, setBank] = useState<number | null>(null);
  const [settings, setSettings] = useState({ group_name: s.settings.group_name, currency: s.settings.currency, rotate: s.settings.rotate === '1' });
  return (
    <div className="space-y-4">
      <div className="card rise p-5">
        <h2 className="display flex items-center gap-2 text-[19px] font-bold">
          <LuUsers className="text-gold" /> The group
        </h2>
        <ul className="mt-3 space-y-2">
          {s.members.map((m: Member) => (
            <li key={m.id} className="rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.04]">
              <div className="flex items-center gap-3">
                <Initial name={m.name} id={m.id} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate font-semibold">
                    {m.name} {m.is_admin ? <Badge tone="gold">Organiser</Badge> : null}
                  </span>
                  <span className="block truncate text-[12.5px] text-faint">
                    @{m.utopia_username} ·{' '}
                    {m.payout ? (
                      `${m.payout.bank_name} ··${m.payout.account_number.slice(-4)}`
                    ) : (
                      <span className="text-warn">no bank details</span>
                    )}
                  </span>
                </span>
              </div>
              <div className="-mx-1 mt-2 flex flex-wrap">
                <Busy
                  className="btn-ghost h-8 px-2 text-[12.5px]"
                  onClick={async () => {
                    const mine = m.id === s.me.id;
                    if (mine && !(await ask('Make yourself a new link?', { detail: 'Your old link stops working for anyone who has it. This phone stays signed in.', yes: 'New link' }))) return;
                    const r = await api.member(m.id, 'link');
                    if (r.link) setLink({ name: m.name, link: r.link, mine });
                  }}
                >
                  New link
                </Busy>
                <button
                  type="button"
                  className={`btn-ghost h-8 px-2 text-[12.5px] ${bank === m.id ? 'text-gold' : ''}`}
                  aria-label="Bank details"
                  aria-expanded={bank === m.id}
                  onClick={() => setBank(bank === m.id ? null : m.id)}
                >
                  <LuLandmark /> Bank
                </button>
                {m.id !== s.me.id && (
                  <Busy
                    className="btn-ghost h-8 px-2 text-[12.5px]"
                    onClick={async () => {
                      const on = !m.is_admin;
                      if (
                        !(await ask(on ? `Make ${m.name} an organiser?` : `Stop ${m.name} being an organiser?`, {
                          detail: 'Organisers add and remove members, start and cancel pots, and decide disputed games.',
                          yes: on ? 'Make organiser' : 'Stop',
                        }))
                      )
                        return;
                      await api.member(m.id, 'admin', { on });
                      await refresh();
                    }}
                  >
                    {m.is_admin ? 'Not organiser' : 'Organiser'}
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
              </div>
              {bank === m.id && (
                <div className="rise mt-3 border-t border-white/[0.06] pt-4">
                  <PayoutForm
                    initial={m.payout}
                    currency={s.settings.currency}
                    cancel={() => setBank(null)}
                    save={async (p) => {
                      await api.member(m.id, 'payout', p);
                      await refresh();
                      setBank(null);
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        {link && <LinkBox link={link.link} name={link.name} mine={link.mine} />}
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
          <div className="grid grid-cols-[1fr_6.5rem] gap-3">
            <label className="block">
              <span className="label">Group name</span>
              <input className="field" value={settings.group_name} onChange={(e) => setSettings({ ...settings, group_name: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Currency</span>
              <input className="field" value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} maxLength={3} />
            </label>
          </div>
          <div>
            <p className="label">Who holds the money</p>
            <div className="grid grid-cols-2 gap-2">
              {[false, true].map((rotate) => (
                <button
                  key={String(rotate)}
                  type="button"
                  onClick={() => setSettings({ ...settings, rotate })}
                  aria-pressed={settings.rotate === rotate}
                  className={`rounded-2xl border p-3 text-left text-[13px] transition-colors ${settings.rotate === rotate ? 'border-gold/70 bg-gold/10' : 'border-white/10 bg-black/20'}`}
                >
                  <b className="block text-[14px]">{rotate ? 'Take turns' : 'The same person'}</b>
                  <span className="text-muted">{rotate ? 'Each new pot goes to the next member with bank details.' : 'Each new pot keeps the last pot’s holder.'}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-faint">You can pick anyone when you start a pot.</p>
          </div>
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
    </div>
  );
}

// ── The app ───────────────────────────────────────────────────────────────

type Tab = 'pots' | 'table' | 'you' | 'group';

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
  const [focus, setFocus] = useState<Focus>(null);
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
    ['you', 'You'],
    ...(s.me.is_admin ? ([['group', 'Group']] as [Tab, string][]) : []),
  ];
  return (
    <Shell>
      <header className="sticky top-0 z-20 -mx-4 mb-5 bg-bg/85 px-4 pb-3 pt-2 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <Mark />
          <div className="min-w-0">
            <p className="text-[12px] text-muted">
              <Now />
            </p>
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
          <ToDo s={s} go={setTab} focus={(id) => setFocus({ id, n: Date.now() })} />
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
              <p className="mt-1 text-[14px] text-muted">{s.me.is_admin ? 'Start one for this weekend.' : 'The organiser will start one soon.'}</p>
            </div>
          ) : (
            s.pots.map((p, i) => <PotCard key={p.id} pot={p} s={s} refresh={refresh} index={i} focus={focus} go={setTab} />)
          )}
        </div>
      )}
      {tab === 'table' && <Table s={s} />}
      {tab === 'you' && <You s={s} refresh={refresh} />}
      {tab === 'group' && s.me.is_admin && <Group s={s} refresh={refresh} />}
    </Shell>
  );
}
