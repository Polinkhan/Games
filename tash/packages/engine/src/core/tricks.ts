import { rankOf, suitOf, type CardId, type Suit } from './cards';
import type { PlayedCard, Seat, Trick } from './types';

export type PowerFn = (card: CardId) => number;

/** The card currently winning a (possibly incomplete) trick. */
export function winningPlay(cards: readonly PlayedCard[], trump: Suit | null, power: PowerFn = rankOf): PlayedCard {
  if (cards.length === 0) throw new Error('empty trick');
  const led = suitOf(cards[0]!.card);
  let best = cards[0]!;
  for (const p of cards.slice(1)) {
    if (beats(p.card, best.card, led, trump, power)) best = p;
  }
  return best;
}

export function trickWinner(trick: Trick, trump: Suit | null, power: PowerFn = rankOf): Seat {
  return winningPlay(trick.cards, trump, power).seat;
}

/** Does `a` beat `b` in a trick where `led` was led? */
export function beats(a: CardId, b: CardId, led: Suit, trump: Suit | null, power: PowerFn = rankOf): boolean {
  const sa = suitOf(a);
  const sb = suitOf(b);
  if (trump) {
    if (sa === trump && sb !== trump) return true;
    if (sb === trump && sa !== trump) return false;
    if (sa === trump && sb === trump) return power(a) > power(b);
  }
  if (sa === sb) return power(a) > power(b);
  return sa === led && sb !== led ? true : false;
}

export function ledSuit(trick: Trick): Suit | null {
  return trick.cards.length ? suitOf(trick.cards[0]!.card) : null;
}
