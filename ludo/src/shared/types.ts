export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export interface LudoConfig {
  /** 2 players use the diagonal colours (seats 0 and 2). */
  players: 2 | 4;
  /** Star squares (8 squares after each start) are safe from capture. Start squares are always safe. */
  safeStars: boolean;
  /** Rolling three 6s in a row ends the turn without moving. */
  threeSixes: boolean;
  /** A player must capture at least one token before their tokens may enter the home column. */
  captureToEnterHome: boolean;
}

export type LudoAction = { type: 'roll' } | { type: 'move'; token: number };

/**
 * Token position, relative to its owner:
 * -1 = in the yard, 0..51 = on the shared track (0 is the owner's start square; 51 is only
 * reachable while the capture-before-home rule keeps a token circling), 52..56 = the owner's
 * home column, 57 = finished.
 */
export type TokenPos = number;
export const YARD = -1;
export const LAST_TRACK = 50;
export const HOME_COLUMN = 52;
export const FINISHED = 57;
export const TRACK_LENGTH = 52;

export type LudoPhase = 'roll' | 'move' | 'matchEnd';

export interface LudoRoll {
  seat: Seat;
  value: number;
  /** Increments on every roll so the client can replay the dice animation. */
  n: number;
}

export interface MatchResult {
  winner: Seat;
  /** Active seats, best first (tokens home, then distance travelled). */
  ranking: Seat[];
  /** Tokens home per seat. */
  home: number[];
}

export interface LudoState {
  config: LudoConfig;
  seed: string;
  active: boolean[];
  phase: LudoPhase;
  turn: Seat;
  tokens: TokenPos[][];
  /** Whether each seat has captured a token (for the capture-before-home rule). */
  captured: boolean[];
  /** Consecutive 6s in the current turn. */
  sixes: number;
  rolls: number;
  lastRoll: LudoRoll | null;
  /** The dice value waiting to be used in the 'move' phase. */
  dice: number | null;
  result: MatchResult | null;
}

export interface LudoView {
  seat: Seat;
  config: LudoConfig;
  active: boolean[];
  phase: LudoPhase;
  turn: Seat;
  tokens: TokenPos[][];
  captured: boolean[];
  dice: number | null;
  lastRoll: LudoRoll | null;
  /** Tokens this seat may move now (empty unless it is this seat's move). */
  legal: number[];
  result: MatchResult | null;
}

export type LudoEvent =
  | { type: 'rolled'; seat: Seat; value: number; n: number }
  | { type: 'moved'; seat: Seat; token: number; from: TokenPos; to: TokenPos; path: TokenPos[] }
  | { type: 'captured'; seat: Seat; victim: Seat; token: number }
  | { type: 'tokenHome'; seat: Seat; token: number }
  | { type: 'turnPassed'; seat: Seat; next: Seat; reason: 'noMove' | 'threeSixes' | 'done' }
  | { type: 'matchEnded'; result: MatchResult };

export class IllegalActionError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`illegal action: ${reason}`);
    this.reason = reason;
  }
}
