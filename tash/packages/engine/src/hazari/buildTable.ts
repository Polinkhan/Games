/**
 * Builds winTable.json: for each group position (0-3) and combination bucket,
 * the chance that group wins its showdown trick against three opponents.
 *
 *   pnpm --filter @tash/engine hazari:table [greedyDeals] [searchDeals]
 *
 * Pass 1 arranges every hand greedily. Pass 2 arranges with the search bot using
 * the pass-1 table, so the final table reflects stronger opponents.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDeck } from '../core/cards';
import { createRng } from '../core/rng';
import { bucketKey, greedyArrangement, searchArrangement, type WinTable } from './bot';
import { evaluate } from './combos';
import type { Groups } from './types';

type Counts = Map<number, { wins: number; n: number }>[];

function collect(deals: number, arrange: (hand: string[]) => Groups, seed: string): Counts {
  const counts: Counts = [new Map(), new Map(), new Map(), new Map()];
  const rng = createRng(seed);
  const deck = makeDeck();
  for (let d = 0; d < deals; d++) {
    const cards = rng.shuffle(deck);
    const groups = [0, 1, 2, 3].map((p) => arrange(cards.slice(p * 13, p * 13 + 13)));
    for (let pos = 0; pos < 4; pos++) {
      const combos = groups.map((g) => evaluate(g[pos]!));
      for (let p = 0; p < 4; p++) {
        const mine = combos[p]!;
        let win = 1;
        for (let q = 0; q < 4; q++) {
          if (q === p) continue;
          const other = combos[q]!;
          if (other.full > mine.full) { win = 0; break; }
          if (other.full === mine.full) win = Math.min(win, 0.5);
        }
        const key = bucketKey(mine);
        const c = counts[pos]!.get(key) ?? { wins: 0, n: 0 };
        c.wins += win;
        c.n += 1;
        counts[pos]!.set(key, c);
      }
    }
    if (d % 20000 === 0 && d) console.log(`  ${d}/${deals}`);
  }
  return counts;
}

function toTable(counts: Counts, prior?: WinTable, priorWeight = 20): WinTable {
  const table: WinTable = {};
  for (let pos = 0; pos < 4; pos++) {
    const keys = new Set<number>([...counts[pos]!.keys(), ...Object.keys(prior?.[pos] ?? {}).map(Number)]);
    const sorted = [...keys].sort((a, b) => a - b);
    const row: Record<string, number> = {};
    let running = 0;
    for (const k of sorted) {
      const c = counts[pos]!.get(k) ?? { wins: 0, n: 0 };
      const p0 = prior?.[pos]?.[k];
      let p: number;
      if (p0 !== undefined) p = (c.wins + priorWeight * p0) / (c.n + priorWeight);
      else if (c.n >= 10) p = c.wins / c.n;
      else continue;
      running = Math.max(running, p); // stronger buckets never win less often
      row[k] = Math.round(running * 10000) / 10000;
    }
    table[pos] = row;
  }
  return table;
}

const greedyDeals = Number(process.argv[2] ?? 100000);
const searchDeals = Number(process.argv[3] ?? 1500);

console.log(`pass 1: ${greedyDeals} deals, greedy arrangement`);
const t1 = toTable(collect(greedyDeals, greedyArrangement, 'table-pass-1'));
console.log(`pass 2: ${searchDeals} deals, search arrangement`);
const t2 = toTable(collect(searchDeals, (h) => searchArrangement(h, t1), 'table-pass-2'), t1);

const out = fileURLToPath(new URL('./winTable.json', import.meta.url));
writeFileSync(out, JSON.stringify(t2) + '\n');
console.log(`wrote ${out}`);
