import type { ReactNode } from 'react';
import { estimateTricks, suitOf, type CallBridgeConfig, type CallBridgeView, type CardId, type Seat } from '@tash/engine';
import { winningPlay } from '@tash/engine';
import { Segmented, Toggle, toast } from '../../components/Sheet';
import { SuitIcon } from '../../components/Card';
import { TrickArea } from '../../components/TrickArea';
import { useNum, useT } from '../../i18n/i18n';
import type { PlayerInfo } from '../../session/types';
import { bubble, ControlPanel, Delta, ScoreTable, TrickTable, tr, trickSteps, type TableProps } from '../common';
import type { ConfigEditorProps, GameUi } from '../types';

const fmt = (tenths: number) => {
  const v = tenths / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

function CallPicker({ view, onCall }: { view: CallBridgeView; onCall: (n: number) => void }) {
  const t = useT();
  const num = useNum();
  const suggested = Math.max(view.config.minCall, Math.min(8, Math.floor(estimateTricks(view.hand))));
  return (
    <ControlPanel title={t('cb.yourCall')}>
      <div className="grid grid-cols-7 gap-1.5">
        {view.legalCalls.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onCall(n)}
            className={`btn tabular min-h-11 px-0 text-base ${n === suggested ? 'btn-primary' : 'btn-secondary'}`}
            aria-label={`${t('cb.call')} ${n}`}
            data-testid={`call-${n}`}
          >
            {num(n)}
          </button>
        ))}
      </div>
    </ControlPanel>
  );
}

function CallBridgeTable(props: TableProps<CallBridgeView>) {
  const t = useT();
  const num = useNum();
  const { view, fx, busy } = props.display;
  const me = view.seat;
  const myTurn = view.pending.includes(me) && !busy;

  const stats = (seat: Seat) => {
    const call = view.calls[seat];
    if (call === null) return view.phase === 'calling' ? t('cb.calling') : '';
    return `${t('cb.calls')} ${num(call)} · ${t('cb.tricks')} ${num(view.tricksWon[seat]!)}`;
  };

  const onIllegal = (card: CardId) => {
    const led = view.trick.cards[0] ? suitOf(view.trick.cards[0].card) : null;
    if (led && view.hand.some((c) => suitOf(c) === led)) toast(t('reason.must-follow', { suit: t(`suit.${led}`) }), 'error');
    else toast(t('reason.must-trump'), 'error');
    void card;
  };

  const winning = view.trick.cards.length ? winningPlay(view.trick.cards, 'S').seat : null;

  return (
    <TrickTable
      {...props}
      activeSeats={view.pending}
      stats={stats}
      legal={view.phase === 'playing' && myTurn ? view.legalCards : null}
      onIllegal={onIllegal}
      center={<TrickArea cards={view.trick.cards} me={me} sweepTo={fx.sweepTo} winning={winning} />}
      corner={
        <span className="chip bg-surface text-text shadow">
          <SuitIcon suit="S" /> {t('cb.trumpNote')}
        </span>
      }
      controls={view.phase === 'calling' && myTurn ? <CallPicker view={view} onCall={(n) => props.send({ type: 'call', call: n })} /> : null}
    />
  );
}

function Summary({ view, players }: { view: CallBridgeView; players: PlayerInfo[] }) {
  const t = useT();
  const num = useNum();
  const last = view.history[view.history.length - 1];
  if (!last) return null;
  const name = (s: number) => (players[s]!.kind === 'you' ? t('common.you') : players[s]!.name);
  return (
    <ScoreTable
      head={['', t('cb.calls'), t('cb.tricks'), '±', t('table.total')]}
      highlightRow={view.seat}
      rows={[0, 1, 2, 3].map((s) => [
        name(s),
        num(last.calls[s]!),
        num(last.tricks[s]!),
        <Delta key="d" value={last.deltas[s]! / 10} format={(n) => fmt(n * 10)} />,
        fmt(view.scores[s]!),
      ])}
    />
  );
}

function Scores({ view, players }: { view: CallBridgeView; players: PlayerInfo[] }) {
  const t = useT();
  const name = (s: number) => (players[s]!.kind === 'you' ? t('common.you') : players[s]!.name);
  return (
    <ScoreTable
      head={['', ...view.history.map((_, i) => `R${i + 1}`), t('table.total')]}
      highlightRow={view.seat}
      rows={[0, 1, 2, 3].map((s) => [name(s), ...view.history.map((h) => fmt(h.deltas[s]!)), <b key="t">{fmt(view.scores[s]!)}</b>])}
    />
  );
}

function ConfigEditor({ config, onChange, disabled }: ConfigEditorProps) {
  const t = useT();
  const c = config as CallBridgeConfig;
  const set = (patch: Partial<CallBridgeConfig>) => onChange({ ...c, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <Row label={t('rules.cb.rounds')}>
        <Segmented label={t('rules.cb.rounds')} value={c.rounds} disabled={disabled} onChange={(v) => set({ rounds: v })} options={[3, 5, 7, 10].map((n) => ({ value: n, label: String(n) }))} />
      </Row>
      <Row label={t('rules.cb.minCall')}>
        <Segmented label={t('rules.cb.minCall')} value={c.minCall} disabled={disabled} onChange={(v) => set({ minCall: v })} options={[1, 2].map((n) => ({ value: n, label: String(n) }))} />
      </Row>
      <Row label={t('rules.cb.overtricks')}>
        <Segmented
          label={t('rules.cb.overtricks')}
          value={c.overtricks}
          disabled={disabled}
          onChange={(v) => set({ overtricks: v })}
          options={[
            { value: 'strict', label: t('rules.cb.strict') },
            { value: 'tenths', label: t('rules.cb.tenths') },
          ]}
        />
      </Row>
      <Toggle label={t('rules.cb.bonusCall')} checked={c.bonusCall} disabled={disabled} onChange={(v) => set({ bonusCall: v })} />
      <Toggle label={t('rules.cb.mustBeatInSuit')} checked={c.mustBeatInSuit} disabled={disabled} onChange={(v) => set({ mustBeatInSuit: v })} />
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

export const callBridgeUi: GameUi<CallBridgeView> = {
  steps: () => (event, _d, finalView) => {
    if (event.type === 'called') {
      const { seat, call } = event as unknown as { seat: Seat; call: number };
      return [{ apply: bubble(seat, tr('cb.called', { n: call })), wait: 300 }, {
        apply: (d) => {
          const calls = [...d.view.calls];
          calls[seat] = call;
          return { ...d, view: { ...d.view, calls } };
        },
      }];
    }
    return (
      trickSteps(event, finalView, (v, seat) => {
        const tricksWon = [...v.tricksWon];
        tricksWon[seat]!++;
        return { ...v, tricksWon };
      }) ?? []
    );
  },
  Table: CallBridgeTable,
  Summary,
  Scores,
  ConfigEditor,
  progress: (v, t) => t('table.roundOf', { n: v.round, total: v.config.rounds }),
};
