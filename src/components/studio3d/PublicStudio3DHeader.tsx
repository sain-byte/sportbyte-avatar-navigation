import React from 'react';
import { ArrowLeft, Globe, LogIn, Moon, Sun } from 'lucide-react';
import { getTranslations, type Language } from '../../utils/i18n';

interface PublicStudio3DHeaderProps {
  theme: 'light' | 'dark';
  lang: Language;
  onToggleTheme: () => void;
  onChangeLang: (lang: Language) => void;
  onGoHome: () => void;
  onSignIn: () => void;
}

export const PublicStudio3DHeader: React.FC<PublicStudio3DHeaderProps> = ({
  theme,
  lang,
  onToggleTheme,
  onChangeLang,
  onGoHome,
  onSignIn,
}) => {
  const dict = getTranslations(lang);
  const t3d = dict.public3d;
  const toolbarT = dict.toolbar;

  return (
    <header
      data-testid="public-3d-header"
      className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800"
    >
      <div className="max-w-[1380px] mx-auto px-3.5 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Brand mark + wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onGoHome();
          }}
          className="inline-flex items-center gap-2 font-display text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-600 text-white inline-flex items-center justify-center text-xs font-bold shrink-0 border border-blue-500">
            3D
          </span>
          <span>Sport Byte</span>
        </a>

        {/* Zone 2: Concise navigation link back to main app */}
        <nav aria-label="Public Studio 3D navigation" className="hidden sm:flex items-center gap-6 text-sm font-medium">
          <a
            href="/"
            data-testid="public-3d-back-btn"
            onClick={(e) => {
              e.preventDefault();
              onGoHome();
            }}
            className="inline-flex items-center gap-1.5 py-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border-b-2 border-transparent hover:border-slate-300 dark:hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t3d.backToHome}</span>
          </a>
        </nav>

        {/* Zone 3: Language, Theme, and Sign In primary CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label={dict.nav.languageLabel}
            data-testid="public-3d-lang"
            className="inline-flex items-center p-0.5 h-9 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
          >
            <Globe className="w-3.5 h-3.5 text-slate-400 mx-1.5 hidden sm:block" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onChangeLang('en')}
              aria-pressed={lang === 'en'}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                lang === 'en'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => onChangeLang('id')}
              aria-pressed={lang === 'id'}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                lang === 'id'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              ID
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? toolbarT.lightMode : toolbarT.darkMode}
            data-testid="public-3d-theme"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            data-testid="public-3d-signin-btn"
            onClick={onSignIn}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t3d.signInBtn}</span>
          </button>
        </div>
      </div>

      {/* Mobile compact back bar */}
      <div className="sm:hidden border-t border-slate-100 dark:border-slate-800 px-3.5 py-1.5 flex items-center justify-between">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onGoHome();
          }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t3d.backToHome}</span>
        </a>
        <span className="font-mono-tabular text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          /3D/
        </span>
      </div>
    </header>
  );
};
