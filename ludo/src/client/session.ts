import { GameHost, type HostUpdate, type SeatControl } from '../shared/host.ts';
import { randomSeed } from '../shared/rng.ts';
import { activeSeats } from '../shared/rules.ts';
import type { Difficulty, LudoConfig, LudoState, Seat } from '../shared/types.ts';
import { t } from './i18n.ts';
import { net } from './net.ts';
import { settings } from './settings.ts';

export interface PlayerInfo {
  name: string;
  kind: 'you' | 'human' | 'bot' | 'none';
  connected: boolean;
}

export type SendResult = { ok: true } | { ok: false; reason: string };

/** The game screen only knows this interface, so solo and online share all the UI. */
export interface Session {
  readonly mode: 'solo' | 'online';
  subscribe(cb: (u: HostUpdate) => void): () => void;
  send(action: unknown): Promise<SendResult>;
  players(): PlayerInfo[];
  canRematch(): boolean;
  rematch(): Promise<SendResult>;
  leave(): void;
}

// ---------- solo ----------

const SAVE_KEY = 'ludo.solo';

interface SavedSolo {
  state: LudoState;
  difficulty: Difficulty;
}

export function loadSolo(): SavedSolo | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedSolo;
    return saved.state?.tokens && !saved.state.result ? saved : null;
  } catch {
    return null;
  }
}

function clearSolo(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export class LocalSession implements Session {
  readonly mode = 'solo' as const;
  private host: GameHost;
  private latest: HostUpdate | null = null;
  private listeners = new Set<(u: HostUpdate) => void>();
  private config: LudoConfig;
  private difficulty: Difficulty;

  constructor(config: LudoConfig, difficulty: Difficulty, resume: LudoState | null) {
    this.config = resume?.config ?? config;
    this.difficulty = difficulty;
    this.host = this.makeHost();
    if (resume) this.host.restore(resume);
    else this.host.start(this.config, randomSeed());
  }

  private makeHost(): GameHost {
    const active = activeSeats(this.config);
    const seats: SeatControl[] = active.map((a, i) => (!a ? { kind: 'none' } : i === 0 ? { kind: 'human', autopilot: false } : { kind: 'bot', difficulty: this.difficulty }));
    return new GameHost(seats, {
      botDelay: [500, 900],
      onUpdate: (seat, u) => {
        if (seat !== 0) return;
        this.latest = u;
        for (const fn of this.listeners) fn(u);
      },
      onState: (state) => {
        try {
          if (state.result) clearSolo();
          else localStorage.setItem(SAVE_KEY, JSON.stringify({ state, difficulty: this.difficulty } satisfies SavedSolo));
        } catch {
          /* storage full or unavailable: the game still plays */
        }
      },
      onError: (e) => console.error(e),
    });
  }

  subscribe(cb: (u: HostUpdate) => void): () => void {
    this.listeners.add(cb);
    if (this.latest) cb({ ...this.latest, events: [] });
    return () => this.listeners.delete(cb);
  }

  async send(action: unknown): Promise<SendResult> {
    const reason = this.host.act(0, action);
    return reason ? { ok: false, reason } : { ok: true };
  }

  players(): PlayerInfo[] {
    const active = activeSeats(this.config);
    return active.map((a, i) =>
      !a ? { name: '', kind: 'none', connected: false } : i === 0 ? { name: settings.name || t('game.you'), kind: 'you', connected: true } : { name: t(`colour.${i}`), kind: 'bot', connected: true },
    );
  }

  canRematch(): boolean {
    return true;
  }

  async rematch(): Promise<SendResult> {
    this.host.dispose();
    this.host = this.makeHost();
    this.host.start(this.config, randomSeed());
    return { ok: true };
  }

  leave(): void {
    this.host.dispose();
    this.listeners.clear();
  }
}

// ---------- online ----------

export class RemoteSession implements Session {
  readonly mode = 'online' as const;

  subscribe(cb: (u: HostUpdate) => void): () => void {
    net.onUpdate.add(cb);
    if (net.lastUpdate) cb({ ...net.lastUpdate, events: [] });
    return () => net.onUpdate.delete(cb);
  }

  async send(action: unknown): Promise<SendResult> {
    return net.emit('action', { action });
  }

  players(): PlayerInfo[] {
    const room = net.room;
    if (!room) return [];
    return room.seats.map((s, i) => {
      if (s.kind === 'human') return { name: s.name, kind: room.you.playerId === s.playerId ? 'you' : 'human', connected: s.connected };
      if (s.kind === 'bot') return { name: t(`colour.${i}`), kind: 'bot', connected: true };
      return { name: '', kind: 'none', connected: false };
    });
  }

  canRematch(): boolean {
    return net.room?.hostId === net.room?.you.playerId;
  }

  async rematch(): Promise<SendResult> {
    return net.emit('rematch', {});
  }

  leave(): void {
    void net.emit('leave', {});
    net.reset();
  }
}

export function mySeat(session: Session): Seat {
  const i = session.players().findIndex((p) => p.kind === 'you');
  return (i < 0 ? 0 : i) as Seat;
}
