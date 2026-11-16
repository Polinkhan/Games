import { rankOf, suitOf, type CardId } from '../core/cards';

export type ComboType = 'troy' | 'colourRun' | 'run' | 'colour' | 'pair' | 'indi';

const TYPE_RANK: Record<ComboType, number> = { troy: 6, colourRun: 5, run: 4, colour: 3, pair: 2, indi: 1 };

export interface Combo {
  type: ComboType;
  /** [typeRank, ...tie-break ranks], compared lexicographically. */
  value: number[];
  /** For a 4-card group: the rank of the card left out of the best three. */
  kicker: number | null;
  /** Comparable scalar of `value` alone. */
  base: number;
  /** Comparable scalar including the kicker. */
  full: number;
  /** The three cards forming the combination. */
  cards: CardId[];
}

function encode(values: number[]): number {
  let n = 0;
  for (let i = 0; i < 4; i++) n = n * 16 + (values[i] ?? 0);
  return n;
}

/**
 * Run value: A-K-Q is the highest (15), A-2-3 is second (14), then K-Q-J (13) down to 4-3-2 (4).
 * Returns null when the three ranks are not a run. K-A-2 is not a run.
 */
export function runValue(ranks: number[]): number | null {
  const [a, b, c] = [...ranks].sort((x, y) => y - x) as [number, number, number];
  if (a === 14 && b === 13 && c === 12) return 15;
  if (a === 14 && b === 3 && c === 2) return 14;
  if (a - b === 1 && b - c === 1) return a;
  return null;
}

export function evaluate3(cards: readonly CardId[]): Combo {
  if (cards.length !== 3) throw new Error('evaluate3 needs 3 cards');
  const ranks = cards.map(rankOf).sort((x, y) => y - x) as [number, number, number];
  const sameSuit = suitOf(cards[0]!) === suitOf(cards[1]!) && suitOf(cards[1]!) === suitOf(cards[2]!);
  let type: ComboType;
  let tie: number[];
  const run = runValue(ranks);
  if (ranks[0] === ranks[2]) {
    type = 'troy';
    tie = [ranks[0]];
  } else if (run !== null && sameSuit) {
    type = 'colourRun';
    tie = [run];
  } else if (run !== null) {
    type = 'run';
    tie = [run];
  } else if (sameSuit) {
    type = 'colour';
    tie = ranks;
  } else if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    type = 'pair';
    const pair = ranks[1];
    const odd = ranks[0] === ranks[1] ? ranks[2] : ranks[0];
    tie = [pair, odd];
  } else {
    type = 'indi';
    tie = ranks;
  }
  const value = [TYPE_RANK[type], ...tie];
  const base = encode(value);
  return { type, value, kicker: null, base, full: base * 16, cards: [...cards] };
}

/** A 4-card group is worth its best 3-card combination; the fourth card breaks ties. */
export function evaluate4(cards: readonly CardId[]): Combo {
  if (cards.length !== 4) throw new Error('evaluate4 needs 4 cards');
  let best: Combo | null = null;
  for (let skip = 0; skip < 4; skip++) {
    const three = cards.filter((_, i) => i !== skip);
    const c = evaluate3(three);
    const kicker = rankOf(cards[skip]!);
    const full = c.base * 16 + kicker;
    if (!best || full > best.full) best = { ...c, kicker, full };
  }
  return best!;
}

export function evaluate(cards: readonly CardId[]): Combo {
  return cards.length === 4 ? evaluate4(cards) : evaluate3(cards);
}

/** Positive if a beats b, 0 if exactly equal, negative if b beats a. */
export function compare(a: Combo, b: Combo): number {
  return a.full - b.full;
}

export const COMBO_TYPES: readonly ComboType[] = ['troy', 'colourRun', 'run', 'colour', 'pair', 'indi'];

/** Hazari card points: A, K, Q, J, 10 = 10; 9..2 = 5. A deal holds 360. */
export function hazariPoints(card: CardId): number {
  return rankOf(card) >= 10 ? 10 : 5;
}
