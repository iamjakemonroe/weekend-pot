// Deciding a pot from the games Utopia recorded. Pure: no database, no clock (now is passed in).

export type GameKind = 'ludo' | 'eights' | 'chess' | 'checkers';
export type PotGame = 'any' | GameKind;
/** first: the first finished game between all the players decides it. most: the most wins by the end. */
export type Rule = 'first' | 'most';

/** A game as weekend_pot.games returns it. */
export interface UtopiaGame {
  game: GameKind;
  match_id: string;
  ended_at: string;
  players: string[];
  winner: string | null;
  /** completed, aborted or disputed (Utopia's match_status). */
  status: string;
  result: string | null;
}

export interface Player {
  memberId: number;
  utopiaId: string;
}

export interface PotSpec {
  rule: Rule;
  game: PotGame;
  stake: number;
  startsAt: string;
  endsAt: string;
}

/** A game the pot looked at, for showing everyone. */
export interface SeenGame {
  matchId: string;
  game: GameKind;
  endedAt: string;
  /** The winning member, or null for a draw. */
  winner: number | null;
  /** counted, abandoned (aborted in Utopia: doesn't count) or disputed */
  verdict: 'counted' | 'abandoned' | 'disputed';
  result: string | null;
}

export type Outcome =
  | { kind: 'waiting'; games: SeenGame[] }
  | { kind: 'needs_admin'; reason: string; games: SeenGame[] }
  | {
      kind: 'decided';
      /** Members who share the pot. Everyone, for a refund. */
      winners: number[];
      refund: boolean;
      reason: string;
      payouts: Record<number, number>;
      games: SeenGame[];
    };

const LABEL: Record<GameKind, string> = { ludo: 'Ludo', eights: 'Crazy Eights', chess: 'Chess', checkers: 'Checkers' };
export const gameLabel = (g: GameKind) => LABEL[g];

/** The pot split between [winners]: equal shares, any remainder one unit each to the first winners. */
export function split(total: number, winners: number[]): Record<number, number> {
  const sorted = [...winners].sort((a, b) => a - b);
  const share = Math.floor(total / sorted.length);
  let left = total - share * sorted.length;
  const out: Record<number, number> = {};
  for (const w of sorted) {
    out[w] = share + (left > 0 ? 1 : 0);
    if (left > 0) left -= 1;
  }
  return out;
}

/** Games between exactly these players, of the pot's kind, inside its window, oldest first. */
export function relevantGames(spec: PotSpec, players: Player[], games: UtopiaGame[]): UtopiaGame[] {
  const ids = new Set(players.map((p) => p.utopiaId));
  const start = Date.parse(spec.startsAt);
  const end = Date.parse(spec.endsAt);
  return games
    .filter((g) => spec.game === 'any' || g.game === spec.game)
    .filter((g) => {
      const t = Date.parse(g.ended_at);
      return t >= start && t < end;
    })
    .filter((g) => {
      const seated = new Set(g.players);
      return seated.size === ids.size && g.players.every((p) => ids.has(p));
    })
    .sort((a, b) => Date.parse(a.ended_at) - Date.parse(b.ended_at));
}

export function decide(spec: PotSpec, players: Player[], games: UtopiaGame[], now: Date): Outcome {
  const member = new Map(players.map((p) => [p.utopiaId, p.memberId]));
  const everyone = players.map((p) => p.memberId);
  const total = spec.stake * players.length;
  const ended = now.getTime() >= Date.parse(spec.endsAt);
  const seen: SeenGame[] = [];

  const view = (g: UtopiaGame): SeenGame => ({
    matchId: g.match_id,
    game: g.game,
    endedAt: new Date(g.ended_at).toISOString(),
    winner: g.winner ? (member.get(g.winner) ?? null) : null,
    verdict: g.status === 'aborted' ? 'abandoned' : g.status === 'disputed' ? 'disputed' : 'counted',
    result: g.result,
  });
  const refund = (reason: string): Outcome => ({
    kind: 'decided',
    winners: everyone,
    refund: true,
    reason,
    payouts: Object.fromEntries(everyone.map((m) => [m, spec.stake])),
    games: seen,
  });
  const win = (winners: number[], reason: string): Outcome => ({
    kind: 'decided',
    winners,
    refund: false,
    reason,
    payouts: split(total, winners),
    games: seen,
  });

  const ours = relevantGames(spec, players, games).filter((g) => ['completed', 'aborted', 'disputed'].includes(g.status));

  if (spec.rule === 'first') {
    for (const g of ours) {
      const v = view(g);
      seen.push(v);
      if (v.verdict === 'abandoned') continue;
      if (v.verdict === 'disputed') {
        return { kind: 'needs_admin', reason: `A ${LABEL[g.game]} game was disputed in Utopia. Decide the winner by hand.`, games: seen };
      }
      if (v.winner !== null) return win([v.winner], `Won the first ${LABEL[g.game]} game.`);
      if (g.winner) {
        return { kind: 'needs_admin', reason: 'Utopia named a winner who isn’t in this pot. Decide it by hand.', games: seen };
      }
      return refund(`The first ${LABEL[g.game]} game was a draw: everyone gets their stake back.`);
    }
    if (ended) return refund('No game between all the players in time: everyone gets their stake back.');
    return { kind: 'waiting', games: seen };
  }

  // most wins
  for (const g of ours) seen.push(view(g));
  if (!ended) return { kind: 'waiting', games: seen };
  if (seen.some((g) => g.verdict === 'disputed')) {
    return { kind: 'needs_admin', reason: 'A game was disputed in Utopia. Decide the winner by hand.', games: seen };
  }
  const wins = new Map<number, number>();
  for (const g of seen) {
    if (g.verdict === 'counted' && g.winner !== null) wins.set(g.winner, (wins.get(g.winner) ?? 0) + 1);
  }
  const best = Math.max(0, ...wins.values());
  if (best === 0) {
    const counted = seen.filter((g) => g.verdict === 'counted').length;
    return refund(counted ? 'Every game was a draw: everyone gets their stake back.' : 'No games between all the players: everyone gets their stake back.');
  }
  const winners = [...wins.entries()].filter(([, n]) => n === best).map(([m]) => m);
  return win(
    winners,
    winners.length === 1
      ? `Most wins: ${best} of ${seen.filter((g) => g.verdict === 'counted').length}.`
      : `A tie on ${best} wins each: the pot is shared.`,
  );
}
