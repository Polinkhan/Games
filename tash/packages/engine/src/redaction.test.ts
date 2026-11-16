import { describe, it } from 'vitest';
import type { CardId } from './core/cards';
import { SEATS, type AnyGame, type Seat } from './core/types';
import { GAMES } from './registry';
import { simulateMatch } from './simulate';

/** Cards hidden from `seat` in a raw state: everyone else's hand (and, in 29, the undealt stock). */
function hiddenFrom(state: Record<string, unknown>, seat: Seat): CardId[] {
  const hands = state.hands as CardId[][];
  const stock = (state.stock as CardId[][] | undefined) ?? [];
  const out: CardId[] = [];
  for (const s of SEATS) {
    if (s !== seat) out.push(...hands[s]!);
    out.push(...(stock[s] ?? []));
  }
  return out;
}

describe('views never leak hidden cards', () => {
  for (const [id, game] of Object.entries(GAMES) as [string, AnyGame][]) {
    it(id, () => {
      const matches = id === 'hazari' ? 15 : 60;
      for (let i = 0; i < matches; i++) {
        simulateMatch(game, game.defaultConfig, `redact-${id}-${i}`, {
          difficulties: id === 'hazari' ? ['easy', 'easy', 'easy', 'easy'] : undefined,
          onStep: (raw, events) => {
            const state = raw as Record<string, unknown>;
            const publicEvents = JSON.stringify(events);
            for (const seat of SEATS) {
              const json = JSON.stringify(game.viewFor(raw, seat));
              if (json.includes('"seed"')) throw new Error('seed leaked');
              for (const card of hiddenFrom(state, seat)) {
                if (json.includes(`"${card}"`)) throw new Error(`${id}: ${card} leaked to seat ${seat}`);
                if (publicEvents.includes(`"${card}"`) && state.phase !== 'roundEnd' && state.phase !== 'matchEnd') {
                  // A card in an event must be on the table, never still in a hand.
                  throw new Error(`${id}: ${card} leaked in events`);
                }
              }
            }
          },
        });
      }
    }, 120_000);
  }
});
