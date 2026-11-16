import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { nextSeat, type BaseEvent, type BaseView, type CardId, type Seat, type Trick } from '@tash/engine';
import { useSettings } from '../app/settings';
import { Hand } from '../components/Hand';
import { Seat as SeatChip } from '../components/Seat';
import { relativeSeat } from '../components/TrickArea';
import { nextFxId, type Display, type Step } from '../director/useDirector';
import { translate, useT } from '../i18n/i18n';
import type { PlayerInfo } from '../session/types';

export interface TableProps<V extends BaseView> {
  display: Display<V>;
  players: PlayerInfo[];
  send: (action: unknown) => void;
  emotes: Partial<Record<Seat, { text: string; id: number }>>;
}

/** Translate outside React (used inside director steps). */
export const tr = (key: string, params?: Record<string, string | number>) => translate(useSettings.getState().lang, key, params);

export function playerName(players: PlayerInfo[], seat: Seat): string {
  const p = players[seat];
  if (!p) return '?';
  return p.kind === 'you' ? tr('common.you') : p.name;
}

export interface TrickView extends BaseView {
  hand: CardId[];
  handCounts: number[];
  trick: Trick;
  turn: Seat;
}

export function bubble<V extends BaseView>(seat: Seat, text: string): (d: Display<V>) => Display<V> {
  return (d) => ({ ...d, fx: { ...d.fx, bubbles: { ...d.fx.bubbles, [seat]: { text, id: nextFxId() } } } });
}

export function banner<V extends BaseView>(text: string): (d: Display<V>) => Display<V> {
  return (d) => ({ ...d, fx: { ...d.fx, banner: { text, id: nextFxId() } } });
}

/** Director steps shared by Call Bridge and Twenty-nine. Returns null for events it does not handle. */
export function trickSteps<V extends TrickView>(
  event: BaseEvent,
  finalView: V,
  onTrickWon?: (v: V, seat: Seat, e: BaseEvent) => V,
): Step<V>[] | null {
  switch (event.type) {
    case 'cardPlayed': {
      const { seat, card } = event as unknown as { seat: Seat; card: CardId };
      return [
        {
          apply: (d) => {
            const v = d.view;
            const handCounts = [...v.handCounts];
            handCounts[seat] = Math.max(0, handCounts[seat]! - 1);
            return {
              ...d,
              view: {
                ...v,
                hand: seat === v.seat ? v.hand.filter((c) => c !== card) : v.hand,
                handCounts,
                trick: { ...v.trick, cards: [...v.trick.cards, { seat, card }] },
                turn: nextSeat(seat),
                pending: [],
              },
            };
          },
          sound: 'play',
          wait: 330,
        },
      ];
    }
    case 'trickWon': {
      const { seat } = event as unknown as { seat: Seat };
      return [
        { wait: 620 },
        { apply: (d) => ({ ...d, fx: { ...d.fx, sweepTo: seat } }), sound: 'win', wait: 400 },
        {
          apply: (d) => {
            const v = { ...d.view, trick: { leader: seat, cards: [] }, turn: seat };
            return { ...d, view: onTrickWon ? onTrickWon(v, seat, event) : v, fx: { ...d.fx, sweepTo: null } };
          },
          wait: 60,
        },
      ];
    }
    case 'dealt':
      return [{ apply: (d) => ({ ...d, view: finalView }), sound: 'deal', wait: 900 }];
    case 'roundScored':
      return [{ sound: 'score', wait: 350 }];
    default:
      return null;
  }
}

type TableView = BaseView & { hand: CardId[]; handCounts: number[] };

interface TrickTableProps<V extends TableView> extends TableProps<V> {
  stats: (seat: Seat) => ReactNode;
  badge?: (seat: Seat) => ReactNode;
  teamColour?: (seat: Seat) => string | undefined;
  /** Content in the centre of the table (the trick, the showdown, …). */
  center: ReactNode;
  /** Info pinned to the top-left corner of the table (trump, target, …). */
  corner?: ReactNode;
  /** Game controls shown above the hand (call picker, bid ladder, …). */
  controls?: ReactNode;
  /** Replace the hand row entirely (Hazari arranging). */
  handArea?: ReactNode;
  legal: CardId[] | null;
  onIllegal?: (card: CardId) => void;
  activeSeats: Seat[];
  /** Show face-down card fans beside opponents (trick games). */
  showCounts?: boolean;
}

/** The shared table: opponents around the edge, centre area, controls, and the player's hand. */
export function TrickTable<V extends TableView>({
  display,
  players,
  send,
  emotes,
  stats,
  badge,
  teamColour,
  center,
  corner,
  controls,
  handArea,
  legal,
  onIllegal,
  activeSeats,
  showCounts = true,
}: TrickTableProps<V>) {
  const t = useT();
  const { view, fx, busy, deadline } = display;
  const me = view.seat;
  const others = [1, 2, 3].map((k) => nextSeat(me, k));
  const myTurn = activeSeats.includes(me) && !busy;

  const chip = (seat: Seat) => (
    <SeatChip
      player={players[seat]!}
      position={relativeSeat(seat, me)}
      active={activeSeats.includes(seat)}
      dealer={view.dealer === seat}
      stats={stats(seat)}
      badge={badge?.(seat)}
      cardCount={showCounts ? view.handCounts[seat] : undefined}
      bubble={fx.bubbles[seat]}
      emote={emotes[seat]}
      deadline={activeSeats.includes(seat) ? deadline : null}
      teamColour={teamColour?.(seat)}
    />
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: 'var(--table)' }}>
        <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2">{chip(others[1]!)}</div>
        <div className="absolute left-2 top-[42%] z-10 -translate-y-1/2 sm:left-4">{chip(others[2]!)}</div>
        <div className="absolute right-2 top-[42%] z-10 -translate-y-1/2 sm:right-4">{chip(others[0]!)}</div>
        {corner && <div className="absolute bottom-2 left-2 z-10 sm:left-4">{corner}</div>}
        <div className="absolute inset-0 grid place-items-center pt-10">{center}</div>
        <AnimatePresence>
          {fx.banner && (
            <motion.div
              key={fx.banner.id}
              className="pointer-events-none absolute inset-x-0 top-[30%] z-20 flex justify-center"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.85, 1, 1, 0.95] }}
              transition={{ duration: 2.2, times: [0, 0.12, 0.8, 1] }}
            >
              <div className="rounded-2xl bg-text px-5 py-2.5 text-base font-bold text-bg shadow-[var(--shadow-3)]">{fx.banner.text}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative z-20 bg-bg">
        <div className="flex items-center justify-between gap-3 px-3 pt-2 sm:px-5">
          <SeatChip
            player={players[me]!}
            position="bottom"
            active={activeSeats.includes(me)}
            dealer={view.dealer === me}
            stats={stats(me)}
            badge={badge?.(me)}
            bubble={fx.bubbles[me]}
            emote={emotes[me]}
            deadline={activeSeats.includes(me) ? deadline : null}
            teamColour={teamColour?.(me)}
          />
          <AnimatePresence>
            {myTurn && (
              <motion.span
                className="chip pulse bg-accent text-accent-contrast"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                role="status"
              >
                {t('table.yourTurn')}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence mode="popLayout">
          {controls && !busy && (
            <motion.div
              key="controls"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="px-3 pt-2 sm:px-5"
            >
              {controls}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="pb-safe px-4 pt-1 sm:px-6">
          {handArea ?? (
            <Hand
              cards={view.hand}
              legal={legal}
              disabled={busy}
              onPlay={(card) => send({ type: 'play', card })}
              onIllegal={onIllegal}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ControlPanel({ title, children, hint }: { title?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="panel mx-auto max-w-xl p-3 sm:p-4" role="group" aria-label={typeof title === 'string' ? title : undefined}>
      {title && <div className="mb-2 text-center text-sm font-semibold">{title}</div>}
      {children}
      {hint && <div className="mt-2 text-center text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Small score-table helper. */
export function ScoreTable({ head, rows, highlightRow }: { head: ReactNode[]; rows: ReactNode[][]; highlightRow?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className={`px-2 py-1.5 font-semibold ${i ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-line ${highlightRow === i ? 'bg-surface-2' : ''}`}>
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-2 ${j ? 'text-right' : 'font-semibold'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Delta({ value, format = (n: number) => String(n) }: { value: number; format?: (n: number) => string }) {
  const cls = value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-muted';
  return (
    <motion.span className={`font-bold ${cls}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      {value > 0 ? '+' : ''}
      {format(value)}
    </motion.span>
  );
}
