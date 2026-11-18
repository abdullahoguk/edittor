// Bilingual UI (TR / EN). The key is the Turkish text itself; the English text comes from en.ts.
import { create } from 'zustand';
import { EN } from './en';

export type Lang = 'tr' | 'en';

function initial(): Lang {
  try {
    const s = localStorage.getItem('edittor.lang');
    if (s === 'tr' || s === 'en') return s;
  } catch { /* unavailable */ }
  return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export const useLang = create<{ lang: Lang }>(() => ({ lang: initial() }));

export function setLang(lang: Lang) {
  try { localStorage.setItem('edittor.lang', lang); } catch { /* unavailable */ }
  document.documentElement.lang = lang;
  useLang.setState({ lang });
}

const missing = new Set<string>();

/** Translates Turkish text into the active language and fills placeholders like `{n}`. */
export function tx(tr: string, vars?: Record<string, string | number>): string {
  let s = tr;
  if (useLang.getState().lang === 'en') {
    const e = EN[tr];
    if (e != null) s = e;
    else if (import.meta.env.DEV && /[a-zçğıöşü]{3,}/.test(tr) && !missing.has(tr)) { missing.add(tr); console.warn('[i18n] missing translation:', tr); }
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export const locale = () => (useLang.getState().lang === 'tr' ? 'tr-TR' : 'en-US');
