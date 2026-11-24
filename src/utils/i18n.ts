export type Language = 'en' | 'id';

const dict = {
  en: {
    toolbar: {
      lightMode: 'Light mode',
      darkMode: 'Dark mode',
    },
    public3d: {
      backToHome: 'Back to Home',
      signInBtn: 'Open Main App',
      guestUploadHint:
        'Upload a .FIT or .GPX file to start, or use the sample track. No account required.',
      authLaunchTitle: 'Studio 3D',
      authLaunchSub:
        'Visualize any .FIT or .GPX run on a 3D map with custom .GLB avatars — no account required.',
      authLaunchBtn: 'Open Studio 3D',
    },
  },
  id: {
    toolbar: {
      lightMode: 'Mode Terang',
      darkMode: 'Mode Gelap',
    },
    public3d: {
      backToHome: 'Kembali ke Beranda',
      signInBtn: 'Buka Aplikasi Utama',
      guestUploadHint:
        'Unggah file .FIT atau .GPX untuk mulai, atau pakai sample track. Tidak perlu akun.',
      authLaunchTitle: 'Studio 3D',
      authLaunchSub:
        'Visualisasi lari dari .FIT / .GPX di peta 3D dengan avatar .GLB custom — tanpa akun.',
      authLaunchBtn: 'Buka Studio 3D',
    },
  },
} as const;

export type Dictionary = (typeof dict)['en'];

export function getTranslations(lang: Language): Dictionary {
  return dict[lang] ?? dict.id;
}
