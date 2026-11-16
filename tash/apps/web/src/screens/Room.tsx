import { motion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { TURN_SECONDS, teamOf, type Difficulty, type RoomSnapshot, type Seat, type SeatInfo } from '@tash/engine';
import { botName, roomPlayers } from '../app/players';
import { useSettings } from '../app/settings';
import { IconBack, IconBot, IconCopy, IconShare } from '../components/Icons';
import { Segmented, toast } from '../components/Sheet';
import { GAME_UI } from '../games/registry';
import { useT } from '../i18n/i18n';
import { net, useNet } from '../session/net';
import { RemoteSession } from '../session/RemoteSession';
import { GameScreen } from './GameScreen';
import { NameSheet } from './Settings';

export function RoomScreen() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const name = useSettings((s) => s.name);
  const room = useNet((s) => s.room);
  const joinError = useNet((s) => s.joinError);
  const status = useNet((s) => s.status);
  const upper = code.toUpperCase();

  useEffect(() => {
    if (!name.trim()) return;
    void net.join(upper, name.trim());
  }, [upper, name]);

  const leave = () => {
    net.leave();
    navigate('/');
  };

  if (!name.trim()) return <NameSheet open onDone={(n) => !n && navigate('/')} />;

  if (joinError) {
    return (
      <Centered>
        <p className="text-center">{t('lobby.noRoom')}</p>
        <Link to="/" className="btn btn-primary">
          {t('table.home')}
        </Link>
      </Centered>
    );
  }

  if (!room || room.code !== upper) {
    return (
      <Centered>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-surface-3 border-t-accent" aria-hidden />
        <p className="text-muted">{status === 'offline' ? t('table.reconnecting') : t('lobby.connecting')}</p>
      </Centered>
    );
  }

  if (room.phase === 'lobby') return <Lobby room={room} onLeave={leave} />;
  if (room.you.seat === null) {
    return (
      <Centered>
        <p className="max-w-sm text-center">{t('lobby.waitingSeat')}</p>
        <button type="button" className="btn btn-secondary" onClick={leave}>
          {t('lobby.leave')}
        </button>
      </Centered>
    );
  }
  return <OnlineGame room={room} onLeave={leave} />;
}

function OnlineGame({ room, onLeave }: { room: RoomSnapshot; onLeave: () => void }) {
  const lang = useSettings((s) => s.lang);
  const session = useMemo(() => new RemoteSession(room.gameId), [room.gameId, room.code]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const players = useMemo(() => roomPlayers(room), [room, lang]);
  return <GameScreen key={`${room.code}`} session={session} players={players} canRematch={room.hostPlayerId === room.you.playerId} onLeave={onLeave} />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="pt-safe flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6">{children}</div>;
}

function SeatCard({ room, seat, isHost }: { room: RoomSnapshot; seat: Seat; isHost: boolean }) {
  const t = useT();
  const s: SeatInfo = room.seats[seat]!;
  const me = room.you.seat === seat;
  const team = room.gameId === 'twentynine' ? teamOf(seat) : null;
  const teamStyle = team === null ? undefined : { boxShadow: `inset 0 3px 0 ${team === 0 ? 'var(--team-a)' : 'var(--team-b)'}` };

  let body: ReactNode;
  if (s.kind === 'human') {
    body = (
      <>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${s.connected ? 'bg-success' : 'bg-muted'}`} aria-hidden />
          <span className="truncate font-semibold">{me ? `${s.name} (${t('common.you')})` : s.name}</span>
        </div>
        {room.hostPlayerId === s.playerId && <span className="chip">{t('lobby.host')}</span>}
      </>
    );
  } else if (s.kind === 'bot') {
    body = (
      <>
        <div className="flex items-center gap-1.5 font-semibold">
          <IconBot /> {botName(seat)}
        </div>
        {isHost ? (
          <div className="flex flex-wrap items-center justify-center gap-1">
            <select
              className="input min-h-9 w-auto py-0 text-xs"
              value={s.difficulty}
              aria-label={t('solo.difficulty')}
              onChange={(e) => void net.emit('room:setSeat', { seat, slot: 'bot', difficulty: e.target.value as Difficulty })}
            >
              {(['easy', 'normal', 'hard'] as const).map((d) => (
                <option key={d} value={d}>
                  {t(`difficulty.${d}`)}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost min-h-9 px-2 text-xs" onClick={() => void net.emit('room:setSeat', { seat, slot: 'open' })}>
              {t('lobby.makeOpen')}
            </button>
          </div>
        ) : (
          <span className="chip">{t(`difficulty.${s.difficulty}`)}</span>
        )}
      </>
    );
  } else {
    body = (
      <>
        <span className="text-sm text-muted">{t('lobby.open')}</span>
        <div className="flex flex-wrap justify-center gap-1">
          <button type="button" className="btn btn-secondary min-h-9 px-3 text-xs" onClick={() => void net.emit('room:sit', { seat })}>
            {t('lobby.sitHere')}
          </button>
          {isHost && (
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => void net.emit('room:setSeat', { seat, slot: 'bot', difficulty: 'normal' })}>
              {t('lobby.addBot')}
            </button>
          )}
        </div>
      </>
    );
  }
  return (
    <motion.div layout className={`panel flex min-h-28 flex-col items-center justify-center gap-2 p-3 text-center ${me ? 'ring-2 ring-accent' : ''}`} style={teamStyle} data-testid={`lobby-seat-${seat}`}>
      {team !== null && <span className={`text-[10px] font-bold uppercase tracking-wider ${team === 0 ? 'text-team-a' : 'text-team-b'}`}>{t(team === 0 ? 'lobby.teamA' : 'lobby.teamB')}</span>}
      {body}
    </motion.div>
  );
}

function Lobby({ room, onLeave }: { room: RoomSnapshot; onLeave: () => void }) {
  const t = useT();
  const isHost = room.hostPlayerId === room.you.playerId;
  const ui = GAME_UI[room.gameId];
  const link = `${location.origin}/room/${room.code}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast(link);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: t('app.name'), text: t('lobby.shareText', { game: t(`game.${room.gameId}`) }), url: link });
    } catch {
      /* cancelled */
    }
  };
  const setConfig = (config: unknown) => void net.emit('room:config', { config }).then((r) => !r.ok && toast(t('reason.generic'), 'error'));

  // Seats arranged around a table, from this player's point of view.
  const mySeat = room.you.seat ?? 0;
  const at = (k: number) => ((mySeat + k) % 4) as Seat;

  return (
    <div className="min-h-dvh bg-bg" data-game={room.gameId}>
      <div className="pt-safe mx-auto max-w-3xl px-4 pb-10">
        <header className="flex items-center gap-2 py-3">
          <button type="button" className="btn btn-ghost btn-icon" onClick={onLeave} aria-label={t('lobby.leave')}>
            <IconBack />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">{t(`game.${room.gameId}`)}</h1>
            <p className="text-xs text-muted">{t('lobby.code')}</p>
          </div>
        </header>

        <section className="panel flex flex-col items-center gap-3 p-5">
          <div className="tabular font-mono text-4xl font-extrabold tracking-[0.3em] text-accent" data-testid="room-code">
            {room.code}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={copy}>
              <IconCopy /> {copied ? t('lobby.copied') : t('lobby.copy')}
            </button>
            {'share' in navigator && (
              <button type="button" className="btn btn-secondary" onClick={share}>
                <IconShare /> {t('lobby.share')}
              </button>
            )}
          </div>
        </section>

        <section className="mt-4 grid grid-cols-3 grid-rows-3 items-center gap-2" aria-label={t('lobby.players')}>
          <div className="col-start-2 row-start-1">
            <SeatCard room={room} seat={at(2)} isHost={isHost} />
          </div>
          <div className="col-start-1 row-start-2">
            <SeatCard room={room} seat={at(3)} isHost={isHost} />
          </div>
          <div className="col-start-2 row-start-2 grid aspect-square place-items-center rounded-full text-4xl opacity-60" style={{ background: 'var(--table)' }} aria-hidden>
            🂠
          </div>
          <div className="col-start-3 row-start-2">
            <SeatCard room={room} seat={at(1)} isHost={isHost} />
          </div>
          <div className="col-start-2 row-start-3">
            <SeatCard room={room} seat={at(0)} isHost={isHost} />
          </div>
        </section>

        {room.waiting.length > 0 && (
          <p className="mt-3 text-center text-sm text-muted">
            {t('lobby.watching')}: {room.waiting.map((w) => w.name).join(', ')}
          </p>
        )}

        <details className="panel mt-4 p-4" open={isHost}>
          <summary className="cursor-pointer font-semibold">{t('solo.rules')}</summary>
          <div className="mt-4 flex flex-col gap-3">
            {!isHost && <p className="text-xs text-muted">{t('lobby.rulesHostOnly')}</p>}
            <ui.ConfigEditor config={room.config} onChange={setConfig} disabled={!isHost} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{t('lobby.turnTimer')}</span>
              <Segmented
                label={t('lobby.turnTimer')}
                value={room.turnSeconds}
                disabled={!isHost}
                onChange={(n) => void net.emit('room:config', { config: room.config, turnSeconds: n })}
                options={TURN_SECONDS.map((n) => ({ value: n as number, label: n ? t('lobby.seconds', { n }) : t('common.off') }))}
              />
            </div>
          </div>
        </details>

        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-sm text-muted">{t('lobby.botsFill')}</p>
          {isHost ? (
            <button
              type="button"
              className="btn btn-primary w-full max-w-sm text-base"
              data-testid="lobby-start"
              onClick={() => void net.emit('room:start').then((r) => !r.ok && toast(t('reason.generic'), 'error'))}
            >
              {t('lobby.start')}
            </button>
          ) : (
            <p className="font-semibold">{t('lobby.waitingHost')}</p>
          )}
          <button type="button" className="btn btn-ghost text-sm" onClick={onLeave}>
            {t('lobby.leave')}
          </button>
        </div>
      </div>
    </div>
  );
}
