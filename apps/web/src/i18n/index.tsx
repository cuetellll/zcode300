import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fa, type FaDict } from './fa';
import { en } from './en';

export type Lang = 'fa' | 'en';
export type Dict = FaDict;

const dictionaries: Record<Lang, Dict> = {
  fa,
  // English must provide every key the Persian dictionary has.
  en,
};

function assertComplete(): void {
  const faKeys = Object.keys(fa).sort();
  const enKeys = Object.keys(en).sort();
  if (JSON.stringify(faKeys) !== JSON.stringify(enKeys)) {
    const missingInEn = faKeys.filter((k) => !(k in en));
    const missingInFa = enKeys.filter((k) => !(k in fa));
    throw new Error(`i18n dictionaries out of sync. missingInEn=${missingInEn} missingInFa=${missingInFa}`);
  }
}
assertComplete();

interface I18nContextValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: (key: keyof Dict) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = 'mahyar_gap_lang';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'en' || stored === 'fa' ? stored : 'fa';
  });

  const dir = lang === 'fa' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang, dir]);

  const t = useCallback((key: keyof Dict) => dictionaries[lang][key] ?? key, [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, dir, t, setLang: setLangState }),
    [lang, dir, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
