import type { CardId } from '../core/cards';
import type { Rng } from '../core/rng';
import type { Difficulty } from '../core/types';
import { evaluate3, evaluate4, hazariPoints, type Combo } from './combos';
import type { Groups, HazariAction, HazariView } from './types';
import winTableJson from './winTable.json';

/** winTable[position][bucketKey] = chance a group in that bucket wins its trick. */
export type WinTable = Record<string, Record<string, number>>;
const defaultTable = winTableJson as WinTable;

/** Coarse bucket: combination type plus its two most significant tie-break ranks. */
export function bucketKey(c: Combo): number {
  return c.value[0]! * 256 + (c.value[1] ?? 0) * 16 + (c.value[2] ?? 0);
}

const sortedKeysCache = new WeakMap<object, number[][]>();

export function winProbability(table: WinTable, position: number, combo: Combo): number {
  const row = table[position];
  const key = bucketKey(combo);
  if (row) {
    const hit = row[key];
    if (hit !== undefined) return hit;
    // Nearest known bucket below this one.
    let keys = sortedKeysCache.get(table)?.[position];
    if (!keys) {
      const all = sortedKeysCache.get(table) ?? [];
      all[position] = Object.keys(row).map(Number).sort((a, b) => a - b);
      sortedKeysCache.set(table, all);
      keys = all[position]!;
    }
    let found: number | null = null;
    for (const k of keys) {
      if (k > key) break;
      found = k;
    }
    if (found !== null) return row[found]!;
    if (keys.length) return row[keys[0]!]! * 0.5;
  }
  // No table: rough guess from combination type.
  return [0, 0.05, 0.3, 0.55, 0.7, 0.85, 0.95][combo.value[0]!]! * (position === 3 ? 0.9 : 1);
}

/** Easy arrangement: best three cards, then best three of the rest, and so on. */
export function greedyArrangement(hand: readonly CardId[]): Groups {
  let left = [...hand];
  const groups: CardId[][] = [];
  for (let g = 0; g < 3; g++) {
    let best: Combo | null = null;
    for (let i = 0; i < left.length; i++)
      for (let j = i + 1; j < left.length; j++)
        for (let k = j + 1; k < left.length; k++) {
          const c = evaluate3([left[i]!, left[j]!, left[k]!]);
          if (!best || c.full > best.full) best = c;
        }
    groups.push(best!.cards);
    left = left.filter((c) => !best!.cards.includes(c));
  }
  groups.push(left);
  return groups as Groups;
}

const AVG_CARD_POINTS = 360 / 52;

/**
 * Strong arrangement: try every split of 13 cards into 3 + 3 + 3 + 4 that satisfies
 * the descending rule and keep the one with the highest expected points.
 */
export function searchArrangement(hand: readonly CardId[], table: WinTable = defaultTable): Groups {
  const n = hand.length; // 13
  const tri = new Map<number, { combo: Combo; ev: number[] }>();
  // Keyed by 13-bit card mask.
  const potOf = (cards: CardId[], size: number) =>
    cards.reduce((a, c) => a + hazariPoints(c), 0) + 3 * size * AVG_CARD_POINTS;
  const maskCards = (m: number) => hand.filter((_, i) => m & (1 << i));

  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const m = (1 << i) | (1 << j) | (1 << k);
        const cards = [hand[i]!, hand[j]!, hand[k]!];
        const combo = evaluate3(cards);
        const pot = potOf(cards, 3);
        tri.set(m, { combo, ev: [0, 1, 2].map((p) => winProbability(table, p, combo) * pot) });
      }

  let bestScore = -Infinity;
  let best: number[] = [];
  const full = (1 << n) - 1;
  const idx = (m: number) => [...Array(n).keys()].filter((i) => m & (1 << i));

  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const m4 = (1 << a) | (1 << b) | (1 << c) | (1 << d);
          const four = evaluate4(maskCards(m4));
          const ev4 = winProbability(table, 3, four) * potOf(maskCards(m4), 4);
          const rest = idx(full & ~m4); // 9 indices
          // Partition rest into three unordered triples.
          const r0 = rest[0]!;
          for (let x = 1; x < 9; x++)
            for (let y = x + 1; y < 9; y++) {
              const t1 = (1 << r0) | (1 << rest[x]!) | (1 << rest[y]!);
              const rem = rest.filter((_, q) => q !== 0 && q !== x && q !== y); // 6
              const s0 = rem[0]!;
              for (let u = 1; u < 6; u++)
                for (let v = u + 1; v < 6; v++) {
                  const t2 = (1 << s0) | (1 << rem[u]!) | (1 << rem[v]!);
                  const t3 = full & ~m4 & ~t1 & ~t2;
                  let A = tri.get(t1)!, B = tri.get(t2)!, C = tri.get(t3)!;
                  let ma = t1, mb = t2, mc = t3;
                  if (B.combo.full > A.combo.full) { [A, B] = [B, A]; [ma, mb] = [mb, ma]; }
                  if (C.combo.full > B.combo.full) { [B, C] = [C, B]; [mb, mc] = [mc, mb]; }
                  if (B.combo.full > A.combo.full) { [A, B] = [B, A]; [ma, mb] = [mb, ma]; }
                  if (C.combo.base < four.base) continue;
                  const score = A.ev[0]! + B.ev[1]! + C.ev[2]! + ev4;
                  if (score > bestScore) {
                    bestScore = score;
                    best = [ma, mb, mc, m4];
                  }
                }
            }
        }
  if (!best.length) return greedyArrangement(hand);
  return best.map(maskCards) as Groups;
}

export function hazariBot(view: HazariView, difficulty: Difficulty, _rng: Rng): HazariAction {
  if (view.phase !== 'arranging') return { type: 'continue' };
  const groups = difficulty === 'easy' ? greedyArrangement(view.hand) : searchArrangement(view.hand);
  return { type: 'arrange', groups };
}
