import { z } from 'zod';
import type { CardId, Suit } from '../core/cards';
import type { BaseView, CompletedTrick, MatchResult, Seat, Trick } from '../core/types';

export const twentyNineConfigSchema = z.object({
  lastTrickPoint: z.boolean(),
  pairEnabled: z.boolean(),
  targetGamePoints: z.number().int().min(1).max(12),
});
export type TwentyNineConfig = z.infer<typeof twentyNineConfigSchema>;

const suit = z.enum(['S', 'H', 'D', 'C']);

export const twentyNineActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bid'), bid: z.number().int().min(16).max(28) }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('trump'), suit }),
  z.object({ type: z.literal('play'), card: z.string().max(3) }),
  /** Ask for trump (or, for the bidder, reveal it) when unable to follow suit. */
  z.object({ type: z.literal('reveal') }),
  z.object({ type: z.literal('continue') }),
]);
export type TwentyNineAction = z.infer<typeof twentyNineActionSchema>;

export type TwentyNinePhase = 'bidding' | 'chooseTrump' | 'playing' | 'roundEnd' | 'matchEnd';

export interface BidEntry {
  seat: Seat;
  bid: number | null; // null = pass
}

export interface TwentyNineTrick extends CompletedTrick {
  points: number;
}

export interface TwentyNineRoundRecord {
  bidder: Seat;
  bid: number;
  target: number;
  trump: Suit;
  teamPoints: [number, number];
  /** Game-point change per team. */
  deltas: [number, number];
}

export interface TwentyNineState {
  game: 'twentynine';
  config: TwentyNineConfig;
  seed: string;
  round: number;
  dealer: Seat;
  phase: TwentyNinePhase;
  hands: CardId[][];
  /** Second half of the deal, handed out after trump is chosen. */
  stock: CardId[][];
  turn: Seat;
  bids: BidEntry[];
  passed: boolean[];
  highBid: number | null;
  highBidder: Seat | null;
  bidder: Seat | null;
  bid: number | null;
  target: number | null;
  trumpSuit: Suit | null;
  trumpRevealed: boolean;
  revealedBy: Seat | null;
  /** Seat that just asked for trump and must play a trump if they hold one. */
  mustTrump: Seat | null;
  pair: { seat: Seat; team: 0 | 1 } | null;
  trick: Trick;
  tricks: TwentyNineTrick[];
  teamPoints: [number, number];
  gamePoints: [number, number];
  history: TwentyNineRoundRecord[];
}

export interface TwentyNineView extends BaseView {
  game: 'twentynine';
  config: TwentyNineConfig;
  phase: TwentyNinePhase;
  hand: CardId[];
  handCounts: number[];
  turn: Seat;
  bids: BidEntry[];
  passed: boolean[];
  highBid: number | null;
  highBidder: Seat | null;
  bidder: Seat | null;
  bid: number | null;
  target: number | null;
  /** Visible to the bidder from the moment it is chosen; to everyone else only once revealed. */
  trumpSuit: Suit | null;
  trumpChosen: boolean;
  trumpRevealed: boolean;
  revealedBy: Seat | null;
  mustTrump: Seat | null;
  pair: { seat: Seat; team: 0 | 1 } | null;
  trick: Trick;
  tricks: TwentyNineTrick[];
  teamPoints: [number, number];
  gamePoints: [number, number];
  history: TwentyNineRoundRecord[];
  legalCards: CardId[];
  legalBids: number[];
  canPass: boolean;
  canReveal: boolean;
  result: MatchResult | null;
}

export type TwentyNineEvent =
  | { type: 'dealt'; round: number; dealer: Seat; count: number }
  | { type: 'bidPlaced'; seat: Seat; bid: number | null }
  | { type: 'bidWon'; seat: Seat; bid: number }
  | { type: 'trumpChosen'; seat: Seat }
  | { type: 'trumpRevealed'; suit: Suit; bySeat: Seat }
  | { type: 'cardPlayed'; seat: Seat; card: CardId }
  | { type: 'trickWon'; seat: Seat; cards: CardId[]; points: number }
  | { type: 'pairDeclared'; seat: Seat; team: 0 | 1; target: number }
  | { type: 'roundScored'; teamPoints: [number, number]; deltas: [number, number]; totals: [number, number]; success: boolean }
  | { type: 'matchEnded'; result: MatchResult };
