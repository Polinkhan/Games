import type { HostUpdate } from '../shared/host.ts';
import { EMOTES } from '../shared/protocol.ts';
import { FINISHED, SEATS, YARD, type LudoEvent, type LudoView, type Seat } from '../shared/types.ts';
import { boardSvg, cellKey, COLOUR_VAR, cornerOf, tokenPoint, tokenSvg } from './board.ts';
import { HOW_TO, num, t } from './i18n.ts';
import { net } from './net.ts';
import { mySeat, type PlayerInfo, type Session } from './session.ts';
import { saveSettings, settings } from './settings.ts';
import { buzz, playSound } from './sound.ts';
import { dieFace, esc, modal, reducedMotion, sleep, toast } from './ui.ts';

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>',
  smile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>',
};

export function howToHtml(): string {
  return HOW_TO[settings.lang]
    .map((s) => `<h3>${esc(s.title)}</h3><ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`)
    .join('');
}

export function showHowTo(): void {
  modal(`<h2>${esc(t('home.how'))}</h2><div class="howto">${howToHtml()}</div><button class="btn btn-primary block" data-close>${esc(t('common.close'))}</button>`, { wide: true });
}

/** The table: board, four player panels, dice, and the event animation player. */
export class GameScreen {
  private root: HTMLElement;
  private session: Session;
  private onLeave: () => void;
  private me: Seat = 0;
  private view: LudoView | null = null;
  private deadline: number | null = null;
  private busy = false;
  private queue: HostUpdate[] = [];
  private running = false;
  private alive = true;
  private mounted = false;
  private tokenEls: SVGGElement[][] = [];
  private resultModal: { close: () => void } | null = null;
  private wasMyTurn = false;
  private unsub: (() => void)[] = [];
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, session: Session, onLeave: () => void) {
    this.root = root;
    this.session = session;
    this.onLeave = onLeave;
    this.root.innerHTML = `<div class="loading">${esc(t('game.reconnecting'))}</div>`;
    this.unsub.push(
      session.subscribe((u) => {
        this.queue.push(u);
        void this.pump();
      }),
    );
    if (session.mode === 'online') {
      const onEmote = (m: { seat: Seat; id: number }) => this.showEmote(m.seat, EMOTES[m.id] ?? '👍');
      const onAuto = (m: { seat: Seat }) => toast(t('game.autoPlayed', { name: this.nameOf(m.seat) }));
      const onStatus = () => this.renderStatus();
      const onRoom = () => this.view && this.renderPanels();
      net.onEmote.add(onEmote);
      net.onAutoPlay.add(onAuto);
      net.onStatus.add(onStatus);
      net.onRoom.add(onRoom);
      this.unsub.push(() => {
        net.onEmote.delete(onEmote);
        net.onAutoPlay.delete(onAuto);
        net.onStatus.delete(onStatus);
        net.onRoom.delete(onRoom);
      });
    }
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    document.addEventListener('keydown', onKey);
    this.unsub.push(() => document.removeEventListener('keydown', onKey));
  }

  destroy(): void {
    this.alive = false;
    this.unsub.forEach((fn) => fn());
    this.resultModal?.close();
  }

  // ---------- layout ----------

  private players(): PlayerInfo[] {
    return this.session.players();
  }

  private nameOf(seat: Seat): string {
    const p = this.players()[seat];
    return !p ? '?' : p.kind === 'you' ? t('game.you') : p.name;
  }

  private mount(view: LudoView): void {
    this.me = mySeat(this.session);
    const online = this.session.mode === 'online';
    const panel = (corner: number) => {
      const seat = ((this.me + corner) % 4) as Seat;
      return `<div class="panel" data-seat="${seat}" data-corner="${corner}" style="--c:${COLOUR_VAR[seat]}">
        <div class="pinfo">
          <span class="avatar" aria-hidden="true"></span>
          <div class="pnames"><b class="pname"></b><small class="psub"></small></div>
        </div>
        <button type="button" class="die" ${seat === this.me ? 'data-mine' : 'tabindex="-1"'} disabled aria-label="Roll">${dieFace(1)}</button>
        <div class="ptimer" aria-hidden="true"><i></i></div>
        <div class="bubble" aria-live="polite"></div>
      </div>`;
    };
    this.root.innerHTML = `<div class="game">
      <header class="bar">
        <button type="button" class="icon-btn" data-act="leave" aria-label="${esc(t('common.back'))}">${ICON.back}</button>
        <div class="bar-title"><b>${esc(t('app.title'))}</b><small class="status" aria-live="polite"></small></div>
        ${online ? `<button type="button" class="icon-btn" data-act="emote" aria-label="Emote">${ICON.smile}</button>` : ''}
        <button type="button" class="icon-btn" data-act="sound" aria-label="${esc(t('common.sound'))}"></button>
        <button type="button" class="icon-btn" data-act="help" aria-label="${esc(t('home.how'))}">${ICON.help}</button>
      </header>
      <div class="table">
        <div class="prow">${panel(1)}${panel(2)}</div>
        <div class="board-wrap">
          <svg class="board" viewBox="-0.15 -0.15 15.3 15.3" aria-label="Ludo board">
            <g class="board-art">${boardSvg(this.me, view.active, view.config.safeStars)}</g>
            <g class="tokens">${SEATS.filter((s) => view.active[s]).map((s) => [0, 1, 2, 3].map((i) => tokenSvg(s, i)).join('')).join('')}</g>
          </svg>
          <div class="banner" aria-live="polite"></div>
        </div>
        <div class="prow">${panel(0)}${panel(3)}</div>
      </div>
    </div>`;
    this.tokenEls = SEATS.map((s) => [0, 1, 2, 3].map((i) => this.root.querySelector<SVGGElement>(`.token[data-seat="${s}"][data-token="${i}"]`)!));
    this.root.querySelector('.tokens')!.addEventListener('click', (e) => {
      const el = (e.target as Element).closest<SVGGElement>('.token');
      if (el && Number(el.dataset.seat) === this.me) this.move(Number(el.dataset.token));
    });
    this.root.querySelector<HTMLButtonElement>('.die[data-mine]')!.addEventListener('click', () => this.roll());
    this.root.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => this.onAct(b.dataset.act!)));
    this.renderSoundIcon();
    this.mounted = true;
  }

  private onAct(act: string): void {
    if (act === 'help') showHowTo();
    else if (act === 'sound') {
      saveSettings({ sound: !settings.sound });
      this.renderSoundIcon();
    } else if (act === 'emote') {
      const m = modal(`<div class="emotes">${EMOTES.map((e, i) => `<button type="button" class="btn" data-emote="${i}">${e}</button>`).join('')}</div>`);
      m.el.querySelectorAll<HTMLElement>('[data-emote]').forEach((b) =>
        b.addEventListener('click', () => {
          net.emote(Number(b.dataset.emote));
          m.close();
        }),
      );
    } else if (act === 'leave') {
      if (this.view?.result) return this.onLeave();
      const online = this.session.mode === 'online';
      const m = modal(`<h2>${esc(t('game.leave'))}</h2><p class="muted">${esc(online ? t('game.leaveRoom') : t('game.leaveSolo'))}</p>
        <div class="row"><button class="btn" data-close>${esc(t('game.stay'))}</button><button class="btn btn-primary" data-go>${esc(t('game.leaveBtn'))}</button></div>`);
      m.el.querySelector('[data-go]')!.addEventListener('click', () => {
        m.close();
        this.onLeave();
      });
    }
  }

  private renderSoundIcon(): void {
    const b = this.root.querySelector<HTMLElement>('[data-act="sound"]');
    if (b) {
      b.innerHTML = settings.sound ? ICON.soundOn : ICON.soundOff;
      b.setAttribute('aria-pressed', String(settings.sound));
    }
  }

  // ---------- input ----------

  private canRoll(): boolean {
    const v = this.view;
    return !!v && !this.busy && !v.result && v.turn === this.me && v.phase === 'roll';
  }

  private roll(): void {
    if (!this.canRoll()) return;
    this.busy = true; // block double taps until the server answers
    this.renderDice();
    void this.session.send({ type: 'roll' }).then((res) => {
      if (!res.ok) {
        this.busy = false;
        this.render();
        toast(t(`reason.${res.reason}`) === `reason.${res.reason}` ? t('reason.generic') : t(`reason.${res.reason}`), 'error');
      }
    });
  }

  private move(token: number): void {
    const v = this.view;
    if (!v || this.busy || v.turn !== this.me || v.phase !== 'move' || !v.legal.includes(token)) return;
    this.busy = true;
    this.renderTokens();
    void this.session.send({ type: 'move', token }).then((res) => {
      if (!res.ok) {
        this.busy = false;
        this.render();
        playSound('error');
      }
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (document.querySelector('.modal-back')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (this.canRoll()) {
        e.preventDefault();
        this.roll();
      }
    } else if (/^[1-4]$/.test(e.key)) {
      this.move(Number(e.key) - 1);
    }
  }

  // ---------- animation player ----------

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && this.alive) {
        const pending = this.queue.reduce((n, u) => n + u.events.length, 0);
        if (pending > 16 || !this.view) {
          // First update, or far behind (e.g. after a reconnect): jump to the latest state.
          const last = this.queue[this.queue.length - 1]!;
          this.queue = [];
          this.snap(last);
          continue;
        }
        const u = this.queue.shift()!;
        if (u.events.length) {
          this.busy = true;
          this.render();
          for (const e of u.events) {
            if (!this.alive) return;
            await this.animate(e);
          }
        }
        this.snap(u);
      }
    } finally {
      this.running = false;
    }
  }

  private snap(u: HostUpdate): void {
    if (!this.mounted) this.mount(u.view);
    this.view = u.view;
    this.deadline = u.deadline;
    this.busy = this.queue.length > 0;
    this.render();
    const myTurn = !this.busy && !u.view.result && u.view.turn === this.me;
    if (myTurn && !this.wasMyTurn) {
      playSound('turn');
      buzz(15);
    }
    this.wasMyTurn = myTurn;
    if (u.view.result && !this.busy) this.showResult(u.view);
    else if (!u.view.result && this.resultModal) {
      this.resultModal.close();
      this.resultModal = null;
    }
  }

  private async animate(e: LudoEvent): Promise<void> {
    const v = this.view!;
    const speed = reducedMotion() ? 0.4 : 1;
    switch (e.type) {
      case 'rolled': {
        this.view = { ...v, turn: e.seat, legal: [], lastRoll: { seat: e.seat, value: e.value, n: e.n } };
        this.render();
        playSound('roll');
        await this.rollDie(e.seat, e.value, 560 * speed);
        await sleep(150 * speed);
        return;
      }
      case 'moved': {
        const el = this.tokenEls[e.seat]![e.token]!;
        el.parentNode?.append(el); // draw the moving token on top
        el.classList.add('hopping');
        for (const p of e.path) {
          const tokens = this.view!.tokens.map((ts) => [...ts]);
          tokens[e.seat]![e.token] = p;
          this.view = { ...this.view!, tokens, legal: [] };
          this.renderTokens();
          playSound(e.from === YARD ? 'out' : 'step');
          await sleep(150 * speed);
        }
        el.classList.remove('hopping');
        return;
      }
      case 'captured': {
        const tokens = this.view!.tokens.map((ts) => [...ts]);
        tokens[e.victim]![e.token] = YARD;
        const el = this.tokenEls[e.victim]![e.token]!;
        el.classList.add('captured');
        this.view = { ...this.view!, tokens };
        this.renderTokens();
        playSound('capture');
        buzz(e.victim === this.me ? 60 : 20);
        const key = e.seat === this.me ? 'game.capturedByYou' : e.victim === this.me ? 'game.capturedYou' : 'game.captured';
        this.banner(t(key, { name: this.nameOf(e.seat), victim: this.nameOf(e.victim) }), e.victim === this.me ? 'bad' : e.seat === this.me ? 'good' : '');
        await sleep(500 * speed);
        el.classList.remove('captured');
        return;
      }
      case 'tokenHome':
        playSound('home');
        this.banner(e.seat === this.me ? t('game.homeYou') : t('game.home', { name: this.nameOf(e.seat) }), e.seat === this.me ? 'good' : '');
        await sleep(300 * speed);
        return;
      case 'turnPassed':
        if (e.reason === 'threeSixes') this.banner(t('game.threeSixes'), 'bad');
        else if (e.reason === 'noMove' && e.seat === this.me) this.banner(t('game.noMove'));
        await sleep((e.reason === 'threeSixes' ? 700 : 150) * speed);
        this.view = { ...this.view!, turn: e.next, phase: 'roll', legal: [] };
        this.render();
        await sleep(100 * speed);
        return;
      case 'matchEnded':
        playSound('win');
        return;
    }
  }

  private async rollDie(seat: Seat, value: number, ms: number): Promise<void> {
    const die = this.root.querySelector<HTMLElement>(`.panel[data-seat="${seat}"] .die`);
    if (!die) return sleep(ms);
    die.classList.add('rolling');
    const end = Date.now() + ms;
    while (Date.now() < end) {
      die.innerHTML = dieFace(1 + Math.floor(Math.random() * 6));
      await sleep(70);
    }
    die.innerHTML = dieFace(value);
    die.classList.remove('rolling');
    die.classList.add('landed');
    setTimeout(() => die.classList.remove('landed'), 300);
  }

  // ---------- rendering ----------

  private render(): void {
    if (!this.mounted || !this.view) return;
    this.renderTokens();
    this.renderPanels();
    this.renderDice();
    this.renderStatus();
  }

  private renderTokens(): void {
    const v = this.view!;
    const groups = new Map<string, { seat: Seat; i: number }[]>();
    for (const s of SEATS) {
      if (!v.active[s]) continue;
      v.tokens[s]!.forEach((p, i) => {
        const key = cellKey(s, p, i, this.me);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push({ seat: s, i });
      });
    }
    const selectable = !this.busy && v.turn === this.me && v.phase === 'move';
    for (const members of groups.values()) {
      const n = members.length;
      members.forEach(({ seat, i }, k) => {
        const [x, y] = tokenPoint(seat, v.tokens[seat]![i]!, i, this.me);
        const off = n === 1 ? [0, 0] : n === 2 ? [k ? 0.2 : -0.2, 0] : [(k % 2 ? 0.2 : -0.2), k < 2 ? -0.2 : 0.2];
        const scale = n === 1 ? 1 : 0.72;
        const el = this.tokenEls[seat]![i]!;
        el.style.transform = `translate(${x + off[0]!}px, ${y + off[1]!}px) scale(${scale})`;
        const legal = selectable && seat === this.me && v.legal.includes(i);
        el.classList.toggle('legal', legal);
        el.classList.toggle('done', v.tokens[seat]![i] === FINISHED);
        el.setAttribute('tabindex', legal ? '0' : '-1');
      });
    }
  }

  private renderPanels(): void {
    const v = this.view!;
    const players = this.players();
    for (const s of SEATS) {
      const el = this.root.querySelector<HTMLElement>(`.panel[data-seat="${s}"]`);
      if (!el) continue;
      const p = players[s];
      el.classList.toggle('empty', !v.active[s]);
      if (!v.active[s] || !p) continue;
      const home = v.tokens[s]!.filter((x) => x === FINISHED).length;
      el.classList.toggle('turn', v.turn === s && !v.result);
      el.querySelector('.avatar')!.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
      el.querySelector('.pname')!.textContent = p.kind === 'you' ? `${p.name} (${t('lobby.you')})` : p.name;
      const sub = [t('result.tokensHome', { n: home })];
      if (p.kind === 'bot') sub.unshift(t('lobby.bot'));
      if (p.kind === 'human' && !p.connected) sub.unshift(t('lobby.offline'));
      if (v.config.captureToEnterHome && !v.captured[s]) sub.push(t('game.mustCapture'));
      el.querySelector('.psub')!.textContent = sub.join(' · ');
      // Turn timer bar (online only).
      const bar = el.querySelector<HTMLElement>('.ptimer i')!;
      const timed = this.session.mode === 'online' && v.turn === s && !v.result;
      const deadline = timed ? (s === this.me ? this.deadline : null) : null;
      if (deadline && bar.dataset.deadline !== String(deadline)) {
        bar.dataset.deadline = String(deadline);
        const left = Math.max(0, deadline - Date.now());
        bar.style.transition = 'none';
        bar.style.width = '100%';
        void bar.offsetWidth;
        bar.style.transition = `width ${left}ms linear`;
        bar.style.width = '0%';
      } else if (!deadline) {
        delete bar.dataset.deadline;
        bar.style.transition = 'none';
        bar.style.width = '0%';
      }
    }
  }

  private renderDice(): void {
    const v = this.view!;
    for (const s of SEATS) {
      const die = this.root.querySelector<HTMLButtonElement>(`.panel[data-seat="${s}"] .die`);
      if (!die || die.classList.contains('rolling')) continue;
      const showing = v.turn === s && !v.result;
      die.classList.toggle('hidden', !showing && v.lastRoll?.seat !== s);
      die.classList.toggle('faded', !showing);
      const value = v.lastRoll?.seat === s && (v.phase === 'move' || !showing || this.busy) ? v.lastRoll.value : null;
      const face = value ?? 0;
      if (die.dataset.face !== String(face)) {
        die.dataset.face = String(face);
        die.innerHTML = dieFace(value ?? 0);
      }
      const can = s === this.me && this.canRoll();
      die.disabled = !can;
      die.classList.toggle('ready', can);
    }
  }

  private renderStatus(): void {
    const el = this.root.querySelector<HTMLElement>('.status');
    const v = this.view;
    if (!el || !v) return;
    if (this.session.mode === 'online' && net.status !== 'online') {
      el.textContent = t('game.reconnecting');
      el.dataset.kind = 'warn';
      return;
    }
    delete el.dataset.kind;
    if (v.result) el.textContent = v.result.winner === this.me ? t('result.youWin') : t('result.wins', { name: this.nameOf(v.result.winner) });
    else if (v.turn === this.me && v.phase === 'move' && v.dice !== null) el.textContent = t('game.pickToken', { n: v.dice });
    else if (v.turn === this.me) el.textContent = t('game.yourTurn');
    else el.textContent = t('game.turnOf', { name: this.nameOf(v.turn) });
  }

  private banner(text: string, kind: '' | 'good' | 'bad' = ''): void {
    const el = this.root.querySelector<HTMLElement>('.banner');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  private showEmote(seat: Seat, text: string): void {
    const el = this.root.querySelector<HTMLElement>(`.panel[data-seat="${seat}"] .bubble`);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  private showResult(v: LudoView): void {
    if (this.resultModal || !v.result) return;
    const r = v.result;
    const iWon = r.winner === this.me;
    const rows = r.ranking
      .map(
        (s, i) => `<li style="--c:${COLOUR_VAR[s]}" class="${s === this.me ? 'me' : ''}">
        <span class="rank">${num(i + 1)}</span><span class="dot"></span><b>${esc(this.nameOf(s))}</b><span class="muted">${esc(t('result.tokensHome', { n: r.home[s] ?? 0 }))}</span></li>`,
      )
      .join('');
    const again = this.session.canRematch()
      ? `<button class="btn btn-primary" data-again>${esc(t('result.again'))}</button>`
      : `<p class="muted center">${esc(t('result.waitHost'))}</p>`;
    const m = modal(
      `<div class="result">
        <div class="trophy" aria-hidden="true">${iWon ? '🏆' : '🎲'}</div>
        <h2>${esc(iWon ? t('result.youWin') : t('result.wins', { name: this.nameOf(r.winner) }))}</h2>
        <ol class="ranking">${rows}</ol>
        <div class="row">${again}<button class="btn" data-home>${esc(t('result.home'))}</button></div>
      </div>`,
      { dismissable: false },
    );
    this.resultModal = m;
    m.el.querySelector('[data-home]')!.addEventListener('click', () => {
      m.close();
      this.resultModal = null;
      this.onLeave();
    });
    m.el.querySelector('[data-again]')?.addEventListener('click', () => {
      m.close();
      this.resultModal = null;
      void this.session.rematch();
    });
    if (iWon) buzz(120);
  }
}
