import { callBridge } from './callbridge/index';
import type { AnyGame, GameId } from './core/types';
import { hazari } from './hazari/index';
import { twentyNine } from './twentynine/index';

export const GAMES: Record<GameId, AnyGame> = {
  callbridge: callBridge,
  twentynine: twentyNine,
  hazari,
};

export function getGame(id: GameId): AnyGame {
  const g = GAMES[id];
  if (!g) throw new Error(`unknown game ${id}`);
  return g;
}
