import type { ZodType } from 'zod';
import type { CardId } from './cards';
import type { Rng } from './rng';

export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export type GameId = 'callbridge' | 'twentynine' | 'hazari';
export const GAME_IDS: readonly GameId[] = ['callbridge', 'twentynine', 'hazari'];

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Play and deal go counter-clockwise: after seat s comes seat s + 1. */
export function nextSeat(s: Seat, step = 1): Seat {
  return (((s + step) % 4) + 4) % 4 as Seat;
}

export function partnerOf(s: Seat): Seat {
  return nextSeat(s, 2);
}

/** Twenty-nine teams: seats 0 & 2 are team 0, seats 1 & 3 are team 1. */
export function teamOf(s: Seat): 0 | 1 {
  return (s % 2) as 0 | 1;
}

export interface PlayedCard {
  seat: Seat;
  card: CardId;
}

export interface Trick {
  leader: Seat;
  cards: PlayedCard[];
}

export interface CompletedTrick extends Trick {
  winner: Seat;
}

/** All events are public information: they never carry a card that some seat may not see. */
export interface BaseEvent {
  type: string;
}

export interface MatchResult {
  /** Winning seats (for team games, both partners). Ties share the win. */
  winners: Seat[];
  /** Final score per seat, in display units. */
  finalScores: number[];
}

export interface ApplyResult<State, Event extends BaseEvent> {
  state: State;
  events: Event[];
}

/** Every view carries these fields so shared code (sessions, server, director) can rely on them. */
export interface BaseView {
  game: GameId;
  seat: Seat;
  phase: string;
  round: number;
  dealer: Seat;
  /** Seats whose input the game is waiting for. */
  pending: Seat[];
  result: MatchResult | null;
}

export interface GameDefinition<State, Action, View extends BaseView, Config, Event extends BaseEvent = BaseEvent> {
  id: GameId;
  defaultConfig: Config;
  configSchema: ZodType<Config>;
  actionSchema: ZodType<Action>;

  /** Start a match. `seed` makes every shuffle reproducible. */
  init(config: Config, seed: string): ApplyResult<State, Event>;

  /** Seats whose input the game is waiting for (all four during Hazari arranging). */
  pendingSeats(state: State): Seat[];

  /** Return null if the action is legal for this seat, otherwise a short reason code. */
  validate(state: State, seat: Seat, action: Action): string | null;

  /** Apply a legal action. Throws on illegal input. Never mutates `state`. */
  apply(state: State, seat: Seat, action: Action): ApplyResult<State, Event>;

  /** What this seat may see. */
  viewFor(state: State, seat: Seat): View;

  /** Bot decision made from the view only, so a bot can never see hidden cards. */
  botAction(view: View, difficulty: Difficulty, rng: Rng): Action;

  /**
   * When the game is paused between rounds, the delay after which the host
   * should send `continueAction` automatically. Null otherwise.
   */
  autoContinueMs(state: State): number | null;
  continueAction: Action;

  result(state: State): MatchResult | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameDefinition<any, any, any, any, any>;

export class IllegalActionError extends Error {
  constructor(public readonly reason: string) {
    super(`illegal action: ${reason}`);
  }
}
