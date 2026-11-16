import type { BaseEvent, BaseView, Difficulty, GameId } from '@tash/engine';

export interface SessionUpdate<V extends BaseView = BaseView> {
  view: V;
  events: BaseEvent[];
  seq: number;
  deadline: number | null;
}

export type SendResult = { ok: true } | { ok: false; reason: string };

/** The game screen only knows this interface, so solo and online share all of the UI. */
export interface GameSession {
  readonly mode: 'solo' | 'online';
  readonly gameId: GameId;
  /** Calls back with the latest update right away (if any), then with every new one. */
  subscribe(cb: (u: SessionUpdate) => void): () => void;
  send(action: unknown): Promise<SendResult>;
  /** Start a new match with the same seats (solo, or host online). */
  rematch(): Promise<SendResult>;
  leave(): void;
}

export interface PlayerInfo {
  name: string;
  kind: 'you' | 'human' | 'bot';
  connected: boolean;
  autopilot: boolean;
  difficulty?: Difficulty;
}
