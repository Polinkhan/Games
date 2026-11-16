import type { GameDefinition } from '../core/types';
import { twentyNineBot } from './bot';
import { twentyNineHardBot } from './hard';
import { apply, init, pendingSeats, result, twentyNineDefaultConfig, validate, viewFor } from './rules';
import {
  twentyNineActionSchema,
  twentyNineConfigSchema,
  type TwentyNineAction,
  type TwentyNineConfig,
  type TwentyNineEvent,
  type TwentyNineState,
  type TwentyNineView,
} from './types';

export * from './types';
export { power as tnPower, points as tnPoints, TN_RANKS, MIN_BID, MAX_BID } from './rules';

export const twentyNine: GameDefinition<
  TwentyNineState,
  TwentyNineAction,
  TwentyNineView,
  TwentyNineConfig,
  TwentyNineEvent
> = {
  id: 'twentynine',
  defaultConfig: twentyNineDefaultConfig,
  configSchema: twentyNineConfigSchema,
  actionSchema: twentyNineActionSchema,
  init,
  pendingSeats,
  validate,
  apply,
  viewFor,
  botAction: (view, difficulty, rng) =>
    difficulty === 'hard' ? twentyNineHardBot(view, rng) : twentyNineBot(view, difficulty, rng),
  autoContinueMs: (s) => (s.phase === 'roundEnd' ? 8000 : null),
  continueAction: { type: 'continue' },
  result,
};
