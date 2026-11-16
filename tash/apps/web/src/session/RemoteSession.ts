import type { GameId } from '@tash/engine';
import { net } from './net';
import type { GameSession, SendResult, SessionUpdate } from './types';

/** Online play: the server runs the engine; this wraps the socket connection. */
export class RemoteSession implements GameSession {
  readonly mode = 'online' as const;
  constructor(readonly gameId: GameId) {}

  subscribe(cb: (u: SessionUpdate) => void): () => void {
    net.updates.add(cb);
    if (net.lastUpdate) cb({ ...net.lastUpdate, events: [] });
    return () => net.updates.delete(cb);
  }

  async send(action: unknown): Promise<SendResult> {
    const attempt = () => net.emit('game:action', { action, seq: net.lastUpdate?.seq ?? 0 });
    let res = await attempt();
    if (!res.ok && res.reason === 'stale') {
      // Another update raced ours (e.g. a bot locked in its Hazari groups). Retry once with the latest seq.
      await new Promise((r) => setTimeout(r, 120));
      res = await attempt();
    }
    return res.ok ? { ok: true } : res;
  }

  async rematch(): Promise<SendResult> {
    const res = await net.emit('room:rematch');
    return res.ok ? { ok: true } : res;
  }

  leave(): void {
    net.leave();
  }
}
