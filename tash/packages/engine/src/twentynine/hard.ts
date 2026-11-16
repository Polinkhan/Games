import { makeDeck, suitOf } from '../core/cards';
import { now, readTricks, sampleHands } from '../core/knowledge';
import { createRng, type Rng } from '../core/rng';
import { teamOf, type Seat } from '../core/types';
import { twentyNineBot } from './bot';
import { apply, TN_RANKS, viewFor } from './rules';
import type { TwentyNineAction, TwentyNineState, TwentyNineView } from './types';

const BUDGET_MS = 150;

/**
 * Hard bot for the play phase: determinised sampling over the unseen cards.
 * Only used when this seat knows the trump suit (bidder, or after the reveal);
 * otherwise it falls back to the normal heuristics.
 */
export function twentyNineHardBot(view: TwentyNineView, rng: Rng): TwentyNineAction {
  const candidates: TwentyNineAction[] = view.legalCards.map((card) => ({ type: 'play', card }));
  if (view.canReveal) candidates.push({ type: 'reveal' });
  if (view.phase !== 'playing' || !view.trumpSuit || candidates.length <= 1) {
    return twentyNineBot(view, 'normal', rng);
  }
  const me = view.seat;
  const { played, voids } = readTricks(view.tricks, view.trick);
  // A player who asked for trump and then did not play one has none left.
  const t = view.trick;
  if (view.revealedBy !== null && view.revealedBy !== me) {
    const p = t.cards.find((c) => c.seat === view.revealedBy);
    if (p && suitOf(p.card) !== view.trumpSuit) voids[view.revealedBy]!.add(view.trumpSuit);
  }
  const unseen = makeDeck(TN_RANKS).filter((c) => !played.has(c) && !view.hand.includes(c));
  const totals = candidates.map(() => 0);
  const start = now();
  let samples = 0;
  while (samples < 80 && (samples < 8 || now() - start < BUDGET_MS)) {
    const hands = sampleHands(unseen, view.handCounts, voids, me, view.hand, rng);
    const base: TwentyNineState = {
      game: 'twentynine',
      config: view.config,
      seed: 'sim',
      round: view.round,
      dealer: view.dealer,
      phase: 'playing',
      hands,
      stock: [[], [], [], []],
      turn: me,
      bids: view.bids,
      passed: view.passed,
      highBid: view.highBid,
      highBidder: view.highBidder,
      bidder: view.bidder,
      bid: view.bid,
      target: view.target,
      trumpSuit: view.trumpSuit,
      trumpRevealed: view.trumpRevealed,
      revealedBy: view.revealedBy,
      mustTrump: view.mustTrump,
      pair: view.pair,
      trick: view.trick,
      tricks: view.tricks,
      teamPoints: view.teamPoints,
      gamePoints: view.gamePoints,
      history: view.history,
    };
    candidates.forEach((a, i) => (totals[i]! += playout(base, me, a, samples)));
    samples++;
  }
  let best = 0;
  totals.forEach((v, i) => { if (v > totals[best]!) best = i; });
  return candidates[best]!;
}

function playout(state: TwentyNineState, me: Seat, action: TwentyNineAction, sample: number): number {
  const rng = createRng(`tn-playout:${sample}`);
  let s = apply(state, me, action).state;
  while (s.phase === 'playing') {
    const seat = s.turn;
    s = apply(s, seat, twentyNineBot(viewFor(s, seat), 'normal', rng)).state;
  }
  const myTeam = teamOf(me);
  const bidderTeam = teamOf(s.bidder!);
  const success = s.teamPoints[bidderTeam] >= s.target!;
  const outcome = (myTeam === bidderTeam) === success ? 1 : -1;
  return outcome * 20 + s.teamPoints[myTeam];
}

