import { motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CardId } from '@tash/engine';
import { useReducedMotion, useSettings } from '../app/settings';
import { buzz, playSound } from '../app/sound';
import { Card } from './Card';

interface HandProps {
  cards: CardId[];
  /** Cards that may be played now; null means it is not this player's turn to play. */
  legal: CardId[] | null;
  onPlay?: (card: CardId) => void;
  /** Called when the player tries an illegal card, to explain why. */
  onIllegal?: (card: CardId) => void;
  disabled?: boolean;
}

/** The local player's hand: an overlapping row that always fits the screen width. */
export function Hand({ cards, legal, onPlay, onIllegal, disabled }: HandProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [cardW, setCardW] = useState(60);
  const [selected, setSelected] = useState<CardId | null>(null);
  const [shaking, setShaking] = useState<CardId | null>(null);
  const [hovered, setHovered] = useState<CardId | null>(null);
  const singleTap = useSettings((s) => s.singleTap);
  const reduced = useReducedMotion();
  const known = useRef(new Set<CardId>());
  const buttons = useRef(new Map<CardId, HTMLButtonElement>());

  useLayoutEffect(() => {
    const measure = () => {
      if (wrap.current) setWidth(wrap.current.clientWidth);
      if (probe.current) setCardW(probe.current.offsetWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (selected && (!cards.includes(selected) || !legal?.includes(selected))) setSelected(null);
  }, [cards, legal, selected]);

  // Cards that were not in the hand before animate in from the deck (a deal).
  const newCards = cards.filter((c) => !known.current.has(c));
  useEffect(() => {
    known.current = new Set(cards);
  }, [cards]);

  const n = cards.length;
  const maxStep = cardW * 0.62;
  const step = n > 1 ? Math.max(Math.min(maxStep, (width - cardW) / (n - 1)), cardW * 0.18) : 0;
  const total = n > 0 ? cardW + step * (n - 1) : 0;
  const myTurn = legal !== null && !disabled;

  const tryPlay = (card: CardId) => {
    if (!myTurn) return;
    if (!legal!.includes(card)) {
      setShaking(card);
      setTimeout(() => setShaking(null), 400);
      playSound('error');
      onIllegal?.(card);
      return;
    }
    setSelected(null);
    buzz(8);
    onPlay?.(card);
  };

  const onTap = (card: CardId) => {
    if (!myTurn) return;
    if (!legal!.includes(card)) return tryPlay(card);
    if (singleTap || selected === card) tryPlay(card);
    else setSelected(card);
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = cards[(i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n]!;
      buttons.current.get(next)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tryPlay(cards[i]!);
    }
  };

  return (
    <div ref={wrap} className="relative w-full" style={{ height: `calc(${cardW}px * 1.4 + 22px)` }}>
      <div ref={probe} className="card pointer-events-none invisible absolute" aria-hidden />
      <div
        className="absolute bottom-0 left-1/2"
        style={{ width: total, height: cardW * 1.4, transform: 'translateX(-50%)' }}
        role="listbox"
        aria-label="Hand"
      >
        {cards.map((card, i) => {
          const isLegal = legal?.includes(card) ?? false;
          const lifted = selected === card;
          const dealIndex = newCards.indexOf(card);
          const isNew = dealIndex >= 0;
          return (
            <motion.button
              key={card}
              ref={(el) => {
                if (el) buttons.current.set(card, el);
                else buttons.current.delete(card);
              }}
              type="button"
              role="option"
              data-testid="hand-card"
              data-card={card}
              aria-selected={lifted}
              aria-disabled={!myTurn || !isLegal}
              onClick={() => onTap(card)}
              onKeyDown={(e) => onKey(e, i)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(card)}
              onPointerLeave={() => setHovered((h) => (h === card ? null : h))}
              className={`absolute bottom-0 rounded-[10%] p-0 border-0 bg-transparent ${shaking === card ? 'shake' : ''}`}
              style={{ left: 0, zIndex: i + 1, touchAction: 'none' }}
              initial={isNew ? (reduced ? { opacity: 0, x: i * step } : { x: total / 2 - cardW / 2, y: -260, opacity: 0, rotate: -8, scale: 0.7 }) : false}
              animate={{ x: i * step, y: 0, opacity: 1, rotate: 0, scale: 1 }}
              transition={
                isNew
                  ? { type: 'spring', stiffness: 380, damping: 32, delay: reduced ? 0 : dealIndex * 0.03 }
                  : { type: 'spring', stiffness: 500, damping: 36 }
              }
              drag={myTurn && isLegal && !reduced ? 'y' : false}
              dragConstraints={{ top: -140, bottom: 0 }}
              dragElastic={0.2}
              dragSnapToOrigin
              onDragEnd={(_, info) => {
                if (info.offset.y < -60) tryPlay(card);
              }}
            >
              {/* The button's hit area stays put; only the card inside lifts, so hovering never jitters. */}
              <motion.div
                animate={{ y: lifted ? -cardW * 0.32 : myTurn && isLegal ? (hovered === card ? -cardW * 0.16 : -6) : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              >
                <Card card={card} layoutId={`card-${card}`} dim={myTurn && !isLegal} />
              </motion.div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
