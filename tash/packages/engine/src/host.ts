import { createRng } from './core/rng';
import { IllegalActionError, SEATS, type AnyGame, type BaseEvent, type BaseView, type Difficulty, type Seat } from './core/types';

export type HostSeat =
  | { kind: 'bot'; difficulty: Difficulty }
  | { kind: 'human'; autopilot: boolean };

export interface HostUpdate<V extends BaseView = BaseView> {
  view: V;
  events: BaseEvent[];
  seq: number;
  /** Epoch ms when this seat's turn times out (null if not timed or not their turn). */
  deadline: number | null;
}

export interface HostOptions {
  /** Random delay range before a bot acts, in ms. */
  botDelay?: [number, number];
  /** Time limit for a human turn; null = unlimited. */
  turnTimeoutMs?: number | null;
  /** Time limit for simultaneous turns (Hazari arranging). */
  simultaneousTimeoutMs?: number | null;
  /** Automatically continue to the next round after the game's pause. */
  autoContinue?: boolean;
  onUpdate: (seat: Seat, update: HostUpdate) => void;
  /** Called when a human ran out of time and the bot moved for them. */
  onAutoPlay?: (seat: Seat) => void;
  onError?: (err: unknown) => void;
}

/**
 * Time the client needs to animate a batch of events before the next move should
 * happen, so bots never act while cards are still flying.
 */
export function animationTime(events: readonly BaseEvent[]): number {
  let ms = 0;
  for (const e of events) {
    if (e.type === 'dealt') ms += 1000;
    else if (e.type === 'trickWon') ms += 1000;
    else if (e.type === 'showdownTrick') ms += 2300;
    else if (e.type === 'trumpRevealed') ms += 700;
    else if (e.type === 'pairDeclared') ms += 900;
    else if (e.type === 'roundScored') ms += 600;
  }
  return ms;
}

/** Runs one match: applies actions, schedules bots, timers and auto-continue. Used by the server and solo play. */
export class GameHost {
  state: unknown;
  seq = 0;
  private timers = new Map<Seat | 'continue', ReturnType<typeof setTimeout>>();
  private deadlines: (number | null)[] = [null, null, null, null];
  private disposed = false;
  private readonly opts: Required<Omit<HostOptions, 'onAutoPlay' | 'onError'>> & Pick<HostOptions, 'onAutoPlay' | 'onError'>;

  constructor(
    readonly game: AnyGame,
    public seats: HostSeat[],
    opts: HostOptions,
  ) {
    this.opts = {
      botDelay: [600, 1400],
      turnTimeoutMs: null,
      simultaneousTimeoutMs: null,
      autoContinue: true,
      ...opts,
    };
  }

  /** Start a new match. */
  start(config: unknown, seed: string): void {
    const { state, events } = this.game.init(config, seed);
    this.state = state;
    this.seq = 0;
    this.publish(events);
  }

  /** Resume from a saved state (solo refresh). */
  restore(state: unknown, seq = 0): void {
    this.state = state;
    this.seq = seq;
    this.publish([]);
  }

  view(seat: Seat): BaseView {
    return this.game.viewFor(this.state, seat);
  }

  snapshot(seat: Seat): HostUpdate {
    return { view: this.view(seat), events: [], seq: this.seq, deadline: this.deadlines[seat] ?? null };
  }

  act(seat: Seat, action: unknown): { ok: true } | { ok: false; reason: string } {
    if (this.disposed) return { ok: false, reason: 'closed' };
    const parsed = this.game.actionSchema.safeParse(action);
    if (!parsed.success) return { ok: false, reason: 'bad-action' };
    const reason = this.game.validate(this.state, seat, parsed.data);
    if (reason) return { ok: false, reason };
    try {
      this.applyAction(seat, parsed.data);
      return { ok: true };
    } catch (err) {
      if (err instanceof IllegalActionError) return { ok: false, reason: err.reason };
      throw err;
    }
  }

  setSeat(seat: Seat, value: HostSeat): void {
    this.seats[seat] = value;
    this.clearTimer(seat);
    this.schedule(0);
  }

  setAutopilot(seat: Seat, on: boolean): void {
    const s = this.seats[seat];
    if (s?.kind !== 'human' || s.autopilot === on) return;
    this.seats[seat] = { kind: 'human', autopilot: on };
    this.clearTimer(seat);
    this.schedule(on ? 300 : 0);
    if (!on) this.publish([], false);
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private applyAction(seat: Seat, action: unknown): void {
    const { state, events } = this.game.apply(this.state, seat, action);
    this.state = state;
    this.clearTimer(seat);
    this.publish(events);
  }

  private publish(events: BaseEvent[], bump = true): void {
    if (bump) this.seq++;
    const wait = animationTime(events);
    this.schedule(wait);
    for (const seat of SEATS) {
      this.opts.onUpdate(seat, {
        view: this.game.viewFor(this.state, seat),
        events,
        seq: this.seq,
        deadline: this.deadlines[seat] ?? null,
      });
    }
  }

  private clearTimer(key: Seat | 'continue'): void {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
    if (key !== 'continue') this.deadlines[key] = null;
  }

  private later(key: Seat | 'continue', ms: number, fn: () => void): void {
    this.clearTimer(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (this.disposed) return;
        try {
          fn();
        } catch (err) {
          this.opts.onError?.(err);
        }
      }, ms),
    );
  }

  /** Arrange timers for whoever the game is waiting on. `wait` = animation time to let pass first. */
  private schedule(wait: number): void {
    if (this.disposed || this.game.result(this.state)) return;
    const pending = this.game.pendingSeats(this.state);
    for (const seat of SEATS) {
      if (!pending.includes(seat)) this.clearTimer(seat);
    }
    if (pending.length === 0) {
      const pause = this.game.autoContinueMs(this.state);
      if (pause !== null && this.opts.autoContinue && !this.timers.has('continue')) {
        this.later('continue', wait + pause, () => this.applyAction(0, this.game.continueAction));
      }
      return;
    }
    this.clearTimer('continue');
    for (const seat of pending) {
      if (this.timers.has(seat)) continue;
      const s = this.seats[seat]!;
      if (s.kind === 'bot' || s.autopilot) {
        const [lo, hi] = this.opts.botDelay;
        const delay = wait + lo + Math.random() * (hi - lo);
        const difficulty = s.kind === 'bot' ? s.difficulty : 'normal';
        this.later(seat, delay, () => this.botMove(seat, difficulty));
      } else {
        const limit = pending.length > 1 ? this.opts.simultaneousTimeoutMs : this.opts.turnTimeoutMs;
        if (limit) {
          this.later(seat, wait + limit, () => {
            this.opts.onAutoPlay?.(seat);
            this.botMove(seat, 'normal');
          });
          this.deadlines[seat] = Date.now() + wait + limit;
        }
      }
    }
  }

  private botMove(seat: Seat, difficulty: Difficulty): void {
    if (!this.game.pendingSeats(this.state).includes(seat)) return;
    const rng = createRng(`bot:${this.seq}:${seat}:${Math.random()}`);
    const action = this.game.botAction(this.game.viewFor(this.state, seat), difficulty, rng);
    this.applyAction(seat, action);
  }
}
