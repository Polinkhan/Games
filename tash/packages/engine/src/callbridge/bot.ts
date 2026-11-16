import { cardId, rankOf, suitOf, SUITS, type CardId, type Rank, type Suit } from '../core/cards';
import { readTricks } from '../core/knowledge';
import type { Rng } from '../core/rng';
import { beats, winningPlay } from '../core/tricks';
import type { Difficulty } from '../core/types';
import type { CallBridgeAction, CallBridgeView } from './types';

const TRUMP: Suit = 'S';

export function estimateTricks(hand: readonly CardId[]): number {
  const bySuit = (s: Suit) => hand.filter((c) => suitOf(c) === s).map(rankOf);
  const spades = bySuit('S');
  let est = 0;
  if (spades.includes(14)) est += 1;
  if (spades.includes(13)) est += 1;
  if (spades.includes(12) && spades.length >= 3) est += 1;
  if (spades.includes(11) && spades.length >= 4) est += 0.5;
  est += Math.max(0, spades.length - 4);
  for (const s of SUITS) {
    if (s === TRUMP) continue;
    const r = bySuit(s);
    if (r.includes(14)) est += 1;
    if (r.includes(13)) est += r.length >= 2 && r.length <= 4 ? 0.75 : 0.25;
    if (r.includes(12) && r.length === 3) est += 0.25;
    if (spades.length >= 3) {
      if (r.length === 0) est += 1;
      else if (r.length === 1) est += 0.5;
    }
  }
  return est;
}

export function chooseCall(view: CallBridgeView, difficulty: Difficulty, rng: Rng): number {
  let call = Math.floor(estimateTricks(view.hand));
  if (difficulty === 'easy') call += rng.int(3) - 1;
  return Math.max(view.config.minCall, Math.min(8, call));
}

const cost = (c: CardId) => rankOf(c) + (suitOf(c) === TRUMP ? 20 : 0);
const cheapest = (cards: CardId[]) => [...cards].sort((a, b) => cost(a) - cost(b))[0]!;
const dearest = (cards: CardId[]) => [...cards].sort((a, b) => cost(b) - cost(a))[0]!;

/** Is `card` the highest card of its suit still out (ignoring cards in my own hand)? */
function isBoss(card: CardId, played: Set<CardId>, hand: readonly CardId[]): boolean {
  const suit = suitOf(card);
  for (let r = rankOf(card) + 1; r <= 14; r++) {
    const higher = cardId(suit, r as Rank);
    if (!played.has(higher) && !hand.includes(higher)) return false;
  }
  return true;
}

export function choosePlay(view: CallBridgeView, difficulty: Difficulty, rng: Rng): CardId {
  const legal = view.legalCards;
  if (legal.length === 1) return legal[0]!;
  if (difficulty === 'easy' && rng.next() < 0.3) return rng.pick(legal);

  const me = view.seat;
  const call = view.calls[me] ?? 1;
  const won = view.tricksWon[me]!;
  const { played, voids } = readTricks(view.tricks, view.trick);
  const hand = view.hand;
  const avoid = view.config.overtricks === 'strict' && won >= call;
  const conserveSpades = view.config.overtricks === 'tenths' && won >= call;
  const trick = view.trick.cards;

  const opponentsVoidIn = (s: Suit) => [0, 1, 2, 3].some((p) => p !== me && voids[p]!.has(s));

  // ---- Leading ----
  if (trick.length === 0) {
    const side = legal.filter((c) => suitOf(c) !== TRUMP);
    if (avoid) {
      const pool = side.length ? side : legal;
      // Lowest card from the longest suit.
      const len = (s: Suit) => hand.filter((c) => suitOf(c) === s).length;
      return [...pool].sort((a, b) => len(suitOf(b)) - len(suitOf(a)) || rankOf(a) - rankOf(b))[0]!;
    }
    const sideBoss = side.filter((c) => isBoss(c, played, hand) && !opponentsVoidIn(suitOf(c)));
    if (sideBoss.length) return dearest(sideBoss);
    const spades = legal.filter((c) => suitOf(c) === TRUMP);
    const unseenSpades = 13 - spades.length - [...played].filter((c) => suitOf(c) === TRUMP).length;
    const bossSpade = spades.find((c) => isBoss(c, played, hand));
    if (!conserveSpades && bossSpade && spades.length >= 3 && unseenSpades > 0) return bossSpade;
    if (spades.length) {
      const singletons = side.filter((c) => hand.filter((h) => suitOf(h) === suitOf(c)).length === 1 && rankOf(c) < 13);
      if (singletons.length) return cheapest(singletons);
    }
    const len = (s: Suit) => hand.filter((c) => suitOf(c) === s).length;
    const pool = side.length ? side : legal;
    return [...pool].sort((a, b) => len(suitOf(b)) - len(suitOf(a)) || rankOf(a) - rankOf(b))[0]!;
  }

  // ---- Following ----
  const led = suitOf(trick[0]!.card);
  const best = winningPlay(trick, TRUMP);
  const winners = legal.filter((c) => beats(c, best.card, led, TRUMP));
  const losers = legal.filter((c) => !winners.includes(c));
  const lastSeat = trick.length === 3;

  if (avoid) {
    if (losers.length) return dearest(losers);
    return dearest(winners);
  }

  if (winners.length) {
    let pool = winners;
    if (conserveSpades && !lastSeat) {
      const cheapOnes = winners.filter((c) => suitOf(c) !== TRUMP || rankOf(c) < 12);
      if (!cheapOnes.length) return losers.length ? cheapest(losers) : cheapest(winners);
      pool = cheapOnes;
    }
    if (lastSeat) return cheapest(pool);
    // Not last: a card that can be beaten later is only worth playing if it is the boss
    // (or a trump when following players are likely to follow suit).
    const safe = pool.filter((c) =>
      suitOf(c) === TRUMP && led !== TRUMP ? true : isBoss(c, played, hand),
    );
    if (safe.length) return cheapest(safe);
    const strong = pool.filter((c) => rankOf(c) >= 12);
    if (strong.length && trick.length === 2) return cheapest(strong);
    return losers.length ? cheapest(losers) : cheapest(pool);
  }
  // Cannot win: throw the lowest card, preferring side suits.
  const side = losers.filter((c) => suitOf(c) !== TRUMP);
  return cheapest(side.length ? side : losers);
}

export function callBridgeBot(view: CallBridgeView, difficulty: Difficulty, rng: Rng): CallBridgeAction {
  if (view.phase === 'calling') return { type: 'call', call: chooseCall(view, difficulty, rng) };
  if (view.phase === 'playing') return { type: 'play', card: choosePlay(view, difficulty, rng) };
  return { type: 'continue' };
}
