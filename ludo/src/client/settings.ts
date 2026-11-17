export interface Settings {
  name: string;
  lang: 'en' | 'bn';
  sound: boolean;
}

const KEY = 'ludo.settings';

function load(): Settings {
  const fallback: Settings = { name: '', lang: navigator.language?.startsWith('bn') ? 'bn' : 'en', sound: true };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return fallback;
  }
}

export const settings: Settings = load();

export function saveSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
  document.documentElement.lang = settings.lang;
}

/** Stable anonymous identity used to rejoin rooms after a refresh. */
export function identity(): { playerId: string; token: string } {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    const raw = localStorage.getItem('ludo.identity');
    if (raw) return JSON.parse(raw) as { playerId: string; token: string };
    const id = { playerId: make(), token: make() + make() };
    localStorage.setItem('ludo.identity', JSON.stringify(id));
    return id;
  } catch {
    return { playerId: make(), token: make() + make() };
  }
}
