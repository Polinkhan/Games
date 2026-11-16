import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  evaluate3,
  evaluate4,
  greedyArrangement,
  searchArrangement,
  sortHand,
  validateGroups,
  type CardId,
  type Groups,
  type HazariView,
} from '@tash/engine';
import { Card, useCardLabel } from '../../components/Card';
import { toast } from '../../components/Sheet';
import { useT } from '../../i18n/i18n';

const SIZES = [3, 3, 3, 4];
type Container = 0 | 1 | 2 | 3 | 'tray';

interface Draft {
  rows: CardId[][];
  tray: CardId[];
}

const DRAFT_KEY = 'tash.hazari.draft';

function loadDraft(hand: CardId[]): Draft | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    if (!d) return null;
    const all = [...d.rows.flat(), ...d.tray].sort();
    if (all.join() !== [...hand].sort().join()) return null;
    return d;
  } catch {
    return null;
  }
}

function DraggableCard({ card, selected, onTap, disabled }: { card: CardId; selected: boolean; onTap: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card, disabled });
  const label = useCardLabel();
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onTap();
        else listeners?.onKeyDown?.(e);
      }}
      aria-pressed={selected}
      aria-label={label(card)}
      className="relative rounded-[10%]"
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 50 : selected ? 5 : 1,
        touchAction: 'none',
        cursor: disabled ? 'default' : 'grab',
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, y: selected ? -10 : 0, scale: isDragging ? 1.08 : 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
      >
        <Card card={card} size="sm" label="" style={selected ? { boxShadow: '0 0 0 2.5px var(--accent), var(--shadow-2)' } : undefined} />
      </motion.div>
    </div>
  );
}

function Row({
  index,
  cards,
  invalid,
  label,
  onTap,
  children,
}: {
  index: number;
  cards: CardId[];
  invalid: boolean;
  label: string | null;
  onTap: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: `row-${index}` });
  const full = cards.length === SIZES[index];
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => e.target === e.currentTarget && onTap()}
      className={`flex min-h-[calc(var(--card-w)*1.4*0.62+28px)] items-center gap-2 rounded-2xl border-2 px-2 py-1.5 transition-colors ${
        invalid ? 'border-danger bg-danger/10' : isOver ? 'border-accent bg-accent/10' : full ? 'border-line bg-surface' : 'border-dashed border-line bg-surface-2'
      }`}
      data-testid={`hz-row-${index}`}
    >
      <button type="button" onClick={onTap} className="w-[4.5rem] shrink-0 whitespace-nowrap text-left text-xs leading-tight">
        <div className="font-semibold">{t('hz.group', { n: index + 1 })}</div>
        <div className={invalid ? 'text-danger' : 'text-muted'}>{invalid ? t('hz.tooStrong') : label ?? `${cards.length}/${SIZES[index]}`}</div>
      </button>
      <div className="flex flex-1 items-center gap-1" onClick={(e) => e.target === e.currentTarget && onTap()}>
        {children}
        {Array.from({ length: SIZES[index]! - cards.length }, (_, i) => (
          <div key={`empty-${i}`} onClick={onTap} className="card sm rounded-[10%] border-2 border-dashed border-line !bg-transparent !shadow-none" aria-hidden />
        ))}
      </div>
    </div>
  );
}

function Tray({ onTap, children, empty }: { onTap: () => void; children: ReactNode; empty: boolean }) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' });
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => e.target === e.currentTarget && onTap()}
      className={`flex min-h-[calc(var(--card-w)*1.4*0.62+16px)] flex-wrap items-center justify-center gap-1 rounded-2xl p-2 ${isOver ? 'bg-accent/10' : 'bg-surface-2'}`}
      aria-label={t('hz.tray')}
    >
      {children}
      {empty && <span className="text-xs text-muted">✓</span>}
    </div>
  );
}

export function ArrangeBoard({ view, send }: { view: HazariView; send: (a: unknown) => void }) {
  const t = useT();
  const locked = view.myArrangement !== null;
  const hand = view.hand;
  const [draft, setDraft] = useState<Draft>(() => {
    if (view.myArrangement) return { rows: view.myArrangement.map((g) => [...g]), tray: [] };
    return loadDraft(hand) ?? { rows: [[], [], [], []], tray: sortHand(hand) };
  });
  const [selected, setSelected] = useState<CardId | null>(null);

  // New deal: reset.
  const handKey = [...hand].sort().join();
  useEffect(() => {
    if (view.myArrangement) setDraft({ rows: view.myArrangement.map((g) => [...g]), tray: [] });
    else setDraft((d) => (loadDraft(hand) ?? ([...d.rows.flat(), ...d.tray].sort().join() === handKey ? d : { rows: [[], [], [], []], tray: sortHand(hand) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey, locked]);

  useEffect(() => {
    try {
      if (!locked) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft, locked]);

  const combos = useMemo(
    () => draft.rows.map((r, i) => (r.length === SIZES[i] ? (i === 3 ? evaluate4(r) : evaluate3(r)) : null)),
    [draft.rows],
  );
  const invalid = combos.map((c, i) => {
    if (!c || i === 0) return false;
    const prev = combos[i - 1];
    return prev ? c.base > prev.base : false;
  });
  const complete = draft.rows.every((r, i) => r.length === SIZES[i]);
  const valid = complete && validateGroups(hand, draft.rows as Groups) === null;

  const where = (card: CardId): Container => {
    const i = draft.rows.findIndex((r) => r.includes(card));
    return i < 0 ? 'tray' : (i as Container);
  };

  const move = (card: CardId, to: Container) => {
    setDraft((d) => {
      const rows = d.rows.map((r) => [...r]);
      let tray = [...d.tray];
      const from: Container = rows.findIndex((r) => r.includes(card)) as Container;
      const fromC: Container = (from as number) < 0 ? 'tray' : from;
      if (fromC === to) return d;
      const take = (c: Container, x: CardId) => {
        if (c === 'tray') tray = tray.filter((y) => y !== x);
        else rows[c] = rows[c]!.filter((y) => y !== x);
      };
      const put = (c: Container, x: CardId) => {
        if (c === 'tray') tray = sortHand([...tray, x]);
        else rows[c] = [...rows[c]!, x];
      };
      take(fromC, card);
      if (to !== 'tray' && rows[to]!.length >= SIZES[to]!) {
        // Full row: swap with its last card.
        const out = rows[to]![rows[to]!.length - 1]!;
        take(to, out);
        put(fromC, out);
      }
      put(to, card);
      return { rows, tray };
    });
  };

  const swap = (a: CardId, b: CardId) => {
    setDraft((d) => {
      const rows = d.rows.map((r) => r.map((c) => (c === a ? b : c === b ? a : c)));
      const tray = d.tray.map((c) => (c === a ? b : c === b ? a : c));
      return { rows, tray: sortHand(tray) };
    });
  };

  const tapCard = (card: CardId) => {
    if (locked) return;
    if (!selected) setSelected(card);
    else if (selected === card) setSelected(null);
    else if (where(selected) !== where(card)) {
      swap(selected, card);
      setSelected(null);
    } else setSelected(card);
  };

  const tapContainer = (c: Container) => {
    if (locked || !selected) return;
    move(selected, c);
    setSelected(null);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const card = String(e.active.id);
    const over = e.over?.id;
    if (!over) return;
    setSelected(null);
    if (over === 'tray') move(card, 'tray');
    else move(card, Number(String(over).replace('row-', '')) as Container);
  };

  const apply = (groups: Groups) => {
    setDraft({ rows: groups.map((g) => [...g]), tray: [] });
    setSelected(null);
  };

  const ready = () => {
    const groups = draft.rows as Groups;
    const reason = validateGroups(hand, groups);
    if (reason) return toast(t(`reason.${reason}`) || t('reason.generic'), 'error');
    send({ type: 'arrange', groups });
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  const comboName = (i: number) => (combos[i] ? t(`hz.combo.${combos[i]!.type}`) : null);

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="mx-auto flex max-w-2xl flex-col gap-2" data-testid="hz-board">
        {!locked && (
          <div className="text-center text-xs text-muted">
            {t('hz.arrangeHint')} {selected ? `· ${t('hz.dropHere')}` : ''}
          </div>
        )}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {draft.rows.map((row, i) => (
            <Row key={i} index={i} cards={row} invalid={invalid[i]!} label={comboName(i)} onTap={() => tapContainer(i as Container)}>
              {row.map((c) => (
                <DraggableCard key={c} card={c} selected={selected === c} onTap={() => tapCard(c)} disabled={locked} />
              ))}
            </Row>
          ))}
        </div>
        {!locked && (
          <Tray onTap={() => tapContainer('tray')} empty={draft.tray.length === 0}>
            {draft.tray.map((c) => (
              <DraggableCard key={c} card={c} selected={selected === c} onTap={() => tapCard(c)} disabled={locked} />
            ))}
          </Tray>
        )}
        <div className="flex items-center justify-center gap-2">
          {locked ? (
            <>
              <span className="text-sm text-muted">{t('hz.waitingOthers')}</span>
              <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'unlock' })}>
                {t('hz.edit')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => apply(searchArrangement(hand))} data-testid="hz-suggest">
                {t('hz.suggest')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => apply(greedyArrangement(hand))}>
                {t('hz.autoSort')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft({ rows: [[], [], [], []], tray: sortHand(hand) })}>
                {t('hz.clear')}
              </button>
              <button type="button" className="btn btn-primary min-w-24" disabled={!valid} onClick={ready} data-testid="hz-ready">
                {t('hz.ready')}
              </button>
            </>
          )}
        </div>
      </div>
    </DndContext>
  );
}
