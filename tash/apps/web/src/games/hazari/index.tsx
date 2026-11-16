import { AnimatePresence, motion } from 'motion/react';
import type { HazariConfig, HazariView, Seat, ShowdownTrick } from '@tash/engine';
import { Card } from '../../components/Card';
import { Segmented } from '../../components/Sheet';
import { farPoint, relativeSeat } from '../../components/TrickArea';
import { useReducedMotion } from '../../app/settings';
import type { Fx } from '../../director/useDirector';
import { useNum, useT } from '../../i18n/i18n';
import type { PlayerInfo } from '../../session/types';
import { Row } from '../callbridge';
import { Delta, playerName, ScoreTable, TrickTable, type TableProps } from '../common';
import type { ConfigEditorProps, GameUi } from '../types';
import { ArrangeBoard } from './ArrangeBoard';

const GRID: Record<string, string> = {
  top: 'col-start-2 row-start-1',
  left: 'col-start-1 row-start-2',
  right: 'col-start-3 row-start-2',
  bottom: 'col-start-2 row-start-3',
};

function Showdown({ showdown, me, sweepTo }: { showdown: NonNullable<Fx['showdown']>; me: Seat; sweepTo: Seat | null }) {
  const t = useT();
  const num = useNum();
  const reduced = useReducedMotion();
  const sweep = sweepTo === null ? null : farPoint(relativeSeat(sweepTo, me));
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="chip bg-surface text-text shadow">
        {t('hz.showdown', { n: showdown.index + 1 })} · {t('hz.pointsWon', { n: showdown.points })}
      </div>
      <div className="grid grid-cols-3 grid-rows-3 place-items-center gap-x-2 gap-y-1">
        {showdown.plays.map((p, order) => {
          const pos = relativeSeat(p.seat, me);
          const faceUp = order < showdown.revealed;
          const won = showdown.winner === p.seat;
          return (
            <motion.div
              key={p.seat}
              className={`${GRID[pos]} flex flex-col items-center gap-0.5`}
              animate={sweep && !reduced ? { x: sweep.x, y: sweep.y, opacity: 0, scale: 0.5 } : { x: 0, y: 0, opacity: 1, scale: won ? 1.06 : 1 }}
              transition={sweep ? { duration: 0.4 } : { type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className={`flex rounded-xl p-1 ${won ? 'bg-accent/25 ring-2 ring-accent' : ''}`}>
                {p.cards.map((c, i) => (
                  <div key={c} style={{ marginLeft: i ? -14 : 0, perspective: 500 }}>
                    <motion.div
                      initial={false}
                      animate={{ rotateY: faceUp ? 0 : 180 }}
                      transition={{ duration: reduced ? 0 : 0.35, delay: faceUp ? i * 0.05 : 0 }}
                    >
                      <Card card={faceUp ? c : null} size="xs" />
                    </motion.div>
                  </div>
                ))}
              </div>
              <AnimatePresence>
                {faceUp && (
                  <motion.span
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-[11px] font-bold ${won ? 'text-accent' : 'text-muted'}`}
                  >
                    {t(`hz.combo.${p.combo}`)}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
        <div className="col-start-2 row-start-2 text-xs text-muted">{num(showdown.index + 1)}/4</div>
      </div>
    </div>
  );
}

function HazariTable(props: TableProps<HazariView>) {
  const t = useT();
  const num = useNum();
  const { view, fx } = props.display;
  const me = view.seat;
  // Once all four are ready the showdown is playing out, even though the view is still 'arranging'.
  const arranging = view.phase === 'arranging' && !view.ready.every(Boolean);

  const stats = (seat: Seat) => {
    if (arranging) return view.ready[seat] ? `✓ ${t('hz.readyChip')}` : t('hz.arranging');
    return `${num(view.scores[seat]!)} / ${num(view.config.targetScore)}`;
  };

  return (
    <TrickTable
      {...props}
      activeSeats={arranging ? view.pending : []}
      stats={stats}
      legal={null}
      showCounts={false}
      center={
        fx.showdown ? (
          <Showdown showdown={fx.showdown} me={me} sweepTo={fx.sweepTo} />
        ) : arranging || view.phase !== 'arranging' ? (
          <div className="chip bg-surface text-sm text-text shadow">{t('hz.target', { n: view.config.targetScore })}</div>
        ) : null
      }
      handArea={arranging ? <ArrangeBoard key={view.round} view={view} send={props.send} /> : <div className="h-4" />}
    />
  );
}

function Summary({ view, players }: { view: HazariView; players: PlayerInfo[] }) {
  const t = useT();
  const num = useNum();
  return (
    <div className="flex flex-col gap-4">
      {view.showdown && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {view.showdown.map((tr: ShowdownTrick) => {
            const w = tr.plays.find((p) => p.seat === tr.winner)!;
            return (
              <div key={tr.index} className="rounded-xl bg-surface-2 p-2 text-center">
                <div className="text-xs text-muted">{t('hz.group', { n: tr.index + 1 })}</div>
                <div className="my-1 flex justify-center">
                  {w.cards.map((c, i) => (
                    <Card key={c} card={c} size="xs" style={{ marginLeft: i ? -12 : 0 }} />
                  ))}
                </div>
                <div className="truncate text-sm font-semibold">{playerName(players, tr.winner)}</div>
                <div className="text-xs text-muted">
                  {t(`hz.combo.${w.combo}`)} · {num(tr.points)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ScoreTable
        head={['', t('tn.points'), t('table.total')]}
        highlightRow={view.seat}
        rows={[0, 1, 2, 3].map((s) => [
          playerName(players, s as Seat),
          <Delta key="d" value={view.roundPoints[s]!} format={num} />,
          <ProgressCell key="p" value={view.scores[s]!} target={view.config.targetScore} />,
        ])}
      />
    </div>
  );
}

function ProgressCell({ value, target }: { value: number; target: number }) {
  const num = useNum();
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
        <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (value / target) * 100)}%` }} />
      </div>
      <b>{num(value)}</b>
    </div>
  );
}

function Scores({ view, players }: { view: HazariView; players: PlayerInfo[] }) {
  const t = useT();
  const num = useNum();
  return (
    <ScoreTable
      head={['', ...view.history.map((_, i) => `#${i + 1}`), t('table.total')]}
      highlightRow={view.seat}
      rows={[0, 1, 2, 3].map((s) => [
        playerName(players, s as Seat),
        ...view.history.map((h) => num(h.points[s]!)),
        <b key="t">{num(view.scores[s]!)}</b>,
      ])}
    />
  );
}

function ConfigEditor({ config, onChange, disabled }: ConfigEditorProps) {
  const t = useT();
  const c = config as HazariConfig;
  return (
    <Row label={t('rules.hz.target')}>
      <Segmented
        label={t('rules.hz.target')}
        value={c.targetScore}
        disabled={disabled}
        onChange={(v) => onChange({ ...c, targetScore: v })}
        options={[500, 1000, 2000].map((n) => ({ value: n, label: String(n) }))}
      />
    </Row>
  );
}

export const hazariUi: GameUi<HazariView> = {
  steps: () => (event, _d, finalView) => {
    switch (event.type) {
      case 'dealt':
        return [{ apply: (d) => ({ ...d, view: finalView }), sound: 'deal', wait: 700 }];
      case 'arranged':
      case 'unlocked': {
        const { seat } = event as unknown as { seat: Seat };
        return [
          {
            apply: (d) => {
              const ready = [...d.view.ready];
              ready[seat] = event.type === 'arranged';
              return { ...d, view: { ...d.view, ready } };
            },
          },
        ];
      }
      case 'showdownTrick': {
        const tr = event as unknown as ShowdownTrick;
        const steps: ReturnType<ReturnType<GameUi<HazariView>['steps']>> = [
          {
            apply: (d) => ({
              ...d,
              fx: { ...d.fx, sweepTo: null, showdown: { index: tr.index, revealed: 0, winner: null, plays: tr.plays, points: tr.points } },
            }),
            wait: 350,
          },
        ];
        for (let k = 1; k <= 4; k++) {
          steps.push({
            apply: (d) => ({ ...d, fx: { ...d.fx, showdown: d.fx.showdown && { ...d.fx.showdown, revealed: k } } }),
            sound: 'play',
            wait: 430,
          });
        }
        steps.push({
          apply: (d) => ({ ...d, fx: { ...d.fx, showdown: d.fx.showdown && { ...d.fx.showdown, winner: tr.winner } } }),
          sound: 'win',
          wait: 900,
        });
        steps.push({ apply: (d) => ({ ...d, fx: { ...d.fx, sweepTo: tr.winner } }), wait: 420 });
        steps.push({
          apply: (d) => {
            const roundPoints = [...d.view.roundPoints];
            roundPoints[tr.winner]! += tr.points;
            return { ...d, view: { ...d.view, roundPoints }, fx: { ...d.fx, sweepTo: null, showdown: null } };
          },
          wait: 120,
        });
        return steps;
      }
      case 'roundScored':
        return [{ sound: 'score', wait: 300 }];
      default:
        return [];
    }
  },
  Table: HazariTable,
  Summary,
  Scores,
  ConfigEditor,
  progress: (v, t) => t('table.round', { n: v.round }),
};
