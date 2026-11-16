import { cardId, rankOf, suitOf, SUITS, type CardId, type Suit } from '../core/cards';
import { readTricks } from '../core/knowledge';
import type { Rng } from '../core/rng';
import { winningPlay } from '../core/tricks';
import { partnerOf, type Difficulty, type Seat } from '../core/types';
import { points, power } from './rules';
import type { TwentyNineAction, TwentyNineView } from './types';

const RANK_BY_POWER = [0, 7, 8, 12, 13, 10, 14, 9, 11]; // power -> rank

export function suitStrength(hand: readonly CardId[], suit: Suit): number {
  const cards = hand.filter((c) => suitOf(c) === suit);
  if (!cards.length) return 0;
  let v = 0;
  for (const c of cards) {
    const r = rankOf(c);
    v += r === 11 ? 3 : r === 9 ? 2 : r === 14 || r === 10 ? 1 : r === 13 || r === 12 ? 0.5 : 0;
  }
  return v + (cards.length - 1);
}

export function handStrength(hand: readonly CardId[]): { strength: number; suit: Suit } {
  let best: Suit = 'S';
  let bestKey = -1;
  for (const s of SUITS) {
    const cards = hand.filter((c) => suitOf(c) === s);
    const key = suitStrength(hand, s) * 100 + cards.length * 10 + (cards.some((c) => rankOf(c) === 11) ? 1 : 0);
    if (key > bestKey) { bestKey = key; best = s; }
  }
  const otherJacks = hand.filter((c) => rankOf(c) === 11 && suitOf(c) !== best).length;
  return { strength: suitStrength(hand, best) + otherJacks, suit: best };
}

export function bidLimit(strength: number): number | null {
  if (strength < 4) return null;
  if (strength < 5.5) return 16;
  if (strength < 7) return 17;
  if (strength < 8.5) return 18;
  if (strength < 10) return 19;
  return strength >= 11 ? 21 : 20;
}

function chooseBid(view: TwentyNineView, difficulty: Difficulty, rng: Rng): TwentyNineAction {
  if (!view.canPass) return { type: 'bid', bid: view.legalBids[0]! };
  const { strength } = handStrength(view.hand);
  let limit = bidLimit(strength + (difficulty === 'easy' ? rng.int(3) - 1 : 0));
  if (limit === null) return { type: 'pass' };
  const partner = partnerOf(view.seat);
  if (view.bids.some((b) => b.seat === partner && b.bid !== null)) limit += 1;
  const next = view.legalBids[0];
  if (next === undefined || next > limit) return { type: 'pass' };
  if (view.highBidder === partner && limit - (view.highBid ?? 0) < 2) return { type: 'pass' };
  return { type: 'bid', bid: next };
}

const cheapest = (cards: CardId[]) => [...cards].sort((a, b) => points(a) - points(b) || power(a) - power(b))[0]!;
const lowestPower = (cards: CardId[]) => [...cards].sort((a, b) => power(a) - power(b))[0]!;
const mostPoints = (cards: CardId[]) => [...cards].sort((a, b) => points(b) - points(a) || power(b) - power(a))[0]!;

function isBoss(card: CardId, played: Set<CardId>, hand: readonly CardId[]): boolean {
  const suit = suitOf(card);
  for (let p = power(card) + 1; p <= 8; p++) {
    const higher = cardId(suit, RANK_BY_POWER[p] as never);
    if (!played.has(higher) && !hand.includes(higher)) return false;
  }
  return true;
}

function choosePlay(view: TwentyNineView, difficulty: Difficulty, rng: Rng): TwentyNineAction {
  const legal = view.legalCards;
  const me = view.seat;
  const partner = partnerOf(me);
  const hand = view.hand;
  const trick = view.trick.cards;
  const known = view.trumpSuit; // known to the bidder, or to all once revealed
  const active = view.trumpRevealed ? view.trumpSuit : null;
  const { played, voids } = readTricks(view.tricks, view.trick);
  const isBidderTeam = view.bidder === me || view.bidder === partner;

  if (difficulty === 'easy' && rng.next() < 0.3) {
    if (view.canReveal && rng.next() < 0.3) return { type: 'reveal' };
    return { type: 'play', card: rng.pick(legal) };
  }

  // ---- Leading ----
  if (trick.length === 0) {
    const nonTrump = legal.filter((c) => suitOf(c) !== known);
    const opponentsVoid = (s: Suit) => [0, 1, 2, 3].some((p) => p !== me && p !== partner && voids[p]!.has(s));
    const safe = (c: CardId) => !(active && opponentsVoid(suitOf(c)));
    const jacks = nonTrump.filter((c) => rankOf(c) === 11 && safe(c));
    if (jacks.length) return play(jacks[0]!);
    const bosses = nonTrump.filter((c) => isBoss(c, played, hand) && safe(c));
    if (bosses.length) return play(mostPoints(bosses));
    if (active && view.bidder === me) {
      const trumps = legal.filter((c) => suitOf(c) === active);
      const boss = trumps.find((c) => isBoss(c, played, hand));
      if (trumps.length >= 3 && boss) return play(boss);
    }
    const pool = nonTrump.length ? nonTrump : legal;
    const len = (s: Suit) => hand.filter((c) => suitOf(c) === s).length;
    const zero = pool.filter((c) => points(c) === 0);
    const choice = (zero.length ? zero : pool).sort((a, b) => len(suitOf(b)) - len(suitOf(a)) || power(a) - power(b));
    return play(choice[0]!);
  }

  // ---- Following ----
  const led = suitOf(trick[0]!.card);
  const best = winningPlay(trick, active, power);
  const partnerWinning = best.seat === partner;
  const trickPoints = trick.reduce((a, p) => a + points(p.card), 0);
  const lastSeat = trick.length === 3;
  const canFollow = hand.some((c) => suitOf(c) === led);
  const wins = (c: CardId) => {
    const t = [...trick, { seat: me, card: c }];
    return winningPlay(t, active, power).seat === me;
  };
  // Will partner's card hold? True when nobody after me can beat it.
  const partnerSafe = partnerWinning && (lastSeat || (isBoss(best.card, played, hand) && (!active || suitOf(best.card) === active || !voids[nextAfterMe(view)]!.has(led))));

  if (canFollow) {
    if (partnerWinning) return play(partnerSafe ? mostPoints(legal) : cheapest(legal));
    const winners = legal.filter(wins);
    if (winners.length) {
      const jackOut = !played.has(cardId(led, 11)) && !hand.includes(cardId(led, 11));
      let pool = winners;
      if (trick.length === 1 && jackOut) pool = winners.filter((c) => rankOf(c) !== 9);
      const sure = pool.filter((c) => lastSeat || isBoss(c, played, hand));
      if (sure.length) return play(lowestPower(sure));
      if (pool.length && trickPoints >= 2) return play(lowestPower(pool));
    }
    return play(cheapest(legal));
  }

  // ---- Cannot follow suit ----
  if (view.canReveal) {
    if (view.bidder === me) {
      const trumps = hand.filter((c) => suitOf(c) === known);
      const canWinWithTrump = trumps.length > 0 && !partnerWinning;
      if (canWinWithTrump && trickPoints >= (difficulty === 'hard' ? 2 : 3)) return { type: 'reveal' };
    } else if (!partnerWinning && trickPoints >= 2) {
      return { type: 'reveal' };
    } else if (!partnerWinning && view.bidder === partner && legal.every((c) => points(c) > 0)) {
      return { type: 'reveal' };
    }
    // Discard without revealing.
    const nonTrump = legal.filter((c) => suitOf(c) !== known);
    const pool = nonTrump.length ? nonTrump : legal;
    return play(partnerSafe ? mostPoints(pool) : cheapest(pool));
  }

  const trumpSuit = active ?? known;
  const trumps = legal.filter((c) => suitOf(c) === trumpSuit);
  const winningTrumps = trumps.filter(wins);
  if (view.mustTrump === me && trumps.length) {
    return play(winningTrumps.length ? lowestPower(winningTrumps) : lowestPower(trumps));
  }
  if (partnerWinning) {
    const pool = legal.filter((c) => suitOf(c) !== trumpSuit);
    return play(partnerSafe ? mostPoints(pool.length ? pool : legal) : cheapest(pool.length ? pool : legal));
  }
  if (winningTrumps.length && (trickPoints >= 1 || lastSeat || isBidderTeam)) return play(lowestPower(winningTrumps));
  const discards = legal.filter((c) => suitOf(c) !== trumpSuit);
  return play(cheapest(discards.length ? discards : legal));
}

function nextAfterMe(view: TwentyNineView): Seat {
  return ((view.seat + 1) % 4) as Seat;
}

function play(card: CardId): TwentyNineAction {
  return { type: 'play', card };
}

export function twentyNineBot(view: TwentyNineView, difficulty: Difficulty, rng: Rng): TwentyNineAction {
  switch (view.phase) {
    case 'bidding':
      return chooseBid(view, difficulty, rng);
    case 'chooseTrump':
      return { type: 'trump', suit: handStrength(view.hand).suit };
    case 'playing':
      return choosePlay(view, difficulty, rng);
    default:
      return { type: 'continue' };
  }
}
