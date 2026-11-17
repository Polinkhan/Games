/** Messages exchanged between the browser and the room server. */
import type { HostUpdate } from './host.ts';
import type { Difficulty, LudoConfig, Seat } from './types.ts';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const ROOM_CODE_LENGTH = 5;
export const EMOTES = ['👍', '😂', '😮', '😡', '🔥', '🙏', '👏', '😢'] as const;
export const TURN_SECONDS = 25;

export type SeatInfo =
  | { kind: 'open' }
  | { kind: 'bot'; difficulty: Difficulty }
  | { kind: 'human'; playerId: string; name: string; connected: boolean };

export interface RoomSnapshot {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing' | 'finished';
  config: LudoConfig;
  difficulty: Difficulty;
  seats: SeatInfo[];
  you: { playerId: string; seat: Seat | null };
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

export interface ClientToServer {
  create: (msg: { name: string }, ack: (res: Ack<{ code: string }>) => void) => void;
  join: (msg: { code: string; name: string }, ack: (res: Ack) => void) => void;
  sit: (msg: { seat: number }, ack: (res: Ack) => void) => void;
  configure: (msg: { config: unknown; difficulty?: unknown }, ack: (res: Ack) => void) => void;
  start: (msg: object, ack: (res: Ack) => void) => void;
  action: (msg: { action: unknown }, ack: (res: Ack) => void) => void;
  rematch: (msg: object, ack: (res: Ack) => void) => void;
  leave: (msg: object, ack: (res: Ack) => void) => void;
  emote: (msg: { id: number }) => void;
}

export interface ServerToClient {
  room: (room: RoomSnapshot) => void;
  update: (update: HostUpdate) => void;
  emote: (msg: { seat: Seat; id: number }) => void;
  autoPlayed: (msg: { seat: Seat }) => void;
  closed: (msg: { reason: string }) => void;
}

export interface HandshakeAuth {
  playerId: string;
  token: string;
}
