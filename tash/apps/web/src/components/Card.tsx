import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef } from 'react';
import { rankOf, suitOf, type CardId, type Suit } from '@tash/engine';
import { useSettings } from '../app/settings';
import { useT } from '../i18n/i18n';

export const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(card: CardId): string {
  const r = rankOf(card);
  return RANK_LABEL[r] ?? String(r);
}

export function suitColour(suit: Suit, fourColour: boolean): string {
  if (fourColour) return { S: 'var(--suit-black)', H: 'var(--suit-red)', D: 'var(--suit-blue)', C: 'var(--suit-green)' }[suit];
  return suit === 'H' || suit === 'D' ? 'var(--suit-red)' : 'var(--suit-black)';
}

export function useCardLabel(): (card: CardId) => string {
  const t = useT();
  return (card) => t('card.label', { rank: t(`rank.${rankOf(card)}`), suit: t(`suit.${suitOf(card)}`) });
}

type CardProps = Omit<HTMLMotionProps<'div'>, 'id'> & {
  card: CardId | null;
  size?: 'md' | 'sm' | 'xs';
  dim?: boolean;
  label?: string;
};

/** A playing card drawn entirely in code. `card = null` draws the back. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { card, size = 'md', dim, label, className = '', style, ...rest },
  ref,
) {
  const fourColour = useSettings((s) => s.fourColour);
  const cardLabel = useCardLabel();
  const t = useT();
  const sizeCls = size === 'md' ? '' : size;
  if (!card) {
    return (
      <motion.div
        ref={ref}
        className={`card card-back ${sizeCls} ${className}`}
        style={style}
        role="img"
        aria-label={label ?? t('card.back')}
        {...rest}
      />
    );
  }
  const suit = suitOf(card);
  const r = rankOf(card);
  const colour = suitColour(suit, fourColour);
  const isFace = r >= 11 && r <= 13;
  return (
    <motion.div
      ref={ref}
      className={`card no-select ${sizeCls} ${dim ? 'dim' : ''} ${className}`}
      style={{ ...style, color: colour }}
      role="img"
      aria-label={label ?? cardLabel(card)}
      {...rest}
    >
      <span className="idx tl" aria-hidden>
        <span>{rankLabel(card)}</span>
        <span className="s">{SUIT_GLYPH[suit]}</span>
      </span>
      {size !== 'xs' && (
        <span className="idx br" aria-hidden>
          <span>{rankLabel(card)}</span>
          <span className="s">{SUIT_GLYPH[suit]}</span>
        </span>
      )}
      <span className="pip" aria-hidden>
        {isFace ? <span className="face-letter">{rankLabel(card)}</span> : SUIT_GLYPH[suit]}
      </span>
    </motion.div>
  );
});

/** A suit symbol on UI surfaces: black suits use the text colour so they stay visible in dark mode. */
export function SuitIcon({ suit, className = '' }: { suit: Suit; className?: string }) {
  const fourColour = useSettings((s) => s.fourColour);
  const colour = suitColour(suit, fourColour);
  return (
    <span className={className} style={{ color: colour === 'var(--suit-black)' ? 'currentColor' : colour }} aria-hidden>
      {SUIT_GLYPH[suit]}
    </span>
  );
}
