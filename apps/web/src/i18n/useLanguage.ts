// TERANODE web — language switcher hook. Exposes the current locale + a setter
// that flips i18next (and persists via the languageChanged listener in index.ts).
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, type AppLocale } from './index';

export interface UseLanguage {
  language: AppLocale;
  locales: readonly AppLocale[];
  setLanguage: (lng: AppLocale) => void;
  toggle: () => void;
}

export function useLanguage(): UseLanguage {
  const { i18n } = useTranslation();
  const current = (i18n.language?.startsWith('ne') ? 'ne' : 'en') as AppLocale;

  const setLanguage = useCallback(
    (lng: AppLocale) => {
      void i18n.changeLanguage(lng);
    },
    [i18n],
  );

  const toggle = useCallback(() => {
    void i18n.changeLanguage(current === 'en' ? 'ne' : 'en');
  }, [i18n, current]);

  return { language: current, locales: LOCALES, setLanguage, toggle };
}
