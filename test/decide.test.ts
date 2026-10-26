import { describe, expect, it } from 'vitest';
import { decide, split, type Player, type PotSpec, type UtopiaGame } from '../worker/decide';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const OUT = '00000000-0000-0000-0000-0000000000ff';
const players: Player[] = [
  { memberId: 1, utopiaId: A },
  { memberId: 2, utopiaId: B },
  { memberId: 3, utopiaId: C },
];
const spec = (over: Partial<PotSpec> = {}): PotSpec => ({
  rule: 'first',
  game: 'any',
  stake: 5000,
  startsAt: '2026-10-31T18:00:00Z',
  endsAt: '2026-10-31T23:00:00Z',
  ...over,
});
let n = 0;
const game = (over: Partial<UtopiaGame>): UtopiaGame => ({
  game: 'ludo',
  match_id: `m${++n}`,
  ended_at: '2026-10-31T19:00:00Z',
  players: [A, B, C],
  winner: A,
  status: 'completed',
  result: 'win',
  ...over,
});
const during = new Date('2026-10-31T20:00:00Z');
const after = new Date('2026-10-31T23:30:00Z');

describe('split', () => {
  it('shares equally, any remainder one each to the first winners', () => {
    expect(split(15000, [1])).toEqual({ 1: 15000 });
    expect(split(10000, [3, 1, 2])).toEqual({ 1: 3334, 2: 3333, 3: 3333 });
  });
});

describe('first game wins', () => {
  it('pays the winner of the first game between exactly the players', () => {
    const o = decide(spec(), players, [game({ ended_at: '2026-10-31T19:30:00Z', winner: B }), game({ winner: C })], during);
    expect(o.kind).toBe('decided');
    if (o.kind !== 'decided') return;
    expect(o.winners).toEqual([3]);
    expect(o.payouts).toEqual({ 3: 15000 });
    expect(o.refund).toBe(false);
  });

  it('ignores games with an outsider, with someone missing, of another kind or outside the window', () => {
    const games = [
      game({ players: [A, B, OUT], winner: A }),
      game({ players: [A, B], winner: A }),
      game({ game: 'chess', players: [A, B, C], winner: A }),
      game({ ended_at: '2026-10-31T17:59:59Z' }),
      game({ ended_at: '2026-10-31T23:00:00Z' }),
    ];
    expect(decide(spec({ game: 'eights' }), players, games, during).kind).toBe('waiting');
    expect(decide(spec({ game: 'ludo' }), players, games.slice(0, 2), during).kind).toBe('waiting');
  });

  it('skips an abandoned game and takes the next one', () => {
    const o = decide(spec(), players, [game({ status: 'aborted', winner: null }), game({ ended_at: '2026-10-31T19:40:00Z', winner: B })], during);
    expect(o.kind === 'decided' && o.winners).toEqual([2]);
    expect(o.games.map((g) => g.verdict)).toEqual(['abandoned', 'counted']);
  });

  it('hands a disputed game to the holder', () => {
    expect(decide(spec(), players, [game({ status: 'disputed', winner: null })], during).kind).toBe('needs_admin');
  });

  it('refunds everyone after a draw', () => {
    const o = decide(spec(), players, [game({ winner: null, result: 'draw' })], during);
    expect(o.kind === 'decided' && o.refund).toBe(true);
    expect(o.kind === 'decided' && o.payouts).toEqual({ 1: 5000, 2: 5000, 3: 5000 });
  });

  it('waits until the end, then refunds if nobody played', () => {
    expect(decide(spec(), players, [], during).kind).toBe('waiting');
    const o = decide(spec(), players, [], after);
    expect(o.kind === 'decided' && o.refund).toBe(true);
  });

  it('ignores games still being played', () => {
    expect(decide(spec(), players, [game({ status: 'active', winner: null })], during).kind).toBe('waiting');
  });
});

describe('most wins', () => {
  const games = [
    game({ ended_at: '2026-10-31T19:00:00Z', winner: A }),
    game({ ended_at: '2026-10-31T20:00:00Z', winner: B, game: 'eights' }),
    game({ ended_at: '2026-10-31T21:00:00Z', winner: A }),
    game({ ended_at: '2026-10-31T21:30:00Z', status: 'aborted', winner: null }),
  ];

  it('waits for the end of the window', () => {
    const o = decide(spec({ rule: 'most' }), players, games, new Date('2026-10-31T22:00:00Z'));
    expect(o.kind).toBe('waiting');
    expect(o.games.map((g) => g.verdict)).toEqual(['counted', 'counted', 'counted', 'abandoned']);
  });

  it('pays whoever won most', () => {
    const o = decide(spec({ rule: 'most' }), players, games, after);
    expect(o.kind === 'decided' && o.winners).toEqual([1]);
    expect(o.kind === 'decided' && o.reason).toContain('2 of 3');
  });

  it('shares the pot on a tie', () => {
    const o = decide(spec({ rule: 'most' }), players, games.slice(0, 2), after);
    expect(o.kind === 'decided' && o.payouts).toEqual({ 1: 7500, 2: 7500 });
  });

  it('refunds if every game was a draw, and asks the holder about disputes', () => {
    expect(decide(spec({ rule: 'most' }), players, [game({ winner: null })], after)).toMatchObject({ kind: 'decided', refund: true });
    expect(decide(spec({ rule: 'most' }), players, [...games, game({ status: 'disputed', winner: null })], after).kind).toBe('needs_admin');
  });
});
