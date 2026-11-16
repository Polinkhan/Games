import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Ack, CallBridgeView, GameUpdateMessage, RoomSnapshot } from '@tash/engine';
import { createApp } from './app';
import { timing } from './rooms';

let url = '';
let close: () => Promise<void>;

beforeAll(async () => {
  timing.disconnectGraceMs = 300;
  timing.botDelay = [10, 20];
  const { app } = await createApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = () => app.close();
});
afterAll(() => close());

interface Client {
  socket: Socket;
  room: RoomSnapshot | null;
  update: GameUpdateMessage | null;
  send<T = object>(event: string, payload?: unknown): Promise<Ack<T>>;
  waitFor(pred: (c: Client) => boolean, ms?: number): Promise<void>;
}

function client(id: string): Promise<Client> {
  const socket = connect(url, { auth: { playerId: id, token: `token-${id}-0123456789` }, transports: ['websocket'], forceNew: true });
  const c: Client = {
    socket,
    room: null,
    update: null,
    send: (event, payload = {}) => new Promise((res) => socket.emit(event, payload, res)),
    waitFor: (pred, ms = 4000) =>
      new Promise((resolve, reject) => {
        if (pred(c)) return resolve();
        const timer = setTimeout(() => reject(new Error(`timeout waiting; room=${JSON.stringify(c.room)} update=${JSON.stringify(c.update?.view)}`)), ms);
        const check = () => {
          if (pred(c)) {
            clearTimeout(timer);
            socket.off('room:state', check);
            socket.off('game:update', check);
            resolve();
          }
        };
        socket.on('room:state', check);
        socket.on('game:update', check);
      }),
  };
  socket.on('room:state', (r: RoomSnapshot) => (c.room = r));
  socket.on('game:update', (u: GameUpdateMessage) => (c.update = u));
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(c));
    socket.on('connect_error', reject);
  });
}

describe('multiplayer server', () => {
  it('rejects a reused player id with the wrong token', async () => {
    const first = await client('dup');
    const bad = connect(url, { auth: { playerId: 'dup', token: 'another-token-123456' }, transports: ['websocket'], forceNew: true });
    const err = await new Promise<Error>((res) => bad.on('connect_error', res));
    expect(err.message).toBe('bad-auth');
    bad.close();
    first.socket.close();
  });

  it('create, join, start with bots, reject illegal and stale actions', async () => {
    const a = await client('alice');
    const b = await client('bob');
    const created = await a.send<{ code: string }>('room:create', { gameId: 'callbridge', name: 'Alice' });
    expect(created.ok).toBe(true);
    const code = (created as { code: string }).code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    expect((await b.send('room:join', { code, name: 'Bob' })).ok).toBe(true);
    await a.waitFor((c) => c.room?.seats[1]?.kind === 'human');
    expect((await b.send('room:start')).ok).toBe(false); // not host
    expect((await a.send('room:config', { config: { rounds: 1, minCall: 1, mustBeatInSuit: false, overtricks: 'strict', bonusCall: true } })).ok).toBe(true);
    expect((await a.send('room:start')).ok).toBe(true);

    await a.waitFor((c) => c.room?.phase === 'playing' && c.update !== null);
    // Bob calls whenever it is his turn (he may call before Alice, depending on the dealer).
    b.socket.on('game:update', (u: GameUpdateMessage) => {
      const v = u.view as CallBridgeView;
      if (v.phase === 'calling' && v.pending.includes(1)) void b.send('game:action', { action: { type: 'call', call: 2 }, seq: u.seq });
    });
    const bv = b.update?.view as CallBridgeView | undefined;
    if (bv?.phase === 'calling' && bv.pending.includes(1)) await b.send('game:action', { action: { type: 'call', call: 2 }, seq: b.update!.seq });
    expect(a.room!.seats.filter((s) => s.kind === 'bot')).toHaveLength(2);

    // Wait until it is Alice's (seat 0) turn to call.
    await a.waitFor((c) => (c.update?.view as CallBridgeView | undefined)?.pending.includes(0) ?? false, 8000);
    const seq = a.update!.seq;
    expect(await a.send('game:action', { action: { type: 'play', card: 'SA' }, seq })).toEqual({ ok: false, reason: 'not-now' });
    expect(await a.send('game:action', { action: { type: 'call', call: 3 }, seq: seq - 1 })).toEqual({ ok: false, reason: 'stale' });
    expect(await a.send('game:action', { action: { type: 'bogus' }, seq })).toEqual({ ok: false, reason: 'bad-action' });
    expect(await a.send('game:action', { action: { type: 'call', call: 3 }, seq })).toEqual({ ok: true });

    // Bob's view never contains Alice's cards.
    await b.waitFor((c) => c.update !== null);
    const aliceHand = (a.update!.view as CallBridgeView).hand;
    const bobJson = JSON.stringify(b.update!.view);
    for (const card of aliceHand) expect(bobJson.includes(`"${card}"`)).toBe(false);

    a.socket.close();
    b.socket.close();
  }, 20_000);

  it('autopilot on disconnect, seat restored on reconnect, host migration', async () => {
    const a = await client('carol');
    const b = await client('dave');
    const code = ((await a.send<{ code: string }>('room:create', { gameId: 'hazari', name: 'Carol' })) as { code: string }).code;
    await b.send('room:join', { code, name: 'Dave' });
    await a.send('room:start');
    await b.waitFor((c) => c.room?.phase === 'playing');

    b.socket.close();
    await a.waitFor((c) => {
      const s = c.room?.seats[1];
      return s?.kind === 'human' && s.autopilot;
    }, 3000);

    const b2 = await client('dave');
    expect((await b2.send('room:join', { code, name: 'Dave' })).ok).toBe(true);
    await b2.waitFor((c) => c.room?.you.seat === 1 && c.update !== null);
    await a.waitFor((c) => {
      const s = c.room?.seats[1];
      return s?.kind === 'human' && !s.autopilot && s.connected;
    });

    await a.send('room:leave');
    await b2.waitFor((c) => c.room?.hostPlayerId === 'dave' && c.room.seats[0]?.kind === 'bot');
    a.socket.close();
    b2.socket.close();
  }, 20_000);

  it('a late joiner waits, then takes a bot seat between rounds', async () => {
    const a = await client('erin');
    const code = ((await a.send<{ code: string }>('room:create', { gameId: 'hazari', name: 'Erin' })) as { code: string }).code;
    await a.send('room:start');
    await a.waitFor((c) => c.update?.view.phase === 'arranging');
    const f = await client('frank');
    await f.send('room:join', { code, name: 'Frank' });
    await f.waitFor((c) => c.room !== null);
    expect(f.room!.you.seat).toBeNull();
    expect(f.room!.waiting.map((w) => w.playerId)).toContain('frank');
    // Erin arranges via the server's own bot by timing out is slow; arrange greedily instead.
    const { greedyArrangement } = await import('@tash/engine');
    const view = a.update!.view as unknown as { hand: string[] };
    expect((await a.send('game:action', { action: { type: 'arrange', groups: greedyArrangement(view.hand) }, seq: a.update!.seq })).ok).toBe(true);
    await f.waitFor((c) => c.room?.you.seat !== null && c.room?.you.seat !== undefined, 8000);
    a.socket.close();
    f.socket.close();
  }, 20_000);
});
