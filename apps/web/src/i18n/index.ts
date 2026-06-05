// TERANODE web — i18next bootstrap (en + ne). Import this once from main.tsx.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { ne } from './ne';

export const LOCALES = ['en', 'ne'] as const;
export type AppLocale = (typeof LOCALES)[number];

const STORAGE_KEY = 'teranode.web.locale';

function initialLocale(): AppLocale {
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY)
    : null;
  if (stored === 'en' || stored === 'ne') return stored;
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en, ne },
  lng: initialLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
    document.documentElement.lang = lng;
  } catch {
    /* ignore */
  }
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language;
}

export default i18n;
