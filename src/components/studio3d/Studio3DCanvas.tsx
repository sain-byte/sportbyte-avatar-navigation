
import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  LightingMood3D,
  MapConfig,
  MapLoadStatus,
  RunnerConfig,
  Studio3DTrack,
} from '../../types/studio3d';
import {
  buildGroundedRoutePath,
  sampleGroundedRouteAtProgress,
} from '../../utils/studio3dGpsEngine';
import { resolveEffectiveCameraMode } from '../../utils/studio3dRunnerHelpers';
import { ChibiRunner3D } from './ChibiRunner3D';
import { CustomGlbRunner3D, type CustomGlbStatus } from './CustomGlbRunner3D';
import { RealisticRunner3D } from './RealisticRunner3D';
import { TerrainMap3D } from './TerrainMap3D';

interface Studio3DCanvasProps {
  track: Studio3DTrack;
  runner: RunnerConfig;
  mapConfig: MapConfig;
  timelineProgress: number;
  isPlaying: boolean;
  includeFinishPose: boolean;
  currentCadence: number;
  currentPaceSec: number;
  mapReloadNonce: number;
  onMapLoadStatus?: (status: MapLoadStatus) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onMapCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onCustomModelStatus?: (status: CustomGlbStatus) => void;
}

interface MoodPalette {
  keyColor: string;
  keyIntensity: number;
  keyPos: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  rimColor: string;
  rimIntensity: number;
}

function resolveLightingMood(
  mood: LightingMood3D,
  mapStyle: MapConfig['mapStyle'],
): Exclude<LightingMood3D, 'auto'> {
  if (mood !== 'auto') return mood;
  if (mapStyle === 'dark') return 'night-run';
  return 'city-park';
}

const MOOD_PALETTES: Record<Exclude<LightingMood3D, 'auto'>, MoodPalette> = {
  morning: {
    keyColor: '#FFF7ED',
    keyIntensity: 1.95,
    keyPos: [160, 220, 120],
    hemiSky: '#E0F2FE',
    hemiGround: '#86EFAC',
    hemiIntensity: 0.72,
    rimColor: '#FDE68A',
    rimIntensity: 0.65,
  },
  evening: {
    keyColor: '#FB923C',
    keyIntensity: 1.9,
    keyPos: [-220, 95, 140],
    hemiSky: '#FDBA74',
    hemiGround: '#431407',
    hemiIntensity: 0.6,
    rimColor: '#F97316',
    rimIntensity: 0.85,
  },
  night: {
    keyColor: '#93C5FD',
    keyIntensity: 1.05,
    keyPos: [120, 200, -140],
    hemiSky: '#1E3A8A',
    hemiGround: '#020617',
    hemiIntensity: 0.42,
    rimColor: '#38BDF8',
    rimIntensity: 1.35,
  },
  'city-park': {
    keyColor: '#FFFBEB',
    keyIntensity: 1.85,
    keyPos: [140, 240, 150],
    hemiSky: '#DBEAFE',
    hemiGround: '#94A3B8',
    hemiIntensity: 0.78,
    rimColor: '#BAE6FD',
    rimIntensity: 0.55,
  },
  mountain: {
    keyColor: '#F8FAFC',
    keyIntensity: 2.0,
    keyPos: [180, 210, -110],
    hemiSky: '#E0F2FE',
    hemiGround: '#475569',
    hemiIntensity: 0.7,
    rimColor: '#38BDF8',
    rimIntensity: 0.6,
  },
  'night-run': {
    keyColor: '#60A5FA',
    keyIntensity: 1.0,
    keyPos: [100, 190, 130],
    hemiSky: '#1E1B4B',
    hemiGround: '#020617',
    hemiIntensity: 0.44,
    rimColor: '#F97316',
    rimIntensity: 1.5,
  },
};

function detectSoftwareWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').toLowerCase();
    return (
      renderer.includes('swiftshader') ||
      renderer.includes('llvmpipe') ||
      renderer.includes('software')
    );
  } catch {
    return false;
  }
}

class WebGLErrorBoundary extends Component<
  { children: React.ReactNode; onErrorFallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; onErrorFallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.onErrorFallback ?? (
          <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-300 text-xs p-6 text-center">
            WebGL 3D belum tersedia di perangkat ini.
          </div>
        )
      );
    }
    return this.props.children;
  }
}

const SceneContent: React.FC<
  Studio3DCanvasProps & { mapContainer: HTMLDivElement | null }
> = ({
  track,
  runner,
  mapConfig,
  timelineProgress,
  isPlaying,
  includeFinishPose,
  currentCadence,
  currentPaceSec,
  mapReloadNonce,
  mapContainer,
  onMapLoadStatus,
  onCanvasReady,
  onMapCanvasReady,
  onCustomModelStatus,
}) => {
  const { gl, scene, camera } = useThree();
  const keyLightRef = useRef<THREE.DirectionalLight>(null);

  const resolvedMood = resolveLightingMood(mapConfig.lightingMood, mapConfig.mapStyle);
  const mood = MOOD_PALETTES[resolvedMood];
  const isNightMood = resolvedMood === 'night' || resolvedMood === 'night-run';

  useEffect(() => {
    onCanvasReady?.(gl.domElement);
    return () => onCanvasReady?.(null);
  }, [gl, onCanvasReady]);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();

    return () => {
      scene.environment = null;
      envTarget.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  // Flat Y=0 grounded path matching MapLibre GL planar ground
  const groundedPath = useMemo(
    () => buildGroundedRoutePath(track.points, () => 0, { heightOffsetM: 0.08 }),
    [track],
  );

  const finishThreshold = includeFinishPose ? 0.88 : 1.0;
  const routeProgress = THREE.MathUtils.clamp(timelineProgress / finishThreshold, 0, 1);
  const isFinishPhase =
    mapConfig.cameraMode === 'finish-pose' ||
    (includeFinishPose && timelineProgress >= finishThreshold);

  const characterSizeFactor =
    runner.characterSize === 'small'
      ? 0.55
      : runner.characterSize === 'large'
        ? 1.18
        : 0.82;

  const runnerScale = useMemo(
    () => Math.max(1.9, Math.min(11.0, track.spanMeters * 0.0056 * characterSizeFactor)),
    [track.spanMeters, characterSizeFactor],
  );

  const { runnerPos, runnerYaw } = useMemo(() => {
    const sampled = sampleGroundedRouteAtProgress(groundedPath, routeProgress);
    return { runnerPos: sampled.position, runnerYaw: sampled.yawRad };
  }, [groundedPath, routeProgress]);

  const camTargetPosRef = useRef(new THREE.Vector3());
  const camLookTargetRef = useRef(new THREE.Vector3());
  const smoothLookAtRef = useRef(new THREE.Vector3(runnerPos.x, runnerPos.y, runnerPos.z));
  const initializedCamRef = useRef(false);
  const prevScrubProgressRef = useRef(timelineProgress);
  const prevModeRef = useRef(mapConfig.cameraMode);

  useEffect(() => {
    initializedCamRef.current = false;
  }, [track.id]);

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);

    const effectiveMode = resolveEffectiveCameraMode(
      mapConfig.cameraMode,
      timelineProgress,
      isFinishPhase,
    );

    const zoom = THREE.MathUtils.clamp(mapConfig.cameraZoom ?? 1.0, 0.5, 2.5);
    const visualHeight = Math.max(10, runnerScale * 1.85);

    const overviewHeight = Math.max(165, Math.min(920, track.spanMeters * 0.68)) * zoom;
    const overviewDist = Math.max(135, Math.min(720, track.spanMeters * 0.52)) * zoom;
    const droneHeight = Math.max(46, Math.min(115, track.spanMeters * 0.062)) * zoom;
    const droneBackDist = droneHeight * 0.54;

    if (effectiveMode === 'overview') {
      const orbitAngle =
        mapConfig.cameraMode === 'auto'
          ? -0.45 + (timelineProgress / 0.08) * 0.35
          : state.clock.elapsedTime * 0.08;
      camTargetPosRef.current.set(
        Math.sin(orbitAngle) * overviewDist,
        overviewHeight,
        Math.cos(orbitAngle) * overviewDist,
      );
      camLookTargetRef.current.set(0, 0, 0);
    } else if (effectiveMode === 'follow-chase') {
      const chaseHeight = Math.max(46, visualHeight * 4.4) * zoom;
      const chaseBackDist = chaseHeight * 0.62;
      const trailAngle = runnerYaw + Math.PI * 0.95;
      const camX = runnerPos.x + Math.sin(trailAngle) * chaseBackDist;
      const camZ = runnerPos.z + Math.cos(trailAngle) * chaseBackDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + chaseHeight, 8), camZ);
      camLookTargetRef.current.set(
        runnerPos.x + Math.sin(runnerYaw) * (runnerScale * 3.8),
        runnerPos.y + runnerScale * 0.4,
        runnerPos.z + Math.cos(runnerYaw) * (runnerScale * 3.8),
      );
    } else if (effectiveMode === 'birds-eye') {
      const birdsHeight =
        Math.max(95, Math.min(270, Math.max(visualHeight * 10.5, track.spanMeters * 0.14))) * zoom;
      const birdsBackDist = birdsHeight * 0.19;
      const trailAngle = runnerYaw + Math.PI * 0.92;
      const camX = runnerPos.x + Math.sin(trailAngle) * birdsBackDist;
      const camZ = runnerPos.z + Math.cos(trailAngle) * birdsBackDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + birdsHeight, 12), camZ);
      camLookTargetRef.current.set(
        runnerPos.x + Math.sin(runnerYaw) * (runnerScale * 2.2),
        runnerPos.y + runnerScale * 0.4,
        runnerPos.z + Math.cos(runnerYaw) * (runnerScale * 2.2),
      );
    } else if (effectiveMode === 'drone-180') {
      const orbitSweep =
        Math.sin(timelineProgress * Math.PI * 2.5 + state.clock.elapsedTime * 0.22) *
        (Math.PI * 0.5);
      const orbitAngle = runnerYaw + Math.PI * 0.5 + orbitSweep;
      const orbitDist = Math.max(visualHeight * 3.6, Math.min(82, track.spanMeters * 0.052)) * zoom;
      const orbitHeight = Math.max(visualHeight * 2.0, Math.min(44, track.spanMeters * 0.028)) * zoom;
      const camX = runnerPos.x + Math.sin(orbitAngle) * orbitDist;
      const camZ = runnerPos.z + Math.cos(orbitAngle) * orbitDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + orbitHeight, 6), camZ);
      camLookTargetRef.current.set(runnerPos.x, runnerPos.y + runnerScale * 0.95, runnerPos.z);
    } else if (effectiveMode === 'follow-20m') {
      const baseAngle =
        mapConfig.camera20mAngle === 'front'
          ? runnerYaw
          : mapConfig.camera20mAngle === 'side'
            ? runnerYaw + Math.PI * 0.5
            : mapConfig.camera20mAngle === 'orbit'
              ? runnerYaw + Math.PI + timelineProgress * Math.PI * 4 + state.clock.elapsedTime * 0.45
              : runnerYaw + Math.PI;
      const horizDist = Math.max(36, visualHeight * 4.6) * zoom;
      const aerialHeight = Math.max(28, visualHeight * 3.8) * zoom;
      const camX = runnerPos.x + Math.sin(baseAngle) * horizDist;
      const camZ = runnerPos.z + Math.cos(baseAngle) * horizDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + aerialHeight, 8), camZ);
      camLookTargetRef.current.set(runnerPos.x, runnerPos.y + runnerScale * 0.8, runnerPos.z);
    } else if (effectiveMode === 'finish-pose') {
      const finishZoom = THREE.MathUtils.clamp(zoom, 0.75, 1.55);
      const orbitOffset = Math.sin(state.clock.elapsedTime * 0.65) * 0.12;
      const frontAngle = runnerYaw + orbitOffset;
      const heroDist = runnerScale * 8.2 * finishZoom;
      const heroHeight = runnerScale * 2.55 * finishZoom;
      camTargetPosRef.current.set(
        runnerPos.x + Math.sin(frontAngle) * heroDist,
        runnerPos.y + heroHeight,
        runnerPos.z + Math.cos(frontAngle) * heroDist,
      );
      camLookTargetRef.current.set(runnerPos.x, runnerPos.y + runnerScale * 1.68, runnerPos.z);
    } else {
      const trailAngle = runnerYaw + Math.PI * 0.86;
      const camX = runnerPos.x + Math.sin(trailAngle) * droneBackDist;
      const camZ = runnerPos.z + Math.cos(trailAngle) * droneBackDist;
      camTargetPosRef.current.set(camX, Math.max(runnerPos.y + droneHeight, 8), camZ);
      camLookTargetRef.current.set(
        runnerPos.x + Math.sin(runnerYaw) * (runnerScale * 2.2),
        runnerPos.y + runnerScale * 0.75,
        runnerPos.z + Math.cos(runnerYaw) * (runnerScale * 2.2),
      );
    }

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov =
        effectiveMode === 'follow-20m' || effectiveMode === 'birds-eye' ? 52 : 45;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4.5, dt);
        camera.updateProjectionMatrix();
      }
    }

    const jumpedWhilePaused =
      !isPlaying &&
      (Math.abs(timelineProgress - prevScrubProgressRef.current) > 0.08 ||
        mapConfig.cameraMode !== prevModeRef.current);
    prevScrubProgressRef.current = timelineProgress;
    prevModeRef.current = mapConfig.cameraMode;

    if (!initializedCamRef.current || jumpedWhilePaused) {
      camera.position.copy(camTargetPosRef.current);
      smoothLookAtRef.current.copy(camLookTargetRef.current);
      camera.lookAt(smoothLookAtRef.current);
      initializedCamRef.current = true;
    } else {
      const lambda =
        effectiveMode === 'overview' || effectiveMode === 'birds-eye'
          ? 3.4
          : effectiveMode === 'finish-pose'
            ? 4.0
            : effectiveMode === 'drone-180' || effectiveMode === 'follow-20m'
              ? 4.6
              : 5.5;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, camTargetPosRef.current.x, lambda, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, camTargetPosRef.current.y, lambda, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, camTargetPosRef.current.z, lambda, dt);

      smoothLookAtRef.current.x = THREE.MathUtils.damp(smoothLookAtRef.current.x, camLookTargetRef.current.x, lambda + 1.5, dt);
      smoothLookAtRef.current.y = THREE.MathUtils.damp(smoothLookAtRef.current.y, camLookTargetRef.current.y, lambda + 1.5, dt);
      smoothLookAtRef.current.z = THREE.MathUtils.damp(smoothLookAtRef.current.z, camLookTargetRef.current.z, lambda + 1.5, dt);
      camera.lookAt(smoothLookAtRef.current);
    }

    if (keyLightRef.current) {
      keyLightRef.current.position.set(
        runnerPos.x + mood.keyPos[0] * 0.55,
        runnerPos.y + mood.keyPos[1] * 0.55,
        runnerPos.z + mood.keyPos[2] * 0.55,
      );
      keyLightRef.current.target.position.copy(runnerPos);
      keyLightRef.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      <hemisphereLight args={[mood.hemiSky, mood.hemiGround, mood.hemiIntensity]} />

      <directionalLight
        ref={keyLightRef}
        color={mood.keyColor}
        intensity={mood.keyIntensity}
        position={mood.keyPos}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={10}
        shadow-camera-far={420}
        shadow-camera-left={-48}
        shadow-camera-right={48}
        shadow-camera-top={48}
        shadow-camera-bottom={-48}
        shadow-bias={-0.0003}
        shadow-normalBias={0.04}
      />

      <directionalLight
        color={mood.rimColor}
        intensity={mood.rimIntensity}
        position={[-140, 90, -160]}
      />

      <TerrainMap3D
        key={track.id}
        track={track}
        mapStyle={mapConfig.mapStyle}
        routeStyle={mapConfig.routeStyle ?? 'google-maps'}
        buildings3d={mapConfig.buildings3d}
        isNight={isNightMood}
        jerseyColor={runner.jerseyColor}
        routeProgress={routeProgress}
        groundedPath={groundedPath}
        mapReloadNonce={mapReloadNonce}
        mapContainer={mapContainer}
        onMapCanvasReady={onMapCanvasReady}
        onMapLoadStatus={onMapLoadStatus}
      />

      {runner.characterStyle === 'custom-glb' && runner.customModelUrl ? (
        <CustomGlbRunner3D
          config={runner}
          position={runnerPos}
          yawRad={runnerYaw}
          scale={runnerScale}
          cadenceSpm={currentCadence}
          paceSecPerKm={currentPaceSec}
          isPlaying={isPlaying}
          isFinishPose={isFinishPhase}
          includeFinishPose={includeFinishPose}
          isManualFinishCamera={mapConfig.cameraMode === 'finish-pose'}
          timelineProgress={timelineProgress}
          onStatusChange={onCustomModelStatus}
        />
      ) : runner.characterStyle === 'realistic' || runner.characterStyle === 'custom-glb' ? (
        <RealisticRunner3D
          config={runner}
          position={runnerPos}
          yawRad={runnerYaw}
          scale={runnerScale}
          cadenceSpm={currentCadence}
          paceSecPerKm={currentPaceSec}
          isPlaying={isPlaying}
          isFinishPose={isFinishPhase}
          includeFinishPose={includeFinishPose}
          isManualFinishCamera={mapConfig.cameraMode === 'finish-pose'}
          timelineProgress={timelineProgress}
          isNightMood={isNightMood}
        />
      ) : (
        <ChibiRunner3D
          config={runner}
          position={runnerPos}
          yawRad={runnerYaw}
          scale={runnerScale}
          cadenceSpm={currentCadence}
          paceSecPerKm={currentPaceSec}
          isPlaying={isPlaying}
          isFinishPose={isFinishPhase}
          includeFinishPose={includeFinishPose}
          isManualFinishCamera={mapConfig.cameraMode === 'finish-pose'}
          timelineProgress={timelineProgress}
          isNightMood={isNightMood}
        />
      )}
    </>
  );
};

export const Studio3DCanvas: React.FC<Studio3DCanvasProps> = (props) => {
  const isSoftwareGl = useMemo(() => detectSoftwareWebGL(), []);
  const [contextLost, setContextLost] = useState(false);
  const [mapContainer, setMapContainer] = useState<HTMLDivElement | null>(null);

  return (
    <WebGLErrorBoundary>
      {contextLost ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-200 p-6 text-center gap-3">
          <p className="text-xs font-medium">Konteks WebGL terputus. Klik muat ulang kanvas 3D.</p>
          <button
            type="button"
            onClick={() => setContextLost(false)}
            className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold cursor-pointer"
          >
            Muat Ulang 3D
          </button>
        </div>
      ) : (
        <div className="relative w-full h-full">
          {/* Layer Bawah: MapLibre GL OpenFreeMap */}
          <div
            ref={setMapContainer}
            id="map"
            className="absolute inset-0 w-full h-full"
          />

          {/* Layer Atas: Three.js Avatar & Route Ribbon Transparan */}
          <div className="relative w-full h-full pointer-events-none">
            <Canvas
              shadows={!isSoftwareGl}
              dpr={isSoftwareGl ? 1 : [1, 2]}
              camera={{ fov: 44, near: 1.5, far: 4500, position: [0, 120, 140] }}
              gl={{
                alpha: true,
                preserveDrawingBuffer: true,
                antialias: !isSoftwareGl,
                powerPreference: 'high-performance',
                toneMapping: THREE.ACESFilmicToneMapping,
                toneMappingExposure: 1.0,
              }}
              onCreated={({ gl }) => {
                gl.setClearColor(0x000000, 0);
                gl.domElement.addEventListener(
                  'webglcontextlost',
                  (e) => {
                    e.preventDefault();
                    setContextLost(true);
                  },
                  false,
                );
              }}
            >
              <SceneContent {...props} mapContainer={mapContainer} />
            </Canvas>
          </div>
        </div>
      )}
    </WebGLErrorBoundary>
  );
};
