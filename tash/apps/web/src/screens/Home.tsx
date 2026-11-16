import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { GAME_IDS, getGame, type Difficulty, type GameId } from '@tash/engine';
import { useReducedMotion, useSettings } from '../app/settings';
import { Card } from '../components/Card';
import { IconSettings, IconUsers } from '../components/Icons';
import { Segmented, Sheet, toast } from '../components/Sheet';
import { GAME_UI } from '../games/registry';
import { useT } from '../i18n/i18n';
import { loadSolo } from '../session/LocalSession';
import { net } from '../session/net';
import { NameSheet, SettingsSheet } from './Settings';

const TILE_CARDS: Record<GameId, string[]> = {
  callbridge: ['SQ', 'SK', 'SA'],
  twentynine: ['HA', 'H9', 'HJ'],
  hazari: ['DA', 'CA', 'HA'],
};

export interface SoloLaunch {
  difficulty: Difficulty;
  config: unknown;
  resume: boolean;
}

function GameTile({ gameId, index, onSolo, onFriends, onResume }: { gameId: GameId; index: number; onSolo: () => void; onFriends: () => void; onResume?: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  return (
    <motion.article
      data-game={gameId}
      className="panel group relative flex flex-col overflow-hidden p-5"
      initial={reduced ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-accent" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">{t(`game.${gameId}`)}</h2>
          <span className="chip mt-1.5">{t(`game.${gameId}.mode`)}</span>
        </div>
        <div className="relative mr-2 mt-1 h-16 w-20 shrink-0" aria-hidden>
          {TILE_CARDS[gameId].map((c, i) => (
            <motion.div
              key={c}
              className="absolute left-4 top-0"
              initial={false}
              animate={{ rotate: (i - 1) * 14, x: (i - 1) * 14 }}
              whileHover={{ rotate: (i - 1) * 20, x: (i - 1) * 20 }}
              style={{ transformOrigin: '50% 120%' }}
            >
              <Card card={c} size="xs" label="" />
            </motion.div>
          ))}
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm text-muted">{t(`game.${gameId}.desc`)}</p>
      <div className="mt-5 flex flex-col gap-2">
        {onResume && (
          <button type="button" className="btn btn-primary" onClick={onResume}>
            {t('home.resume', { game: t(`game.${gameId}`) })}
          </button>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" className={`btn ${onResume ? 'btn-secondary' : 'btn-primary'}`} onClick={onSolo} data-testid={`solo-${gameId}`}>
            {t('home.playSolo')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onFriends} data-testid={`friends-${gameId}`}>
            <IconUsers /> {t('home.playFriends')}
          </button>
        </div>
        <button type="button" className="btn btn-ghost min-h-9 text-sm text-muted" onClick={() => navigate(`/how/${gameId}`)}>
          {t('home.howToPlay')}
        </button>
      </div>
    </motion.article>
  );
}

function SoloSetup({ gameId, onClose }: { gameId: GameId | null; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [config, setConfig] = useState<unknown>(null);
  useEffect(() => {
    if (gameId) setConfig(getGame(gameId).defaultConfig);
  }, [gameId]);
  if (!gameId) return <Sheet open={false}>{null}</Sheet>;
  const Editor = GAME_UI[gameId].ConfigEditor;
  const hasSave = !!loadSolo(gameId);
  return (
    <Sheet open={!!gameId} onClose={onClose} title={t('solo.title', { game: t(`game.${gameId}`) })}>
      <div data-game={gameId} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('solo.difficulty')}</span>
          <Segmented
            label={t('solo.difficulty')}
            value={difficulty}
            onChange={setDifficulty}
            options={(['easy', 'normal', 'hard'] as const).map((d) => ({ value: d, label: t(`difficulty.${d}`) }))}
          />
        </div>
        <details className="rounded-xl bg-surface-2 p-3">
          <summary className="cursor-pointer text-sm font-semibold">{t('solo.rules')}</summary>
          <div className="mt-3">{config !== null && <Editor config={config} onChange={setConfig} />}</div>
        </details>
        {hasSave && <p className="text-xs text-muted">{t('solo.discard')}</p>}
        <button
          type="button"
          className="btn btn-primary"
          data-testid="solo-start"
          onClick={() => navigate(`/solo/${gameId}`, { state: { difficulty, config: config ?? getGame(gameId).defaultConfig, resume: false } satisfies SoloLaunch })}
        >
          {t('solo.start')}
        </button>
      </div>
    </Sheet>
  );
}

export function Home() {
  const t = useT();
  const navigate = useNavigate();
  const name = useSettings((s) => s.name);
  const [solo, setSolo] = useState<GameId | null>(null);
  const [settings, setSettings] = useState(false);
  const [askName, setAskName] = useState<null | ((name: string) => void)>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [saves, setSaves] = useState<Partial<Record<GameId, boolean>>>({});

  useEffect(() => {
    setSaves(Object.fromEntries(GAME_IDS.map((g) => [g, !!loadSolo(g)])));
  }, []);

  const withName = (fn: (name: string) => void) => {
    if (name.trim()) fn(name.trim());
    else setAskName(() => fn);
  };

  const friends = (gameId: GameId) =>
    withName(async (n) => {
      if (!navigator.onLine) return toast(t('home.offline'), 'error');
      setBusy(true);
      const res = await net.create(gameId, n);
      setBusy(false);
      if (res.ok) navigate(`/room/${res.code}`);
      else toast(t('lobby.noRoom'), 'error');
    });

  const join = () => {
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return;
    withName(() => navigate(`/room/${c}`));
  };

  return (
    <div className="min-h-dvh bg-bg">
      <div className="pt-safe mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <header className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-2xl text-accent-contrast shadow" aria-hidden>
              ♠
            </div>
            <div>
              <h1 className="text-2xl font-extrabold leading-none tracking-tight">{t('app.name')}</h1>
              <p className="mt-1 text-sm text-muted">{t('app.tagline')}</p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSettings(true)} aria-label={t('home.settings')}>
            <IconSettings />
          </button>
        </header>

        <main className="mt-4 grid gap-4 md:grid-cols-3">
          {GAME_IDS.map((g, i) => (
            <GameTile
              key={g}
              gameId={g}
              index={i}
              onSolo={() => setSolo(g)}
              onFriends={() => friends(g)}
              onResume={saves[g] ? () => navigate(`/solo/${g}`, { state: { resume: true } as Partial<SoloLaunch> }) : undefined}
            />
          ))}
        </main>

        <section className="panel mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <h2 className="font-bold sm:mr-auto">{t('home.joinTitle')}</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <input
              className="input tabular w-full font-mono text-lg uppercase tracking-[0.25em] sm:w-48"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6))}
              placeholder={t('home.joinPlaceholder')}
              aria-label={t('home.joinPlaceholder')}
              autoCapitalize="characters"
              autoComplete="off"
              data-testid="join-code"
            />
            <button type="submit" className="btn btn-primary" disabled={code.length !== 6}>
              {t('home.join')}
            </button>
          </form>
        </section>
      </div>

      <SoloSetup gameId={solo} onClose={() => setSolo(null)} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
      <NameSheet
        open={!!askName}
        onDone={(n) => {
          const fn = askName;
          setAskName(null);
          if (n && fn) fn(n);
        }}
      />
      {busy && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" role="status">
          <div className="panel px-5 py-3 text-sm font-semibold">{t('home.creating')}</div>
        </div>
      )}
    </div>
  );
}
