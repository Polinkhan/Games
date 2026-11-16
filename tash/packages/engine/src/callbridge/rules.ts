import { makeDeck, rankOf, removeCard, sortHand, suitOf, type CardId } from '../core/cards';
import { firstDealer, shuffleAndDeal } from '../core/deal';
import { ledSuit, trickWinner, winningPlay } from '../core/tricks';
import {
  IllegalActionError,
  nextSeat,
  SEATS,
  type ApplyResult,
  type MatchResult,
  type Seat,
} from '../core/types';
import {
  type CallBridgeAction,
  type CallBridgeConfig,
  type CallBridgeEvent,
  type CallBridgeState,
  type CallBridgeView,
} from './types';

export { init, pendingSeats, validate, apply, viewFor, result };

export const TRUMP = 'S' as const;
type Result = ApplyResult<CallBridgeState, CallBridgeEvent>;

export const callBridgeDefaultConfig: CallBridgeConfig = {
  rounds: 5,
  minCall: 1,
  mustBeatInSuit: false,
  overtricks: 'strict',
  bonusCall: true,
};

function startRound(state: CallBridgeState, round: number, dealer: Seat): Result {
  const { hands } = shuffleAndDeal(makeDeck(), state.seed, round, dealer, 13);
  const next: CallBridgeState = {
    ...state,
    round,
    dealer,
    phase: 'calling',
    hands: hands.map((h) => sortHand(h)),
    calls: [null, null, null, null],
    tricksWon: [0, 0, 0, 0],
    turn: nextSeat(dealer),
    trick: { leader: nextSeat(dealer), cards: [] },
    tricks: [],
  };
  return { state: next, events: [{ type: 'dealt', round, dealer }] };
}

function init(config: CallBridgeConfig, seed: string): Result {
  const base: CallBridgeState = {
    game: 'callbridge',
    config,
    seed,
    round: 0,
    dealer: 0,
    phase: 'calling',
    hands: [[], [], [], []],
    calls: [null, null, null, null],
    tricksWon: [0, 0, 0, 0],
    turn: 0,
    trick: { leader: 0, cards: [] },
    tricks: [],
    scores: [0, 0, 0, 0],
    history: [],
  };
  return startRound(base, 1, firstDealer(seed));
}

/** Cards `seat` may legally play in the current trick. */
export function legalCards(state: Pick<CallBridgeState, 'trick' | 'config'>, hand: readonly CardId[]): CardId[] {
  const { trick, config } = state;
  const led = ledSuit(trick);
  if (!led) return [...hand];
  const inSuit = hand.filter((c) => suitOf(c) === led);
  if (inSuit.length) {
    if (!config.mustBeatInSuit) return inSuit;
    const trumped = led !== TRUMP && trick.cards.some((p) => suitOf(p.card) === TRUMP);
    if (trumped) return inSuit;
    const best = Math.max(...trick.cards.filter((p) => suitOf(p.card) === led).map((p) => rankOf(p.card)));
    const higher = inSuit.filter((c) => rankOf(c) > best);
    return higher.length ? higher : inSuit;
  }
  // Void in the led suit: must over-trump if able.
  const spadesInTrick = trick.cards.filter((p) => suitOf(p.card) === TRUMP).map((p) => rankOf(p.card));
  const bestSpade = spadesInTrick.length ? Math.max(...spadesInTrick) : 0;
  const winningSpades = hand.filter((c) => suitOf(c) === TRUMP && rankOf(c) > bestSpade);
  return winningSpades.length ? winningSpades : [...hand];
}

function callRange(config: CallBridgeConfig): number[] {
  const out: number[] = [];
  for (let c = config.minCall; c <= 13; c++) out.push(c);
  return out;
}

function pendingSeats(state: CallBridgeState): Seat[] {
  return state.phase === 'calling' || state.phase === 'playing' ? [state.turn] : [];
}

function validate(state: CallBridgeState, seat: Seat, action: CallBridgeAction): string | null {
  if (action.type === 'continue') return state.phase === 'roundEnd' ? null : 'not-now';
  if (!pendingSeats(state).includes(seat)) return 'not-your-turn';
  if (action.type === 'call') {
    if (state.phase !== 'calling') return 'not-now';
    if (action.call < state.config.minCall || action.call > 13) return 'bad-call';
    return null;
  }
  if (state.phase !== 'playing') return 'not-now';
  const hand = state.hands[seat]!;
  if (!hand.includes(action.card)) return 'not-in-hand';
  if (!legalCards(state, hand).includes(action.card)) {
    const led = ledSuit(state.trick);
    return led && hand.some((c) => suitOf(c) === led) ? 'must-follow' : 'must-trump';
  }
  return null;
}

export function scoreRound(call: number, tricks: number, config: CallBridgeConfig): number {
  if (config.overtricks === 'strict') {
    const ok = tricks === call || tricks === call + 1;
    if (!ok) return -call * 10;
    return (config.bonusCall && call >= 8 ? 13 : call) * 10;
  }
  if (tricks < call) return -call * 10;
  if (config.bonusCall && call >= 8) return 130;
  return call * 10 + (tricks - call);
}

function result(state: CallBridgeState): MatchResult | null {
  if (state.phase !== 'matchEnd') return null;
  const top = Math.max(...state.scores);
  return {
    winners: SEATS.filter((s) => state.scores[s] === top),
    finalScores: state.scores.map((s) => s / 10),
  };
}

function apply(state: CallBridgeState, seat: Seat, action: CallBridgeAction): Result {
  const reason = validate(state, seat, action);
  if (reason) throw new IllegalActionError(reason);
  const events: CallBridgeEvent[] = [];

  if (action.type === 'continue') {
    return startRound(state, state.round + 1, nextSeat(state.dealer));
  }

  if (action.type === 'call') {
    const calls = [...state.calls];
    calls[seat] = action.call;
    events.push({ type: 'called', seat, call: action.call });
    const done = calls.every((c) => c !== null);
    const s: CallBridgeState = {
      ...state,
      calls,
      phase: done ? 'playing' : 'calling',
      turn: done ? state.trick.leader : nextSeat(seat),
    };
    return { state: s, events };
  }

  // play
  const hands = state.hands.map((h, i) => (i === seat ? removeCard(h, action.card) : h));
  const trick = { ...state.trick, cards: [...state.trick.cards, { seat, card: action.card }] };
  events.push({ type: 'cardPlayed', seat, card: action.card });
  let s: CallBridgeState = { ...state, hands, trick, turn: nextSeat(seat) };

  if (trick.cards.length < 4) return { state: s, events };

  const winner = trickWinner(trick, TRUMP);
  const tricksWon = [...s.tricksWon];
  tricksWon[winner]!++;
  events.push({ type: 'trickWon', seat: winner, cards: trick.cards.map((p) => p.card) });
  s = {
    ...s,
    tricksWon,
    tricks: [...s.tricks, { ...trick, winner }],
    trick: { leader: winner, cards: [] },
    turn: winner,
  };

  if (s.tricks.length < 13) return { state: s, events };

  // Round over.
  const calls = s.calls as number[];
  const deltas = SEATS.map((p) => scoreRound(calls[p]!, tricksWon[p]!, s.config));
  const scores = s.scores.map((v, i) => v + deltas[i]!);
  const history = [...s.history, { calls: [...calls], tricks: [...tricksWon], deltas }];
  const over = s.round >= s.config.rounds;
  s = { ...s, scores, history, phase: over ? 'matchEnd' : 'roundEnd' };
  events.push({ type: 'roundScored', deltas, totals: scores, tricks: [...tricksWon], calls: [...calls] });
  const res = result(s);
  if (res) events.push({ type: 'matchEnded', result: res });
  return { state: s, events };
}

function viewFor(state: CallBridgeState, seat: Seat): CallBridgeView {
  const myTurn = pendingSeats(state).includes(seat);
  return {
    game: 'callbridge',
    seat,
    config: state.config,
    phase: state.phase,
    round: state.round,
    dealer: state.dealer,
    pending: pendingSeats(state),
    hand: [...state.hands[seat]!],
    handCounts: state.hands.map((h) => h.length),
    calls: [...state.calls],
    tricksWon: [...state.tricksWon],
    turn: state.turn,
    trick: state.trick,
    tricks: state.tricks,
    scores: [...state.scores],
    history: state.history,
    legalCards: myTurn && state.phase === 'playing' ? legalCards(state, state.hands[seat]!) : [],
    legalCalls: myTurn && state.phase === 'calling' ? callRange(state.config) : [],
    result: result(state),
  };
}

/** Helper used by bots and UI: who is currently winning the trick. */
export function currentWinner(trick: CallBridgeState['trick']): Seat | null {
  return trick.cards.length ? winningPlay(trick.cards, TRUMP).seat : null;
}
