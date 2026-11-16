import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import type { Ack, GameUpdateMessage, RoomSnapshot, Seat } from '@tash/engine';

export interface NetState {
  status: 'idle' | 'connecting' | 'online' | 'offline';
  room: RoomSnapshot | null;
  /** Code of the room we are in or trying to join. */
  code: string | null;
  joinError: string | null;
}

export const useNet = create<NetState>(() => ({ status: 'idle', room: null, code: null, joinError: null }));

type UpdateListener = (u: GameUpdateMessage) => void;
type EmoteListener = (m: { seat: Seat; id: number }) => void;
type AutoListener = (m: { seat: Seat }) => void;

function identity(): { playerId: string; token: string } {
  const KEY = 'tash.identity';
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const id = { playerId: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID() };
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* ignore */
  }
  return id;
}

class Net {
  private socket: Socket | null = null;
  readonly me = identity();
  private name = '';
  lastUpdate: GameUpdateMessage | null = null;
  readonly updates = new Set<UpdateListener>();
  readonly emotes = new Set<EmoteListener>();
  readonly autoPlays = new Set<AutoListener>();

  private ensure(): Socket {
    if (this.socket) return this.socket;
    useNet.setState({ status: 'connecting' });
    const socket = io({ auth: this.me, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
    socket.on('connect', () => {
      useNet.setState({ status: 'online' });
      const code = useNet.getState().code;
      if (code) void this.join(code, this.name); // rejoin after a dropped connection
    });
    socket.on('disconnect', () => useNet.setState({ status: 'offline' }));
    socket.on('connect_error', () => useNet.setState({ status: 'offline' }));
    socket.on('room:state', (room: RoomSnapshot) => useNet.setState({ room }));
    socket.on('game:update', (u: GameUpdateMessage) => {
      this.lastUpdate = u;
      for (const l of this.updates) l(u);
    });
    socket.on('room:emote', (m: { seat: Seat; id: number }) => this.emotes.forEach((l) => l(m)));
    socket.on('game:autoPlayed', (m: { seat: Seat }) => this.autoPlays.forEach((l) => l(m)));
    this.socket = socket;
    return socket;
  }

  emit<T = object>(event: string, payload: unknown = {}, timeoutMs = 8000): Promise<Ack<T>> {
    const socket = this.ensure();
    return new Promise((resolve) => {
      socket.timeout(timeoutMs).emit(event, payload, (err: unknown, res: Ack<T>) => {
        resolve(err ? { ok: false, reason: 'timeout' } : res);
      });
    });
  }

  async create(gameId: string, name: string): Promise<Ack<{ code: string }>> {
    this.name = name;
    this.lastUpdate = null;
    const res = await this.emit<{ code: string }>('room:create', { gameId, name });
    if (res.ok) useNet.setState({ code: res.code, joinError: null });
    return res;
  }

  async join(code: string, name: string): Promise<Ack<{ code: string }>> {
    this.name = name;
    if (useNet.getState().code !== code) {
      this.lastUpdate = null;
      useNet.setState({ room: null });
    }
    useNet.setState({ code, joinError: null });
    const res = await this.emit<{ code: string }>('room:join', { code, name });
    if (!res.ok) useNet.setState({ joinError: res.reason });
    return res;
  }

  leave(): void {
    if (useNet.getState().code) void this.emit('room:leave');
    this.lastUpdate = null;
    useNet.setState({ room: null, code: null, joinError: null });
  }
}

export const net = new Net();
