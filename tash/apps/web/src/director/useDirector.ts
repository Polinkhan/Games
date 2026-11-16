import { useEffect, useRef, useState } from 'react';
import type { BaseEvent, BaseView, Seat } from '@tash/engine';
import { prefersReducedMotion } from '../app/settings';
import { playSound, type SoundName } from '../app/sound';
import type { GameSession, SessionUpdate } from '../session/types';

/** Transient visual state the director drives alongside the view. */
export interface Fx {
  /** Trick cards are flying to this seat. */
  sweepTo: Seat | null;
  /** Speech bubbles (calls, bids, "Pair!"). A new id re-triggers the bubble. */
  bubbles: Partial<Record<Seat, { text: string; id: number }>>;
  /** Short centre banner. */
  banner: { text: string; id: number } | null;
  /** Increments on every deal, so hands replay their deal animation. */
  dealId: number;
  /** Increments when trump is revealed (Twenty-nine). */
  trumpFlip: number;
  /** Hazari showdown progress: which trick, how many groups are face up, and the winner once known. */
  showdown: {
    index: number;
    revealed: number;
    winner: Seat | null;
    plays: { seat: Seat; cards: string[]; combo: string }[];
    points: number;
  } | null;
}

export interface Display<V extends BaseView = BaseView> {
  view: V;
  fx: Fx;
  deadline: number | null;
  /** True while events are being animated; input is disabled. */
  busy: boolean;
}

export interface Step<V extends BaseView = BaseView> {
  apply?: (d: Display<V>) => Display<V>;
  /** Pause after applying, in ms (shortened when motion is reduced). */
  wait?: number;
  sound?: SoundName;
}

export type StepFn<V extends BaseView> = (event: BaseEvent, current: Display<V>, finalView: V) => Step<V>[];

const emptyFx = (): Fx => ({ sweepTo: null, bubbles: {}, banner: null, dealId: 0, trumpFlip: 0, showdown: null });

let fxId = 1;
export const nextFxId = () => fxId++;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays each update's events one after another, applying the matching piece of the
 * view as each animation finishes, then snaps to the authoritative view. Without this,
 * a fast server would make cards teleport.
 */
export function useDirector<V extends BaseView>(session: GameSession, steps: StepFn<V>): Display<V> | null {
  const [display, setDisplay] = useState<Display<V> | null>(null);
  const current = useRef<Display<V> | null>(null);
  const queue = useRef<SessionUpdate[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  useEffect(() => {
    alive.current = true;
    const commit = (d: Display<V>) => {
      current.current = d;
      if (alive.current) setDisplay(d);
    };
    const snap = (u: SessionUpdate, busy: boolean) => {
      const prev = current.current;
      commit({
        view: u.view as V,
        deadline: u.deadline,
        busy,
        fx: prev ? { ...prev.fx, sweepTo: null, showdown: null } : emptyFx(),
      });
    };

    const pump = async () => {
      if (running.current) return;
      running.current = true;
      try {
        while (queue.current.length && alive.current) {
          const pendingEvents = queue.current.reduce((n, u) => n + u.events.length, 0);
          if (pendingEvents > 12) {
            // Far behind (e.g. after a reconnect): skip straight to the latest view.
            const last = queue.current[queue.current.length - 1]!;
            queue.current = [];
            snap(last, false);
            continue;
          }
          const u = queue.current.shift()!;
          if (!current.current || u.events.length === 0) {
            snap(u, queue.current.length > 0);
            continue;
          }
          const speed = prefersReducedMotion() ? 0.35 : 1;
          commit({ ...current.current, busy: true });
          for (const event of u.events) {
            for (const step of stepsRef.current(event, current.current!, u.view as V)) {
              if (!alive.current) return;
              if (step.apply) commit({ ...step.apply(current.current!), busy: true });
              if (step.sound) playSound(step.sound);
              if (step.wait) await sleep(step.wait * speed);
            }
          }
          snap(u, queue.current.length > 0);
        }
      } finally {
        running.current = false;
      }
    };

    const unsubscribe = session.subscribe((u) => {
      queue.current.push(u);
      void pump();
    });
    return () => {
      alive.current = false;
      unsubscribe();
      queue.current = [];
      current.current = null;
      running.current = false;
    };
  }, [session]);

  return display;
}
