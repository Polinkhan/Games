import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { useReducedMotion } from '../app/settings';

interface SheetProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Keep the page behind visible and interactive (no dim backdrop). */
  modal?: boolean;
  wide?: boolean;
  labelledBy?: string;
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, title, children, modal = true, wide, labelledBy }: SheetProps) {
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    setTimeout(() => panel.current?.querySelector<HTMLElement>('button, input, select, [tabindex]')?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {modal && <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden />}
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal={modal}
            aria-labelledby={labelledBy}
            className={`panel relative max-h-[88dvh] pb-[calc(env(safe-area-inset-bottom)+1.25rem)] w-full overflow-y-auto rounded-b-none p-5 shadow-[var(--shadow-3)] sm:rounded-b-[var(--radius-lg)] ${
              wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
            }`}
            initial={reduced ? { opacity: 0 } : { y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-3 sm:hidden" aria-hidden />
            {title && (
              <h2 id={labelledBy} className="mb-4 text-lg font-bold">
                {title}
              </h2>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- Toasts ----------

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}
interface ToastStore {
  toasts: Toast[];
  push: (text: string, tone?: Toast['tone']) => void;
}
let toastId = 1;
export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (text, tone = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.filter((t) => t.text !== text), { id, text, tone }].slice(-3) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2600);
  },
}));
export const toast = (text: string, tone?: Toast['tone']) => useToasts.getState().push(text, tone);

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+64px)] z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            className={`rounded-full px-4 py-2 text-sm font-semibold shadow-[var(--shadow-2)] ${
              t.tone === 'error' ? 'bg-danger text-white' : t.tone === 'success' ? 'bg-success text-white' : 'bg-text text-bg'
            }`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex min-h-11 items-center justify-between gap-4 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <span className="text-sm font-medium">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-3'}`}
      >
        <motion.span
          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow"
          animate={{ left: checked ? 24 : 4 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        />
      </button>
    </label>
  );
}
