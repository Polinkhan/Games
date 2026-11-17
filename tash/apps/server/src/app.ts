import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  clientMessages,
  type Ack,
  type ClientMessage,
  type HandshakeAuth,
  type Seat,
  type ServerToClient,
} from '@tash/engine';
import { Room, RoomStore, type RoomTransport } from './rooms';

export interface AppOptions {
  port?: number;
  host?: string;
  /** Directory of the built web client to serve (production). */
  staticDir?: string;
  logger?: boolean;
  /** Max rooms one IP may create per hour. */
  roomsPerIpPerHour?: number;
}

/** Incoming events are validated by hand with Zod, so the socket is left untyped here. */
type ClientSocket = Socket;

export async function createApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  app.get('/health', async () => ({ ok: true, rooms: store.rooms.size }));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const root = resolve(opts.staticDir);
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/socket.io') && !req.url.includes('.')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  const io = new Server(app.server, {
    cors: { origin: true },
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  // playerId -> secret token (first come); playerId -> live sockets
  const tokens = new Map<string, string>();
  const sockets = new Map<string, Set<ClientSocket>>();
  const roomOf = new Map<string, string>(); // playerId -> room code
  const createdByIp = new Map<string, number[]>();

  const emitTo = <E extends keyof ServerToClient>(playerId: string, event: E, ...args: Parameters<ServerToClient[E]>) => {
    for (const s of sockets.get(playerId) ?? []) (s.emit as (e: string, ...a: unknown[]) => void)(event, ...args);
  };
  const transport: RoomTransport = {
    sendRoom: (id, snap) => emitTo(id, 'room:state', snap),
    sendUpdate: (id, u) => emitTo(id, 'game:update', u),
    sendEmote: (id, m) => emitTo(id, 'room:emote', m),
    sendAutoPlayed: (id, m) => emitTo(id, 'game:autoPlayed', m),
  };
  const store = new RoomStore(transport);
  const sweeper = setInterval(() => store.sweep(), 60_000);

  io.use((socket, next) => {
    const auth = socket.handshake.auth as Partial<HandshakeAuth>;
    if (typeof auth.playerId !== 'string' || typeof auth.token !== 'string' || auth.playerId.length > 64 || auth.token.length < 16 || auth.token.length > 128) {
      return next(new Error('bad-auth'));
    }
    const known = tokens.get(auth.playerId);
    if (known && known !== auth.token) return next(new Error('bad-auth'));
    tokens.set(auth.playerId, auth.token);
    next();
  });

  io.on('connection', (raw) => {
    const socket: ClientSocket = raw;
    const { playerId } = socket.handshake.auth as HandshakeAuth;
    // Behind Cloudflare + nginx the socket peer is the proxy; prefer the forwarded client address.
    const fwd = socket.handshake.headers['cf-connecting-ip'] ?? socket.handshake.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || socket.handshake.address;
    if (!sockets.has(playerId)) sockets.set(playerId, new Set());
    sockets.get(playerId)!.add(socket);

    // Simple token bucket: 20 messages, refilled at 10/s.
    let tokensLeft = 20;
    let last = Date.now();
    const allow = () => {
      const now = Date.now();
      tokensLeft = Math.min(20, tokensLeft + ((now - last) / 1000) * 10);
      last = now;
      if (tokensLeft < 1) return false;
      tokensLeft -= 1;
      return true;
    };

    const currentRoom = (): Room | undefined => {
      const code = roomOf.get(playerId);
      return code ? store.get(code) : undefined;
    };

    function on<K extends ClientMessage>(event: K, handler: (payload: ReturnType<(typeof clientMessages)[K]['parse']>) => Ack | Promise<Ack>) {
      socket.on(event as string, async (payload: unknown, ack?: (res: Ack) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!allow()) return reply({ ok: false, reason: 'rate-limited' });
        const parsed = clientMessages[event].safeParse(payload ?? {});
        if (!parsed.success) return reply({ ok: false, reason: 'bad-request' });
        try {
          reply(await handler(parsed.data as never));
        } catch (err) {
          console.error(err);
          reply({ ok: false, reason: 'server-error' });
        }
      });
    }

    const leaveCurrent = () => {
      const room = currentRoom();
      if (room) room.leave(playerId);
      roomOf.delete(playerId);
    };

    on('room:create', ({ gameId, name }) => {
      const hour = Date.now() - 3_600_000;
      const recent = (createdByIp.get(ip) ?? []).filter((t) => t > hour);
      if (recent.length >= (opts.roomsPerIpPerHour ?? 30)) return { ok: false, reason: 'too-many-rooms' };
      leaveCurrent();
      const room = store.create(gameId, { playerId, name });
      if (!room) return { ok: false, reason: 'server-full' };
      createdByIp.set(ip, [...recent, Date.now()]);
      roomOf.set(playerId, room.code);
      room.broadcastRoom();
      return { ok: true, code: room.code };
    });

    on('room:join', ({ code, name }) => {
      const room = store.get(code);
      if (!room) return { ok: false, reason: 'no-room' };
      if (roomOf.get(playerId) !== room.code) leaveCurrent();
      const err = room.join(playerId, name);
      if (err) return { ok: false, reason: err };
      roomOf.set(playerId, room.code);
      room.resync(playerId);
      return { ok: true, code: room.code };
    });

    const withRoom = (fn: (room: Room) => string | null): Ack => {
      const room = currentRoom();
      if (!room) return { ok: false, reason: 'no-room' };
      const err = fn(room);
      return err ? { ok: false, reason: err } : { ok: true };
    };

    on('room:sit', ({ seat }) => withRoom((r) => r.sit(playerId, seat as Seat)));
    on('room:setSeat', ({ seat, slot, difficulty }) => withRoom((r) => r.setSeat(playerId, seat as Seat, slot, difficulty)));
    on('room:config', ({ config, turnSeconds }) => withRoom((r) => r.setConfig(playerId, config, turnSeconds)));
    on('room:start', () => withRoom((r) => r.start(playerId)));
    on('room:rematch', () => withRoom((r) => r.rematch(playerId)));
    on('room:emote', ({ id }) => withRoom((r) => (r.emote(playerId, id), null)));
    on('game:action', ({ action, seq }) => withRoom((r) => r.action(playerId, action, seq)));
    on('room:leave', () => {
      leaveCurrent();
      return { ok: true };
    });

    socket.on('disconnect', () => {
      const set = sockets.get(playerId);
      set?.delete(socket);
      if (set && set.size === 0) {
        sockets.delete(playerId);
        currentRoom()?.disconnected(playerId);
      }
    });
  });

  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    for (const r of store.rooms.values()) r.dispose();
    io.disconnectSockets(true);
  });

  return { app, io, store };
}
