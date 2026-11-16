import { describe, expect, it } from 'vitest';
import { makeDeck } from '../core/cards';
import { trickWinner } from '../core/tricks';
import type { Seat } from '../core/types';
import { simulateMatch } from '../simulate';
import { twentyNine } from './index';
import { apply, power, points, TN_RANKS, twentyNineDefaultConfig as cfg, viewFor } from './rules';
import type { TwentyNineState } from './types';

/** Drive the game to the play phase with seat `bidder` winning at `bid` and choosing `suit`. */
function toPlay(seed = 'tn', bid = 16, suit: 'S' | 'H' | 'D' | 'C' = 'H') {
  let { state } = twentyNine.init(cfg, seed);
  const first = state.turn;
  state = apply(state, first, { type: 'bid', bid }).state;
  for (let i = 0; i < 3; i++) state = apply(state, state.turn, { type: 'pass' }).state;
  expect(state.phase).toBe('chooseTrump');
  state = apply(state, first, { type: 'trump', suit }).state;
  return { state, bidder: first };
}

/** Replace hands and current trick for focused rule tests. */
function withHands(state: TwentyNineState, hands: string[][], trick: [Seat, string][] = [], turn?: Seat): TwentyNineState {
  const leader = trick[0]?.[0] ?? state.turn;
  return {
    ...state,
    hands,
    trick: { leader, cards: trick.map(([seat, card]) => ({ seat, card })) },
    turn: turn ?? (((leader + trick.length) % 4) as Seat),
  };
}

describe('Twenty-nine cards', () => {
  it('uses 32 cards with J > 9 > A > 10 > K > Q > 8 > 7', () => {
    expect(makeDeck(TN_RANKS)).toHaveLength(32);
    const order = ['HJ', 'H9', 'HA', 'H10', 'HK', 'HQ', 'H8', 'H7'];
    const sorted = [...order].sort((a, b) => power(b) - power(a));
    expect(sorted).toEqual(order);
  });
  it('has 28 card points in the pack', () => {
    expect(makeDeck(TN_RANKS).reduce((a, c) => a + points(c), 0)).toBe(28);
  });
});

describe('Twenty-nine bidding', () => {
  it('deals 4 cards, then 8 after trump', () => {
    const { state } = twentyNine.init(cfg, 'deal');
    expect(state.hands.every((h) => h.length === 4)).toBe(true);
    const { state: playing } = toPlay('deal');
    expect(playing.hands.every((h) => h.length === 8)).toBe(true);
    expect(playing.hands.flat().sort()).toEqual(makeDeck(TN_RANKS).sort());
  });

  it('requires each bid to be higher', () => {
    let { state } = twentyNine.init(cfg, 'bids');
    state = apply(state, state.turn, { type: 'bid', bid: 18 }).state;
    expect(twentyNine.validate(state, state.turn, { type: 'bid', bid: 18 })).toBe('bad-bid');
    expect(twentyNine.validate(state, state.turn, { type: 'bid', bid: 19 })).toBeNull();
  });

  it('forces the dealer to take 16 when the other three pass', () => {
    let { state } = twentyNine.init(cfg, 'forced');
    for (let i = 0; i < 3; i++) state = apply(state, state.turn, { type: 'pass' }).state;
    expect(state.turn).toBe(state.dealer);
    expect(twentyNine.validate(state, state.dealer, { type: 'pass' })).toBe('dealer-must-bid');
    expect(viewFor(state, state.dealer).legalBids).toEqual([16]);
    state = apply(state, state.dealer, { type: 'bid', bid: 16 }).state;
    expect(state.phase).toBe('chooseTrump');
    expect(state.bidder).toBe(state.dealer);
  });

  it('lets an outbid player raise again; ends after three passes', () => {
    let { state } = twentyNine.init(cfg, 'raise');
    const a = state.turn;
    state = apply(state, a, { type: 'bid', bid: 16 }).state;
    const b = state.turn;
    state = apply(state, b, { type: 'bid', bid: 17 }).state;
    state = apply(state, state.turn, { type: 'pass' }).state;
    state = apply(state, state.turn, { type: 'pass' }).state;
    expect(state.turn).toBe(a);
    state = apply(state, a, { type: 'pass' }).state;
    expect(state.phase).toBe('chooseTrump');
    expect(state.bidder).toBe(b);
  });
});

describe('Twenty-nine hidden trump', () => {
  it('hides trump from everyone but the bidder in every phase', () => {
    for (let i = 0; i < 50; i++) {
      simulateMatch(twentyNine, { ...cfg, targetGamePoints: 1 }, `hide-${i}`, {
        onStep: (raw) => {
          const s = raw as TwentyNineState;
          for (const seat of [0, 1, 2, 3] as Seat[]) {
            const v = viewFor(s, seat);
            if (!s.trumpRevealed && seat !== s.bidder && v.trumpSuit !== null) throw new Error('trump leaked');
          }
        },
      });
    }
  });

  it('trump-suit cards do not win before the reveal', () => {
    const t = { leader: 0 as Seat, cards: [{ seat: 0 as Seat, card: 'D7' }, { seat: 1 as Seat, card: 'HJ' }] };
    expect(trickWinner(t, null, power)).toBe(0);
    expect(trickWinner(t, 'H', power)).toBe(1);
  });

  it('asking for trump reveals it and forces a trump', () => {
    const { state } = toPlay('ask', 16, 'H');
    const leader = state.turn;
    const asker = ((leader + 1) % 4) as Seat;
    const hands = [[], [], [], []] as string[][];
    hands[leader] = ['D9'];
    hands[asker] = ['HQ', 'S7'];
    let s = withHands(state, hands, [[leader, 'DJ']], asker);
    expect(twentyNine.validate(s, asker, { type: 'reveal' })).toBeNull();
    s = apply(s, asker, { type: 'reveal' }).state;
    expect(s.trumpRevealed).toBe(true);
    expect(viewFor(s, ((asker + 1) % 4) as Seat).trumpSuit).toBe('H');
    expect(twentyNine.validate(s, asker, { type: 'play', card: 'S7' })).toBe('must-trump');
    expect(twentyNine.validate(s, asker, { type: 'play', card: 'HQ' })).toBeNull();
  });

  it('cannot ask for trump while able to follow suit', () => {
    const { state } = toPlay('ask2', 16, 'H');
    const leader = state.turn;
    const next = ((leader + 1) % 4) as Seat;
    const hands = [[], [], [], []] as string[][];
    hands[leader] = ['D9'];
    hands[next] = ['D8', 'H7'];
    const s = withHands(state, hands, [[leader, 'DJ']], next);
    expect(twentyNine.validate(s, next, { type: 'reveal' })).toBe('cannot-reveal');
    expect(twentyNine.validate(s, next, { type: 'play', card: 'H7' })).toBe('must-follow');
  });
});

describe('Twenty-nine pair and scoring', () => {
  it('pair lowers the bidder team target and raises it for defenders, with clamps', () => {
    for (const [bid, holderIsBidderTeam, expected] of [
      [20, true, 16],
      [18, true, 16],
      [20, false, 24],
      [26, false, 28],
    ] as const) {
      const { state, bidder } = toPlay('pair', bid, 'H');
      const holder = (holderIsBidderTeam ? bidder : (bidder + 1) % 4) as Seat;
      const leader = holder;
      const hands = [['C7'], ['C8'], ['CQ'], ['CK']] as string[][];
      for (const h of hands) h.push('S7');
      hands[holder] = ['CJ', 'HK', 'HQ'];
      let s: TwentyNineState = { ...withHands(state, hands, [], leader), trumpRevealed: true };
      s = apply(s, leader, { type: 'play', card: 'CJ' }).state;
      for (let i = 0; i < 3; i++) s = apply(s, s.turn, { type: 'play', card: s.hands[s.turn]![0]! }).state;
      expect(s.pair?.seat).toBe(holder);
      expect(s.target).toBe(expected);
    }
  });

  it('every simulated round scores 29 points and moves only the bidder team', () => {
    for (let i = 0; i < 2000; i++) {
      simulateMatch(twentyNine, { ...cfg, lastTrickPoint: i % 4 !== 0 }, `tn-${i}`, {
        difficulties: i % 3 === 0 ? ['easy', 'normal', 'easy', 'normal'] : undefined,
        onStep: (raw, events) => {
          const s = raw as TwentyNineState;
          for (const e of events) {
            if (e.type !== 'roundScored') continue;
            const ev = e as unknown as { teamPoints: [number, number]; deltas: [number, number] };
            const total = ev.teamPoints[0] + ev.teamPoints[1];
            if (total !== (s.config.lastTrickPoint ? 29 : 28)) throw new Error(`points ${total}`);
            const bidderTeam = s.bidder! % 2;
            if (ev.deltas[1 - bidderTeam] !== 0) throw new Error('defender score changed');
          }
        },
      });
    }
  }, 180_000);

  it('hard bots play legal moves', () => {
    simulateMatch(twentyNine, { ...cfg, targetGamePoints: 2 }, 'tn-hard', { difficulties: ['hard', 'normal', 'hard', 'easy'] });
  }, 120_000);
});
