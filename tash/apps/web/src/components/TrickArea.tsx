import { AnimatePresence, motion } from 'motion/react';
import type { PlayedCard, Seat } from '@tash/engine';
import { useReducedMotion } from '../app/settings';
import { useCardWidth } from '../hooks/useCardWidth';
import { Card } from './Card';
import type { SeatPosition } from './Seat';

export function relativeSeat(seat: Seat, me: Seat): SeatPosition {
  return (['bottom', 'right', 'top', 'left'] as const)[(seat - me + 4) % 4]!;
}

/** Where a card enters from / leaves to, for each table position. */
export function farPoint(pos: SeatPosition): { x: number; y: number } {
  const w = typeof window === 'undefined' ? 800 : window.innerWidth;
  const h = typeof window === 'undefined' ? 600 : window.innerHeight;
  return {
    bottom: { x: 0, y: h * 0.32 },
    right: { x: w * 0.38, y: 0 },
    top: { x: 0, y: -h * 0.32 },
    left: { x: -w * 0.38, y: 0 },
  }[pos];
}

/** Resting place of each seat's card in the trick, as a fraction of the card size. */
const SLOT: Record<SeatPosition, { x: number; y: number; r: number }> = {
  bottom: { x: 0, y: 0.42, r: -2 },
  right: { x: 0.62, y: 0, r: 4 },
  top: { x: 0, y: -0.42, r: 2 },
  left: { x: -0.62, y: 0, r: -4 },
};

interface TrickAreaProps {
  cards: PlayedCard[];
  me: Seat;
  sweepTo: Seat | null;
  /** Seat whose card is currently winning (highlighted). */
  winning?: Seat | null;
}

export function TrickArea({ cards, me, sweepTo, winning }: TrickAreaProps) {
  const reduced = useReducedMotion();
  const cw = useCardWidth();
  const sweep = sweepTo === null ? null : farPoint(relativeSeat(sweepTo, me));
  return (
    <div className="pointer-events-none relative" style={{ width: cw * 2.4, height: cw * 2.6 }}>
      <AnimatePresence>
        {cards.map((p, i) => {
          const pos = relativeSeat(p.seat, me);
          const slot = SLOT[pos];
          const mine = p.seat === me;
          return (
            <motion.div
              key={p.card}
              className="absolute left-1/2 top-1/2"
              style={{ zIndex: i + 1, marginLeft: -cw / 2, marginTop: -cw * 0.7 }}
              initial={mine || reduced ? { opacity: reduced ? 0 : 1 } : { ...farPoint(pos), opacity: 0, rotate: slot.r * 4 }}
              animate={
                sweep
                  ? reduced
                    ? { opacity: 0, transition: { duration: 0.2 } }
                    : { x: sweep.x, y: sweep.y, scale: 0.5, opacity: 0, transition: { duration: 0.38, ease: [0.4, 0, 0.6, 1] } }
                  : {
                      x: cw * slot.x,
                      y: cw * slot.y,
                      rotate: slot.r,
                      opacity: 1,
                      scale: 1,
                    }
              }
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >
              <Card
                card={p.card}
                layoutId={mine ? `card-${p.card}` : undefined}
                style={winning === p.seat && cards.length > 1 ? { boxShadow: '0 0 0 2.5px var(--accent), var(--shadow-2)' } : undefined}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
