import { botAction } from './bot.ts';
import { createRng } from './rng.ts';
import { apply, init, parseAction, pendingSeat, validate, viewFor } from './rules.ts';
import { SEATS, type Difficulty, type LudoConfig, type LudoEvent, type LudoState, type LudoView, type Seat } from './types.ts';

export type SeatControl = { kind: 'bot'; difficulty: Difficulty } | { kind: 'human'; autopilot: boolean } | { kind: 'none' };

export interface HostUpdate {
  view: LudoView;
  events: LudoEvent[];
  seq: number;
  /** Epoch ms when this seat's turn times out (null if untimed or not their turn). */
  deadline: number | null;
}

export interface HostOptions {
  onUpdate: (seat: Seat, update: HostUpdate) => void;
  /** Called after every state change (used to save solo games). */
  onState?: (state: LudoState) => void;
  /** A human ran out of time and the bot moved for them. */
  onAutoPlay?: (seat: Seat) => void;
  onError?: (err: unknown) => void;
  botDelay?: [number, number];
  turnTimeoutMs?: number | null;
}

/** Time the client needs to animate a batch of events, so bots never act mid-animation. */
export function animationTime(events: readonly LudoEvent[]): number {
  let ms = 0;
  for (const e of events) {
    if (e.type === 'rolled') ms += 750;
    else if (e.type === 'moved') ms += 150 * e.path.length + 150;
    else if (e.type === 'captured') ms += 500;
    else if (e.type === 'tokenHome') ms += 300;
    else if (e.type === 'turnPassed') ms += e.reason === 'threeSixes' ? 900 : 250;
  }
  return ms;
}

/** Runs one match: applies actions and schedules bots and turn timers. Used by the server and by solo play. */
export class GameHost {
  state!: LudoState;
  seq = 0;
  seats: SeatControl[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;
  private disposed = false;
  private opts: HostOptions;

  constructor(seats: SeatControl[], opts: HostOptions) {
    this.seats = seats;
    this.opts = opts;
  }

  start(config: LudoConfig, seed: string): void {
    const { state, events } = init(config, seed);
    this.state = state;
    this.seq = 0;
    this.publish(events);
  }

  restore(state: LudoState, seq = 0): void {
    this.state = state;
    this.seq = seq;
    this.publish([], false);
  }

  snapshot(seat: Seat): HostUpdate {
    return { view: viewFor(this.state, seat), events: [], seq: this.seq, deadline: this.deadlineFor(seat) };
  }

  act(seat: Seat, raw: unknown): string | null {
    if (this.disposed) return 'closed';
    const action = parseAction(raw);
    if (!action) return 'bad-action';
    const reason = validate(this.state, seat, action);
    if (reason) return reason;
    this.applyAction(seat, action);
    return null;
  }

  setSeat(seat: Seat, control: SeatControl): void {
    this.seats[seat] = control;
    this.clearTimer();
    this.schedule(0);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private deadlineFor(seat: Seat): number | null {
    return pendingSeat(this.state) === seat ? this.deadline : null;
  }

  private applyAction(seat: Seat, action: Parameters<typeof apply>[2]): void {
    const { state, events } = apply(this.state, seat, action);
    this.state = state;
    this.clearTimer();
    this.publish(events);
  }

  private publish(events: LudoEvent[], bump = true): void {
    if (bump) this.seq++;
    this.schedule(animationTime(events));
    this.opts.onState?.(this.state);
    for (const seat of SEATS) {
      this.opts.onUpdate(seat, { view: viewFor(this.state, seat), events, seq: this.seq, deadline: this.deadlineFor(seat) });
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  private later(ms: number, fn: () => void): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed) return;
      try {
        fn();
      } catch (err) {
        this.opts.onError?.(err);
      }
    }, ms);
  }

  /** Arrange the timer for whoever the game is waiting on. `wait` = animation time to let pass first. */
  private schedule(wait: number): void {
    if (this.disposed || this.timer) return;
    const seat = pendingSeat(this.state);
    if (seat === null) return;
    const control = this.seats[seat]!;
    if (control.kind === 'bot' || (control.kind === 'human' && control.autopilot) || control.kind === 'none') {
      const [lo, hi] = this.opts.botDelay ?? [450, 900];
      const difficulty = control.kind === 'bot' ? control.difficulty : 'normal';
      this.later(wait + lo + Math.random() * (hi - lo), () => this.botMove(seat, difficulty));
    } else if (this.opts.turnTimeoutMs) {
      const limit = this.opts.turnTimeoutMs;
      this.deadline = Date.now() + wait + limit;
      this.later(wait + limit, () => {
        this.opts.onAutoPlay?.(seat);
        this.botMove(seat, 'normal');
      });
    }
  }

  private botMove(seat: Seat, difficulty: Difficulty): void {
    if (pendingSeat(this.state) !== seat) return;
    const rng = createRng(`bot:${this.seq}:${seat}:${Math.random()}`);
    this.applyAction(seat, botAction(viewFor(this.state, seat), difficulty, rng));
  }
}
