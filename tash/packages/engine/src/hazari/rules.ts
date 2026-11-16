import { makeDeck, sortHand, type CardId } from '../core/cards';
import { firstDealer, shuffleAndDeal } from '../core/deal';
import {
  IllegalActionError,
  nextSeat,
  SEATS,
  type ApplyResult,
  type MatchResult,
  type Seat,
} from '../core/types';
import { evaluate, evaluate3, evaluate4, hazariPoints } from './combos';
import type { Groups, HazariAction, HazariConfig, HazariEvent, HazariState, HazariView, ShowdownTrick } from './types';

type Result = ApplyResult<HazariState, HazariEvent>;

export const hazariDefaultConfig: HazariConfig = { targetScore: 1000 };

function startRound(state: HazariState, round: number, dealer: Seat): Result {
  const { hands } = shuffleAndDeal(makeDeck(), state.seed, round, dealer, 13);
  return {
    state: {
      ...state,
      round,
      dealer,
      phase: 'arranging',
      hands: hands.map((h) => sortHand(h)),
      arrangements: [null, null, null, null],
      showdown: null,
      roundPoints: [0, 0, 0, 0],
    },
    events: [{ type: 'dealt', round, dealer }],
  };
}

export function init(config: HazariConfig, seed: string): Result {
  const base: HazariState = {
    game: 'hazari',
    config,
    seed,
    round: 0,
    dealer: 0,
    phase: 'arranging',
    hands: [[], [], [], []],
    arrangements: [null, null, null, null],
    showdown: null,
    roundPoints: [0, 0, 0, 0],
    scores: [0, 0, 0, 0],
    history: [],
  };
  return startRound(base, 1, firstDealer(seed));
}

export function pendingSeats(state: HazariState): Seat[] {
  return state.phase === 'arranging' ? SEATS.filter((s) => state.arrangements[s] === null) : [];
}

/** Null if the four groups are a valid arrangement of `hand`, otherwise a reason code. */
export function validateGroups(hand: readonly CardId[], groups: Groups): string | null {
  const sizes = groups.map((g) => g.length).join(',');
  if (sizes !== '3,3,3,4') return 'bad-sizes';
  const all = groups.flat();
  if (new Set(all).size !== 13 || all.length !== 13 || !all.every((c) => hand.includes(c))) return 'not-your-cards';
  const [a, b, c, d] = [evaluate3(groups[0]), evaluate3(groups[1]), evaluate3(groups[2]), evaluate4(groups[3])];
  if (a.base < b.base || b.base < c.base || c.base < d.base) return 'not-descending';
  return null;
}

export function validate(state: HazariState, seat: Seat, action: HazariAction): string | null {
  if (action.type === 'continue') return state.phase === 'roundEnd' ? null : 'not-now';
  if (state.phase !== 'arranging') return 'not-now';
  if (action.type === 'unlock') return state.arrangements[seat] ? null : 'not-locked';
  if (state.arrangements[seat]) return 'already-arranged';
  return validateGroups(state.hands[seat]!, action.groups as Groups);
}

export function result(state: HazariState): MatchResult | null {
  if (state.phase !== 'matchEnd') return null;
  const top = Math.max(...state.scores);
  return { winners: SEATS.filter((s) => state.scores[s] === top), finalScores: [...state.scores] };
}

/** Play the four showdown tricks. Exact ties go to the group played later. */
export function runShowdown(arrangements: Groups[], dealer: Seat): ShowdownTrick[] {
  const tricks: ShowdownTrick[] = [];
  let leader = nextSeat(dealer);
  for (let index = 0; index < 4; index++) {
    const plays = [0, 1, 2, 3].map((k) => {
      const seat = nextSeat(leader, k);
      const cards = arrangements[seat]![index]!;
      return { seat, cards, combo: evaluate(cards) };
    });
    let best = plays[0]!;
    for (const p of plays.slice(1)) if (p.combo.full >= best.combo.full) best = p;
    const points = plays.reduce((a, p) => a + p.cards.reduce((x, c) => x + hazariPoints(c), 0), 0);
    tricks.push({
      index,
      leader,
      plays: plays.map((p) => ({ seat: p.seat, cards: p.cards, combo: p.combo.type })),
      winner: best.seat,
      points,
    });
    leader = best.seat;
  }
  return tricks;
}

export function apply(state: HazariState, seat: Seat, action: HazariAction): Result {
  const reason = validate(state, seat, action);
  if (reason) throw new IllegalActionError(reason);

  if (action.type === 'continue') return startRound(state, state.round + 1, nextSeat(state.dealer));

  if (action.type === 'unlock') {
    const arrangements = [...state.arrangements];
    arrangements[seat] = null;
    return { state: { ...state, arrangements }, events: [{ type: 'unlocked', seat }] };
  }

  const arrangements = [...state.arrangements];
  arrangements[seat] = action.groups.map((g) => [...g]) as Groups;
  const events: HazariEvent[] = [{ type: 'arranged', seat }];
  let s: HazariState = { ...state, arrangements };
  if (arrangements.some((a) => a === null)) return { state: s, events };

  const showdown = runShowdown(arrangements as Groups[], s.dealer);
  const roundPoints = [0, 0, 0, 0];
  for (const t of showdown) {
    roundPoints[t.winner]! += t.points;
    events.push({ type: 'showdownTrick', ...t });
  }
  const scores = s.scores.map((v, i) => v + roundPoints[i]!);
  const over = scores.some((v) => v >= s.config.targetScore);
  s = {
    ...s,
    showdown,
    roundPoints,
    scores,
    history: [...s.history, { points: roundPoints }],
    hands: [[], [], [], []],
    phase: over ? 'matchEnd' : 'roundEnd',
  };
  events.push({ type: 'roundScored', points: roundPoints, totals: scores });
  const res = result(s);
  if (res) events.push({ type: 'matchEnded', result: res });
  return { state: s, events };
}

export function viewFor(state: HazariState, seat: Seat): HazariView {
  const mine = state.arrangements[seat];
  return {
    game: 'hazari',
    seat,
    config: state.config,
    phase: state.phase,
    round: state.round,
    dealer: state.dealer,
    pending: pendingSeats(state),
    hand: state.phase === 'arranging' ? [...state.hands[seat]!] : [],
    handCounts: state.hands.map((h) => h.length),
    myArrangement: mine ? (mine.map((g) => [...g]) as Groups) : null,
    ready: state.arrangements.map((a) => a !== null),
    showdown: state.showdown,
    roundPoints: [...state.roundPoints],
    scores: [...state.scores],
    history: state.history,
    result: result(state),
  };
}
