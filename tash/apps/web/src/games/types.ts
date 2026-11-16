import type { ComponentType } from 'react';
import type { BaseView } from '@tash/engine';
import type { StepFn } from '../director/useDirector';
import type { PlayerInfo } from '../session/types';
import type { TableProps } from './common';

export interface ConfigEditorProps<C = unknown> {
  config: C;
  onChange: (config: C) => void;
  disabled?: boolean;
}

/** Everything game-specific the shared screens need. */
export interface GameUi<V extends BaseView = BaseView> {
  steps: (players: PlayerInfo[]) => StepFn<V>;
  Table: ComponentType<TableProps<V>>;
  /** Round summary content (inside the round-end sheet). */
  Summary: ComponentType<{ view: V; players: PlayerInfo[] }>;
  /** Compact standings (score sheet and desktop side panel). */
  Scores: ComponentType<{ view: V; players: PlayerInfo[] }>;
  ConfigEditor: ComponentType<ConfigEditorProps>;
  /** Header text such as "Round 2 of 5". */
  progress: (view: V, t: (k: string, p?: Record<string, string | number>) => string) => string;
}
