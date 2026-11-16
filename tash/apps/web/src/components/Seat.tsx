import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n/i18n';
import type { PlayerInfo } from '../session/types';
import { Card } from './Card';

export type SeatPosition = 'bottom' | 'right' | 'top' | 'left';

interface SeatProps {
  player: PlayerInfo;
  position: SeatPosition;
  active: boolean;
  dealer?: boolean;
  /** Short stat line, e.g. "Call 4 · Won 2". */
  stats?: ReactNode;
  /** Badge shown beside the name (team colour, ready, bidder). */
  badge?: ReactNode;
  cardCount?: number;
  bubble?: { text: string; id: number };
  emote?: { text: string; id: number };
  deadline?: number | null;
  teamColour?: string;
  highlight?: boolean;
}

const AVATAR_COLOURS = ['#6c8cff', '#e0663f', '#1f9d6b', '#d9901a', '#a78bfa', '#e0567a', '#14a38b'];

function avatarColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length]!;
}

/** Countdown ring around the avatar while it is this seat's turn. */
function TurnRing({ deadline, active }: { deadline?: number | null; active: boolean }) {
  const [now, setNow] = useState(Date.now());
  const span = useRef<{ deadline: number; total: number } | null>(null);
  if (deadline && span.current?.deadline !== deadline) span.current = { deadline, total: Math.max(1000, deadline - Date.now()) };
  useEffect(() => {
    if (!active || !deadline) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active, deadline]);
  if (!active) return null;
  const r = 23;
  const c = 2 * Math.PI * r;
  const left = deadline ? Math.max(0, deadline - now) : null;
  const frac = left === null || !span.current ? 1 : Math.min(1, left / span.current.total);
  const urgent = left !== null && left < 8000;
  return (
    <svg className="pointer-events-none absolute -inset-[5px]" viewBox="0 0 50 50" aria-hidden>
      <circle cx="25" cy="25" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="3" />
      <motion.circle
        cx="25"
        cy="25"
        r={r}
        fill="none"
        stroke={urgent ? 'var(--danger)' : 'var(--accent)'}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        animate={{ strokeDashoffset: c * (1 - frac) }}
        transition={{ duration: 0.25, ease: 'linear' }}
        transform="rotate(-90 25 25)"
      />
    </svg>
  );
}

export function Seat({
  player,
  position,
  active,
  dealer,
  stats,
  badge,
  cardCount,
  bubble,
  emote,
  deadline,
  teamColour,
  highlight,
}: SeatProps) {
  const t = useT();
  const [showBubble, setShowBubble] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    if (!bubble) return;
    setShowBubble(bubble);
    const id = setTimeout(() => setShowBubble(null), 1800);
    return () => clearTimeout(id);
  }, [bubble?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showEmote, setShowEmote] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    if (!emote) return;
    setShowEmote(emote);
    const id = setTimeout(() => setShowEmote(null), 2200);
    return () => clearTimeout(id);
  }, [emote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = player.kind === 'you' ? t('common.you') : player.name;
  const away = player.kind === 'human' && !player.connected;
  const vertical = position === 'left' || position === 'right';
  const bubbleSide =
    position === 'top' ? 'top-full mt-2' : position === 'bottom' ? 'bottom-full mb-2' : position === 'left' ? 'left-full ml-2 top-0' : 'right-full mr-2 top-0';

  return (
    <div
      className={`relative flex items-center gap-2 ${vertical ? 'flex-col text-center' : ''}`}
      data-testid={`seat-${position}`}
      aria-current={active ? 'true' : undefined}
    >
      <div className="relative shrink-0">
        <motion.div
          className="grid h-11 w-11 place-items-center rounded-full text-base font-bold text-white"
          style={{
            background: avatarColour(player.name),
            boxShadow: teamColour ? `0 0 0 2.5px var(--bg), 0 0 0 4.5px ${teamColour}` : undefined,
            opacity: away ? 0.5 : 1,
          }}
          animate={highlight ? { scale: [1, 1.15, 1] } : { scale: 1 }}
          transition={{ duration: 0.6 }}
        >
          {player.kind === 'bot' ? '🤖' : (name[0] ?? '?').toUpperCase()}
        </motion.div>
        <TurnRing deadline={deadline} active={active} />
        {dealer && (
          <span
            className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-surface text-[10px] font-bold text-text shadow"
            title={t('table.dealer')}
            aria-label={t('table.dealer')}
          >
            D
          </span>
        )}
      </div>
      <div className={`min-w-0 ${vertical ? 'max-w-[5.5rem]' : 'max-w-[9rem]'}`}>
        <div className={`flex items-center gap-1 ${vertical ? 'justify-center' : ''}`}>
          <span className={`truncate text-sm font-semibold ${active ? 'text-accent' : ''}`}>{name}</span>
          {badge}
        </div>
        <div className="tabular truncate text-xs text-muted">
          {away ? t('table.away') : player.autopilot ? t('table.autopilot') : stats}
        </div>
      </div>
      {cardCount !== undefined && cardCount > 0 && position !== 'bottom' && (
        <div className="pointer-events-none hidden items-center md:flex" aria-label={t('card.cards', { n: cardCount })}>
          {Array.from({ length: Math.min(cardCount, 8) }, (_, i) => (
            <Card key={i} card={null} size="xs" style={{ marginLeft: i ? -16 : 0 }} />
          ))}
        </div>
      )}
      <AnimatePresence>
        {showBubble && (
          <motion.div
            key={showBubble.id}
            className={`absolute z-30 whitespace-nowrap rounded-2xl bg-text px-3 py-1.5 text-sm font-bold text-bg shadow-lg ${bubbleSide}`}
            initial={{ opacity: 0, scale: 0.6, y: position === 'top' ? -6 : 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 520, damping: 28 }}
            role="status"
          >
            {showBubble.text}
          </motion.div>
        )}
        {showEmote && (
          <motion.div
            key={`e${showEmote.id}`}
            className="pointer-events-none absolute -top-6 left-2 z-30 text-3xl"
            initial={{ opacity: 0, y: 10, scale: 0.5 }}
            animate={{ opacity: 1, y: -14, scale: 1.2 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.4 }}
          >
            {showEmote.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
