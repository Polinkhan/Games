import { create } from 'zustand';

export type Lang = 'en' | 'bn';
export type ThemePref = 'system' | 'light' | 'dark';
export type MotionPref = 'system' | 'full' | 'reduced';
export type CardBack = 'blue' | 'violet' | 'rose' | 'teal';

export interface Settings {
  name: string;
  lang: Lang;
  theme: ThemePref;
  motion: MotionPref;
  sound: boolean;
  cardBack: CardBack;
  fourColour: boolean;
  /** Play a card with a single tap instead of tap-to-lift, tap-again-to-play. */
  singleTap: boolean;
}

const KEY = 'tash.settings';

function load(): Settings {
  const defaults: Settings = {
    name: '',
    lang: typeof navigator !== 'undefined' && navigator.language?.startsWith('bn') ? 'bn' : 'en',
    theme: 'system',
    motion: 'system',
    sound: false,
    cardBack: 'blue',
    fourColour: false,
    singleTap: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { set: _ignored, ...rest } = { ...get(), ...patch };
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* storage unavailable */
    }
  },
}));

export function prefersReducedMotion(): boolean {
  const pref = useSettings.getState().motion;
  if (pref === 'reduced') return true;
  if (pref === 'full') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useReducedMotion(): boolean {
  const pref = useSettings((s) => s.motion);
  if (pref === 'reduced') return true;
  if (pref === 'full') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Keep <html> attributes in sync with settings. */
export function applyDocumentSettings(s: Settings): void {
  const el = document.documentElement;
  if (s.theme === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', s.theme);
  el.setAttribute('lang', s.lang);
  el.setAttribute('data-cardback', s.cardBack);
}
