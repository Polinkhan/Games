import { createRng } from './rng.ts';
import {
  FINISHED,
  HOME_COLUMN,
  IllegalActionError,
  LAST_TRACK,
  SEATS,
  TRACK_LENGTH,
  YARD,
  type LudoAction,
  type LudoConfig,
  type LudoEvent,
  type LudoState,
  type LudoView,
  type MatchResult,
  type Seat,
  type TokenPos,
} from './types.ts';

export interface ApplyResult {
  state: LudoState;
  events: LudoEvent[];
}

export const defaultConfig: LudoConfig = { players: 4, safeStars: true, threeSixes: true, captureToEnterHome: false };

/** Accepts untrusted input (from the network or storage) and returns a valid config. */
export function parseConfig(raw: unknown): LudoConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof LudoConfig) => (typeof c[k] === 'boolean' ? (c[k] as boolean) : (defaultConfig[k] as boolean));
  return {
    players: c.players === 2 ? 2 : 4,
    safeStars: bool('safeStars'),
    threeSixes: bool('threeSixes'),
    captureToEnterHome: bool('captureToEnterHome'),
  };
}

export function parseAction(raw: unknown): LudoAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.type === 'roll') return { type: 'roll' };
  if (a.type === 'move' && Number.isInteger(a.token) && (a.token as number) >= 0 && (a.token as number) <= 3) {
    return { type: 'move', token: a.token as number };
  }
  return null;
}

export function activeSeats(config: LudoConfig): boolean[] {
  return config.players === 2 ? [true, false, true, false] : [true, true, true, true];
}

/** Turns go clockwise around the board: seat 0 (bottom-left), 1 (top-left), 2 (top-right), 3 (bottom-right). */
export function nextActive(active: boolean[], seat: Seat): Seat {
  for (let k = 1; k <= 4; k++) {
    const s = ((seat + k) % 4) as Seat;
    if (active[s]) return s;
  }
  return seat;
}

/** Absolute track square (0..51) of a token, or null when it is in the yard, home column or finished. */
export function absSquare(seat: Seat, pos: TokenPos): number | null {
  if (pos < 0 || pos >= TRACK_LENGTH) return null;
  return (seat * 13 + pos) % TRACK_LENGTH;
}

export function isSafeSquare(abs: number, config: LudoConfig): boolean {
  if (abs % 13 === 0) return true; // start squares
  return config.safeStars && abs % 13 === 8;
}

/** May this seat's tokens turn into the home column? */
export function canEnterHome(config: LudoConfig, captured: boolean): boolean {
  return !config.captureToEnterHome || captured;
}

/** One step forward from `pos` (pos must be on the board, not in the yard or finished). */
export function stepFrom(pos: TokenPos, enterHome: boolean): TokenPos {
  if (pos === LAST_TRACK) return enterHome ? HOME_COLUMN : LAST_TRACK + 1;
  if (pos === TRACK_LENGTH - 1) return 0;
  return pos + 1;
}

/** The squares a token passes through for a roll, ending at its destination; null if the move is impossible. */
export function pathFor(pos: TokenPos, roll: number, enterHome: boolean): TokenPos[] | null {
  if (pos === FINISHED) return null;
  if (pos === YARD) return roll === 6 ? [0] : null;
  const path: TokenPos[] = [];
  let p = pos;
  for (let i = 0; i < roll; i++) {
    if (p === FINISHED) return null; // must land exactly
    p = stepFrom(p, enterHome);
    path.push(p);
  }
  return path;
}

/** Steps a token still has to travel to finish (the yard counts as one more than the start square). */
export function remaining(pos: TokenPos): number {
  if (pos === YARD) return 58;
  if (pos >= HOME_COLUMN) return FINISHED - pos;
  if (pos === TRACK_LENGTH - 1) return 57;
  return 56 - pos;
}

export function legalTokens(state: Pick<LudoState, 'tokens' | 'captured' | 'config'>, seat: Seat, roll: number): number[] {
  const enter = canEnterHome(state.config, state.captured[seat]!);
  return state.tokens[seat]!.flatMap((pos, i) => (pathFor(pos, roll, enter) ? [i] : []));
}

export function init(rawConfig: LudoConfig, seed: string): ApplyResult {
  const config = parseConfig(rawConfig);
  const active = activeSeats(config);
  const choices = SEATS.filter((s) => active[s]);
  const first = choices[createRng(`${seed}:first`).int(choices.length)]!;
  const state: LudoState = {
    config,
    seed,
    active,
    phase: 'roll',
    turn: first,
    tokens: SEATS.map(() => [YARD, YARD, YARD, YARD]),
    captured: [false, false, false, false],
    sixes: 0,
    rolls: 0,
    lastRoll: null,
    dice: null,
    result: null,
  };
  return { state, events: [] };
}

export function pendingSeat(state: LudoState): Seat | null {
  return state.phase === 'matchEnd' ? null : state.turn;
}

export function validate(state: LudoState, seat: Seat, action: LudoAction): string | null {
  if (state.phase === 'matchEnd') return 'not-now';
  if (seat !== state.turn) return 'not-your-turn';
  if (action.type === 'roll') return state.phase === 'roll' ? null : 'not-now';
  if (state.phase !== 'move' || state.dice === null) return 'not-now';
  return legalTokens(state, seat, state.dice).includes(action.token) ? null : 'cannot-move';
}

function computeResult(state: LudoState, winner: Seat): MatchResult {
  const home = state.tokens.map((ts) => ts.filter((p) => p === FINISHED).length);
  const travelled = state.tokens.map((ts) => ts.reduce((a, p) => a + (58 - remaining(p)), 0));
  const ranking = SEATS.filter((s) => state.active[s]).sort((a, b) =>
    a === winner ? -1 : b === winner ? 1 : home[b]! - home[a]! || travelled[b]! - travelled[a]!,
  );
  return { winner, ranking, home };
}

function passTurn(state: LudoState, events: LudoEvent[], reason: 'noMove' | 'threeSixes' | 'done'): LudoState {
  const next = nextActive(state.active, state.turn);
  events.push({ type: 'turnPassed', seat: state.turn, next, reason });
  return { ...state, phase: 'roll', turn: next, sixes: 0, dice: null };
}

function doMove(state: LudoState, seat: Seat, token: number, events: LudoEvent[]): LudoState {
  const roll = state.dice!;
  const from = state.tokens[seat]![token]!;
  const path = pathFor(from, roll, canEnterHome(state.config, state.captured[seat]!))!;
  const to = path[path.length - 1]!;
  const tokens = state.tokens.map((ts) => [...ts]);
  tokens[seat]![token] = to;
  events.push({ type: 'moved', seat, token, from, to, path });

  let capturedAny = false;
  const square = absSquare(seat, to);
  if (square !== null && !isSafeSquare(square, state.config)) {
    for (const other of SEATS) {
      if (other === seat) continue;
      tokens[other]!.forEach((p, i) => {
        if (absSquare(other, p) === square) {
          tokens[other]![i] = YARD;
          capturedAny = true;
          events.push({ type: 'captured', seat, victim: other, token: i });
        }
      });
    }
  }
  const captured = capturedAny ? state.captured.map((c, i) => c || i === seat) : state.captured;
  const home = to === FINISHED;
  if (home) events.push({ type: 'tokenHome', seat, token });

  let s: LudoState = { ...state, tokens, captured, dice: null };
  if (tokens[seat]!.every((p) => p === FINISHED)) {
    const result = computeResult(s, seat);
    s = { ...s, phase: 'matchEnd', result };
    events.push({ type: 'matchEnded', result });
    return s;
  }
  if (roll === 6 || capturedAny || home) {
    // Extra roll. Only consecutive sixes count towards the three-sixes rule.
    return { ...s, phase: 'roll', sixes: roll === 6 ? s.sixes : 0 };
  }
  return passTurn(s, events, 'done');
}

/** Apply a legal action. Throws on illegal input. Never mutates `state`. */
export function apply(state: LudoState, seat: Seat, action: LudoAction): ApplyResult {
  const reason = validate(state, seat, action);
  if (reason) throw new IllegalActionError(reason);
  const events: LudoEvent[] = [];

  if (action.type === 'move') return { state: doMove(state, seat, action.token, events), events };

  const n = state.rolls + 1;
  const value = createRng(`${state.seed}:roll:${n}`).int(6) + 1;
  events.push({ type: 'rolled', seat, value, n });
  const sixes = value === 6 ? state.sixes + 1 : 0;
  const s: LudoState = { ...state, rolls: n, lastRoll: { seat, value, n }, sixes, dice: value };

  if (value === 6 && sixes >= 3 && s.config.threeSixes) return { state: passTurn(s, events, 'threeSixes'), events };

  const legal = legalTokens(s, seat, value);
  if (legal.length === 0) {
    // A six with nothing to move still earns another roll.
    if (value === 6) return { state: { ...s, phase: 'roll', dice: null }, events };
    return { state: passTurn(s, events, 'noMove'), events };
  }
  // If every legal choice is the same move (e.g. bringing out any yard token), play it automatically.
  const froms = new Set(legal.map((i) => s.tokens[seat]![i]));
  if (froms.size === 1) return { state: doMove({ ...s, phase: 'move' }, seat, legal[0]!, events), events };
  return { state: { ...s, phase: 'move' }, events };
}

/** Everything is public in Ludo except the seed, which would let a client predict the dice. */
export function viewFor(state: LudoState, seat: Seat): LudoView {
  return {
    seat,
    config: state.config,
    active: [...state.active],
    phase: state.phase,
    turn: state.turn,
    tokens: state.tokens.map((ts) => [...ts]),
    captured: [...state.captured],
    dice: state.dice,
    lastRoll: state.lastRoll,
    legal: state.phase === 'move' && seat === state.turn && state.dice !== null ? legalTokens(state, seat, state.dice) : [],
    result: state.result,
  };
}
