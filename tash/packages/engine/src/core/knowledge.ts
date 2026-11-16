import { suitOf, type CardId, type Suit } from './cards';
import type { Rng } from './rng';
import type { Seat, Trick } from './types';

export interface Knowledge {
  played: Set<CardId>;
  /** voids[seat] = suits that seat has shown out of. */
  voids: Set<Suit>[];
}

/** What every player can deduce from the cards played so far this round. */
export function readTricks(tricks: readonly Trick[], current: Trick): Knowledge {
  const played = new Set<CardId>();
  const voids: Set<Suit>[] = [new Set(), new Set(), new Set(), new Set()];
  for (const t of [...tricks, current]) {
    if (!t.cards.length) continue;
    const led = suitOf(t.cards[0]!.card);
    for (const p of t.cards) {
      played.add(p.card);
      if (suitOf(p.card) !== led) voids[p.seat]!.add(led);
    }
  }
  return { played, voids };
}

/**
 * Randomly deal `unseen` cards to the other seats so each gets `counts[seat]` cards
 * and nobody receives a suit they are known to be void in. Falls back to ignoring
 * voids if no consistent deal is found quickly.
 */
export function sampleHands(
  unseen: readonly CardId[],
  counts: readonly number[],
  voids: readonly Set<Suit>[],
  me: Seat,
  myHand: readonly CardId[],
  rng: Rng,
): CardId[][] {
  for (let attempt = 0; attempt < 30; attempt++) {
    const hands: CardId[][] = [[], [], [], []];
    hands[me] = [...myHand];
    const left = counts.map((c, s) => (s === me ? 0 : c));
    // Place the most constrained cards first.
    const cards = rng.shuffle(unseen).sort((a, b) => openSeats(b).length - openSeats(a).length);
    let ok = true;
    for (const card of cards) {
      const options = openSeats(card).filter((s) => left[s]! > 0);
      if (!options.length) { ok = false; break; }
      const s = rng.pick(options);
      hands[s]!.push(card);
      left[s]!--;
    }
    if (ok) return hands;
    function openSeats(card: CardId): number[] {
      const suit = suitOf(card);
      return [0, 1, 2, 3].filter((s) => s !== me && !voids[s]!.has(suit));
    }
  }
  // Fallback: ignore voids.
  const hands: CardId[][] = [[], [], [], []];
  hands[me] = [...myHand];
  const pool = rng.shuffle(unseen);
  let i = 0;
  for (let s = 0; s < 4; s++) {
    if (s === me) continue;
    hands[s] = pool.slice(i, i + counts[s]!);
    i += counts[s]!;
  }
  return hands;
}

export function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
