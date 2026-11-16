import { cardId, makeDeck, rankOf, removeCard, sortHand, suitOf, type CardId, type Rank, type Suit } from '../core/cards';
import { firstDealer, shuffleAndDeal } from '../core/deal';
import { ledSuit, trickWinner } from '../core/tricks';
import {
  IllegalActionError,
  nextSeat,
  partnerOf,
  SEATS,
  teamOf,
  type ApplyResult,
  type MatchResult,
  type Seat,
} from '../core/types';
import type {
  TwentyNineAction,
  TwentyNineConfig,
  TwentyNineEvent,
  TwentyNineState,
  TwentyNineView,
} from './types';

type Result = ApplyResult<TwentyNineState, TwentyNineEvent>;

export const TN_RANKS: readonly Rank[] = [7, 8, 9, 10, 11, 12, 13, 14];
export const MIN_BID = 16;
export const MAX_BID = 28;

/** Rank order in every suit: J, 9, A, 10, K, Q, 8, 7. */
const POWER: Record<number, number> = { 11: 8, 9: 7, 14: 6, 10: 5, 13: 4, 12: 3, 8: 2, 7: 1 };
const POINTS: Record<number, number> = { 11: 3, 9: 2, 14: 1, 10: 1 };

export const power = (c: CardId) => POWER[rankOf(c)]!;
export const points = (c: CardId) => POINTS[rankOf(c)] ?? 0;

export const twentyNineDefaultConfig: TwentyNineConfig = {
  lastTrickPoint: true,
  pairEnabled: true,
  targetGamePoints: 6,
};

function startRound(state: TwentyNineState, round: number, dealer: Seat): Result {
  const { hands, rest } = shuffleAndDeal(makeDeck(TN_RANKS), state.seed, round, dealer, 4);
  const stock: CardId[][] = [[], [], [], []];
  let seat = nextSeat(dealer);
  for (const c of rest) {
    stock[seat]!.push(c);
    seat = nextSeat(seat);
  }
  const s: TwentyNineState = {
    ...state,
    round,
    dealer,
    phase: 'bidding',
    hands: hands.map((h) => sortHand(h, power)),
    stock,
    turn: nextSeat(dealer),
    bids: [],
    passed: [false, false, false, false],
    highBid: null,
    highBidder: null,
    bidder: null,
    bid: null,
    target: null,
    trumpSuit: null,
    trumpRevealed: false,
    revealedBy: null,
    mustTrump: null,
    pair: null,
    trick: { leader: nextSeat(dealer), cards: [] },
    tricks: [],
    teamPoints: [0, 0],
  };
  return { state: s, events: [{ type: 'dealt', round, dealer, count: 4 }] };
}

export function init(config: TwentyNineConfig, seed: string): Result {
  const base: TwentyNineState = {
    game: 'twentynine',
    config,
    seed,
    round: 0,
    dealer: 0,
    phase: 'bidding',
    hands: [[], [], [], []],
    stock: [[], [], [], []],
    turn: 0,
    bids: [],
    passed: [false, false, false, false],
    highBid: null,
    highBidder: null,
    bidder: null,
    bid: null,
    target: null,
    trumpSuit: null,
    trumpRevealed: false,
    revealedBy: null,
    mustTrump: null,
    pair: null,
    trick: { leader: 0, cards: [] },
    tricks: [],
    teamPoints: [0, 0],
    gamePoints: [0, 0],
    history: [],
  };
  return startRound(base, 1, firstDealer(seed));
}

export function pendingSeats(state: TwentyNineState): Seat[] {
  if (state.phase === 'bidding' || state.phase === 'playing') return [state.turn];
  if (state.phase === 'chooseTrump') return [state.bidder!];
  return [];
}

/** Nobody has bid and three players passed: the dealer must take it at 16. */
function dealerForced(state: TwentyNineState): boolean {
  return state.highBid === null && state.passed.filter(Boolean).length === 3;
}

export function legalBids(state: TwentyNineState): number[] {
  if (dealerForced(state)) return [MIN_BID];
  const from = state.highBid === null ? MIN_BID : state.highBid + 1;
  const out: number[] = [];
  for (let b = from; b <= MAX_BID; b++) out.push(b);
  return out;
}

export function legalCards(state: TwentyNineState, seat: Seat): CardId[] {
  const hand = state.hands[seat]!;
  const led = ledSuit(state.trick);
  if (state.mustTrump === seat) {
    const trumps = hand.filter((c) => suitOf(c) === state.trumpSuit);
    if (trumps.length) return trumps;
    return [...hand];
  }
  if (!led) return [...hand];
  const inSuit = hand.filter((c) => suitOf(c) === led);
  return inSuit.length ? inSuit : [...hand];
}

export function canReveal(state: TwentyNineState, seat: Seat): boolean {
  if (state.phase !== 'playing' || state.turn !== seat || state.trumpRevealed) return false;
  const led = ledSuit(state.trick);
  if (!led) return false;
  return !state.hands[seat]!.some((c) => suitOf(c) === led);
}

export function validate(state: TwentyNineState, seat: Seat, action: TwentyNineAction): string | null {
  if (action.type === 'continue') return state.phase === 'roundEnd' ? null : 'not-now';
  if (!pendingSeats(state).includes(seat)) return 'not-your-turn';
  switch (action.type) {
    case 'bid':
      if (state.phase !== 'bidding') return 'not-now';
      return legalBids(state).includes(action.bid) ? null : 'bad-bid';
    case 'pass':
      if (state.phase !== 'bidding') return 'not-now';
      return dealerForced(state) ? 'dealer-must-bid' : null;
    case 'trump':
      return state.phase === 'chooseTrump' ? null : 'not-now';
    case 'reveal':
      return canReveal(state, seat) ? null : 'cannot-reveal';
    case 'play': {
      if (state.phase !== 'playing') return 'not-now';
      if (!state.hands[seat]!.includes(action.card)) return 'not-in-hand';
      if (!legalCards(state, seat).includes(action.card)) return state.mustTrump === seat ? 'must-trump' : 'must-follow';
      return null;
    }
  }
}

function nextBidder(state: TwentyNineState, from: Seat): Seat {
  let s = nextSeat(from);
  while (state.passed[s]) s = nextSeat(s);
  return s;
}

export function result(state: TwentyNineState): MatchResult | null {
  if (state.phase !== 'matchEnd') return null;
  const [a, b] = state.gamePoints;
  const target = state.config.targetGamePoints;
  // The team that reached +target wins, or the other team if one fell to -target.
  let winningTeam: 0 | 1;
  if (a >= target || b <= -target) winningTeam = 0;
  else winningTeam = 1;
  return {
    winners: SEATS.filter((s) => teamOf(s) === winningTeam),
    finalScores: SEATS.map((s) => state.gamePoints[teamOf(s)]),
  };
}

function hasPair(hand: readonly CardId[], trump: Suit): boolean {
  return hand.includes(cardId(trump, 13)) && hand.includes(cardId(trump, 12));
}

export function apply(state: TwentyNineState, seat: Seat, action: TwentyNineAction): Result {
  const reason = validate(state, seat, action);
  if (reason) throw new IllegalActionError(reason);
  const events: TwentyNineEvent[] = [];

  switch (action.type) {
    case 'continue':
      return startRound(state, state.round + 1, nextSeat(state.dealer));

    case 'bid':
    case 'pass': {
      const bid = action.type === 'bid' ? action.bid : null;
      const passed = [...state.passed];
      let s: TwentyNineState = { ...state, bids: [...state.bids, { seat, bid }] };
      if (bid === null) passed[seat] = true;
      else s = { ...s, highBid: bid, highBidder: seat };
      s = { ...s, passed };
      events.push({ type: 'bidPlaced', seat, bid });
      const passes = passed.filter(Boolean).length;
      if (passes === 3 && s.highBidder !== null) {
        events.push({ type: 'bidWon', seat: s.highBidder, bid: s.highBid! });
        s = { ...s, phase: 'chooseTrump', bidder: s.highBidder, bid: s.highBid, target: s.highBid, turn: s.highBidder };
        return { state: s, events };
      }
      return { state: { ...s, turn: nextBidder(s, seat) }, events };
    }

    case 'trump': {
      const hands = state.hands.map((h, i) => sortHand([...h, ...state.stock[i]!], power));
      events.push({ type: 'trumpChosen', seat });
      events.push({ type: 'dealt', round: state.round, dealer: state.dealer, count: 4 });
      const leader = nextSeat(state.dealer);
      return {
        state: {
          ...state,
          hands,
          stock: [[], [], [], []],
          trumpSuit: action.suit,
          phase: 'playing',
          turn: leader,
          trick: { leader, cards: [] },
        },
        events,
      };
    }

    case 'reveal': {
      events.push({ type: 'trumpRevealed', suit: state.trumpSuit!, bySeat: seat });
      return { state: { ...state, trumpRevealed: true, revealedBy: seat, mustTrump: seat }, events };
    }

    case 'play':
      return playCard(state, seat, action.card);
  }
}

function playCard(state: TwentyNineState, seat: Seat, card: CardId): Result {
  const events: TwentyNineEvent[] = [{ type: 'cardPlayed', seat, card }];
  const hands = state.hands.map((h, i) => (i === seat ? removeCard(h, card) : h));
  const trick = { ...state.trick, cards: [...state.trick.cards, { seat, card }] };
  let s: TwentyNineState = { ...state, hands, trick, mustTrump: null, turn: nextSeat(seat) };
  if (trick.cards.length < 4) return { state: s, events };

  const trump = s.trumpRevealed ? s.trumpSuit : null;
  const winner = trickWinner(trick, trump, power);
  const last = s.tricks.length === 7;
  const pts = trick.cards.reduce((a, p) => a + points(p.card), 0) + (last && s.config.lastTrickPoint ? 1 : 0);
  const teamPoints: [number, number] = [...s.teamPoints];
  teamPoints[teamOf(winner)] += pts;
  events.push({ type: 'trickWon', seat: winner, cards: trick.cards.map((p) => p.card), points: pts });
  s = {
    ...s,
    teamPoints,
    tricks: [...s.tricks, { ...trick, winner, points: pts }],
    trick: { leader: winner, cards: [] },
    turn: winner,
  };

  // Pair: declared automatically by the winning team once trump is known.
  if (s.config.pairEnabled && s.trumpRevealed && !s.pair && !last) {
    for (const p of [winner, partnerOf(winner)]) {
      if (hasPair(s.hands[p]!, s.trumpSuit!)) {
        const team = teamOf(p);
        const bidderTeam = teamOf(s.bidder!);
        const target = team === bidderTeam ? Math.max(MIN_BID, s.target! - 4) : Math.min(MAX_BID, s.target! + 4);
        s = { ...s, pair: { seat: p, team }, target };
        events.push({ type: 'pairDeclared', seat: p, team, target });
        break;
      }
    }
  }

  if (!last) return { state: s, events };

  // Round over.
  const bidderTeam = teamOf(s.bidder!);
  const success = teamPoints[bidderTeam] >= s.target!;
  const deltas: [number, number] = [0, 0];
  deltas[bidderTeam] = success ? 1 : -1;
  const gamePoints: [number, number] = [s.gamePoints[0] + deltas[0], s.gamePoints[1] + deltas[1]];
  const record = {
    bidder: s.bidder!,
    bid: s.bid!,
    target: s.target!,
    trump: s.trumpSuit!,
    teamPoints,
    deltas,
  };
  const t = s.config.targetGamePoints;
  const over = gamePoints.some((g) => g >= t || g <= -t);
  s = { ...s, gamePoints, history: [...s.history, record], phase: over ? 'matchEnd' : 'roundEnd', trumpRevealed: true };
  events.push({ type: 'roundScored', teamPoints, deltas, totals: gamePoints, success });
  const res = result(s);
  if (res) events.push({ type: 'matchEnded', result: res });
  return { state: s, events };
}

export function viewFor(state: TwentyNineState, seat: Seat): TwentyNineView {
  const pending = pendingSeats(state);
  const myTurn = pending.includes(seat);
  const showTrump = state.trumpRevealed || state.bidder === seat;
  return {
    game: 'twentynine',
    seat,
    config: state.config,
    phase: state.phase,
    round: state.round,
    dealer: state.dealer,
    pending,
    hand: [...state.hands[seat]!],
    handCounts: state.hands.map((h) => h.length),
    turn: state.turn,
    bids: state.bids,
    passed: [...state.passed],
    highBid: state.highBid,
    highBidder: state.highBidder,
    bidder: state.bidder,
    bid: state.bid,
    target: state.target,
    trumpSuit: showTrump ? state.trumpSuit : null,
    trumpChosen: state.trumpSuit !== null,
    trumpRevealed: state.trumpRevealed,
    revealedBy: state.revealedBy,
    mustTrump: state.mustTrump,
    pair: state.pair,
    trick: state.trick,
    tricks: state.tricks,
    teamPoints: [...state.teamPoints],
    gamePoints: [...state.gamePoints],
    history: state.history,
    legalCards: myTurn && state.phase === 'playing' ? legalCards(state, seat) : [],
    legalBids: myTurn && state.phase === 'bidding' ? legalBids(state) : [],
    canPass: myTurn && state.phase === 'bidding' && !dealerForced(state),
    canReveal: canReveal(state, seat),
    result: result(state),
  };
}
