import * as THREE from 'three';
import type { CameraMode3D } from '../types/studio3d';
export {
  blendGaitProfiles,
  blendGaitToFinishPoseKinematics,
  computeArmDropCharQuat,
  computeElbowBendLocalCharQuat,
  computeFinishTransitionBlend,
  computePreFinishGaitScale,
  createEmptyGaitFramePose,
  detectBoneSide,
  evaluateFinishPoseKinematics,
  evaluateMultiPhaseGaitFrame,
  extractFullHumanoidRig,
  GAIT_PRESETS,
  normalizeBoneName,
  resolveGaitProfile,
  type ArmKinematicsPose,
  type BoneRigSlot,
  type CalibratedCharAxes,
  type FinishPoseKinematics,
  type FingerRigSlot,
  type GaitBiomechanics,
  type GaitFramePose,
  type HumanoidRigMap,
  type HumanoidSlotKey,
  type LegKinematicsPose,
  type ResolvedGaitKey,
} from './studio3dGaitEngine';

/**
 * Resolves the active 3D camera mode for the current timeline frame.
 * During Auto: brief opening overview (0..8%) -> 3/4 oblique road chase ('follow-chase') -> front-facing avatar ('finish-pose') at Finish.
 * Any follow-chase mode also smoothly switches to front-facing 'finish-pose' once the runner crosses the Finish line.
 */
export function resolveEffectiveCameraMode(
  cameraMode: CameraMode3D,
  timelineProgress: number,
  isFinishPhase: boolean,
): Exclude<CameraMode3D, 'auto'> {
  if (isFinishPhase && cameraMode !== 'overview') {
    return 'finish-pose';
  }
  if (cameraMode === 'auto') {
    if (timelineProgress < 0.08) return 'overview';
    return 'follow-chase';
  }
  return cameraMode;
}

export const CONFETTI_COUNT = 26;
export const CONFETTI_COLORS = ['#F97316', '#38BDF8', '#34D399', '#FBBF24', '#F43F5E'];

export interface ConfettiSeed {
  angle: number;
  radius: number;
  speed: number;
  phase: number;
}

/**
 * Determines whether an embedded GLTF AnimationClip actually contains locomotion motion
 * (walk/run/stride) rather than a static rest pose or subtle standing breathing loop.
 */
export function isClipLocomotion(clip: THREE.AnimationClip): boolean {
  const cleanName = clip.name.trim().toLowerCase();
  if (clip.duration < 0.25 || clip.tracks.length === 0) return false;
  if (/(t-?pose|a-?pose|bind|rest|static|idle|stand|breath|survey)/.test(cleanName)) {
    return false;
  }
  if (/(run|jog|sprint|stride|walk|locomotion|gallop)/.test(cleanName)) {
    return true;
  }

  // Fallback for generic names like "Take 001" or "mixamo.com": inspect quaternion angular range
  let activeRotTracks = 0;
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion') || track.values.length < 8) continue;
    let minDot = 1;
    const x0 = track.values[0];
    const y0 = track.values[1];
    const z0 = track.values[2];
    const w0 = track.values[3];
    for (let i = 4; i + 3 < track.values.length; i += 4) {
      const dot = Math.abs(
        x0 * track.values[i] +
          y0 * track.values[i + 1] +
          z0 * track.values[i + 2] +
          w0 * track.values[i + 3],
      );
      if (dot < minDot) minDot = dot;
    }
    // dot < 0.985 corresponds to > ~20 deg joint swing during the clip
    if (minDot < 0.985) {
      activeRotTracks += 1;
    }
  }
  return activeRotTracks >= 3;
}

export function buildConfettiSeeds(): ConfettiSeed[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    angle: (i / CONFETTI_COUNT) * Math.PI * 2,
    radius: 0.45 + ((i * 19) % 10) * 0.08,
    speed: 1.4 + ((i * 7) % 5) * 0.25,
    phase: i * 0.7,
  }));
}

export function updateConfettiMesh(
  confettiMesh: THREE.InstancedMesh | null,
  visible: boolean,
  timeSec: number,
  seeds: ConfettiSeed[],
  dummyObj: THREE.Object3D,
  heightTop = 2.15,
) {
  if (!confettiMesh) return;
  confettiMesh.visible = visible;
  if (!visible) return;

  for (let i = 0; i < CONFETTI_COUNT; i += 1) {
    const seed = seeds[i];
    const cycle = ((timeSec * seed.speed + seed.phase) % 2.4) / 2.4;
    const r = seed.radius * (0.6 + cycle * 1.15);
    dummyObj.position.set(
      Math.cos(seed.angle + timeSec * 0.8) * r,
      heightTop - cycle * 1.9 + Math.sin(cycle * Math.PI) * 0.45,
      Math.sin(seed.angle + timeSec * 0.8) * r,
    );
    dummyObj.rotation.set(timeSec * 3 + i, timeSec * 2, i);
    dummyObj.scale.setScalar(1 - cycle * 0.45);
    dummyObj.updateMatrix();
    confettiMesh.setMatrixAt(i, dummyObj.matrix);
  }
  confettiMesh.instanceMatrix.needsUpdate = true;
}

export function createJerseyBibTexture(jerseyColor: string, bibNumber: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = jerseyColor;
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(0, 320);
    ctx.lineTo(512, 230);
    ctx.lineTo(512, 290);
    ctx.lineTo(0, 380);
    ctx.closePath();
    ctx.fill();

    const drawBibAt = (cx: number, cy: number) => {
      const bw = 136;
      const bh = 86;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 4;
      ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);

      ctx.fillStyle = '#F97316';
      ctx.fillRect(cx - bw / 2 + 4, cy - bh / 2 + 4, bw - 8, 16);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SPORTBYTE', cx, cy - bh / 2 + 16);

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 34px monospace';
      ctx.fillText((bibNumber || '001').slice(0, 6), cx, cy + 20);
    };

    drawBibAt(256, 235);
    drawBibAt(60, 235);
    drawBibAt(452, 235);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
