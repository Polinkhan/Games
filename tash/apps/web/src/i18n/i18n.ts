import { useCallback } from 'react';
import { useSettings, type Lang } from '../app/settings';
import bn from './bn.json';
import en from './en.json';

export type MessageKey = keyof typeof en;
const DICTS: Record<Lang, Record<string, string>> = { en, bn };

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Format a number for display; Bangla uses Bengali digits. */
export function formatNumber(n: number, lang: Lang): string {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return lang === 'bn' ? s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]!) : s;
}

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    return typeof v === 'number' ? formatNumber(v, lang) : v;
  });
}

export type T = (key: MessageKey | (string & {}), params?: Record<string, string | number>) => string;

export function useT(): T {
  const lang = useSettings((s) => s.lang);
  return useCallback<T>((key, params) => translate(lang, key, params), [lang]);
}

export function useNum(): (n: number) => string {
  const lang = useSettings((s) => s.lang);
  return useCallback((n: number) => formatNumber(n, lang), [lang]);
}
