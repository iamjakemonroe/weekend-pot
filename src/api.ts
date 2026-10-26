// The Worker's API (worker/index.ts).

export type Game = 'any' | 'ludo' | 'eights' | 'chess' | 'checkers';
export type Rule = 'first' | 'most';
export type Phase = 'joining' | 'playing' | 'decided' | 'settled' | 'cancelled';

export interface SeenGame {
  matchId: string;
  game: Exclude<Game, 'any'>;
  endedAt: string;
  winner: number | null;
  verdict: 'counted' | 'abandoned' | 'disputed';
  result: string | null;
}

export interface Decision {
  kind: 'waiting' | 'needs_admin' | 'decided' | 'cancelled';
  reason?: string;
  note?: string;
  winners?: number[];
  refund?: boolean;
  games?: SeenGame[];
  by?: number | null;
}

export interface Entry {
  member_id: number;
  state: 'joined' | 'sent' | 'paid';
  sent_note: string | null;
  sent_at: string | null;
  paid_at: string | null;
  payout: number;
  paid_out_at: string | null;
}

export interface Pot {
  id: number;
  title: string;
  game: Game;
  rule: Rule;
  stake: number;
  starts_at: string;
  ends_at: string;
  status: 'open' | 'decided' | 'settled' | 'cancelled';
  phase: Phase;
  decision: Decision | null;
  checked_at: string | null;
  decided_at: string | null;
  entries: Entry[];
}

export interface Member {
  id: number;
  name: string;
  utopia_username: string;
  is_admin: number;
}

export interface LedgerRow {
  member_id: number;
  staked: number;
  won: number;
  owed: number;
  played: number;
  pots_won: number;
}

export interface State {
  me: { id: number; name: string; is_admin: boolean; utopia_username: string };
  settings: { group_name: string; currency: string; timezone: string; treasurer: string };
  members: Member[];
  pots: Pot[];
  ledger: LedgerRow[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data as T;
}

export const api = {
  hello: () => call<{ setup: boolean; signed_in: boolean }>('/api/hello'),
  setup: (key: string, name: string, username: string) => call<{ link: string }>('/api/setup', { key, name, username }),
  state: () => call<State>('/api/state'),
  newPot: (p: { title: string; game: Game; rule: Rule; stake: number; starts_at: string; ends_at: string }) => call<{ id: number }>('/api/pots', p),
  pot: (id: number, action: string, body: Record<string, unknown> = {}) => call<{ ok: boolean }>(`/api/pots/${id}/${action}`, body),
  addMember: (name: string, username: string) => call<{ link: string }>('/api/members', { name, username }),
  member: (id: number, action: 'link' | 'remove' | 'admin', body: Record<string, unknown> = {}) =>
    call<{ link?: string; ok?: boolean }>(`/api/members/${id}/${action}`, body),
  settings: (s: Partial<State['settings']>) => call<{ ok: boolean }>('/api/settings', s),
  signOut: () => call<{ ok: boolean }>('/api/signout', {}),
};
