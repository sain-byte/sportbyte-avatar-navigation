export type Language = 'en' | 'id';

export interface AppTranslations {
  nav: {
    studio3d: string;
  };
  toolbar: {
    lightMode: string;
    darkMode: string;
  };
  public3d: {
    backToHome: string;
    signInBtn: string;
    guestUploadHint: string;
    authLaunchNote: string;
    syncAccountHint: string;
    offlineBadge: string;
  };
}

export const TRANSLATIONS: Record<Language, AppTranslations> = {
  en: {
    nav: {
      studio3d: '3D Animation Studio',
    },
    toolbar: {
      lightMode: 'Light mode',
      darkMode: 'Dark mode',
    },
    public3d: {
      backToHome: 'Back to Home',
      signInBtn: 'Open Main App',
      guestUploadHint:
        'Upload a .FIT or .GPX file to start, or use the sample track. No account required.',
      authLaunchNote:
        'Works offline & locally in your browser — upload .FIT / .GPX anytime.',
      syncAccountHint: 'Sign in with SportByte account to sync your run history.',
      offlineBadge: 'Offline Ready',
    },
  },
  id: {
    nav: {
      studio3d: 'Studio Animasi 3D',
    },
    toolbar: {
      lightMode: 'Mode Terang',
      darkMode: 'Mode Gelap',
    },
    public3d: {
      backToHome: 'Kembali ke Beranda',
      signInBtn: 'Buka Aplikasi Utama',
      guestUploadHint:
        'Unggah file .FIT atau .GPX untuk mulai, atau pakai sample track. Tidak perlu akun.',
      authLaunchNote:
        'Berjalan lokal di browser — unggah file .FIT / .GPX kapan saja tanpa login.',
      syncAccountHint: 'Masuk dengan akun SportByte untuk menyinkronkan riwayat lari.',
      offlineBadge: 'Siap Offline',
    },
  },
};

export function getTranslations(lang: Language): AppTranslations {
  return TRANSLATIONS[lang] ?? TRANSLATIONS.id;
}
