'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translate, type Lang, type MessageKey } from '@/i18n';
import type { ParamValue } from '@/engine/types';

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, params?: Record<string, ParamValue>, currency?: string) => string;
}
const LangContext = createContext<Ctx | null>(null);

const KEY = 'lang';
function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'lt' || stored === 'pl' || stored === 'en') return stored;
  } catch {
    /* storage unavailable */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase();
  return nav === 'lt' ? 'lt' : nav === 'pl' ? 'pl' : 'en';
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('lt');
  useEffect(() => setLangState(initialLang()), []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t: (key, params, currency) => translate(lang, key, params, currency) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangContext);
  if (!c) throw new Error('LangProvider missing');
  return c;
}
