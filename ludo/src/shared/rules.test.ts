import { describe, expect, it } from 'vitest';
import { botAction } from './bot.ts';
import { createRng } from './rng.ts';
import { absSquare, apply, defaultConfig, init, isSafeSquare, legalTokens, parseAction, parseConfig, pathFor, pendingSeat, viewFor } from './rules.ts';
import { FINISHED, HOME_COLUMN, YARD, type Difficulty, type LudoConfig, type LudoState, type Seat } from './types.ts';

/** A state with a chosen dice value waiting to be used. */
function withDice(over: Partial<LudoState>, dice: number, config: Partial<LudoConfig> = {}): LudoState {
  const base = init({ ...defaultConfig, ...config }, 'test').state;
  return { ...base, turn: 0, phase: 'move', dice, ...over };
}

function playMatch(seed: string, config: LudoConfig, diffs: Difficulty[]): { state: LudoState; steps: number } {
  let { state } = init(config, seed);
  const rng = createRng(`${seed}:bots`);
  for (let step = 0; step < 20000; step++) {
    const seat = pendingSeat(state);
    if (seat === null) return { state, steps: step };
    const action = botAction(viewFor(state, seat), diffs[seat]!, rng);
    ({ state } = apply(state, seat, action));
  }
  throw new Error('match did not finish');
}

describe('movement', () => {
  it('needs a 6 to leave the yard, landing on the start square', () => {
    expect(pathFor(YARD, 5, true)).toBeNull();
    expect(pathFor(YARD, 6, true)).toEqual([0]);
  });

  it('turns into the home column after square 50 and must finish exactly', () => {
    expect(pathFor(49, 3, true)).toEqual([50, HOME_COLUMN, HOME_COLUMN + 1]);
    expect(pathFor(54, 3, true)).toEqual([55, 56, FINISHED]);
    expect(pathFor(55, 3, true)).toBeNull();
    expect(pathFor(FINISHED, 1, true)).toBeNull();
  });

  it('keeps circling the track when the capture-before-home rule blocks the home column', () => {
    expect(pathFor(49, 4, false)).toEqual([50, 51, 0, 1]);
  });

  it('maps relative squares to absolute ones per seat', () => {
    expect(absSquare(0, 0)).toBe(0);
    expect(absSquare(1, 0)).toBe(13);
    expect(absSquare(3, 20)).toBe(7);
    expect(absSquare(2, HOME_COLUMN)).toBeNull();
  });

  it('treats start squares and (optionally) stars as safe', () => {
    expect(isSafeSquare(13, { ...defaultConfig, safeStars: false })).toBe(true);
    expect(isSafeSquare(21, defaultConfig)).toBe(true);
    expect(isSafeSquare(21, { ...defaultConfig, safeStars: false })).toBe(false);
    expect(isSafeSquare(22, defaultConfig)).toBe(false);
  });
});

describe('captures and turns', () => {
  it('captures an opponent on a normal square and grants another roll', () => {
    // Seat 0 at relative 3 rolls 2 -> absolute 5. Seat 1 relative 44 = absolute (13+44)%52 = 5.
    const s = withDice({ tokens: [[3, YARD, YARD, YARD], [44, YARD, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]] }, 2);
    const { state, events } = apply(s, 0, { type: 'move', token: 0 });
    expect(state.tokens[1]![0]).toBe(YARD);
    expect(state.captured[0]).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['moved', 'captured']);
    expect(state.turn).toBe(0);
    expect(state.phase).toBe('roll');
  });

  it('does not capture on a safe square', () => {
    // Seat 0 relative 6 rolls 2 -> absolute 8 (a star). Seat 1 relative 47 = absolute 8.
    const s = withDice({ tokens: [[6, YARD, YARD, YARD], [47, YARD, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]] }, 2);
    const { state } = apply(s, 0, { type: 'move', token: 0 });
    expect(state.tokens[1]![0]).toBe(47);
    expect(state.turn).toBe(1);
  });

  it('passes the turn after a normal move and skips empty seats in 2-player games', () => {
    const s = withDice({ tokens: [[10, 20, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], active: [true, false, true, false] }, 3, { players: 2 });
    const { state } = apply(s, 0, { type: 'move', token: 0 });
    expect(state.turn).toBe(2);
  });

  it('rejects moves that are not legal', () => {
    const s = withDice({ tokens: [[YARD, 20, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]] }, 3);
    expect(legalTokens(s, 0, 3)).toEqual([1]);
    expect(() => apply(s, 0, { type: 'move', token: 0 })).toThrow();
    expect(() => apply(s, 1, { type: 'move', token: 1 })).toThrow();
  });

  it('ends the match when all four tokens are home', () => {
    const s = withDice({ tokens: [[FINISHED, FINISHED, FINISHED, 55], [YARD, YARD, YARD, YARD], [10, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]] }, 2);
    const { state, events } = apply(s, 0, { type: 'move', token: 3 });
    expect(state.phase).toBe('matchEnd');
    expect(state.result?.winner).toBe(0);
    expect(state.result?.ranking[0]).toBe(0);
    expect(state.result?.ranking[1]).toBe(2);
    expect(events.at(-1)?.type).toBe('matchEnded');
  });

  it('only gives another roll on a six, capture or reaching home', () => {
    const s = withDice({ tokens: [[54, 20, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]] }, 3);
    expect(apply(s, 0, { type: 'move', token: 0 }).state.turn).toBe(0);
    expect(apply(s, 0, { type: 'move', token: 1 }).state.turn).toBe(1);
  });
});

describe('dice', () => {
  it('is deterministic per seed and roll number, and fair-ish', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    let state = init(defaultConfig, 'dice').state;
    for (let i = 0; i < 3000; i++) {
      const r = apply({ ...state, phase: 'roll', turn: 0, tokens: state.tokens.map(() => [YARD, YARD, YARD, YARD]) }, 0, { type: 'roll' });
      counts[r.state.lastRoll!.value - 1]!++;
      state = { ...state, rolls: state.rolls + 1 };
    }
    for (const c of counts) expect(c).toBeGreaterThan(400);
    const a = apply(init(defaultConfig, 'same').state, init(defaultConfig, 'same').state.turn, { type: 'roll' });
    const b = apply(init(defaultConfig, 'same').state, init(defaultConfig, 'same').state.turn, { type: 'roll' });
    expect(a.state.lastRoll).toEqual(b.state.lastRoll);
  });

  it('never exposes the seed in a view', () => {
    const { state } = init(defaultConfig, 'secret-seed');
    for (const seat of [0, 1, 2, 3] as Seat[]) expect(JSON.stringify(viewFor(state, seat))).not.toContain('secret-seed');
  });
});

describe('input parsing', () => {
  it('sanitises configs and actions', () => {
    expect(parseConfig({ players: 3, safeStars: 'yes' })).toEqual(defaultConfig);
    expect(parseConfig({ players: 2, captureToEnterHome: true }).players).toBe(2);
    expect(parseAction({ type: 'move', token: 7 })).toBeNull();
    expect(parseAction({ type: 'move', token: 2 })).toEqual({ type: 'move', token: 2 });
    expect(parseAction('roll')).toBeNull();
  });
});

describe('bot matches', () => {
  const variants: [string, LudoConfig][] = [
    ['default', defaultConfig],
    ['2 players', { ...defaultConfig, players: 2 }],
    ['capture before home', { ...defaultConfig, captureToEnterHome: true }],
    ['no stars, no three-sixes', { ...defaultConfig, safeStars: false, threeSixes: false }],
  ];
  for (const [name, config] of variants) {
    it(`always finish (${name})`, () => {
      for (let i = 0; i < 40; i++) {
        const { state } = playMatch(`${name}-${i}`, config, ['normal', 'easy', 'hard', 'normal']);
        expect(state.result).not.toBeNull();
        expect(state.active[state.result!.winner]).toBe(true);
      }
    });
  }

  it('hard bots beat easy bots most of the time', () => {
    let hardWins = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const { state } = playMatch(`strength-${i}`, { ...defaultConfig, players: 2 }, ['hard', 'easy', 'easy', 'easy']);
      if (state.result!.winner === 0) hardWins++;
    }
    expect(hardWins / n).toBeGreaterThan(0.6);
  });
});
