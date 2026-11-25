export type RunnerGender = 'male' | 'female';
export type RunnerHairStyle = 'undercut' | 'spiky' | 'side-fade';
export type RunnerAccessory = 'none' | 'cap' | 'headband' | 'visor' | 'trail-vest';
export type CharacterStyle3D = 'chibi' | 'realistic' | 'custom-glb';
export type CharacterSize3D = 'small' | 'medium' | 'large';
export type GaitMode3D = 'auto' | 'walk' | 'jog' | 'run' | 'sprint';
export type FinishPoseStyle3D = 'celebrate-jump' | 'exhausted-bow' | 'victory-raise';
export type CustomModelAnimMode = 'auto' | 'bones' | 'clip';

export interface RunnerConfig {
  characterStyle: CharacterStyle3D;
  characterSize: CharacterSize3D;
  gaitMode: GaitMode3D;
  finishPoseStyle: FinishPoseStyle3D;
  customModelUrl: string | null;
  customModelName: string | null;
  customModelFlip180: boolean;
  customModelAnimMode: CustomModelAnimMode;
  runnerName: string;
  bibNumber: string;
  gender: RunnerGender;
  glasses: boolean;
  hairStyle: RunnerHairStyle;
  accessory: RunnerAccessory;
  jerseyColor: string;
  shortsColor: string;
  shoesColor: string;
}

export interface MapLoadStatus {
  phase: 'loading' | 'ready' | 'partial' | 'error';
  loadedTiles: number;
  failedTiles: number;
  totalTiles: number;
  zoom: number;
}

export type CameraMode3D =
  | 'auto'
  | 'follow-chase'
  | 'drone'
  | 'drone-180'
  | 'follow-20m'
  | 'birds-eye'
  | 'overview'
  | 'finish-pose';
export type Camera20mAngle = 'front' | 'back' | 'side' | 'orbit';
export type MapMode3D = 'light' | 'dark';
export type MapStyle3D = MapMode3D;

export type LightingMood3D =
  | 'auto'
  | 'morning'
  | 'evening'
  | 'night'
  | 'city-park'
  | 'mountain'
  | 'night-run';

export type RouteVisualStyle3D =
  | 'google-maps'
  | 'sportbyte-lime'
  | 'google-pace'
  | 'sport-jersey'
  | 'minimal-clean';
export type RouteSnapMode3D = 'raw' | 'snap-road';

export interface MapConfig {
  cameraMode: CameraMode3D;
  camera20mAngle: Camera20mAngle;
  cameraZoom: number;
  mapStyle: MapMode3D;
  buildings3d: boolean;
  lightingMood: LightingMood3D;
  routeStyle?: RouteVisualStyle3D;
  routeSnapMode?: RouteSnapMode3D;
}

export type DurationPresetSec = 15 | 30 | 45 | 60 | 'custom';
export type MusicPreset3D = 'none' | 'upbeat-synth' | 'lofi-stride' | 'epic-trail' | 'custom-mp3';
export type VideoQuality3D = '720p' | '1080p';

export interface ExportConfig {
  durationPreset: DurationPresetSec;
  customDurationSec: number;
  includeFinishPose: boolean;
  musicPreset: MusicPreset3D;
  customAudioUrl: string | null;
  customAudioName: string | null;
  volume: number;
  quality: VideoQuality3D;
}

export interface Studio3DTrackPoint {
  lat: number;
  lon: number;
  xM: number;
  zM: number;
  elevationM: number;
  elapsedSec: number;
  distanceKm: number;
  paceSecPerKm: number;
  hr: number;
  cadence: number;
}

export type LandmarkType3D = 'start' | 'finish' | 'peak' | 'km' | 'custom';

export interface Studio3DLandmark {
  id: string;
  label: string;
  type: LandmarkType3D;
  progress: number;
  distanceKm: number;
  elevationM: number;
}

export interface Studio3DTrack {
  id: string;
  title: string;
  date: string;
  location: string;
  source: 'fit' | 'gpx' | 'sample' | 'history';
  points: Studio3DTrackPoint[];
  totalDistanceKm: number;
  totalDurationSec: number;
  avgPaceSecPerKm: number;
  avgHr: number;
  avgCadence: number;
  elevationGainM: number;
  minElevationM: number;
  maxElevationM: number;
  centerLat: number;
  centerLon: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  spanMeters: number;
  landmarks: Studio3DLandmark[];
}

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  characterStyle: 'chibi',
  characterSize: 'medium',
  gaitMode: 'auto',
  finishPoseStyle: 'celebrate-jump',
  customModelUrl: null,
  customModelName: null,
  customModelFlip180: false,
  customModelAnimMode: 'auto',
  runnerName: 'Pelari Nusantara',
  bibNumber: '2026',
  gender: 'male',
  glasses: false,
  hairStyle: 'undercut',
  accessory: 'cap',
  jerseyColor: '#F97316',
  shortsColor: '#0F172A',
  shoesColor: '#38BDF8',
};

export const DEFAULT_MAP_CONFIG: MapConfig = {
  cameraMode: 'auto',
  camera20mAngle: 'back',
  cameraZoom: 1.0,
  mapStyle: 'light',
  buildings3d: true,
  lightingMood: 'auto',
  routeStyle: 'google-maps',
  routeSnapMode: 'raw',
};

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  durationPreset: 30,
  customDurationSec: 25,
  includeFinishPose: true,
  musicPreset: 'upbeat-synth',
  customAudioUrl: null,
  customAudioName: null,
  volume: 0.65,
  quality: '720p',
};
