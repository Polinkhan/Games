import { describe, expect, it } from 'vitest';
import { makeDeck } from '../core/cards';
import { createRng } from '../core/rng';
import type { Seat } from '../core/types';
import { simulateMatch } from '../simulate';
import { greedyArrangement, searchArrangement } from './bot';
import { compare, evaluate3, evaluate4, hazariPoints, runValue } from './combos';
import { hazari } from './index';
import { hazariDefaultConfig as cfg, runShowdown, validateGroups } from './rules';
import type { Groups, HazariState } from './types';

const ev = (s: string) => evaluate3(s.split(' '));
const beats = (a: string, b: string) => compare(ev(a), ev(b)) > 0;

describe('Hazari combinations', () => {
  it('classifies every type', () => {
    expect(ev('S9 H9 D9').type).toBe('troy');
    expect(ev('H5 H6 H7').type).toBe('colourRun');
    expect(ev('H5 S6 H7').type).toBe('run');
    expect(ev('H2 H9 HK').type).toBe('colour');
    expect(ev('H9 S9 DK').type).toBe('pair');
    expect(ev('H2 S9 DK').type).toBe('indi');
  });

  it('orders the types: troy > colour run > run > colour > pair > indi', () => {
    const order = ['S2 H2 D2', 'H2 H3 H4', 'HA SK DQ', 'HA HK HJ', 'SA HA DK', 'SA HK DJ'];
    for (let i = 0; i < order.length - 1; i++) expect(beats(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('ranks AAA highest among troys', () => {
    expect(beats('SA HA DA', 'SK HK DK')).toBe(true);
  });

  it('orders runs A-K-Q > A-2-3 > K-Q-J > ... > 4-3-2', () => {
    expect(runValue([14, 13, 12])).toBe(15);
    expect(runValue([14, 2, 3])).toBe(14);
    expect(runValue([13, 12, 11])).toBe(13);
    expect(runValue([4, 3, 2])).toBe(4);
    expect(beats('SA HK DQ', 'SA H2 D3')).toBe(true);
    expect(beats('SA H2 D3', 'SK HQ DJ')).toBe(true);
    expect(beats('S5 H4 D3', 'S4 H3 D2')).toBe(true);
    expect(beats('HA H2 H3', 'HK HQ HJ')).toBe(true);
  });

  it('does not treat K-A-2 as a run', () => {
    expect(runValue([13, 14, 2])).toBeNull();
    expect(ev('SK HA D2').type).toBe('indi');
  });

  it('breaks pair and colour ties correctly, never by suit', () => {
    expect(beats('S9 H9 D2', 'C8 D8 SA')).toBe(true);
    expect(beats('S9 H9 DK', 'C9 D9 SQ')).toBe(true);
    expect(beats('HA H9 H2', 'SK SQ SJ'.replace('SJ', 'S9'))).toBe(true);
    expect(beats('HA H9 H3', 'SA S9 S2')).toBe(true);
    expect(compare(ev('S9 H9 DK'), ev('C9 D9 HK'))).toBe(0);
    expect(compare(ev('H5 H6 H7'), ev('S5 S6 S7'))).toBe(0);
  });

  it('values a 4-card group by its best three, then the fourth card', () => {
    const a = evaluate4(['S9', 'H9', 'D9', 'C2']);
    expect(a.type).toBe('troy');
    expect(a.kicker).toBe(2);
    const b = evaluate4(['SA', 'HA', 'D5', 'C3']);
    const c = evaluate4(['SA', 'HA', 'D5', 'C2']);
    expect(b.type).toBe('pair');
    expect(compare(b, c)).toBeGreaterThan(0);
    expect(evaluate4(['H5', 'H6', 'H7', 'S7']).type).toBe('colourRun');
  });

  it('has 360 points in a deal', () => {
    expect(makeDeck().reduce((a, c) => a + hazariPoints(c), 0)).toBe(360);
  });
});

describe('Hazari arrangement validation', () => {
  const hand = ['SA', 'HA', 'DA', 'S2', 'S3', 'S4', 'H9', 'D9', 'CK', 'C2', 'D5', 'H7', 'C8'];
  it('accepts a descending arrangement', () => {
    const groups: Groups = [['SA', 'HA', 'DA'], ['S2', 'S3', 'S4'], ['H9', 'D9', 'CK'], ['C2', 'D5', 'H7', 'C8']];
    expect(validateGroups(hand, groups)).toBeNull();
  });
  it('rejects groups out of order', () => {
    const groups: Groups = [['S2', 'S3', 'S4'], ['SA', 'HA', 'DA'], ['H9', 'D9', 'CK'], ['C2', 'D5', 'H7', 'C8']];
    expect(validateGroups(hand, groups)).toBe('not-descending');
  });
  it('rejects a 4-card group stronger than group 3', () => {
    const groups: Groups = [['SA', 'HA', 'DA'], ['S2', 'S3', 'S4'], ['C2', 'D5', 'H7'], ['H9', 'D9', 'CK', 'C8']];
    expect(validateGroups(hand, groups)).toBe('not-descending');
  });
  it('rejects foreign or missing cards and wrong sizes', () => {
    expect(validateGroups(hand, [['SA', 'HA', 'CA'], ['S2', 'S3', 'S4'], ['H9', 'D9', 'CK'], ['C2', 'D5', 'H7', 'C8']])).toBe('not-your-cards');
    expect(validateGroups(hand, [['SA', 'HA'], ['DA', 'S2', 'S3', 'S4'], ['H9', 'D9', 'CK'], ['C2', 'D5', 'H7', 'C8']] as unknown as Groups)).toBe('bad-sizes');
  });
  it('greedy and search arrangements are always valid', () => {
    const rng = createRng('arr');
    for (let i = 0; i < 40; i++) {
      const h = rng.shuffle(makeDeck()).slice(0, 13);
      expect(validateGroups(h, greedyArrangement(h))).toBeNull();
      expect(validateGroups(h, searchArrangement(h))).toBeNull();
    }
  });
});

describe('Hazari showdown', () => {
  it('gives exact ties to the group played later', () => {
    const filler = (): Groups => [['C2', 'D4', 'H9'], ['C3', 'D5', 'H8'], ['C4', 'D6', 'H7'], ['C5', 'D7', 'H6', 'S2']];
    const groups: Groups[] = [filler(), filler(), filler(), filler()];
    groups[0]![0] = ['S5', 'S6', 'S7'];
    groups[1]![0] = ['H5', 'H6', 'H7'];
    groups[3]![0] = ['SJ', 'D3', 'C8'];
    // Dealer 3, so seat 0 leads and seat 1 plays the equal colour run later.
    expect(runShowdown(groups, 3)[0]!.winner).toBe(1);
    // With seat 1 leading (dealer 0), seat 1 plays first and seat 0 plays last: seat 0 wins.
    expect(runShowdown(groups, 0)[0]!.winner).toBe(0);
  });

  it('simulated matches always score 360 per deal and stay legal', () => {
    for (let i = 0; i < 300; i++) {
      simulateMatch(hazari, { targetScore: 400 }, `hz-${i}`, {
        difficulties: i % 2 ? ['easy', 'easy', 'easy', 'easy'] : ['normal', 'easy', 'normal', 'easy'],
        onStep: (raw, events) => {
          for (const e of events) {
            if (e.type !== 'roundScored') continue;
            const pts = (e as unknown as { points: number[] }).points;
            if (pts.reduce((a, b) => a + b, 0) !== 360) throw new Error('points != 360');
          }
          const s = raw as HazariState;
          if (s.phase === 'arranging' && s.hands.flat().length !== 52) throw new Error('bad deal');
        },
      });
    }
  }, 180_000);

  it('2,000 greedy matches finish', () => {
    for (let i = 0; i < 2000; i++) simulateMatch(hazari, cfg, `hzg-${i}`, { difficulties: ['easy', 'easy', 'easy', 'easy'] });
  }, 180_000);

  it('search beats greedy over many deals', () => {
    let search = 0;
    let greedy = 0;
    for (let i = 0; i < 60; i++) {
      const { state } = simulateMatch(hazari, { targetScore: 200 }, `vs-${i}`, {
        difficulties: ['normal', 'easy', 'normal', 'easy'],
      });
      const s = state as HazariState;
      search += s.scores[0]! + s.scores[2]!;
      greedy += s.scores[1]! + s.scores[3]!;
    }
    expect(search).toBeGreaterThan(greedy);
  }, 180_000);

  it('rejects arranging twice and allows unlocking', () => {
    let { state } = hazari.init(cfg, 'lock');
    const g = greedyArrangement(state.hands[0]!);
    state = hazari.apply(state, 0 as Seat, { type: 'arrange', groups: g }).state;
    expect(hazari.validate(state, 0, { type: 'arrange', groups: g })).toBe('already-arranged');
    expect(hazari.pendingSeats(state)).toEqual([1, 2, 3]);
    state = hazari.apply(state, 0, { type: 'unlock' }).state;
    expect(hazari.pendingSeats(state)).toEqual([0, 1, 2, 3]);
  });
});
