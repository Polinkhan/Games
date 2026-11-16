import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EMOTES, teamOf, type BaseView, type Seat } from '@tash/engine';
import { useSettings } from '../app/settings';
import { buzz, playSound } from '../app/sound';
import { IconBack, IconHelp, IconScore, IconSettings, IconSmile, IconWifiOff } from '../components/Icons';
import { Sheet, toast } from '../components/Sheet';
import { useDirector } from '../director/useDirector';
import { GAME_UI } from '../games/registry';
import { useT } from '../i18n/i18n';
import { net, useNet } from '../session/net';
import type { GameSession, PlayerInfo } from '../session/types';
import { HowToContent } from './HowTo';
import { SettingsSheet } from './Settings';

interface GameScreenProps {
  session: GameSession;
  players: PlayerInfo[];
  /** Host-only actions online; always allowed solo. */
  canRematch: boolean;
  onLeave: () => void;
}

export function GameScreen({ session, players, canRematch, onLeave }: GameScreenProps) {
  const t = useT();
  const ui = GAME_UI[session.gameId];
  const steps = useMemo(() => ui.steps(players), [ui, players]);
  const display = useDirector(session, steps);
  const [sheet, setSheet] = useState<null | 'scores' | 'help' | 'settings' | 'leave' | 'emotes'>(null);
  const [emotes, setEmotes] = useState<Partial<Record<Seat, { text: string; id: number }>>>({});
  const status = useNet((s) => s.status);
  const online = session.mode === 'online';

  useEffect(() => {
    if (!online) return;
    const onEmote = (m: { seat: Seat; id: number }) => setEmotes((e) => ({ ...e, [m.seat]: { text: EMOTES[m.id] ?? '👍', id: Date.now() } }));
    const onAuto = (m: { seat: Seat }) => {
      const p = players[m.seat];
      toast(t('table.autoPlayed', { name: p?.kind === 'you' ? t('common.you') : (p?.name ?? '') }));
    };
    net.emotes.add(onEmote);
    net.autoPlays.add(onAuto);
    return () => {
      net.emotes.delete(onEmote);
      net.autoPlays.delete(onAuto);
    };
  }, [online, players, t]);

  // "Your turn" cue.
  const myTurn = !!display && display.view.pending.includes(display.view.seat) && !display.busy;
  const prevTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !prevTurn.current) {
      playSound('turn');
      buzz(10);
    }
    prevTurn.current = myTurn;
  }, [myTurn]);

  const send = (action: unknown) => {
    void session.send(action).then((res) => {
      if (!res.ok) toast(t(`reason.${res.reason}`) === `reason.${res.reason}` ? t('reason.generic') : t(`reason.${res.reason}`), 'error');
    });
  };

  if (!display) {
    return (
      <div className="grid h-dvh place-items-center text-muted" data-game={session.gameId}>
        {t('lobby.connecting')}
      </div>
    );
  }

  const { view, busy } = display;
  const Table = ui.Table;
  const roundEnd = view.phase === 'roundEnd' && !busy;
  const matchEnd = !!view.result && !busy;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg" data-game={session.gameId}>
      <header className="pt-safe relative z-30 flex items-center gap-1 border-b border-line bg-bg px-2 pb-1 sm:px-4">
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSheet('leave')} aria-label={t('common.back')}>
          <IconBack />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{t(`game.${session.gameId}`)}</div>
          <div className="truncate text-xs text-muted">{ui.progress(view as never, t)}</div>
        </div>
        {online && status !== 'online' && (
          <span className="chip bg-warning/20 text-warning" role="status">
            <IconWifiOff /> {t('table.reconnecting')}
          </span>
        )}
        {online && (
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSheet('emotes')} aria-label={t('table.emote')}>
            <IconSmile />
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon lg:hidden" onClick={() => setSheet('scores')} aria-label={t('table.scores')}>
          <IconScore />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSheet('help')} aria-label={t('home.howToPlay')}>
          <IconHelp />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSheet('settings')} aria-label={t('settings.title')}>
          <IconSettings />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Table display={display as never} players={players} send={send} emotes={emotes} />
        </main>
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-line p-4 lg:block">
          <h2 className="mb-3 text-sm font-bold">{t('table.scores')}</h2>
          <ui.Scores view={view as never} players={players} />
        </aside>
      </div>

      <RoundSheet open={roundEnd && !matchEnd} view={view} online={online} onNext={() => send({ type: 'continue' })} title={t('table.roundOver', { n: view.round })}>
        <ui.Summary view={view as never} players={players} />
      </RoundSheet>

      <Sheet open={matchEnd} title={<MatchTitle view={view} players={players} />} wide>
        <ui.Scores view={view as never} players={players} />
        <div className="mt-5 flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={onLeave}>
            {t('table.home')}
          </button>
          {canRematch && (
            <button type="button" className="btn btn-primary flex-1" onClick={() => void session.rematch()}>
              {t('table.rematch')}
            </button>
          )}
        </div>
      </Sheet>

      <Sheet open={sheet === 'scores'} onClose={() => setSheet(null)} title={t('table.scores')} wide>
        <ui.Scores view={view as never} players={players} />
      </Sheet>
      <Sheet open={sheet === 'help'} onClose={() => setSheet(null)} title={t('how.title', { game: t(`game.${session.gameId}`) })} wide>
        <HowToContent gameId={session.gameId} />
      </Sheet>
      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} />
      <Sheet open={sheet === 'leave'} onClose={() => setSheet(null)} title={t('table.leave')}>
        <p className="text-sm text-muted">{online ? t('table.leaveRoom') : t('table.leaveSolo')}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={() => setSheet(null)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => {
              setSheet(null);
              onLeave();
            }}
          >
            {online ? t('lobby.leave') : t('table.home')}
          </button>
        </div>
      </Sheet>
      <Sheet open={sheet === 'emotes'} onClose={() => setSheet(null)} title={t('table.emote')}>
        <div className="grid grid-cols-4 gap-2">
          {EMOTES.map((e, i) => (
            <button
              key={e}
              type="button"
              className="btn btn-secondary h-14 text-2xl"
              onClick={() => {
                void net.emit('room:emote', { id: i });
                setSheet(null);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function MatchTitle({ view, players }: { view: BaseView; players: PlayerInfo[] }) {
  const t = useT();
  const winners = view.result?.winners ?? [];
  const iWon = winners.includes(view.seat);
  const team = view.game === 'twentynine';
  let text: string;
  if (iWon) text = team ? t('table.youWinTeam') : t('table.youWin');
  else if (team) text = t('table.winner', { name: t(teamOf(winners[0] ?? 0) === teamOf(view.seat) ? 'tn.yourTeam' : 'tn.theirTeam') });
  else if (winners.length > 1) text = t('table.tie', { names: winners.map((w) => players[w]?.name).join(', ') });
  else text = t('table.winner', { name: players[winners[0] ?? 0]?.name ?? '' });
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <motion.div initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }} className="text-5xl" aria-hidden>
        {iWon ? '🏆' : '🃏'}
      </motion.div>
      <div>{t('table.matchOver')}</div>
      <div className={`text-2xl font-extrabold ${iWon ? 'text-accent' : ''}`}>{text}</div>
    </div>
  );
}

function RoundSheet({
  open,
  view,
  online,
  onNext,
  title,
  children,
}: {
  open: boolean;
  view: BaseView;
  online: boolean;
  onNext: () => void;
  title: string;
  children: ReactNode;
}) {
  const t = useT();
  const pause = view.game === 'hazari' ? 12 : 8;
  const [left, setLeft] = useState(pause);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLeft(pause);
    setSent(false);
    if (!online) return;
    const id = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [open, online, pause, view.round]);
  const reduced = useSettings((s) => s.motion) === 'reduced';
  return (
    <Sheet open={open} title={title} wide>
      <AnimatePresence>{open && <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>}</AnimatePresence>
      <button
        type="button"
        className="btn btn-primary mt-5 w-full"
        disabled={sent}
        onClick={() => {
          setSent(true);
          onNext();
        }}
        data-testid="next-round"
      >
        {online && left > 0 ? t('table.nextIn', { n: left }) : t('table.nextRound')}
      </button>
    </Sheet>
  );
}
