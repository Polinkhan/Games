import { randomBytes, randomInt } from 'node:crypto';
import {
  GameHost,
  getGame,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Difficulty,
  type GameId,
  type GameUpdateMessage,
  type HostSeat,
  type RoomSnapshot,
  type Seat,
  type SeatInfo,
} from '@tash/engine';

/** How the room talks to connected players. Implemented by the socket layer. */
export interface RoomTransport {
  sendRoom(playerId: string, snapshot: RoomSnapshot): void;
  sendUpdate(playerId: string, update: GameUpdateMessage): void;
  sendEmote(playerId: string, msg: { seat: Seat; id: number }): void;
  sendAutoPlayed(playerId: string, msg: { seat: Seat }): void;
}

export interface Member {
  playerId: string;
  name: string;
  connected: boolean;
}

/** Tunable timings (tests shorten them). */
export const timing: { disconnectGraceMs: number; botDelay: [number, number] } = {
  disconnectGraceMs: 20_000,
  botDelay: [600, 1400],
};

export class Room {
  readonly code: string;
  config: unknown;
  turnSeconds = 30;
  hostPlayerId: string;
  phase: RoomSnapshot['phase'] = 'lobby';
  seats: SeatInfo[] = [{ kind: 'open' }, { kind: 'open' }, { kind: 'open' }, { kind: 'open' }];
  /** Everyone in the room, seated or waiting. */
  members = new Map<string, Member>();
  host: GameHost | null = null;
  lastActivity = Date.now();
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    code: string,
    readonly gameId: GameId,
    creator: { playerId: string; name: string },
    private readonly transport: RoomTransport,
    private readonly onEmpty: (room: Room) => void,
  ) {
    this.code = code;
    this.config = getGame(gameId).defaultConfig;
    this.hostPlayerId = creator.playerId;
    this.members.set(creator.playerId, { ...creator, connected: true });
    this.seats[0] = { kind: 'human', playerId: creator.playerId, name: creator.name, connected: true, autopilot: false };
  }

  seatOf(playerId: string): Seat | null {
    const i = this.seats.findIndex((s) => s.kind === 'human' && s.playerId === playerId);
    return i < 0 ? null : (i as Seat);
  }

  snapshot(playerId: string): RoomSnapshot {
    const seated = new Set(this.seats.flatMap((s) => (s.kind === 'human' ? [s.playerId] : [])));
    return {
      code: this.code,
      gameId: this.gameId,
      config: this.config,
      turnSeconds: this.turnSeconds,
      hostPlayerId: this.hostPlayerId,
      phase: this.phase,
      seats: this.seats.map((s) => ({ ...s })),
      waiting: [...this.members.values()].filter((m) => !seated.has(m.playerId)).map(({ playerId, name }) => ({ playerId, name })),
      you: { playerId, seat: this.seatOf(playerId) },
    };
  }

  broadcastRoom(): void {
    this.lastActivity = Date.now();
    for (const m of this.members.values()) if (m.connected) this.transport.sendRoom(m.playerId, this.snapshot(m.playerId));
  }

  /** Join or rejoin. Returns an error code or null. */
  join(playerId: string, name: string): string | null {
    const existing = this.members.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      this.reconnected(playerId);
      return null;
    }
    if (this.members.size >= 8) return 'room-full';
    this.members.set(playerId, { playerId, name, connected: true });
    if (this.phase === 'lobby') {
      const open = this.seats.findIndex((s) => s.kind === 'open');
      if (open >= 0) this.seats[open] = { kind: 'human', playerId, name, connected: true, autopilot: false };
    } else {
      this.fillWaiting();
    }
    this.broadcastRoom();
    return null;
  }

  sit(playerId: string, seat: Seat): string | null {
    if (this.phase !== 'lobby') return 'not-in-lobby';
    if (this.seats[seat]!.kind !== 'open') return 'seat-taken';
    const m = this.members.get(playerId);
    if (!m) return 'not-in-room';
    const from = this.seatOf(playerId);
    if (from !== null) this.seats[from] = { kind: 'open' };
    this.seats[seat] = { kind: 'human', playerId, name: m.name, connected: m.connected, autopilot: false };
    this.broadcastRoom();
    return null;
  }

  setSeat(playerId: string, seat: Seat, slot: 'open' | 'bot', difficulty: Difficulty = 'normal'): string | null {
    if (playerId !== this.hostPlayerId) return 'not-host';
    if (this.phase !== 'lobby') return 'not-in-lobby';
    if (this.seats[seat]!.kind === 'human') return 'seat-taken';
    this.seats[seat] = slot === 'bot' ? { kind: 'bot', difficulty } : { kind: 'open' };
    this.broadcastRoom();
    return null;
  }

  setConfig(playerId: string, config: unknown, turnSeconds?: number): string | null {
    if (playerId !== this.hostPlayerId) return 'not-host';
    if (this.phase !== 'lobby') return 'not-in-lobby';
    const parsed = getGame(this.gameId).configSchema.safeParse(config);
    if (!parsed.success) return 'bad-config';
    this.config = parsed.data;
    if (turnSeconds !== undefined) this.turnSeconds = turnSeconds;
    this.broadcastRoom();
    return null;
  }

  start(playerId: string): string | null {
    if (playerId !== this.hostPlayerId) return 'not-host';
    if (this.phase === 'playing') return 'already-playing';
    this.seats = this.seats.map((s) => (s.kind === 'open' ? { kind: 'bot', difficulty: 'normal' } : s));
    this.startMatch();
    return null;
  }

  rematch(playerId: string): string | null {
    if (playerId !== this.hostPlayerId) return 'not-host';
    if (this.phase !== 'finished') return 'not-finished';
    this.startMatch();
    return null;
  }

  private startMatch(): void {
    this.host?.dispose();
    const game = getGame(this.gameId);
    const hostSeats: HostSeat[] = this.seats.map((s) =>
      s.kind === 'human' ? { kind: 'human', autopilot: s.autopilot } : { kind: 'bot', difficulty: s.kind === 'bot' ? s.difficulty : 'normal' },
    );
    const turnMs = this.turnSeconds ? this.turnSeconds * 1000 : null;
    this.host = new GameHost(game, hostSeats, {
      botDelay: timing.botDelay,
      turnTimeoutMs: turnMs,
      simultaneousTimeoutMs: turnMs ? turnMs * 3 : null,
      onUpdate: (seat, update) => {
        const s = this.seats[seat]!;
        if (s.kind === 'human' && this.members.get(s.playerId)?.connected) this.transport.sendUpdate(s.playerId, update);
        if (seat === 3) this.afterUpdate();
      },
      onAutoPlay: (seat) => {
        for (const m of this.members.values()) if (m.connected) this.transport.sendAutoPlayed(m.playerId, { seat });
      },
      onError: (err) => console.error(`[room ${this.code}]`, err),
    });
    this.phase = 'playing';
    this.broadcastRoom();
    this.host.start(this.config, randomBytes(16).toString('hex'));
  }

  /** Runs once per game update, after every seat was sent its view. */
  private afterUpdate(): void {
    this.lastActivity = Date.now();
    if (!this.host) return;
    const game = this.host.game;
    if (game.result(this.host.state) && this.phase !== 'finished') {
      this.phase = 'finished';
      this.broadcastRoom();
    }
    if (this.isBetweenRounds()) this.fillWaiting();
  }

  private isBetweenRounds(): boolean {
    if (!this.host) return false;
    const g = this.host.game;
    return g.pendingSeats(this.host.state).length === 0;
  }

  /** Waiting players take bot seats, but only between rounds. */
  private fillWaiting(): void {
    if (this.phase === 'lobby' || !this.isBetweenRounds()) return;
    let changed = false;
    for (const m of this.members.values()) {
      if (this.seatOf(m.playerId) !== null || !m.connected) continue;
      const bot = this.seats.findIndex((s) => s.kind === 'bot');
      if (bot < 0) break;
      this.seats[bot] = { kind: 'human', playerId: m.playerId, name: m.name, connected: true, autopilot: false };
      this.host?.setSeat(bot as Seat, { kind: 'human', autopilot: false });
      changed = true;
      if (this.host) this.transport.sendUpdate(m.playerId, this.host.snapshot(bot as Seat));
    }
    if (changed) this.broadcastRoom();
  }

  action(playerId: string, action: unknown, seq: number): string | null {
    const seat = this.seatOf(playerId);
    if (seat === null || !this.host) return 'not-seated';
    if (seq !== this.host.seq) return 'stale';
    const res = this.host.act(seat, action);
    return res.ok ? null : res.reason;
  }

  emote(playerId: string, id: number): void {
    const seat = this.seatOf(playerId);
    if (seat === null) return;
    for (const m of this.members.values()) if (m.connected) this.transport.sendEmote(m.playerId, { seat, id });
  }

  /** Send the current game view to one player (on join / reconnect). */
  resync(playerId: string): void {
    const seat = this.seatOf(playerId);
    if (seat !== null && this.host && this.phase !== 'lobby') this.transport.sendUpdate(playerId, this.host.snapshot(seat));
  }

  disconnected(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    m.connected = false;
    const seat = this.seatOf(playerId);
    if (seat !== null) {
      const s = this.seats[seat] as Extract<SeatInfo, { kind: 'human' }>;
      s.connected = false;
      if (this.phase === 'playing') {
        this.graceTimers.set(
          playerId,
          setTimeout(() => {
            this.graceTimers.delete(playerId);
            if (this.members.get(playerId)?.connected) return;
            s.autopilot = true;
            this.host?.setAutopilot(seat, true);
            this.broadcastRoom();
          }, timing.disconnectGraceMs),
        );
      }
    }
    // An empty room is kept so a refresh can rejoin; RoomStore.sweep removes it later.
    this.broadcastRoom();
  }

  private reconnected(playerId: string): void {
    const t = this.graceTimers.get(playerId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(playerId);
    const seat = this.seatOf(playerId);
    if (seat !== null) {
      const s = this.seats[seat] as Extract<SeatInfo, { kind: 'human' }>;
      s.connected = true;
      if (s.autopilot) {
        s.autopilot = false;
        this.host?.setAutopilot(seat, false);
      }
    }
    this.broadcastRoom();
    this.resync(playerId);
  }

  leave(playerId: string): void {
    const t = this.graceTimers.get(playerId);
    if (t) clearTimeout(t);
    this.members.delete(playerId);
    const seat = this.seatOf(playerId);
    if (seat !== null) {
      if (this.phase === 'lobby') this.seats[seat] = { kind: 'open' };
      else {
        this.seats[seat] = { kind: 'bot', difficulty: 'normal' };
        this.host?.setSeat(seat, { kind: 'bot', difficulty: 'normal' });
      }
    }
    if (this.hostPlayerId === playerId) {
      const next = this.seats.find((s) => s.kind === 'human') as Extract<SeatInfo, { kind: 'human' }> | undefined;
      const anyMember = [...this.members.keys()][0];
      if (next) this.hostPlayerId = next.playerId;
      else if (anyMember) this.hostPlayerId = anyMember;
    }
    if (this.members.size === 0) {
      this.dispose();
      this.onEmpty(this);
      return;
    }
    this.broadcastRoom();
  }

  humansConnected(): number {
    return [...this.members.values()].filter((m) => m.connected).length;
  }

  dispose(): void {
    this.host?.dispose();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
  }
}

export class RoomStore {
  rooms = new Map<string, Room>();
  constructor(private readonly transport: RoomTransport, readonly maxRooms = 2000) {}

  create(gameId: GameId, creator: { playerId: string; name: string }): Room | null {
    if (this.rooms.size >= this.maxRooms) return null;
    let code = '';
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, gameId, creator, this.transport, (r) => this.rooms.delete(r.code));
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Remove rooms nobody has been connected to for a while. */
  sweep(idleMs = 10 * 60_000): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.humansConnected() === 0 && now - room.lastActivity > idleMs) {
        room.dispose();
        this.rooms.delete(room.code);
      }
    }
  }
}

