import { motion } from 'motion/react';
import {
  partnerOf,
  suitOf,
  teamOf,
  tnPower,
  winningPlay,
  type CardId,
  type Seat,
  type Suit,
  type TwentyNineConfig,
  type TwentyNineView,
} from '@tash/engine';
import { Card, SuitIcon } from '../../components/Card';
import { Segmented, Toggle, toast } from '../../components/Sheet';
import { TrickArea } from '../../components/TrickArea';
import { useReducedMotion } from '../../app/settings';
import { useNum, useT } from '../../i18n/i18n';
import type { PlayerInfo } from '../../session/types';
import { Row } from '../callbridge';
import { banner, bubble, ControlPanel, Delta, ScoreTable, TrickTable, tr, trickSteps, playerName, type TableProps } from '../common';
import type { ConfigEditorProps, GameUi } from '../types';

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

function TrumpMarker({ view, flip }: { view: TwentyNineView; flip: number }) {
  const t = useT();
  const reduced = useReducedMotion();
  if (!view.trumpChosen && view.phase !== 'chooseTrump') return null;
  const known = view.trumpSuit;
  const shownToAll = view.trumpRevealed;
  return (
    <div className="flex items-center gap-2">
      <div style={{ perspective: 600 }}>
        <motion.div
          key={flip}
          initial={reduced || flip === 0 ? false : { rotateY: 180 }}
          animate={{ rotateY: 0 }}
          transition={{ duration: 0.6, ease: [0.3, 0, 0.2, 1] }}
        >
          {shownToAll && known ? (
            <div className="card sm grid place-items-center text-3xl">
              <SuitIcon suit={known} />
            </div>
          ) : (
            <Card card={null} size="sm" />
          )}
        </motion.div>
      </div>
      <div className="text-xs leading-tight">
        <div className="font-semibold">{shownToAll ? t('tn.trump') : t('tn.trumpHidden')}</div>
        {known && (
          <div className="text-muted">
            <SuitIcon suit={known} /> {t(`suitName.${known}`)}
            {!shownToAll && ' 🔒'}
          </div>
        )}
      </div>
    </div>
  );
}

function BidLadder({ view, onBid, onPass }: { view: TwentyNineView; onBid: (n: number) => void; onPass: () => void }) {
  const t = useT();
  const num = useNum();
  const bids = view.legalBids.slice(0, 6);
  return (
    <ControlPanel
      title={view.highBid === null ? t('tn.noBid') : t('tn.highBid', { n: view.highBid })}
      hint={!view.canPass ? t('tn.dealerMust') : undefined}
    >
      <div className="flex flex-wrap justify-center gap-1.5">
        {bids.map((b) => (
          <button key={b} type="button" className="btn btn-secondary tabular min-w-12 px-2 text-base" onClick={() => onBid(b)} data-testid={`bid-${b}`}>
            {num(b)}
          </button>
        ))}
        {view.canPass && (
          <button type="button" className="btn btn-primary min-w-20" onClick={onPass} data-testid="bid-pass">
            {t('tn.pass')}
          </button>
        )}
      </div>
    </ControlPanel>
  );
}

function TrumpPicker({ view, onPick }: { view: TwentyNineView; onPick: (s: Suit) => void }) {
  const t = useT();
  return (
    <ControlPanel title={t('tn.chooseTrump')} hint={t('tn.chooseTrumpHint')}>
      <div className="grid grid-cols-4 gap-2">
        {SUITS.map((s) => {
          const count = view.hand.filter((c) => suitOf(c) === s).length;
          return (
            <button key={s} type="button" className="btn btn-secondary h-16 flex-col gap-0 text-2xl" onClick={() => onPick(s)} aria-label={t(`suitName.${s}`)} data-testid={`trump-${s}`}>
              <SuitIcon suit={s} />
              <span className="text-xs text-muted">{count}</span>
            </button>
          );
        })}
      </div>
    </ControlPanel>
  );
}

function TwentyNineTable(props: TableProps<TwentyNineView>) {
  const t = useT();
  const num = useNum();
  const { view, fx, busy } = props.display;
  const me = view.seat;
  const myTurn = view.pending.includes(me) && !busy;
  const myTeam = teamOf(me);

  const stats = (seat: Seat) => {
    if (view.phase === 'bidding') {
      const mine = [...view.bids].reverse().find((b) => b.seat === seat);
      if (!mine) return '';
      return mine.bid === null ? t('tn.passed') : num(mine.bid);
    }
    if (view.bidder === seat) return `${t('tn.bidder')} · ${num(view.bid ?? 0)}`;
    if (seat === partnerOf(me)) return t('tn.partner');
    return '';
  };

  const onIllegal = (_card: CardId) => {
    if (view.mustTrump === me) return toast(t('reason.must-trump'), 'error');
    const led = view.trick.cards[0] ? suitOf(view.trick.cards[0].card) : null;
    if (led) toast(t('reason.must-follow', { suit: t(`suit.${led}`) }), 'error');
  };

  let controls = null;
  if (myTurn && view.phase === 'bidding') {
    controls = <BidLadder view={view} onBid={(n) => props.send({ type: 'bid', bid: n })} onPass={() => props.send({ type: 'pass' })} />;
  } else if (myTurn && view.phase === 'chooseTrump') {
    controls = <TrumpPicker view={view} onPick={(s) => props.send({ type: 'trump', suit: s })} />;
  } else if (myTurn && view.phase === 'playing' && view.canReveal) {
    controls = (
      <ControlPanel hint={t('tn.orPlayAny')}>
        <button type="button" className="btn btn-primary w-full" onClick={() => props.send({ type: 'reveal' })} data-testid="reveal">
          {view.bidder === me ? t('tn.revealTrump') : t('tn.askTrump')}
        </button>
      </ControlPanel>
    );
  }

  const active = view.trumpRevealed ? view.trumpSuit : null;
  const winning = view.trick.cards.length ? winningPlay(view.trick.cards, active, tnPower).seat : null;
  const status =
    view.phase === 'chooseTrump' && view.bidder !== me
      ? t('tn.choosingTrump', { name: playerName(props.players, view.bidder!) })
      : view.phase === 'bidding' && !myTurn
        ? t('tn.bidding')
        : null;

  return (
    <TrickTable
      {...props}
      activeSeats={view.pending}
      stats={stats}
      teamColour={(s) => (teamOf(s) === myTeam ? 'var(--team-a)' : 'var(--team-b)')}
      legal={view.phase === 'playing' && myTurn ? view.legalCards : null}
      onIllegal={onIllegal}
      center={
        <div className="relative grid place-items-center">
          <TrickArea cards={view.trick.cards} me={me} sweepTo={fx.sweepTo} winning={winning} />
          {status && view.trick.cards.length === 0 && (
            <div className="chip absolute bg-surface text-sm text-text shadow" role="status">
              {status}
            </div>
          )}
        </div>
      }
      corner={
        <div className="panel flex flex-col gap-2 rounded-2xl p-2.5 text-xs">
          <TrumpMarker view={view} flip={fx.trumpFlip} />
          {view.target !== null && (
            <div className="tabular flex items-center gap-2">
              <span className="font-semibold">{t('tn.target', { n: view.target })}</span>
              <span className="text-team-a">{t('tn.yourTeam')} {num(view.teamPoints[myTeam])}</span>
              <span className="text-team-b">{num(view.teamPoints[1 - myTeam]!)}</span>
            </div>
          )}
          <div className="tabular text-muted">
            {t('tn.gamePoints')}: <span className="text-team-a">{num(view.gamePoints[myTeam])}</span> /{' '}
            <span className="text-team-b">{num(view.gamePoints[1 - myTeam]!)}</span>
          </div>
        </div>
      }
      controls={controls}
    />
  );
}

function Summary({ view, players }: { view: TwentyNineView; players: PlayerInfo[] }) {
  const t = useT();
  const num = useNum();
  const last = view.history[view.history.length - 1];
  if (!last) return null;
  const myTeam = teamOf(view.seat);
  const bidderTeam = teamOf(last.bidder);
  const pts = last.teamPoints[bidderTeam];
  const made = pts >= last.target;
  const teamName = bidderTeam === myTeam ? t('tn.yourTeam') : t('tn.theirTeam');
  return (
    <div className="flex flex-col gap-4">
      <div className={`rounded-xl p-3 text-center font-semibold ${made === (bidderTeam === myTeam) ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
        {t(made ? 'tn.made' : 'tn.failed', { team: teamName, pts, target: last.target })}
      </div>
      <div className="flex items-center justify-center gap-3 text-sm text-muted">
        <span>
          {t('tn.bidder')}: <b className="text-text">{playerName(players, last.bidder)}</b> · {num(last.bid)}
        </span>
        <span>
          {t('tn.trump')}: <SuitIcon suit={last.trump} />
        </span>
      </div>
      <ScoreTable
        head={['', t('tn.points'), '±', t('tn.gamePoints')]}
        rows={[myTeam, 1 - myTeam].map((team) => [
          <span key="n" className={team === myTeam ? 'text-team-a' : 'text-team-b'}>
            {team === myTeam ? t('tn.yourTeam') : t('tn.theirTeam')}
          </span>,
          num(last.teamPoints[team]!),
          <Delta key="d" value={last.deltas[team]!} format={num} />,
          num(view.gamePoints[team]!),
        ])}
      />
    </div>
  );
}

function Scores({ view, players }: { view: TwentyNineView; players: PlayerInfo[] }) {
  const t = useT();
  const num = useNum();
  const myTeam = teamOf(view.seat);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-surface-2 p-2">
          <div className="text-xs text-team-a">{t('tn.yourTeam')}</div>
          <div className="tabular text-2xl font-bold">{num(view.gamePoints[myTeam])}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-2">
          <div className="text-xs text-team-b">{t('tn.theirTeam')}</div>
          <div className="tabular text-2xl font-bold">{num(view.gamePoints[1 - myTeam]!)}</div>
        </div>
      </div>
      {view.history.length > 0 && (
        <ScoreTable
          head={['#', t('tn.bidder'), t('tn.target', { n: '' }).trim(), t('tn.points'), '±']}
          rows={view.history.map((h, i) => [
            num(i + 1),
            playerName(players, h.bidder),
            num(h.target),
            num(h.teamPoints[teamOf(h.bidder)]),
            <Delta key="d" value={h.deltas[teamOf(h.bidder)]!} format={num} />,
          ])}
        />
      )}
    </div>
  );
}

function ConfigEditor({ config, onChange, disabled }: ConfigEditorProps) {
  const t = useT();
  const c = config as TwentyNineConfig;
  const set = (patch: Partial<TwentyNineConfig>) => onChange({ ...c, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <Row label={t('rules.tn.target')}>
        <Segmented label={t('rules.tn.target')} value={c.targetGamePoints} disabled={disabled} onChange={(v) => set({ targetGamePoints: v })} options={[3, 6, 8].map((n) => ({ value: n, label: String(n) }))} />
      </Row>
      <Toggle label={t('rules.tn.lastTrickPoint')} checked={c.lastTrickPoint} disabled={disabled} onChange={(v) => set({ lastTrickPoint: v })} />
      <Toggle label={t('rules.tn.pairEnabled')} checked={c.pairEnabled} disabled={disabled} onChange={(v) => set({ pairEnabled: v })} />
    </div>
  );
}

export const twentyNineUi: GameUi<TwentyNineView> = {
  steps: (players) => (event, _d, finalView) => {
    switch (event.type) {
      case 'bidPlaced': {
        const { seat, bid } = event as unknown as { seat: Seat; bid: number | null };
        return [
          {
            apply: (d) => {
              const b = bubble<TwentyNineView>(seat, bid === null ? tr('tn.pass') : String(bid))(d);
              const passed = [...b.view.passed];
              if (bid === null) passed[seat] = true;
              return {
                ...b,
                view: {
                  ...b.view,
                  bids: [...b.view.bids, { seat, bid }],
                  passed,
                  highBid: bid ?? b.view.highBid,
                  highBidder: bid === null ? b.view.highBidder : seat,
                  pending: [],
                },
              };
            },
            wait: 380,
          },
        ];
      }
      case 'bidWon':
        return [{ wait: 250 }];
      case 'trumpRevealed': {
        const { suit, bySeat } = event as unknown as { suit: Suit; bySeat: Seat };
        return [
          {
            apply: (d) => {
              const b = banner<TwentyNineView>(tr('tn.trumpRevealed', { suit: tr(`suitName.${suit}`) }))(d);
              return {
                ...b,
                view: { ...b.view, trumpRevealed: true, trumpSuit: suit, revealedBy: bySeat },
                fx: { ...b.fx, trumpFlip: b.fx.trumpFlip + 1 },
              };
            },
            sound: 'reveal',
            wait: 800,
          },
        ];
      }
      case 'pairDeclared': {
        const { seat, target } = event as unknown as { seat: Seat; target: number };
        return [
          {
            apply: (d) => {
              const b = banner<TwentyNineView>(tr('tn.pairDeclared', { name: playerName(players, seat), n: target }))(bubble<TwentyNineView>(seat, tr('tn.pair'))(d));
              return { ...b, view: { ...b.view, target } };
            },
            sound: 'reveal',
            wait: 1000,
          },
        ];
      }
      default:
        return (
          trickSteps(event, finalView, (v, seat, e) => {
            const teamPoints: [number, number] = [...v.teamPoints];
            teamPoints[teamOf(seat)] += (e as unknown as { points: number }).points;
            return { ...v, teamPoints };
          }) ?? []
        );
    }
  },
  Table: TwentyNineTable,
  Summary,
  Scores,
  ConfigEditor,
  progress: (v, t) => t('table.round', { n: v.round }),
};
