import { z } from 'zod';
import type { CardId } from '../core/cards';
import type { BaseView, MatchResult, Seat } from '../core/types';
import type { ComboType } from './combos';

export const hazariConfigSchema = z.object({
  targetScore: z.number().int().min(200).max(5000),
});
export type HazariConfig = z.infer<typeof hazariConfigSchema>;

const card = z.string().max(3);
export const hazariActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('arrange'),
    groups: z.tuple([z.array(card).length(3), z.array(card).length(3), z.array(card).length(3), z.array(card).length(4)]),
  }),
  z.object({ type: z.literal('unlock') }),
  z.object({ type: z.literal('continue') }),
]);
export type HazariAction = z.infer<typeof hazariActionSchema>;
export type Groups = [CardId[], CardId[], CardId[], CardId[]];

export type HazariPhase = 'arranging' | 'roundEnd' | 'matchEnd';

export interface ShowdownPlay {
  seat: Seat;
  cards: CardId[];
  combo: ComboType;
}

export interface ShowdownTrick {
  index: number;
  leader: Seat;
  plays: ShowdownPlay[];
  winner: Seat;
  points: number;
}

export interface HazariState {
  game: 'hazari';
  config: HazariConfig;
  seed: string;
  round: number;
  dealer: Seat;
  phase: HazariPhase;
  hands: CardId[][];
  arrangements: (Groups | null)[];
  showdown: ShowdownTrick[] | null;
  roundPoints: number[];
  scores: number[];
  history: { points: number[] }[];
}

export interface HazariView extends BaseView {
  game: 'hazari';
  config: HazariConfig;
  phase: HazariPhase;
  hand: CardId[];
  handCounts: number[];
  myArrangement: Groups | null;
  ready: boolean[];
  showdown: ShowdownTrick[] | null;
  roundPoints: number[];
  scores: number[];
  history: { points: number[] }[];
  result: MatchResult | null;
}

export type HazariEvent =
  | { type: 'dealt'; round: number; dealer: Seat }
  | { type: 'arranged'; seat: Seat }
  | { type: 'unlocked'; seat: Seat }
  | ({ type: 'showdownTrick' } & ShowdownTrick)
  | { type: 'roundScored'; points: number[]; totals: number[] }
  | { type: 'matchEnded'; result: MatchResult };
