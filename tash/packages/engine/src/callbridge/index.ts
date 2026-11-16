import type { GameDefinition } from '../core/types';
import { callBridgeBot } from './bot';
import { callBridgeHardBot } from './hard';
import { apply, callBridgeDefaultConfig, init, pendingSeats, result, validate, viewFor } from './rules';
import {
  callBridgeActionSchema,
  callBridgeConfigSchema,
  type CallBridgeAction,
  type CallBridgeConfig,
  type CallBridgeEvent,
  type CallBridgeState,
  type CallBridgeView,
} from './types';

export * from './types';
export { estimateTricks } from './bot';
export { legalCards, scoreRound, currentWinner, TRUMP as CALLBRIDGE_TRUMP } from './rules';

export const callBridge: GameDefinition<
  CallBridgeState,
  CallBridgeAction,
  CallBridgeView,
  CallBridgeConfig,
  CallBridgeEvent
> = {
  id: 'callbridge',
  defaultConfig: callBridgeDefaultConfig,
  configSchema: callBridgeConfigSchema,
  actionSchema: callBridgeActionSchema,
  init,
  pendingSeats,
  validate,
  apply,
  viewFor,
  botAction: (view, difficulty, rng) =>
    difficulty === 'hard' ? callBridgeHardBot(view, rng) : callBridgeBot(view, difficulty, rng),
  autoContinueMs: (s) => (s.phase === 'roundEnd' ? 8000 : null),
  continueAction: { type: 'continue' },
  result,
};
