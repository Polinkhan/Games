import { useEffect, useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { GAME_IDS, getGame, type GameId } from '@tash/engine';
import { soloPlayers } from '../app/players';
import { useSettings } from '../app/settings';
import { LocalSession, loadSolo } from '../session/LocalSession';
import { GameScreen } from './GameScreen';
import type { SoloLaunch } from './Home';

export function SoloScreen() {
  const { gameId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const name = useSettings((s) => s.name);
  const lang = useSettings((s) => s.lang);
  const valid = GAME_IDS.includes(gameId as GameId);
  const launch = (location.state ?? {}) as Partial<SoloLaunch>;

  const session = useMemo(() => {
    if (!valid) return null;
    const id = gameId as GameId;
    const saved = launch.resume !== false ? loadSolo(id) : null;
    if (saved) return new LocalSession(id, saved.difficulty, saved.config, saved);
    return new LocalSession(id, launch.difficulty ?? 'normal', launch.config ?? getGame(id).defaultConfig);
    // One session per mount; dropping the router state below must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => () => session?.leave(), [session]);

  // After the launch, drop the router state so a refresh resumes the saved game instead of starting over.
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const difficulty = (session && loadSolo(session.gameId)?.difficulty) ?? launch.difficulty ?? 'normal';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const players = useMemo(() => soloPlayers(name, difficulty), [name, difficulty, lang]);

  if (!valid || !session) return <Navigate to="/" replace />;
  return <GameScreen session={session} players={players} canRematch onLeave={() => navigate('/')} />;
}
