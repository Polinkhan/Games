/** Messages exchanged between the web client and the multiplayer server. */
import { z } from 'zod';
import type { BaseEvent, BaseView, Difficulty, GameId, Seat } from './core/types';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const ROOM_CODE_LENGTH = 6;

const gameId = z.enum(['callbridge', 'twentynine', 'hazari']);
const seat = z.number().int().min(0).max(3);
const difficulty = z.enum(['easy', 'normal', 'hard']);
export const playerName = z.string().trim().min(1).max(20);
export const roomCode = z.string().trim().toUpperCase().length(ROOM_CODE_LENGTH);

export const EMOTES = ['👍', '😂', '😮', '😡', '🔥', '🙏', '👏', '😢'] as const;
export const TURN_SECONDS = [0, 15, 30, 60] as const;

export const clientMessages = {
  'room:create': z.object({ gameId, name: playerName }),
  'room:join': z.object({ code: roomCode, name: playerName }),
  'room:sit': z.object({ seat }),
  'room:setSeat': z.object({ seat, slot: z.enum(['open', 'bot']), difficulty: difficulty.optional() }),
  'room:config': z.object({ config: z.unknown(), turnSeconds: z.number().int().refine((n) => (TURN_SECONDS as readonly number[]).includes(n)).optional() }),
  'room:start': z.object({}),
  'room:rematch': z.object({}),
  'room:leave': z.object({}),
  'room:emote': z.object({ id: z.number().int().min(0).max(EMOTES.length - 1) }),
  'game:action': z.object({ action: z.unknown(), seq: z.number().int() }),
};
export type ClientMessage = keyof typeof clientMessages;
export type ClientPayload<K extends ClientMessage> = z.infer<(typeof clientMessages)[K]>;

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

export type SeatInfo =
  | { kind: 'open' }
  | { kind: 'bot'; difficulty: Difficulty }
  | { kind: 'human'; playerId: string; name: string; connected: boolean; autopilot: boolean };

export interface RoomSnapshot {
  code: string;
  gameId: GameId;
  config: unknown;
  turnSeconds: number;
  hostPlayerId: string;
  phase: 'lobby' | 'playing' | 'finished';
  seats: SeatInfo[];
  /** Players who joined mid-round and will take a bot seat at the end of the round. */
  waiting: { playerId: string; name: string }[];
  you: { playerId: string; seat: Seat | null };
}

export interface GameUpdateMessage {
  view: BaseView;
  events: BaseEvent[];
  seq: number;
  deadline: number | null;
}

export interface ServerToClient {
  'room:state': (room: RoomSnapshot) => void;
  'game:update': (update: GameUpdateMessage) => void;
  'room:emote': (msg: { seat: Seat; id: number }) => void;
  'game:autoPlayed': (msg: { seat: Seat }) => void;
  'room:closed': (msg: { reason: string }) => void;
}

export interface HandshakeAuth {
  playerId: string;
  token: string;
}
