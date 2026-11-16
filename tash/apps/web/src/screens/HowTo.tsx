import { Link, useParams } from 'react-router';
import { GAME_IDS, type GameId } from '@tash/engine';
import { useSettings } from '../app/settings';
import { IconBack } from '../components/Icons';
import { useT } from '../i18n/i18n';
import { HOW_TO } from './howto';

export function HowToContent({ gameId }: { gameId: GameId }) {
  const lang = useSettings((s) => s.lang);
  return (
    <div className="flex flex-col gap-5">
      {HOW_TO[gameId][lang].map((section) => (
        <section key={section.title}>
          <h3 className="mb-2 text-base font-bold text-accent">{section.title}</h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {section.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function HowToScreen() {
  const t = useT();
  const { gameId } = useParams();
  const id = (GAME_IDS.includes(gameId as GameId) ? gameId : 'callbridge') as GameId;
  return (
    <div className="min-h-dvh bg-bg" data-game={id}>
      <div className="pt-safe mx-auto max-w-2xl px-4 pb-10">
        <header className="flex items-center gap-2 py-3">
          <Link to="/" className="btn btn-ghost btn-icon" aria-label={t('how.back')}>
            <IconBack />
          </Link>
          <h1 className="text-xl font-bold">{t('how.title', { game: t(`game.${id}`) })}</h1>
        </header>
        <nav className="seg mb-6" aria-label="Games">
          {GAME_IDS.map((g) => (
            <Link key={g} to={`/how/${g}`} aria-pressed={g === id} className="flex min-h-9 items-center rounded-[9px] px-3 text-sm font-semibold aria-pressed:bg-surface aria-pressed:shadow">
              {t(`game.${g}`)}
            </Link>
          ))}
        </nav>
        <div className="panel p-5">
          <HowToContent gameId={id} />
        </div>
      </div>
    </div>
  );
}
