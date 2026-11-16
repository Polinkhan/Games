import { createRng } from './core/rng';
import type { AnyGame, BaseEvent, Difficulty, MatchResult, Seat } from './core/types';

export interface SimulationOptions {
  difficulties?: Difficulty[];
  maxSteps?: number;
  /** Called after every applied action with the new state and its events. */
  onStep?: (state: unknown, events: BaseEvent[], seat: Seat, action: unknown) => void;
}

/** Play a whole match bot-vs-bot. Throws if any bot move is illegal or the match never ends. */
export function simulateMatch(
  game: AnyGame,
  config: unknown,
  seed: string,
  opts: SimulationOptions = {},
): { state: unknown; result: MatchResult; steps: number } {
  const difficulties = opts.difficulties ?? ['normal', 'normal', 'normal', 'normal'];
  const rng = createRng(`${seed}:bots`);
  let { state, events } = game.init(config, seed);
  opts.onStep?.(state, events, 0, null);
  const maxSteps = opts.maxSteps ?? 20000;
  for (let step = 0; step < maxSteps; step++) {
    const res = game.result(state);
    if (res) return { state, result: res, steps: step };
    const pending = game.pendingSeats(state);
    let seat: Seat;
    let action: unknown;
    if (pending.length === 0) {
      if (game.autoContinueMs(state) === null) throw new Error('game stuck: nobody pending and no auto-continue');
      seat = 0;
      action = game.continueAction;
    } else {
      seat = pending[0]!;
      action = game.botAction(game.viewFor(state, seat), difficulties[seat]!, rng);
    }
    const reason = game.validate(state, seat, action);
    if (reason) throw new Error(`bot made illegal move (${reason}): ${JSON.stringify(action)}`);
    ({ state, events } = game.apply(state, seat, action));
    opts.onStep?.(state, events, seat, action);
  }
  throw new Error('match did not finish');
}
