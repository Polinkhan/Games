import { z } from 'zod';
import type { CardId } from '../core/cards';
import type { BaseView, CompletedTrick, MatchResult, Seat, Trick } from '../core/types';

export const callBridgeConfigSchema = z.object({
  rounds: z.number().int().min(1).max(20),
  minCall: z.number().int().min(1).max(4),
  mustBeatInSuit: z.boolean(),
  overtricks: z.enum(['strict', 'tenths']),
  bonusCall: z.boolean(),
});
export type CallBridgeConfig = z.infer<typeof callBridgeConfigSchema>;

export const callBridgeActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('call'), call: z.number().int().min(1).max(13) }),
  z.object({ type: z.literal('play'), card: z.string().max(3) }),
  z.object({ type: z.literal('continue') }),
]);
export type CallBridgeAction = z.infer<typeof callBridgeActionSchema>;

export type CallBridgePhase = 'calling' | 'playing' | 'roundEnd' | 'matchEnd';

export interface CallBridgeRoundRecord {
  calls: number[];
  tricks: number[];
  /** Score change per seat, in tenths of a point. */
  deltas: number[];
}

export interface CallBridgeState {
  game: 'callbridge';
  config: CallBridgeConfig;
  seed: string;
  round: number;
  dealer: Seat;
  phase: CallBridgePhase;
  hands: CardId[][];
  calls: (number | null)[];
  tricksWon: number[];
  turn: Seat;
  trick: Trick;
  tricks: CompletedTrick[];
  /** Running totals in tenths of a point. */
  scores: number[];
  history: CallBridgeRoundRecord[];
}

export interface CallBridgeView extends BaseView {
  game: 'callbridge';
  config: CallBridgeConfig;
  phase: CallBridgePhase;
  hand: CardId[];
  handCounts: number[];
  calls: (number | null)[];
  tricksWon: number[];
  turn: Seat;
  trick: Trick;
  tricks: CompletedTrick[];
  scores: number[];
  history: CallBridgeRoundRecord[];
  /** Cards this seat may play now (empty if not playing). */
  legalCards: CardId[];
  /** Calls this seat may make now (empty if not calling). */
  legalCalls: number[];
  result: MatchResult | null;
}

export type CallBridgeEvent =
  | { type: 'dealt'; round: number; dealer: Seat }
  | { type: 'called'; seat: Seat; call: number }
  | { type: 'cardPlayed'; seat: Seat; card: CardId }
  | { type: 'trickWon'; seat: Seat; cards: CardId[] }
  | { type: 'roundScored'; deltas: number[]; totals: number[]; tricks: number[]; calls: number[] }
  | { type: 'matchEnded'; result: MatchResult };
