import { makeDeck, type CardId } from '../core/cards';
import { now, readTricks, sampleHands } from '../core/knowledge';
import { createRng, type Rng } from '../core/rng';
import { SEATS, type Seat } from '../core/types';
import { callBridgeBot } from './bot';
import { apply, scoreRound, viewFor } from './rules';
import type { CallBridgeAction, CallBridgeState, CallBridgeView } from './types';

const BUDGET_MS = 150;

/**
 * Hard bot: determinised sampling. Deal the unseen cards at random consistent with
 * what is known, play each candidate out with the normal heuristics, and keep the
 * card with the best average score for this seat relative to the others.
 */
export function callBridgeHardBot(view: CallBridgeView, rng: Rng): CallBridgeAction {
  if (view.phase !== 'playing' || view.legalCards.length <= 1) return callBridgeBot(view, 'normal', rng);
  const me = view.seat;
  const { played, voids } = readTricks(view.tricks, view.trick);
  const unseen = makeDeck().filter((c) => !played.has(c) && !view.hand.includes(c));
  const totals = new Map<CardId, number>(view.legalCards.map((c) => [c, 0]));
  const start = now();
  let samples = 0;
  while (samples < 80 && (samples < 8 || now() - start < BUDGET_MS)) {
    const hands = sampleHands(unseen, view.handCounts, voids, me, view.hand, rng);
    const base: CallBridgeState = {
      game: 'callbridge',
      config: view.config,
      seed: 'sim',
      round: view.round,
      dealer: view.dealer,
      phase: 'playing',
      hands,
      calls: view.calls,
      tricksWon: view.tricksWon,
      turn: me,
      trick: view.trick,
      tricks: view.tricks,
      scores: view.scores,
      history: view.history,
    };
    for (const card of view.legalCards) {
      totals.set(card, totals.get(card)! + playout(base, me, card, samples));
    }
    samples++;
  }
  let best = view.legalCards[0]!;
  for (const c of view.legalCards) if (totals.get(c)! > totals.get(best)!) best = c;
  return { type: 'play', card: best };
}

function playout(state: CallBridgeState, me: Seat, card: CardId, sample: number): number {
  const rng = createRng(`playout:${sample}`);
  let s = apply(state, me, { type: 'play', card }).state;
  while (s.phase === 'playing') {
    const seat = s.turn;
    s = apply(s, seat, callBridgeBot(viewFor(s, seat), 'normal', rng)).state;
  }
  const calls = s.calls as number[];
  const score = (p: Seat) => scoreRound(calls[p]!, s.tricksWon[p]!, s.config);
  const mine = score(me);
  const others = SEATS.filter((p) => p !== me).reduce((a: number, p) => a + score(p), 0) / 3;
  return mine - others * 0.3;
}
