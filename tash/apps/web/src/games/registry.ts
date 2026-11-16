import type { GameId } from '@tash/engine';
import { callBridgeUi } from './callbridge';
import { hazariUi } from './hazari';
import { twentyNineUi } from './twentynine';
import type { GameUi } from './types';

export const GAME_UI: Record<GameId, GameUi> = {
  callbridge: callBridgeUi as unknown as GameUi,
  twentynine: twentyNineUi as unknown as GameUi,
  hazari: hazariUi as unknown as GameUi,
};
