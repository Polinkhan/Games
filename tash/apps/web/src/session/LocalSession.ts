import { GameHost, getGame, randomSeed, type Difficulty, type GameId, type HostSeat } from '@tash/engine';
import type { GameSession, SendResult, SessionUpdate } from './types';

export interface SavedSolo {
  gameId: GameId;
  difficulty: Difficulty;
  config: unknown;
  state: unknown;
  seq: number;
  savedAt: number;
}

const key = (gameId: GameId) => `tash.solo.${gameId}`;

export function loadSolo(gameId: GameId): SavedSolo | null {
  try {
    const raw = localStorage.getItem(key(gameId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedSolo;
    // Discard saves the current rules engine cannot read.
    const game = getGame(gameId);
    game.viewFor(saved.state, 0);
    return saved;
  } catch {
    return null;
  }
}

export function clearSolo(gameId: GameId): void {
  try {
    localStorage.removeItem(key(gameId));
  } catch {
    /* ignore */
  }
}

/** Solo play: the engine runs in the browser with three bots. */
export class LocalSession implements GameSession {
  readonly mode = 'solo' as const;
  private host: GameHost;
  private last: SessionUpdate | null = null;
  private listeners = new Set<(u: SessionUpdate) => void>();

  constructor(
    readonly gameId: GameId,
    private difficulty: Difficulty,
    private config: unknown,
    saved?: SavedSolo | null,
  ) {
    const seats: HostSeat[] = [
      { kind: 'human', autopilot: false },
      { kind: 'bot', difficulty },
      { kind: 'bot', difficulty },
      { kind: 'bot', difficulty },
    ];
    this.host = new GameHost(getGame(gameId), seats, {
      botDelay: [550, 1150],
      autoContinue: false,
      onUpdate: (seat, u) => {
        if (seat !== 0) return;
        this.last = u;
        this.save();
        for (const l of this.listeners) l(u);
      },
      onError: (err) => console.error(err),
    });
    if (saved) this.host.restore(saved.state, saved.seq);
    else this.host.start(config, randomSeed());
  }

  subscribe(cb: (u: SessionUpdate) => void): () => void {
    this.listeners.add(cb);
    if (this.last) cb({ ...this.last, events: [] });
    return () => this.listeners.delete(cb);
  }

  async send(action: unknown): Promise<SendResult> {
    return this.host.act(0, action);
  }

  async rematch(): Promise<SendResult> {
    this.host.start(this.config, randomSeed());
    return { ok: true };
  }

  leave(): void {
    this.host.dispose();
    this.listeners.clear();
  }

  private save(): void {
    const game = getGame(this.gameId);
    try {
      if (game.result(this.host.state)) {
        clearSolo(this.gameId);
        return;
      }
      const saved: SavedSolo = {
        gameId: this.gameId,
        difficulty: this.difficulty,
        config: this.config,
        state: this.host.state,
        seq: this.host.seq,
        savedAt: Date.now(),
      };
      localStorage.setItem(key(this.gameId), JSON.stringify(saved));
    } catch {
      /* storage full or unavailable: solo still works, just without resume */
    }
  }
}
