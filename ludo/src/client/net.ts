import { io, type Socket } from 'socket.io-client';
import type { HostUpdate } from '../shared/host.ts';
import type { Ack, ClientToServer, RoomSnapshot, ServerToClient } from '../shared/protocol.ts';
import type { Seat } from '../shared/types.ts';
import { identity } from './settings.ts';

type Status = 'offline' | 'connecting' | 'online';

/** One shared socket connection to the room server. */
class Net {
  socket: Socket<ServerToClient, ClientToServer> | null = null;
  status: Status = 'offline';
  room: RoomSnapshot | null = null;
  lastUpdate: HostUpdate | null = null;
  readonly onRoom = new Set<(r: RoomSnapshot) => void>();
  readonly onUpdate = new Set<(u: HostUpdate) => void>();
  readonly onEmote = new Set<(m: { seat: Seat; id: number }) => void>();
  readonly onAutoPlay = new Set<(m: { seat: Seat }) => void>();
  readonly onStatus = new Set<(s: Status) => void>();

  connect(): Socket<ServerToClient, ClientToServer> {
    if (this.socket) return this.socket;
    const socket: Socket<ServerToClient, ClientToServer> = io({
      path: `${import.meta.env.BASE_URL}socket.io`,
      auth: identity(),
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 4000,
    });
    this.socket = socket;
    this.setStatus('connecting');
    socket.on('connect', () => this.setStatus('online'));
    socket.on('disconnect', () => this.setStatus('connecting'));
    socket.on('room', (r) => {
      this.room = r;
      for (const fn of this.onRoom) fn(r);
    });
    socket.on('update', (u) => {
      this.lastUpdate = u;
      for (const fn of this.onUpdate) fn(u);
    });
    socket.on('emote', (m) => this.onEmote.forEach((fn) => fn(m)));
    socket.on('autoPlayed', (m) => this.onAutoPlay.forEach((fn) => fn(m)));
    return socket;
  }

  private setStatus(s: Status): void {
    this.status = s;
    for (const fn of this.onStatus) fn(s);
  }

  /** Emit with an acknowledgement; resolves with a failure if the server does not answer in time. */
  emit<T = object>(event: keyof ClientToServer, payload: object): Promise<Ack<T>> {
    const socket = this.connect();
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, reason: 'offline' }), 8000);
      (socket.emit as (e: string, p: object, ack: (r: Ack<T>) => void) => void)(event, payload, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });
  }

  emote(id: number): void {
    this.socket?.emit('emote', { id });
  }

  reset(): void {
    this.room = null;
    this.lastUpdate = null;
  }
}

export const net = new Net();
