/**
 * Ludo server: serves the built client from dist/ and runs private rooms over Socket.IO.
 * Runs directly with Node's built-in TypeScript support: `node server/index.ts`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { GameHost, type HostUpdate } from '../src/shared/host.ts';
import type { Ack, ClientToServer, HandshakeAuth, RoomSnapshot, SeatInfo, ServerToClient } from '../src/shared/protocol.ts';
import { EMOTES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, TURN_SECONDS } from '../src/shared/protocol.ts';
import { randomSeed } from '../src/shared/rng.ts';
import { activeSeats, defaultConfig, parseConfig } from '../src/shared/rules.ts';
import { DIFFICULTIES, SEATS, type Difficulty, type LudoConfig, type Seat } from '../src/shared/types.ts';

const PORT = Number(process.env.PORT ?? 3003);
const HOST = process.env.HOST ?? '127.0.0.1';
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? fileURLToPath(new URL('../dist', import.meta.url)));
const MAX_ROOMS = 500;
const ROOMS_PER_IP_PER_HOUR = 30;
const IDLE_ROOM_MS = 15 * 60_000;

// ---------- static files ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let file = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Client-side routes (e.g. /r/ABCDE) fall back to the app; missing assets are real 404s.
    if (extname(url.pathname)) {
      res.writeHead(404).end('not found');
      return;
    }
    file = join(STATIC_DIR, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(503).end('client not built: run npm run build');
      return;
    }
  }
  const immutable = url.pathname.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

// ---------- rooms ----------

type ClientSocket = Socket<ClientToServer, ServerToClient>;

class Room {
  readonly code: string;
  hostId: string;
  phase: RoomSnapshot['phase'] = 'lobby';
  config: LudoConfig = { ...defaultConfig };
  difficulty: Difficulty = 'normal';
  seats: SeatInfo[] = [{ kind: 'open' }, { kind: 'open' }, { kind: 'open' }, { kind: 'open' }];
  host: GameHost | null = null;
  lastActive = Date.now();
  /** Last update per seat, so a reconnecting player can be caught up. */
  private latest: (HostUpdate | null)[] = [null, null, null, null];

  constructor(code: string, hostId: string) {
    this.code = code;
    this.hostId = hostId;
  }

  seatOf(playerId: string): Seat | null {
    const i = this.seats.findIndex((s) => s.kind === 'human' && s.playerId === playerId);
    return i < 0 ? null : (i as Seat);
  }

  usable(seat: number): boolean {
    return activeSeats(this.config)[seat] === true;
  }

  snapshot(playerId: string): RoomSnapshot {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      config: this.config,
      difficulty: this.difficulty,
      seats: this.seats,
      you: { playerId, seat: this.seatOf(playerId) },
    };
  }

  broadcast(): void {
    this.lastActive = Date.now();
    for (const s of this.seats) {
      if (s.kind === 'human') for (const sock of socketsOf(s.playerId)) sock.emit('room', this.snapshot(s.playerId));
    }
  }

  /** Seat a player: their old seat if they had one, else the first free usable seat. */
  join(playerId: string, name: string): string | null {
    const existing = this.seatOf(playerId);
    if (existing !== null) {
      const s = this.seats[existing] as Extract<SeatInfo, { kind: 'human' }>;
      this.seats[existing] = { ...s, name, connected: true };
      this.host?.setSeat(existing, { kind: 'human', autopilot: false });
      return null;
    }
    if (this.phase !== 'lobby') return 'in-progress';
    const free = SEATS.find((s) => this.usable(s) && this.seats[s]!.kind !== 'human');
    if (free === undefined) return 'room-full';
    this.seats[free] = { kind: 'human', playerId, name, connected: true };
    return null;
  }

  sit(playerId: string, seat: number): string | null {
    if (this.phase !== 'lobby') return 'not-in-lobby';
    const from = this.seatOf(playerId);
    if (from === null || !this.usable(seat) || this.seats[seat]!.kind === 'human') return 'seat-taken';
    this.seats[seat] = this.seats[from]!;
    this.seats[from] = { kind: 'open' };
    return null;
  }

  configure(playerId: string, raw: unknown, difficulty: unknown): string | null {
    if (playerId !== this.hostId) return 'not-host';
    if (this.phase !== 'lobby') return 'not-in-lobby';
    const config = parseConfig(raw);
    if (config.players === 2) {
      // Move anyone sitting in a seat that disappears into a free diagonal seat.
      for (const s of [1, 3] as Seat[]) {
        const info = this.seats[s]!;
        if (info.kind !== 'human') continue;
        const to = ([0, 2] as Seat[]).find((t) => this.seats[t]!.kind !== 'human');
        if (to === undefined) return 'too-many-players';
        this.seats[to] = info;
        this.seats[s] = { kind: 'open' };
      }
    }
    this.config = config;
    if (DIFFICULTIES.includes(difficulty as Difficulty)) this.difficulty = difficulty as Difficulty;
    return null;
  }

  start(playerId: string): string | null {
    if (playerId !== this.hostId) return 'not-host';
    if (this.phase === 'playing') return 'already-playing';
    this.host?.dispose();
    const active = activeSeats(this.config);
    this.seats = this.seats.map((s, i) => (active[i] ? (s.kind === 'human' ? s : { kind: 'bot', difficulty: this.difficulty }) : { kind: 'open' }));
    this.latest = [null, null, null, null];
    const host = new GameHost(
      this.seats.map((s, i) => (!active[i] ? { kind: 'none' } : s.kind === 'human' ? { kind: 'human', autopilot: !s.connected } : { kind: 'bot', difficulty: this.difficulty })),
      {
        turnTimeoutMs: TURN_SECONDS * 1000,
        onUpdate: (seat, update) => {
          this.latest[seat] = update;
          const s = this.seats[seat]!;
          if (s.kind === 'human') for (const sock of socketsOf(s.playerId)) sock.emit('update', update);
          if (update.view.result && seat === 0) this.finish();
        },
        onAutoPlay: (seat) => this.emitAll('autoPlayed', { seat }),
        onError: (err) => console.error(`[room ${this.code}]`, err),
      },
    );
    this.host = host;
    this.phase = 'playing';
    this.broadcast();
    host.start(this.config, randomSeed());
    return null;
  }

  private finish(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'finished';
    // Seats of players who left go back to open, so new friends can join the rematch.
    queueMicrotask(() => this.broadcast());
  }

  rematch(playerId: string): string | null {
    if (playerId !== this.hostId) return 'not-host';
    if (this.phase !== 'finished') return 'not-finished';
    return this.start(playerId);
  }

  leave(playerId: string): void {
    const seat = this.seatOf(playerId);
    if (seat === null) return;
    if (this.phase === 'playing' && this.host) {
      this.seats[seat] = { kind: 'bot', difficulty: 'normal' };
      this.host.setSeat(seat, { kind: 'bot', difficulty: 'normal' });
    } else {
      this.seats[seat] = { kind: 'open' };
    }
    this.handOffHost();
    this.broadcast();
  }

  setConnected(playerId: string, connected: boolean): void {
    const seat = this.seatOf(playerId);
    if (seat === null) return;
    const s = this.seats[seat] as Extract<SeatInfo, { kind: 'human' }>;
    this.seats[seat] = { ...s, connected };
    if (this.phase === 'playing') this.host?.setSeat(seat, { kind: 'human', autopilot: !connected });
    if (!connected) this.handOffHost();
    this.broadcast();
  }

  catchUp(playerId: string, sock: ClientSocket): void {
    sock.emit('room', this.snapshot(playerId));
    const seat = this.seatOf(playerId);
    if (seat !== null && this.host && this.phase !== 'lobby') sock.emit('update', this.host.snapshot(seat));
  }

  emitAll<E extends keyof ServerToClient>(event: E, ...args: Parameters<ServerToClient[E]>): void {
    for (const s of this.seats) {
      if (s.kind === 'human') for (const sock of socketsOf(s.playerId)) (sock.emit as (e: string, ...a: unknown[]) => void)(event, ...args);
    }
  }

  humans(): Extract<SeatInfo, { kind: 'human' }>[] {
    return this.seats.filter((s): s is Extract<SeatInfo, { kind: 'human' }> => s.kind === 'human');
  }

  /** If the host left or dropped, the next connected player becomes host. */
  private handOffHost(): void {
    const host = this.humans().find((h) => h.playerId === this.hostId);
    if (host?.connected) return;
    const next = this.humans().find((h) => h.connected);
    if (next) this.hostId = next.playerId;
  }

  dispose(): void {
    this.host?.dispose();
  }
}

const rooms = new Map<string, Room>();
const roomOf = new Map<string, string>(); // playerId -> code
const sockets = new Map<string, Set<ClientSocket>>(); // playerId -> live sockets
const tokens = new Map<string, string>(); // playerId -> secret token (first come)
const createdByIp = new Map<string, number[]>();

function socketsOf(playerId: string): Set<ClientSocket> {
  return sockets.get(playerId) ?? new Set();
}

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

const cleanName = (raw: unknown) => (typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 20) : '');

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.humans().some((h) => h.connected);
    if (!anyone && now - room.lastActive > IDLE_ROOM_MS) {
      room.dispose();
      rooms.delete(code);
      for (const h of room.humans()) if (roomOf.get(h.playerId) === code) roomOf.delete(h.playerId);
    }
  }
  for (const [ip, times] of createdByIp) {
    const recent = times.filter((t) => t > now - 3_600_000);
    if (recent.length) createdByIp.set(ip, recent);
    else createdByIp.delete(ip);
  }
}, 60_000).unref();

// ---------- sockets ----------

const http = createServer(serveStatic);
const io = new Server<ClientToServer, ServerToClient>(http, { serveClient: false, pingInterval: 20_000, pingTimeout: 20_000 });

io.use((socket, next) => {
  const auth = socket.handshake.auth as Partial<HandshakeAuth>;
  if (typeof auth.playerId !== 'string' || typeof auth.token !== 'string' || auth.playerId.length > 64 || auth.token.length < 16 || auth.token.length > 128) {
    return next(new Error('bad-auth'));
  }
  const known = tokens.get(auth.playerId);
  if (known && known !== auth.token) return next(new Error('bad-auth'));
  if (!known) tokens.set(auth.playerId, auth.token);
  next();
});

io.on('connection', (socket: ClientSocket) => {
  const { playerId } = socket.handshake.auth as HandshakeAuth;
  // Behind Cloudflare + nginx the socket peer is the proxy; prefer the forwarded client address.
  const fwd = socket.handshake.headers['cf-connecting-ip'] ?? socket.handshake.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || socket.handshake.address;
  if (!sockets.has(playerId)) sockets.set(playerId, new Set());
  sockets.get(playerId)!.add(socket);

  // Reconnecting player: put them back in their room.
  const existing = rooms.get(roomOf.get(playerId) ?? '');
  if (existing && existing.seatOf(playerId) !== null) {
    existing.setConnected(playerId, true);
    existing.catchUp(playerId, socket);
  }

  const room = () => rooms.get(roomOf.get(playerId) ?? '') ?? null;
  const reply = <T extends object = object>(ack: unknown, res: Ack<T>) => {
    if (typeof ack === 'function') (ack as (r: Ack<T>) => void)(res);
  };
  const leaveCurrent = () => {
    const r = room();
    if (r) r.leave(playerId);
    roomOf.delete(playerId);
  };

  socket.on('create', (msg, ack) => {
    const name = cleanName(msg?.name);
    if (!name) return reply(ack, { ok: false, reason: 'bad-name' });
    const now = Date.now();
    const recent = (createdByIp.get(ip) ?? []).filter((t) => t > now - 3_600_000);
    if (recent.length >= ROOMS_PER_IP_PER_HOUR) return reply(ack, { ok: false, reason: 'too-many-rooms' });
    if (rooms.size >= MAX_ROOMS) return reply(ack, { ok: false, reason: 'server-full' });
    leaveCurrent();
    const r = new Room(newCode(), playerId);
    r.join(playerId, name);
    rooms.set(r.code, r);
    roomOf.set(playerId, r.code);
    createdByIp.set(ip, [...recent, now]);
    reply(ack, { ok: true, code: r.code });
    r.broadcast();
  });

  socket.on('join', (msg, ack) => {
    const name = cleanName(msg?.name);
    const code = typeof msg?.code === 'string' ? msg.code.trim().toUpperCase() : '';
    const r = rooms.get(code);
    if (!name) return reply(ack, { ok: false, reason: 'bad-name' });
    if (!r) return reply(ack, { ok: false, reason: 'no-room' });
    if (roomOf.get(playerId) !== code) leaveCurrent();
    const err = r.join(playerId, name);
    if (err) return reply(ack, { ok: false, reason: err });
    roomOf.set(playerId, code);
    reply(ack, { ok: true });
    r.broadcast();
    r.catchUp(playerId, socket);
  });

  const hostAction = (fn: (r: Room) => string | null) => (_msg: unknown, ack: unknown) => {
    const r = room();
    if (!r) return reply(ack, { ok: false, reason: 'no-room' });
    const err = fn(r);
    if (err) return reply(ack, { ok: false, reason: err });
    reply(ack, { ok: true });
    r.broadcast();
  };

  socket.on('sit', (msg, ack) => hostAction((r) => r.sit(playerId, Number(msg?.seat)))(msg, ack));
  socket.on('configure', (msg, ack) => hostAction((r) => r.configure(playerId, msg?.config, msg?.difficulty))(msg, ack));
  socket.on('start', hostAction((r) => r.start(playerId)));
  socket.on('rematch', hostAction((r) => r.rematch(playerId)));

  socket.on('leave', (_msg, ack) => {
    leaveCurrent();
    reply(ack, { ok: true });
  });

  socket.on('action', (msg, ack) => {
    const r = room();
    const seat = r?.seatOf(playerId) ?? null;
    if (!r || !r.host || seat === null || r.phase !== 'playing') return reply(ack, { ok: false, reason: 'not-now' });
    const err = r.host.act(seat, msg?.action);
    reply(ack, err ? { ok: false, reason: err } : { ok: true });
  });

  let lastEmote = 0;
  socket.on('emote', (msg) => {
    const r = room();
    const seat = r?.seatOf(playerId) ?? null;
    const id = Number(msg?.id);
    if (!r || seat === null || !Number.isInteger(id) || id < 0 || id >= EMOTES.length || Date.now() - lastEmote < 1500) return;
    lastEmote = Date.now();
    r.emitAll('emote', { seat, id });
  });

  socket.on('disconnect', () => {
    const set = sockets.get(playerId);
    set?.delete(socket);
    if (set && set.size === 0) {
      sockets.delete(playerId);
      room()?.setConnected(playerId, false);
    }
  });
});

http.listen(PORT, HOST, () => console.log(`ludo server listening on http://${HOST}:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    io.close();
    process.exit(0);
  });
}
