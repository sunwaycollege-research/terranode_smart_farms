// TERANODE mobile i18n — i18next + react-i18next, en + ne bundles.
//
// Exposes:
//   <I18nProvider> — wraps the tree, hydrates the persisted language from
//                    AsyncStorage before rendering children.
//   useT()         — returns { t, lang, setLanguage } where t(key, vars?) is a
//                    typed translate fn over the en/ne key set.
//   setLanguage()  — also available standalone; persists to AsyncStorage.
//
// We intentionally keep a tiny typed wrapper around i18next.t so screens get
// autocomplete on translation keys (TranslationKey) instead of free strings.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { en, type TranslationKey } from './en';
import { ne } from './ne';

export type Lang = 'en' | 'ne';
export const LANGUAGES: readonly Lang[] = ['en', 'ne'];

const STORAGE_KEY = 'teranode.lang';

// Initialise i18next exactly once at module load. resources are the flat
// key→string maps; we disable key nesting so dotted keys are literal.
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ne: { translation: ne },
    },
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    compatibilityJSON: 'v4',
  });
}

async function loadStoredLang(): Promise<Lang | null> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'ne' ? v : null;
  } catch {
    return null;
  }
}

async function persistLang(lang: Lang): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // best-effort; ignore storage failures (e.g. web private mode)
  }
}

/** Typed translate function: t('zone.dayOf', { day: 3, total: 45 }). */
export type TFunc = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18nState {
  t: TFunc;
  lang: Lang;
  setLanguage: (lang: Lang) => Promise<void>;
}

const I18nContext = createContext<I18nState | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { t: rawT, i18n: inst } = useTranslation();
  const [lang, setLang] = useState<Lang>((inst.language as Lang) ?? 'en');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the persisted language on mount.
  useEffect(() => {
    (async () => {
      const stored = await loadStoredLang();
      if (stored && stored !== inst.language) {
        await inst.changeLanguage(stored);
        setLang(stored);
      }
      setHydrated(true);
    })();
  }, [inst]);

  const setLanguage = useMemo(
    () => async (next: Lang) => {
      await inst.changeLanguage(next);
      setLang(next);
      await persistLang(next);
    },
    [inst]
  );

  const t = useMemo<TFunc>(
    () => (key, vars) => rawT(key, vars as Record<string, unknown>) as string,
    [rawT, lang]
  );

  const value = useMemo<I18nState>(() => ({ t, lang, setLanguage }), [t, lang, setLanguage]);

  // Avoid a flash of the default language before AsyncStorage resolves.
  if (!hydrated) return null;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access the typed translate fn + current language + setter. */
export function useT(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside <I18nProvider>');
  return ctx;
}

/** Standalone language setter (also persists). Prefer useT().setLanguage in components. */
export async function setLanguage(lang: Lang): Promise<void> {
  await i18n.changeLanguage(lang);
  await persistLang(lang);
}

export type { TranslationKey };
