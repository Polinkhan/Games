import './style.css';
import type { RoomSnapshot } from '../shared/protocol.ts';
import { defaultConfig, parseConfig } from '../shared/rules.ts';
import { DIFFICULTIES, type Difficulty, type LudoConfig } from '../shared/types.ts';
import { COLOUR_VAR } from './board.ts';
import { GameScreen, showHowTo } from './game.ts';
import { t } from './i18n.ts';
import { net } from './net.ts';
import { loadSolo, LocalSession, RemoteSession } from './session.ts';
import { saveSettings, settings } from './settings.ts';
import { $, bindSegments, esc, modal, segmented, toast, toggle } from './ui.ts';

const BASE = import.meta.env.BASE_URL; // e.g. "/ludo/"
const app = document.getElementById('app')!;
let current: { destroy(): void } | null = null;

// ---------- routing ----------

function relPath(): string {
  const p = location.pathname;
  if (p.startsWith(BASE)) return p.slice(BASE.length).replace(/\/$/, '');
  return '';
}

export function navigate(path: string, replace = false): void {
  const url = BASE + path;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  route();
}

function route(): void {
  current?.destroy();
  current = null;
  document.documentElement.lang = settings.lang;
  const path = relPath();
  const room = /^r\/([A-Za-z0-9]{5})$/.exec(path);
  if (room) return roomScreen(room[1]!.toUpperCase());
  if (path === 'play') return soloScreen();
  if (path !== '') return navigate('', true);
  homeScreen();
}

window.addEventListener('popstate', route);

// ---------- setup state (remembered between visits) ----------

interface Setup {
  config: LudoConfig;
  difficulty: Difficulty;
}

function loadSetup(): Setup {
  try {
    const raw = JSON.parse(localStorage.getItem('ludo.setup') ?? '{}') as Partial<Setup>;
    return { config: parseConfig(raw.config ?? defaultConfig), difficulty: DIFFICULTIES.includes(raw.difficulty as Difficulty) ? raw.difficulty! : 'normal' };
  } catch {
    return { config: { ...defaultConfig }, difficulty: 'normal' };
  }
}

function saveSetup(s: Setup): void {
  try {
    localStorage.setItem('ludo.setup', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function setupControls(s: Setup, opts: { difficulty: boolean } = { difficulty: true }): string {
  return `
    <div class="field"><span>${esc(t('setup.players'))}</span>${segmented('players', s.config.players, [
      { value: 2, label: '2' },
      { value: 4, label: '4' },
    ])}</div>
    ${opts.difficulty ? `<div class="field"><span>${esc(t('setup.difficulty'))}</span>${segmented('difficulty', s.difficulty, DIFFICULTIES.map((d) => ({ value: d, label: t(`diff.${d}`) })))}</div>` : ''}
    <details class="rules"><summary>${esc(t('setup.rules'))}</summary>
      ${toggle('safeStars', s.config.safeStars, t('rule.safeStars'))}
      ${toggle('threeSixes', s.config.threeSixes, t('rule.threeSixes'))}
      ${toggle('captureToEnterHome', s.config.captureToEnterHome, t('rule.captureToEnterHome'))}
    </details>`;
}

function bindSetup(root: HTMLElement, s: Setup, onChange: () => void): void {
  bindSegments(root, (name, value) => {
    if (name === 'players') s.config = { ...s.config, players: value === '2' ? 2 : 4 };
    if (name === 'difficulty') s.difficulty = value as Difficulty;
    onChange();
  });
  root.querySelectorAll<HTMLInputElement>('[data-toggle]').forEach((input) =>
    input.addEventListener('change', () => {
      s.config = { ...s.config, [input.dataset.toggle!]: input.checked };
      onChange();
    }),
  );
}

/** Ask for a name if we do not have one yet. */
function withName(fn: () => void): void {
  if (settings.name.trim()) return fn();
  const m = modal(`<h2>${esc(t('home.name'))}</h2>
    <form class="stack"><input class="input" name="n" maxlength="20" autocomplete="nickname" required autofocus />
    <div class="row"><button type="button" class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary">OK</button></div></form>`);
  const form = m.el.querySelector('form')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = (new FormData(form).get('n') as string).trim();
    if (!n) return;
    saveSettings({ name: n });
    m.close();
    fn();
  });
}

// ---------- home ----------

function miniBoard(): string {
  const c = COLOUR_VAR;
  return `<svg viewBox="0 0 30 30" aria-hidden="true" class="logo">
    <rect width="30" height="30" rx="6" fill="var(--board)"/>
    <rect x="2" y="2" width="11" height="11" rx="3" fill="${c[1]}"/><rect x="17" y="2" width="11" height="11" rx="3" fill="${c[2]}"/>
    <rect x="2" y="17" width="11" height="11" rx="3" fill="${c[0]}"/><rect x="17" y="17" width="11" height="11" rx="3" fill="${c[3]}"/>
    <circle cx="15" cy="15" r="3.2" fill="var(--text)"/>
  </svg>`;
}

function homeScreen(): void {
  const s = loadSetup();
  const saved = loadSolo();
  app.innerHTML = `<div class="home">
    <header class="home-top">
      <a class="all-games" href="/">← games.polinkhan.com</a>
      <div class="row tight">
        <button type="button" class="btn small" data-lang>${esc(t('common.language'))}</button>
      </div>
    </header>
    <section class="hero">
      ${miniBoard()}
      <h1>${esc(t('app.title'))}${settings.lang === 'en' ? ' <span lang="bn">লুডু</span>' : ''}</h1>
      <p class="muted">${esc(t('app.tagline'))}</p>
    </section>
    <section class="card stack">
      <label class="field"><span>${esc(t('home.name'))}</span><input class="input" data-name maxlength="20" autocomplete="nickname" value="${esc(settings.name)}" /></label>
      ${setupControls(s)}
      ${saved ? `<button type="button" class="btn btn-primary block" data-resume>${esc(t('home.resume'))}</button>` : ''}
      <button type="button" class="btn ${saved ? '' : 'btn-primary'} block" data-solo>${esc(t('home.solo'))}</button>
      <button type="button" class="btn block" data-friends>${esc(t('home.friends'))}</button>
    </section>
    <section class="card">
      <form class="join" data-join>
        <span>${esc(t('home.joinTitle'))}</span>
        <div class="row tight">
          <input class="input code" maxlength="5" placeholder="${esc(t('home.code'))}" aria-label="${esc(t('home.code'))}" autocapitalize="characters" autocomplete="off" />
          <button class="btn btn-primary">${esc(t('home.join'))}</button>
        </div>
      </form>
    </section>
    <button type="button" class="btn ghost block" data-how>${esc(t('home.how'))}</button>
  </div>`;

  const nameInput = $(app, '[data-name]') as HTMLInputElement;
  nameInput.addEventListener('change', () => saveSettings({ name: nameInput.value.trim().slice(0, 20) }));
  bindSetup(app, s, () => saveSetup(s));
  $(app, '[data-lang]').addEventListener('click', () => {
    saveSettings({ lang: settings.lang === 'en' ? 'bn' : 'en' });
    homeScreen();
  });
  $(app, '[data-how]').addEventListener('click', showHowTo);
  app.querySelector('[data-resume]')?.addEventListener('click', () => {
    history.pushState({ resume: true }, '', `${BASE}play`);
    route();
  });
  $(app, '[data-solo]').addEventListener('click', () => {
    saveSettings({ name: nameInput.value.trim().slice(0, 20) });
    saveSetup(s);
    history.pushState({ resume: false }, '', `${BASE}play`);
    route();
  });
  $(app, '[data-friends]').addEventListener('click', () => {
    saveSettings({ name: nameInput.value.trim().slice(0, 20) });
    saveSetup(s);
    withName(async () => {
      const res = await net.emit<{ code: string }>('create', { name: settings.name });
      if (!res.ok) return toast(t(`reason.${res.reason}`), 'error');
      await net.emit('configure', { config: s.config, difficulty: s.difficulty });
      navigate(`r/${res.code}`);
    });
  });
  const join = $(app, '[data-join]') as HTMLFormElement;
  const codeInput = join.querySelector('input')!;
  codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5)));
  join.addEventListener('submit', (e) => {
    e.preventDefault();
    if (codeInput.value.length === 5) {
      saveSettings({ name: nameInput.value.trim().slice(0, 20) });
      withName(() => navigate(`r/${codeInput.value}`));
    }
  });
}

// ---------- solo ----------

function soloScreen(): void {
  const s = loadSetup();
  const resume = (history.state as { resume?: boolean } | null)?.resume !== false ? loadSolo() : null;
  const session = new LocalSession(s.config, resume?.difficulty ?? s.difficulty, resume?.state ?? null);
  // Later refreshes resume the saved game.
  history.replaceState({ resume: true }, '', location.href);
  const screen = new GameScreen(app, session, () => navigate(''));
  current = {
    destroy() {
      screen.destroy();
      session.leave();
    },
  };
}

// ---------- online room ----------

function roomScreen(code: string): void {
  let screen: GameScreen | null = null;
  let session: RemoteSession | null = null;
  let alive = true;

  const showLobby = (room: RoomSnapshot) => {
    screen?.destroy();
    screen = null;
    const isHost = room.hostId === room.you.playerId;
    const link = `${location.origin}${BASE}r/${room.code}`;
    const seats = room.seats
      .map((seat, i) => {
        const usable = room.config.players === 4 || i % 2 === 0;
        if (!usable) return '';
        const mine = seat.kind === 'human' && seat.playerId === room.you.playerId;
        const label =
          seat.kind === 'human'
            ? `<b>${esc(seat.name)}</b>${mine ? ` <span class="chip">${esc(t('lobby.you'))}</span>` : ''}${room.hostId === seat.playerId ? ` <span class="chip">${esc(t('lobby.host'))}</span>` : ''}${seat.connected ? '' : ` <span class="chip warn">${esc(t('lobby.offline'))}</span>`}`
            : `<span class="muted">${esc(t('lobby.open'))}</span><small class="muted">${esc(t('lobby.openHint'))}</small>`;
        const sit = seat.kind !== 'human' ? `<button type="button" class="btn small" data-sit="${i}">${esc(t('lobby.sitHere'))}</button>` : '';
        return `<li style="--c:${COLOUR_VAR[i]}"><span class="dot"></span><div class="seat-label">${label}</div>${sit}</li>`;
      })
      .join('');
    const setup: Setup = { config: room.config, difficulty: room.difficulty };
    app.innerHTML = `<div class="home">
      <header class="home-top"><button type="button" class="btn small" data-leave>← ${esc(t('lobby.leave'))}</button></header>
      <section class="card stack">
        <h1 class="room-code">${esc(t('lobby.title', { code: room.code }))}</h1>
        <button type="button" class="btn btn-primary block" data-share>${esc(t('lobby.share'))}</button>
        <ul class="seats">${seats}</ul>
      </section>
      <section class="card stack ${isHost ? '' : 'locked'}">
        ${setupControls(setup)}
        ${isHost ? `<button type="button" class="btn btn-primary block" data-start>${esc(t('setup.start'))}</button>` : `<p class="muted center">${esc(t('lobby.waitingHost'))}</p>`}
      </section>
    </div>`;
    if (isHost) bindSetup(app, setup, () => void net.emit('configure', { config: setup.config, difficulty: setup.difficulty }));
    else app.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.locked button, .locked input').forEach((b) => (b.disabled = true));
    app.querySelectorAll<HTMLElement>('[data-sit]').forEach((b) => b.addEventListener('click', () => void net.emit('sit', { seat: Number(b.dataset.sit) })));
    app.querySelector('[data-start]')?.addEventListener('click', async () => {
      const res = await net.emit('start', {});
      if (!res.ok) toast(t(`reason.${res.reason}`), 'error');
    });
    $(app, '[data-leave]').addEventListener('click', () => {
      void net.emit('leave', {});
      net.reset();
      navigate('');
    });
    $(app, '[data-share]').addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ title: t('app.title'), text: t('lobby.shareText'), url: link });
        else {
          await navigator.clipboard.writeText(link);
          toast(t('lobby.copied'));
        }
      } catch {
        /* share cancelled */
      }
    });
  };

  const onRoom = (room: RoomSnapshot) => {
    if (!alive || room.code !== code) return;
    if (room.phase === 'lobby') return showLobby(room);
    if (!screen) {
      session = new RemoteSession();
      screen = new GameScreen(app, session, () => {
        session?.leave();
        navigate('');
      });
    }
  };
  net.onRoom.add(onRoom);
  current = {
    destroy() {
      alive = false;
      net.onRoom.delete(onRoom);
      screen?.destroy();
    },
  };

  if (net.room?.code === code) onRoom(net.room);
  else {
    app.innerHTML = `<div class="loading">${esc(t('game.reconnecting'))}</div>`;
    withName(async () => {
      const res = await net.emit('join', { code, name: settings.name });
      if (!alive) return;
      if (!res.ok) {
        toast(t(`reason.${res.reason}`), 'error');
        navigate('', true);
      }
    });
  }
}

saveSettings({});
route();
