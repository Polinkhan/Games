import { FINISHED, HOME_COLUMN, TRACK_LENGTH, YARD, type Seat, type TokenPos } from '../shared/types.ts';

/** Seat colours: 0 red, 1 green, 2 yellow, 3 blue (CSS variables so dark mode can adjust them). */
export const COLOUR_VAR = ['var(--red)', 'var(--green)', 'var(--yellow)', 'var(--blue)'];
export const COLOUR_SOFT = ['var(--red-soft)', 'var(--green-soft)', 'var(--yellow-soft)', 'var(--blue-soft)'];
export const COLOUR_DARK = ['var(--red-dark)', 'var(--green-dark)', 'var(--yellow-dark)', 'var(--blue-dark)'];

type Pt = [number, number];

/**
 * The 52 track cells (column, row) on a 15×15 grid, clockwise, starting at the start square
 * of the bottom-left yard. Every quarter (13 cells) is the next yard's start.
 */
const TRACK: Pt[] = [
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7],
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0],
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7],
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14],
  [6, 14],
];

/** Bottom-left player's home column (positions 52..56), in cells. */
const HOME: Pt[] = [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]];
/** Token spots (centres) in the bottom-left yard and in its finishing triangle. */
const YARD_SPOTS: Pt[] = [[2.2, 11.2], [3.8, 11.2], [2.2, 12.8], [3.8, 12.8]];
const FINISH_SPOTS: Pt[] = [[6.95, 8.55], [8.05, 8.55], [7.5, 8.6], [7.5, 8.12]];

/** Rotate a point clockwise by `k` quarter turns around the board centre. */
function rot([x, y]: Pt, k: number): Pt {
  let p: Pt = [x, y];
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) p = [15 - p[1], p[0]];
  return p;
}

const centre = ([c, r]: Pt): Pt => [c + 0.5, r + 0.5];

/** Board corner of a seat as seen by `me` (0 bottom-left, 1 top-left, 2 top-right, 3 bottom-right). */
export function cornerOf(seat: Seat, me: Seat): number {
  return (seat - me + 4) % 4;
}

/** Centre point of a token, in board units. */
export function tokenPoint(seat: Seat, pos: TokenPos, index: number, me: Seat): Pt {
  const k = cornerOf(seat, me);
  if (pos === YARD) return rot(YARD_SPOTS[index]!, k);
  if (pos === FINISHED) return rot(FINISH_SPOTS[index]!, k);
  if (pos >= HOME_COLUMN) return rot(centre(HOME[pos - HOME_COLUMN]!), k);
  return centre(TRACK[(13 * k + pos) % TRACK_LENGTH]!);
}

/** A key per board cell, used to fan out tokens sharing a square. */
export function cellKey(seat: Seat, pos: TokenPos, index: number, me: Seat): string {
  if (pos === YARD || pos === FINISHED) return `${seat}:${pos}:${index}`;
  const [x, y] = tokenPoint(seat, pos, index, me);
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

function rect(x: number, y: number, w: number, h: number, k: number): { x: number; y: number; w: number; h: number } {
  const [ax, ay] = rot([x, y], k);
  const [bx, by] = rot([x + w, y + h], k);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(3)},${(cy + Math.sin(a) * rr).toFixed(3)}`);
  }
  return pts.join(' ');
}

/** Static board artwork. Colours follow the seat in each corner; inactive seats are faded. */
export function boardSvg(me: Seat, active: boolean[], safeStars: boolean): string {
  const parts: string[] = [];
  const seatAt = (k: number) => ((me + k) % 4) as Seat;
  parts.push(`<rect x="0" y="0" width="15" height="15" rx="0.45" fill="var(--board)" />`);

  for (let k = 0; k < 4; k++) {
    const s = seatAt(k);
    const fade = active[s] ? '' : ' opacity="0.35"';
    const y = rect(0, 9, 6, 6, k);
    const inner = rect(0.75, 9.75, 4.5, 4.5, k);
    parts.push(`<g${fade}>`);
    parts.push(`<rect x="${y.x}" y="${y.y}" width="${y.w}" height="${y.h}" fill="${COLOUR_VAR[s]}" rx="${k === 0 || k === 2 ? 0.45 : 0.45}" />`);
    parts.push(`<rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" rx="0.6" fill="var(--board)" />`);
    for (const p of YARD_SPOTS) {
      const [cx, cy] = rot(p, k);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="0.5" fill="${COLOUR_SOFT[s]}" stroke="${COLOUR_VAR[s]}" stroke-width="0.06" />`);
    }
    parts.push(`</g>`);
    // Home column
    for (const c of HOME) {
      const r = rect(c[0], c[1], 1, 1, k);
      parts.push(`<rect x="${r.x}" y="${r.y}" width="1" height="1" fill="${COLOUR_VAR[s]}" stroke="var(--grid)" stroke-width="0.04"${fade} />`);
    }
    // Centre triangle
    const tri = [rot([6, 9], k), rot([9, 9], k), [7.5, 7.5] as Pt].map((p) => p.join(',')).join(' ');
    parts.push(`<polygon points="${tri}" fill="${COLOUR_VAR[s]}"${fade} />`);
  }

  TRACK.forEach(([c, r], i) => {
    const startOf = i % 13 === 0 ? seatAt(i / 13) : null;
    const fill = startOf !== null ? COLOUR_VAR[startOf] : 'var(--cell)';
    parts.push(`<rect x="${c}" y="${r}" width="1" height="1" fill="${fill}" stroke="var(--grid)" stroke-width="0.04" />`);
    if (startOf !== null) {
      // Arrow pointing the way out of the yard.
      const [cx, cy] = centre([c, r]);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="0.28" fill="none" stroke="var(--board)" stroke-width="0.08" opacity="0.9" />`);
    } else if (safeStars && i % 13 === 8) {
      const [cx, cy] = centre([c, r]);
      parts.push(`<polygon points="${star(cx, cy, 0.36)}" fill="var(--star)" />`);
    }
  });
  parts.push(`<rect x="0" y="0" width="15" height="15" rx="0.45" fill="none" stroke="var(--grid)" stroke-width="0.08" />`);
  return parts.join('');
}

export function tokenSvg(seat: Seat, index: number): string {
  return `<g class="token" data-seat="${seat}" data-token="${index}" role="button" tabindex="-1" aria-label="token ${index + 1}">
    <g class="token-body">
      <circle class="token-ring" r="0.48" fill="none" stroke="${COLOUR_VAR[seat]}" stroke-width="0.09" />
      <ellipse cx="0" cy="0.2" rx="0.36" ry="0.16" fill="rgba(0,0,0,0.28)" />
      <circle cy="-0.04" r="0.34" fill="${COLOUR_DARK[seat]}" />
      <circle cy="-0.1" r="0.3" fill="${COLOUR_VAR[seat]}" stroke="#fff" stroke-width="0.07" />
      <circle cx="-0.09" cy="-0.2" r="0.08" fill="rgba(255,255,255,0.75)" />
    </g>
  </g>`;
}
