// Traducción mínima sin dependencias: `t(clave, vars)` con diccionarios planos por idioma. Las claves salen del
// diccionario inglés (en.ts), así que una clave que falte en otro idioma es un error de tipos. El idioma elegido se
// guarda en localStorage (`pg-lang`); por defecto, inglés. Para añadir un idioma: crear su diccionario y sumarlo a LANGS.
import { useSyncExternalStore } from 'react';
import { en as enBase, type Key as BaseKey } from './en';
import { es as esBase } from './es';
import { serverText } from './server';
import { fen, fes, FES_SERVER_EXACT, FES_SERVER_PATTERNS, type FKey } from './features';

export type Key = BaseKey | FKey;
const en: Record<Key, string> = { ...enBase, ...fen };
const es: Record<Key, string> = { ...esBase, ...fes };
export type Lang = 'en' | 'es';
export type Vars = Record<string, string | number>;

export const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'es', label: 'ES', name: 'Español' },
];
const DICTS: Record<Lang, Record<Key, string>> = { en, es };
const STORAGE_KEY = 'pg-lang';

const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.code === v);
function readSaved(): Lang {
  try { const v = localStorage.getItem(STORAGE_KEY); if (isLang(v)) return v; } catch { /* sin storage */ }
  return 'en';
}

let lang: Lang = readSaved();
const listeners = new Set<() => void>();
const applyDocLang = () => { if (typeof document !== 'undefined') document.documentElement.lang = lang; };
applyDocLang();

export const getLang = () => lang;
export function setLang(next: Lang) {
  if (next === lang || !isLang(next)) return;
  lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* sin storage */ }
  applyDocLang();
  listeners.forEach((l) => l());
}
export function onLangChange(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

export function t(key: Key, vars?: Vars): string {
  return fill(DICTS[lang][key] ?? en[key] ?? key, vars);
}
/** Para claves armadas en tiempo de ejecución (p. ej. `mart.${item}.name`): si no existe, devuelve `fallback`. */
export function tk(key: string, fallback: string, vars?: Vars): string {
  const s = (DICTS[lang] as Record<string, string>)[key] ?? (en as Record<string, string>)[key];
  return s === undefined ? fallback : fill(s, vars);
}
/** Mensajes del servidor (en inglés): se traducen en el cliente si se conocen; si no, se muestran tal cual. */
export const tServer = (msg: string) => {
  if (lang === 'en') return msg;
  const hit = FES_SERVER_EXACT[msg];
  if (hit) return hit;
  for (const [re, fn] of FES_SERVER_PATTERNS) { const m = msg.match(re); if (m) return fn(...m); }
  return serverText(lang, msg);
};

/** Re-renderiza el componente al cambiar de idioma y devuelve `t`. */
export function useT() {
  useSyncExternalStore(onLangChange, getLang, getLang);
  return t;
}
export const useLang = () => useSyncExternalStore(onLangChange, getLang, getLang);
