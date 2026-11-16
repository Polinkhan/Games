import type { CardId } from './cards';
import { createRng } from './rng';
import { nextSeat, type Seat } from './types';

/** Shuffle with a seed derived from the match seed and round, then deal one card at a time starting after the dealer. */
export function shuffleAndDeal(
  deck: readonly CardId[],
  seed: string,
  round: number,
  dealer: Seat,
  perPlayer: number,
): { hands: CardId[][]; rest: CardId[] } {
  const shuffled = createRng(`${seed}:deal:${round}`).shuffle(deck);
  const hands: CardId[][] = [[], [], [], []];
  let seat = nextSeat(dealer);
  let i = 0;
  for (; i < perPlayer * 4; i++) {
    hands[seat]!.push(shuffled[i]!);
    seat = nextSeat(seat);
  }
  return { hands, rest: shuffled.slice(i) };
}

/** The first dealer of a match, chosen from the seed. */
export function firstDealer(seed: string): Seat {
  return createRng(`${seed}:dealer`).int(4) as Seat;
}
