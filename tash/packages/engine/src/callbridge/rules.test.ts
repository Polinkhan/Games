import { describe, expect, it } from 'vitest';
import { makeDeck } from '../core/cards';
import type { Seat } from '../core/types';
import { simulateMatch } from '../simulate';
import { callBridge, legalCards, scoreRound } from './index';
import { callBridgeDefaultConfig as cfg } from './rules';
import type { CallBridgeState } from './types';

function trickState(cards: [Seat, string][], extra: Partial<CallBridgeState['config']> = {}) {
  return {
    config: { ...cfg, ...extra },
    trick: { leader: cards[0]?.[0] ?? 0, cards: cards.map(([seat, card]) => ({ seat, card })) },
  };
}

describe('Call Bridge legal plays', () => {
  it('lets the leader play anything, including spades', () => {
    const hand = ['SA', 'H2', 'D9'];
    expect(legalCards(trickState([]), hand)).toEqual(hand);
  });

  it('forces following suit', () => {
    expect(legalCards(trickState([[0, 'H5']]), ['HK', 'H2', 'SA', 'D3'])).toEqual(['HK', 'H2']);
  });

  it('forces a winning spade when void in the led suit', () => {
    expect(legalCards(trickState([[0, 'H5']]), ['S3', 'S9', 'D3'])).toEqual(['S3', 'S9']);
  });

  it('forces over-trumping when a spade is already in the trick', () => {
    expect(legalCards(trickState([[0, 'H5'], [1, 'S8']]), ['S3', 'S9', 'D3'])).toEqual(['S9']);
  });

  it('does not force a spade that cannot beat the spade already played', () => {
    expect(legalCards(trickState([[0, 'H5'], [1, 'SQ']]), ['S3', 'S9', 'D3'])).toEqual(['S3', 'S9', 'D3']);
  });

  it('applies must-beat-in-suit only when enabled and not trumped', () => {
    const hand = ['HK', 'H2', 'D3'];
    expect(legalCards(trickState([[0, 'H9']], { mustBeatInSuit: true }), hand)).toEqual(['HK']);
    expect(legalCards(trickState([[0, 'HA']], { mustBeatInSuit: true }), hand)).toEqual(['HK', 'H2']);
    expect(legalCards(trickState([[0, 'H9'], [1, 'S2']], { mustBeatInSuit: true }), hand)).toEqual(['HK', 'H2']);
  });
});

describe('Call Bridge scoring (in tenths)', () => {
  const strict = { ...cfg, overtricks: 'strict' as const };
  const tenths = { ...cfg, overtricks: 'tenths' as const };
  it('strict: call or call+1 succeeds, call+2 or less fails', () => {
    expect(scoreRound(4, 4, strict)).toBe(40);
    expect(scoreRound(4, 5, strict)).toBe(40);
    expect(scoreRound(4, 6, strict)).toBe(-40);
    expect(scoreRound(4, 3, strict)).toBe(-40);
  });
  it('tenths: extra tricks score 0.1 each', () => {
    expect(scoreRound(3, 5, tenths)).toBe(32);
    expect(scoreRound(3, 2, tenths)).toBe(-30);
  });
  it('bonus call of 8+ scores 13', () => {
    expect(scoreRound(8, 8, strict)).toBe(130);
    expect(scoreRound(8, 9, tenths)).toBe(130);
    expect(scoreRound(8, 8, { ...strict, bonusCall: false })).toBe(80);
    expect(scoreRound(8, 7, strict)).toBe(-80);
  });
});

describe('Call Bridge flow', () => {
  it('deals 13 unique cards each and starts calling after the dealer', () => {
    const { state } = callBridge.init(cfg, 'seed-1');
    expect(state.hands.flat().sort()).toEqual(makeDeck().sort());
    expect(state.turn).toBe((state.dealer + 1) % 4);
    expect(state.phase).toBe('calling');
  });

  it('rejects out-of-turn and illegal actions', () => {
    const { state } = callBridge.init(cfg, 'seed-2');
    const other = ((state.turn + 1) % 4) as Seat;
    expect(callBridge.validate(state, other, { type: 'call', call: 3 })).toBe('not-your-turn');
    expect(callBridge.validate(state, state.turn, { type: 'play', card: state.hands[state.turn]![0]! })).toBe('not-now');
    expect(() => callBridge.apply(state, other, { type: 'call', call: 3 })).toThrow();
  });
});

describe('Call Bridge simulation', () => {
  it('2,000 bot matches finish with consistent rounds', () => {
    for (let i = 0; i < 2000; i++) {
      simulateMatch(callBridge, { ...cfg, rounds: 1, overtricks: i % 2 ? 'tenths' : 'strict' }, `cb-${i}`, {
        difficulties: i % 3 === 0 ? ['easy', 'normal', 'easy', 'normal'] : undefined,
        onStep: (raw, events) => {
          const s = raw as CallBridgeState;
          const inPlay = [...s.hands.flat(), ...s.tricks.flatMap((t) => t.cards.map((p) => p.card)), ...s.trick.cards.map((p) => p.card)];
          if (new Set(inPlay).size !== 52 || inPlay.length !== 52) throw new Error('card lost or duplicated');
          for (const e of events) if (e.type === 'roundScored') {
            const tricks = (e as unknown as { tricks: number[] }).tricks;
            if (tricks.reduce((a, b) => a + b, 0) !== 13) throw new Error('tricks != 13');
          }
        },
      });
    }
  }, 120_000);

  it('hard bots play legal moves', () => {
    simulateMatch(callBridge, { ...cfg, rounds: 1 }, 'cb-hard', { difficulties: ['hard', 'normal', 'hard', 'easy'] });
  }, 60_000);
});
