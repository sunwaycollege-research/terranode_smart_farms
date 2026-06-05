import { useLanguage, type UseLanguage } from '../i18n/useLanguage';

const LABELS: Record<string, string> = { en: 'EN', ne: 'ने' };

export function LanguageSwitcher() {
  const { language, locales, setLanguage }: UseLanguage = useLanguage();
  return (
    <div className="tn-langswitch" role="group" aria-label="Language">
      {locales.map((lng) => (
        <button
          key={lng}
          type="button"
          className={lng === language ? 'is-active' : ''}
          onClick={() => setLanguage(lng)}
          aria-pressed={lng === language}
        >
          {LABELS[lng] ?? lng.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
