export type RunCategory =
  | 'Easy Run'
  | 'Interval Run'
  | 'Tempo Run'
  | 'Fast Run'
  | 'Recovery Run';

export const RUN_CATEGORIES: RunCategory[] = [
  'Easy Run',
  'Interval Run',
  'Tempo Run',
  'Fast Run',
  'Recovery Run',
];

export type PersonalBestKey = '12m' | '5k' | '10k' | 'hm' | 'fm';

export interface PersonalBestMeta {
  key: PersonalBestKey;
  title: string;
  subtitle: string;
  targetKm?: number;
  isDistanceBased?: boolean;
}

export const PERSONAL_BEST_DEFS: PersonalBestMeta[] = [
  { key: '12m', title: '12 Minute', subtitle: 'Cooper Distance', isDistanceBased: true },
  { key: '5k', title: '5 km', subtitle: '5,000 m Road / Track', targetKm: 5 },
  { key: '10k', title: '10 km', subtitle: '10,000 m Road', targetKm: 10 },
  { key: 'hm', title: 'HM', subtitle: 'Half Marathon 21.1 km', targetKm: 21.0975 },
  { key: 'fm', title: 'FM', subtitle: 'Full Marathon 42.2 km', targetKm: 42.195 },
];

export interface KmSplit {
  km: number;
  distanceKm: number;
  durationSec: number;
  paceSecPerKm: number;
  paceStr: string;
  hr?: number;
}

export interface RoutePoint {
  x: number;
  y: number;
}

export interface TelemetryPoint {
  lat: number;
  lon: number;
  ele: number;
  tSec: number;
  distKm: number;
  paceSec: number;
  hr?: number;
  cad?: number;
}

export interface RunLog {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  distanceKm: number;
  durationSec: number;
  durationStr: string;
  paceSecPerKm: number;
  paceStr: string;
  hr: number;
  cadence: number;
  strideCm: number;
  category: RunCategory;
  vo2max: number;
  note: string;
  kmSplits?: KmSplit[];
  routePoints?: RoutePoint[];
  telemetryPoints?: TelemetryPoint[];
  rawInput?: string;
  createdAt: string;
}

export interface PersonalBestEntry {
  id: string;
  userId: string;
  key: PersonalBestKey;
  valueDisplay: string;
  secondaryDisplay: string;
  numericValue: number; // for 12m: higher distanceKm is better; for 5k/10k/hm/fm: lower seconds is better
  date: string;
  runId?: string;
  source: 'auto' | 'manual';
  note?: string;
  createdAt: string;
}

export interface UserBiodata {
  fullName: string;
  email: string;
  birthDate: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  heightCm: number;
  weightKg: number;
  restingHr: number;
  maxHr: number;
  city: string;
  club: string;
  biography: string;
  avatarUrl: string;
  weeklyTargetKm?: number;
  spectatorEnabled?: boolean;
}

export interface AthleteUser {
  id: string;
  username: string;
  biodata: UserBiodata;
  passwordLinked?: boolean;
  createdAt: string;
}

export interface DashboardPayload {
  user: AthleteUser;
  runs: RunLog[];
  pbHistory: PersonalBestEntry[];
  availableDemoUsers: Array<{
    id: string;
    username: string;
    fullName: string;
    city: string;
    club: string;
    avatarUrl: string;
  }>;
  dbStats: {
    fileName: string;
    updatedAt: string;
    totalUsers: number;
    totalRuns: number;
    totalPbEntries: number;
    fileBytes: number;
  };
}

export interface PublicFeedProfile {
  id: string; // e.g. "cloud:<uid>" or "local:<username>"
  mode: 'cloud' | 'local';
  targetId: string;
  username: string;
  fullName: string;
  age: number;
  city: string;
  club: string;
  biography: string;
  avatarUrl: string;
  weeklyTargetKm: number;
  totalRuns: number;
  totalDistanceKm: number;
  latestRunDate: string;
  latestRunDistanceKm: number;
  latestRunDurationStr: string;
  latestRunPaceStr: string;
  latestRunCategory: RunCategory | '';
  latestRunNote: string;
  updatedAt: string;
}

