/** Tiny DOM helpers: escaping, toasts, modals, segmented controls. */

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function $(root: ParentNode, sel: string): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as HTMLElement;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = text;
  el.dataset.kind = kind;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Open a modal; returns a function that closes it. */
export function modal(html: string, opts: { onClose?: () => void; dismissable?: boolean; wide?: boolean } = {}): { el: HTMLElement; close: () => void } {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('open'));
  const close = () => {
    back.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => back.remove(), 200);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissable !== false) close();
  };
  document.addEventListener('keydown', onKey);
  if (opts.dismissable !== false) back.addEventListener('click', (e) => e.target === back && close());
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  return { el: back.querySelector('.modal')!, close };
}

export function segmented<T extends string | number>(name: string, value: T, options: { value: T; label: string }[]): string {
  return `<div class="seg" role="group" data-seg="${name}">${options
    .map((o) => `<button type="button" data-value="${o.value}" aria-pressed="${o.value === value}">${esc(o.label)}</button>`)
    .join('')}</div>`;
}

export function toggle(name: string, checked: boolean, label: string): string {
  return `<label class="toggle"><span>${esc(label)}</span><input type="checkbox" data-toggle="${name}" ${checked ? 'checked' : ''} /><i aria-hidden="true"></i></label>`;
}

/** Wire segmented controls inside `root`; calls back with (name, value). */
export function bindSegments(root: ParentNode, onChange: (name: string, value: string) => void): void {
  root.querySelectorAll<HTMLElement>('[data-seg]').forEach((seg) => {
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        onChange(seg.dataset.seg!, b.dataset.value!);
      }),
    );
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function dieFace(value: number): string {
  const on = new Set(PIPS[value] ?? []);
  return Array.from({ length: 9 }, (_, i) => `<i${on.has(i) ? ' class="on"' : ''}></i>`).join('');
}
