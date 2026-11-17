import type { Rng } from './rng.ts';
import { absSquare, canEnterHome, isSafeSquare, pathFor, remaining } from './rules.ts';
import { FINISHED, HOME_COLUMN, LAST_TRACK, SEATS, TRACK_LENGTH, YARD, type Difficulty, type LudoAction, type LudoView, type Seat, type TokenPos } from './types.ts';

/** Opponent tokens that could land on `square` with a single roll of 1..6. */
function threatsTo(view: LudoView, me: Seat, square: number, tokens: TokenPos[][]): number {
  if (isSafeSquare(square, view.config)) return 0;
  let n = 0;
  for (const o of SEATS) {
    if (o === me || !view.active[o]) continue;
    const enter = canEnterHome(view.config, view.captured[o]!);
    for (const p of tokens[o]!) {
      const from = absSquare(o, p);
      if (from === null) continue;
      const dist = (square - from + TRACK_LENGTH) % TRACK_LENGTH;
      if (dist < 1 || dist > 6) continue;
      // A token about to turn into its home column cannot reach squares past its turn-off.
      if (enter && p <= LAST_TRACK && p + dist > LAST_TRACK) continue;
      n++;
    }
  }
  return n;
}

/** Opponent tokens sitting 1..6 squares ahead of `square` (capture chances next turn). */
function targetsFrom(view: LudoView, me: Seat, square: number, tokens: TokenPos[][]): number {
  let n = 0;
  for (const o of SEATS) {
    if (o === me || !view.active[o]) continue;
    for (const p of tokens[o]!) {
      const at = absSquare(o, p);
      if (at === null || isSafeSquare(at, view.config)) continue;
      const dist = (at - square + TRACK_LENGTH) % TRACK_LENGTH;
      if (dist >= 1 && dist <= 6) n++;
    }
  }
  return n;
}

const travelled = (p: TokenPos) => 58 - remaining(p);

export function scoreMove(view: LudoView, token: number, hard: boolean): number {
  const me = view.seat;
  const from = view.tokens[me]![token]!;
  const path = pathFor(from, view.dice!, canEnterHome(view.config, view.captured[me]!))!;
  const to = path[path.length - 1]!;
  const after = view.tokens.map((ts) => [...ts]);
  after[me]![token] = to;

  let score = 0;
  const sq = absSquare(me, to);
  if (sq !== null && !isSafeSquare(sq, view.config)) {
    for (const o of SEATS) {
      if (o === me) continue;
      view.tokens[o]!.forEach((p, i) => {
        if (absSquare(o, p) === sq) {
          score += 80 + travelled(p);
          after[o]![i] = YARD;
        }
      });
    }
  }
  if (to === FINISHED) score += 70;
  if (from === YARD) score += 45;
  if (to >= HOME_COLUMN && from < HOME_COLUMN) score += 30;

  // Safety: leave danger, avoid walking into it. Losing an advanced token hurts more.
  const fromSq = absSquare(me, from);
  if (fromSq !== null) score += threatsTo(view, me, fromSq, view.tokens) * 22 * (1 + travelled(from) / 56);
  if (sq !== null) {
    if (isSafeSquare(sq, view.config)) score += 12;
    score -= threatsTo(view, me, sq, after) * (hard ? 26 : 20) * (1 + travelled(to) / 56);
    if (hard) score += targetsFrom(view, me, sq, after) * 6;
  }
  score += hard ? path.length * 0.6 - travelled(from) * 0.05 : travelled(to) * 0.1;
  return score;
}

/** Bot decision from the public view. */
export function botAction(view: LudoView, difficulty: Difficulty, rng: Rng): LudoAction {
  if (view.phase === 'roll') return { type: 'roll' };
  const legal = view.legal;
  if (difficulty === 'easy' || legal.length === 1) return { type: 'move', token: rng.pick(legal) };
  let best = legal[0]!;
  let bestScore = -Infinity;
  for (const t of legal) {
    const s = scoreMove(view, t, difficulty === 'hard') + rng.next() * 0.01;
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return { type: 'move', token: best };
}
