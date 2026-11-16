import type { Difficulty, RoomSnapshot } from '@tash/engine';
import type { PlayerInfo } from '../session/types';
import { useSettings } from './settings';

const BOT_NAMES = {
  en: ['Rafi', 'Mitu', 'Joy', 'Nila'],
  bn: ['রাফি', 'মিতু', 'জয়', 'নীলা'],
};

export function botName(seat: number): string {
  return BOT_NAMES[useSettings.getState().lang][seat % 4]!;
}

export function soloPlayers(name: string, difficulty: Difficulty): PlayerInfo[] {
  return [
    { name: name || 'You', kind: 'you', connected: true, autopilot: false },
    ...[1, 2, 3].map((s) => ({ name: botName(s), kind: 'bot' as const, connected: true, autopilot: false, difficulty })),
  ];
}

export function roomPlayers(room: RoomSnapshot): PlayerInfo[] {
  return room.seats.map((s, i) => {
    if (s.kind === 'human')
      return {
        name: s.name,
        kind: s.playerId === room.you.playerId ? ('you' as const) : ('human' as const),
        connected: s.connected,
        autopilot: s.autopilot,
      };
    return { name: botName(i), kind: 'bot' as const, connected: true, autopilot: false, difficulty: s.kind === 'bot' ? s.difficulty : 'normal' };
  });
}
