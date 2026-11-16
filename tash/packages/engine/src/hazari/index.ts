import type { GameDefinition } from '../core/types';
import { hazariBot } from './bot';
import { apply, hazariDefaultConfig, init, pendingSeats, result, validate, viewFor } from './rules';
import {
  hazariActionSchema,
  hazariConfigSchema,
  type HazariAction,
  type HazariConfig,
  type HazariEvent,
  type HazariState,
  type HazariView,
} from './types';

export * from './types';
export * from './combos';
export { validateGroups, runShowdown } from './rules';
export { greedyArrangement, searchArrangement } from './bot';

export const hazari: GameDefinition<HazariState, HazariAction, HazariView, HazariConfig, HazariEvent> = {
  id: 'hazari',
  defaultConfig: hazariDefaultConfig,
  configSchema: hazariConfigSchema,
  actionSchema: hazariActionSchema,
  init,
  pendingSeats,
  validate,
  apply,
  viewFor,
  botAction: hazariBot,
  autoContinueMs: (s) => (s.phase === 'roundEnd' ? 12000 : null),
  continueAction: { type: 'continue' },
  result,
};
