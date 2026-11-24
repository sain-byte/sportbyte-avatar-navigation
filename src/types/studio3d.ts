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
export type CanonicalMapStyle3D =
  | 'standard'
  | 'liberty'
  | 'satellite'
  | 'terrain'
  | 'monochrome'
  | 'hybrid'
  | 'city3d';
export type MapStyle3D =
  | CanonicalMapStyle3D
  | 'openfreemap'
  | 'voyager'
  | 'topo'
  | 'street'
  | 'night';
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
  cameraZoom: number; // 0.5..2.5 multiplier (1.0 = calibrated default)
  mapStyle: MapStyle3D;
  buildings3d: boolean;
  overlayRelief?: boolean; // Three.js elevation contour + hillshade overlay texture
  overlaySurface?: boolean; // Three.js PBR surface micro-detail bump/roughness overlay
  overlayLabels?: boolean; // Three.js street/reference label overlay texture
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
  volume: number; // 0..1
  quality: VideoQuality3D;
}

export interface Studio3DTrackPoint {
  lat: number;
  lon: number;
  xM: number; // East-West meters relative to center
  zM: number; // North-South meters relative to center (North = negative Z in Three.js)
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
  progress: number; // 0..1 along route
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

export interface OsmBuildingFootprint {
  id: string;
  polygon: Array<{ xM: number; zM: number }>;
  heightM: number;
  levels?: number;
  distanceToRouteM?: number;
}

export interface OsmRoadWay {
  id: string;
  highway: string;
  widthM: number;
  layer?: number;
  points: Array<{ xM: number; zM: number }>;
}

export function normalizeMapStyle3D(style: MapStyle3D): CanonicalMapStyle3D {
  if (style === 'openfreemap') return 'liberty';
  if (style === 'voyager' || style === 'street') return 'standard';
  if (style === 'topo') return 'terrain';
  if (style === 'night') return 'city3d';
  return style;
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
  mapStyle: 'standard',
  buildings3d: true,
  overlayRelief: true,
  overlaySurface: true,
  overlayLabels: true,
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
