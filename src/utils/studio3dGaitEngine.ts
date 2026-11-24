import * as THREE from 'three';
import type { GaitMode3D } from '../types/studio3d';

export type ResolvedGaitKey = Exclude<GaitMode3D, 'auto'>;

export interface GaitBiomechanics {
  resolvedGait: ResolvedGaitKey;
  forwardLean: number;
  bounceAmp: number;
  strideForward: number;
  strideBack: number;
  kneeDriveAmp: number;
  kneeKickBackAmp: number;
  armSwingAmp: number;
  elbowBaseBend: number; // ~ -1.40 to -1.75 rad (80-100 deg flexion) during running
  elbowSwingAmp: number;
  torsoTwistAmp: number;
  hipTwistAmp: number;
  anklePushAmp: number;
  toePushAmp: number;
  shoulderSwingAmp: number;
  armOutwardClearance: number;
  freqScale: number;
}

export const GAIT_PRESETS: Record<ResolvedGaitKey, GaitBiomechanics> = {
  walk: {
    resolvedGait: 'walk',
    forwardLean: 0.06, // ~3.5 deg
    bounceAmp: 0.026,
    strideForward: 0.36,
    strideBack: 0.32,
    kneeDriveAmp: 0.24,
    kneeKickBackAmp: 0.34,
    armSwingAmp: 0.36,
    elbowBaseBend: -0.58, // ~33 deg relaxed walk bend
    elbowSwingAmp: 0.16,
    torsoTwistAmp: 0.045,
    hipTwistAmp: 0.04,
    anklePushAmp: 0.2,
    toePushAmp: 0.28,
    shoulderSwingAmp: 0.05,
    armOutwardClearance: 0.08,
    freqScale: 0.72,
  },
  jog: {
    resolvedGait: 'jog',
    forwardLean: 0.145, // ~8.3 deg
    bounceAmp: 0.095,
    strideForward: 0.62,
    strideBack: 0.48,
    kneeDriveAmp: 0.56,
    kneeKickBackAmp: 1.02,
    armSwingAmp: 0.72,
    elbowBaseBend: -1.42, // ~81 deg athletic bend
    elbowSwingAmp: 0.24,
    torsoTwistAmp: 0.1,
    hipTwistAmp: 0.075,
    anklePushAmp: 0.36,
    toePushAmp: 0.42,
    shoulderSwingAmp: 0.09,
    armOutwardClearance: 0.11,
    freqScale: 0.96,
  },
  run: {
    resolvedGait: 'run',
    forwardLean: 0.19, // ~10.9 deg (target 8-12 deg run lean)
    bounceAmp: 0.13,
    strideForward: 0.84,
    strideBack: 0.68,
    kneeDriveAmp: 0.78,
    kneeKickBackAmp: 1.42,
    armSwingAmp: 0.98,
    elbowBaseBend: -1.56, // ~89.4 deg (right in 80-100 deg target)
    elbowSwingAmp: 0.3,
    torsoTwistAmp: 0.145,
    hipTwistAmp: 0.105,
    anklePushAmp: 0.48,
    toePushAmp: 0.54,
    shoulderSwingAmp: 0.125,
    armOutwardClearance: 0.125,
    freqScale: 1.12,
  },
  sprint: {
    resolvedGait: 'sprint',
    forwardLean: 0.255, // ~14.6 deg sprint drive
    bounceAmp: 0.165,
    strideForward: 1.08,
    strideBack: 0.86,
    kneeDriveAmp: 1.02,
    kneeKickBackAmp: 1.72,
    armSwingAmp: 1.24,
    elbowBaseBend: -1.68, // ~96 deg sprint pump
    elbowSwingAmp: 0.36,
    torsoTwistAmp: 0.185,
    hipTwistAmp: 0.13,
    anklePushAmp: 0.6,
    toePushAmp: 0.68,
    shoulderSwingAmp: 0.16,
    armOutwardClearance: 0.14,
    freqScale: 1.28,
  },
};

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothStep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function blendGaitProfiles(
  a: GaitBiomechanics,
  b: GaitBiomechanics,
  t: number,
): GaitBiomechanics {
  const s = smoothStep(t);
  return {
    resolvedGait: s >= 0.5 ? b.resolvedGait : a.resolvedGait,
    forwardLean: lerpNum(a.forwardLean, b.forwardLean, s),
    bounceAmp: lerpNum(a.bounceAmp, b.bounceAmp, s),
    strideForward: lerpNum(a.strideForward, b.strideForward, s),
    strideBack: lerpNum(a.strideBack, b.strideBack, s),
    kneeDriveAmp: lerpNum(a.kneeDriveAmp, b.kneeDriveAmp, s),
    kneeKickBackAmp: lerpNum(a.kneeKickBackAmp, b.kneeKickBackAmp, s),
    armSwingAmp: lerpNum(a.armSwingAmp, b.armSwingAmp, s),
    elbowBaseBend: lerpNum(a.elbowBaseBend, b.elbowBaseBend, s),
    elbowSwingAmp: lerpNum(a.elbowSwingAmp, b.elbowSwingAmp, s),
    torsoTwistAmp: lerpNum(a.torsoTwistAmp, b.torsoTwistAmp, s),
    hipTwistAmp: lerpNum(a.hipTwistAmp, b.hipTwistAmp, s),
    anklePushAmp: lerpNum(a.anklePushAmp, b.anklePushAmp, s),
    toePushAmp: lerpNum(a.toePushAmp, b.toePushAmp, s),
    shoulderSwingAmp: lerpNum(a.shoulderSwingAmp, b.shoulderSwingAmp, s),
    armOutwardClearance: lerpNum(a.armOutwardClearance, b.armOutwardClearance, s),
    freqScale: lerpNum(a.freqScale, b.freqScale, s),
  };
}

/**
 * Resolves biomechanical gait parameters for walk / jog / run / sprint, or smoothly
 * interpolates across pace (sec/km) and cadence (spm) in 'auto' mode.
 */
export function resolveGaitProfile(
  gaitMode: GaitMode3D,
  paceSecPerKm: number,
  cadenceSpm: number,
): GaitBiomechanics {
  if (gaitMode !== 'auto') {
    return GAIT_PRESETS[gaitMode];
  }

  // Compute continuous athletic speed index 0..3 (0=walk, 1=jog, 2=run, 3=sprint)
  const paceClamped = Math.min(720, Math.max(175, Number.isFinite(paceSecPerKm) ? paceSecPerKm : 390));
  const cadClamped = Math.min(215, Math.max(95, Number.isFinite(cadenceSpm) ? cadenceSpm : 165));

  // Pace index: 600->0, 430->1, 310->2, 210->3
  let paceIdx = 1;
  if (paceClamped >= 430) {
    paceIdx = 1 - Math.min(1, (paceClamped - 430) / 170);
  } else if (paceClamped >= 310) {
    paceIdx = 1 + (430 - paceClamped) / 120;
  } else {
    paceIdx = 2 + Math.min(1, (310 - paceClamped) / 100);
  }

  // Cadence index: 120->0, 154->1, 174->2, 196->3
  let cadIdx = 1;
  if (cadClamped <= 154) {
    cadIdx = Math.max(0, 1 - (154 - cadClamped) / 34);
  } else if (cadClamped <= 174) {
    cadIdx = 1 + (cadClamped - 154) / 20;
  } else {
    cadIdx = 2 + Math.min(1, (cadClamped - 174) / 22);
  }

  const idx = Math.min(3, Math.max(0, paceIdx * 0.55 + cadIdx * 0.45));
  if (idx <= 1) return blendGaitProfiles(GAIT_PRESETS.walk, GAIT_PRESETS.jog, idx);
  if (idx <= 2) return blendGaitProfiles(GAIT_PRESETS.jog, GAIT_PRESETS.run, idx - 1);
  return blendGaitProfiles(GAIT_PRESETS.run, GAIT_PRESETS.sprint, idx - 2);
}

export interface LegKinematicsPose {
  thighPitch: number;
  kneeFlex: number;
  anklePitch: number;
  toePitch: number;
}

export interface ArmKinematicsPose {
  shoulderPitch: number;
  shoulderYaw: number;
  armPitch: number;
  armRoll: number;
  armYaw: number;
  elbowBend: number;
  handPitch: number;
}

export interface GaitFramePose {
  bounceY: number;
  turnLeanRoll: number;
  pelvisYaw: number;
  pelvisPitch: number;
  spinePitch: number;
  spineYaw: number;
  chestPitch: number;
  chestYaw: number;
  chestRoll: number;
  neckPitch: number;
  headPitch: number;
  headYaw: number;
  leftLeg: LegKinematicsPose;
  rightLeg: LegKinematicsPose;
  leftArm: ArmKinematicsPose;
  rightArm: ArmKinematicsPose;
}

export function createEmptyGaitFramePose(): GaitFramePose {
  return {
    bounceY: 0,
    turnLeanRoll: 0,
    pelvisYaw: 0,
    pelvisPitch: 0,
    spinePitch: 0,
    spineYaw: 0,
    chestPitch: 0,
    chestYaw: 0,
    chestRoll: 0,
    neckPitch: 0,
    headPitch: 0,
    headYaw: 0,
    leftLeg: { thighPitch: 0, kneeFlex: 0, anklePitch: 0, toePitch: 0 },
    rightLeg: { thighPitch: 0, kneeFlex: 0, anklePitch: 0, toePitch: 0 },
    leftArm: {
      shoulderPitch: 0,
      shoulderYaw: 0,
      armPitch: 0,
      armRoll: 0,
      armYaw: 0,
      elbowBend: 0,
      handPitch: 0,
    },
    rightArm: {
      shoulderPitch: 0,
      shoulderYaw: 0,
      armPitch: 0,
      armRoll: 0,
      armYaw: 0,
      elbowBend: 0,
      handPitch: 0,
    },
  };
}

const TWO_PI = Math.PI * 2;

function wrapCycle01(rad: number): number {
  const mod = ((rad % TWO_PI) + TWO_PI) % TWO_PI;
  return mod / TWO_PI;
}

function solveSingleLegCycle(
  u: number, // 0..1 within stride cycle: 0=landing, 0.25=mid-stance, 0.48=push-off, 0.72=mid-swing
  gait: GaitBiomechanics,
  out: LegKinematicsPose,
) {
  const isWalk = gait.resolvedGait === 'walk';

  // Thigh pitch: negative = forward (+Z), positive = backward (-Z)
  // Smooth asymmetric gait harmonic shaping for crisp drive & rear extension
  const c = Math.cos(u * TWO_PI);
  const s = Math.sin(u * TWO_PI);
  const forwardEnv = Math.max(0, c * 0.72 + s * 0.69);
  const backEnv = Math.max(0, -(c * 0.72 + s * 0.69));
  out.thighPitch =
    -forwardEnv * gait.strideForward +
    backEnv * gait.strideBack;

  // Four-phase knee flexion (positive = bends calf backward)
  // 1) Landing (0..0.14): modest absorption cushion
  // 2) Stance (0.14..0.42): weight-bearing knee yield peaking mid-stance (~0.32..0.45 rad) then extending
  // 3) Push-off (0.42..0.56): extends smoothly at toe-off before rapid swing fold
  // 4) Swing recovery (0.56..1.0): high heel kick-back peaking around u=0.70, settling for next landing
  let kneeFlex = 0.14;
  if (u < 0.14) {
    const p = u / 0.14;
    kneeFlex = lerpNum(0.16, isWalk ? 0.18 : 0.34, smoothStep(p));
  } else if (u < 0.42) {
    const p = (u - 0.14) / 0.28;
    const stancePeak = isWalk ? 0.22 : 0.42;
    kneeFlex =
      p < 0.5
        ? lerpNum(isWalk ? 0.18 : 0.34, stancePeak, smoothStep(p * 2))
        : lerpNum(stancePeak, 0.14, smoothStep((p - 0.5) * 2));
  } else if (u < 0.56) {
    const p = (u - 0.42) / 0.14;
    kneeFlex = lerpNum(0.14, isWalk ? 0.32 : 0.65, smoothStep(p));
  } else if (u < 0.74) {
    const p = (u - 0.56) / 0.18;
    kneeFlex = lerpNum(isWalk ? 0.32 : 0.65, gait.kneeKickBackAmp, smoothStep(p));
  } else {
    const p = (u - 0.74) / 0.26;
    const driveFloor = Math.max(0.16, gait.kneeDriveAmp * 0.36);
    kneeFlex = lerpNum(gait.kneeKickBackAmp, driveFloor, smoothStep(p));
    if (p > 0.65) {
      kneeFlex = lerpNum(driveFloor, 0.16, smoothStep((p - 0.65) / 0.35));
    }
  }
  out.kneeFlex = kneeFlex;

  // Ankle & toe push-off:
  // Dorsiflex slightly at landing/late swing (-), flat during mid-stance, plantarflex (+anklePushAmp) on push-off
  if (u < 0.12) {
    out.anklePitch = lerpNum(-0.22, 0.0, smoothStep(u / 0.12));
    out.toePitch = 0.04;
  } else if (u < 0.36) {
    out.anklePitch = -0.05 * Math.sin(((u - 0.12) / 0.24) * Math.PI);
    out.toePitch = 0;
  } else if (u < 0.56) {
    const p = (u - 0.36) / 0.2;
    out.anklePitch = Math.sin(p * Math.PI) * gait.anklePushAmp;
    // Toe bends back upward (dorsiflexes on ground while heel lifts) during push-off
    out.toePitch = -Math.sin(p * Math.PI) * gait.toePushAmp;
  } else {
    const p = (u - 0.56) / 0.44;
    out.anklePitch = lerpNum(0.12, -0.22, smoothStep(p));
    out.toePitch = lerpNum(-0.1, 0.05, smoothStep(p));
  }
}

/**
 * Computes full-body multi-phase running/walking biomechanics without allocating memory.
 */
export function evaluateMultiPhaseGaitFrame(
  phaseRad: number,
  gait: GaitBiomechanics,
  turnLeanRoll: number,
  out: GaitFramePose,
): GaitFramePose {
  const uLeft = wrapCycle01(phaseRad);
  const uRight = wrapCycle01(phaseRad + Math.PI);

  solveSingleLegCycle(uLeft, gait, out.leftLeg);
  solveSingleLegCycle(uRight, gait, out.rightLeg);

  // Double-frequency vertical flight wave: lowest near mid-stance (stance feet touch terrain), peak mid-flight
  const flightPhase = Math.sin(phaseRad * 2 - Math.PI * 0.25);
  const normalizedFlight = Math.max(0, (flightPhase + 1) * 0.5);
  out.bounceY = Math.pow(normalizedFlight, 1.15) * gait.bounceAmp;
  out.turnLeanRoll = turnLeanRoll;

  const strideWave = Math.sin(phaseRad);
  const armWaveLeft = Math.sin(phaseRad + 0.12);
  const armWaveRight = -armWaveLeft;

  // Pelvis & Spine/Chest counter-rotation
  out.pelvisYaw = strideWave * gait.hipTwistAmp;
  out.pelvisPitch = gait.forwardLean * 0.22;

  out.spinePitch = gait.forwardLean * 0.42;
  out.spineYaw = -strideWave * gait.torsoTwistAmp * 0.38;

  out.chestPitch = gait.forwardLean * 0.52;
  out.chestYaw = -strideWave * gait.torsoTwistAmp * 0.68;
  out.chestRoll = -strideWave * gait.torsoTwistAmp * 0.18;

  // Head & neck stabilize forward gaze
  out.neckPitch = -gait.forwardLean * 0.32;
  out.headPitch = -gait.forwardLean * 0.48;
  out.headYaw = strideWave * gait.torsoTwistAmp * 0.48;

  // Left arm (opposes left leg: swings forward when armWaveLeft < 0, i.e., negative X rotation swings forward)
  out.leftArm.shoulderPitch = -armWaveLeft * gait.shoulderSwingAmp * 0.35;
  out.leftArm.shoulderYaw = -armWaveLeft * gait.shoulderSwingAmp;
  out.leftArm.armPitch = armWaveLeft * gait.armSwingAmp - 0.12;
  out.leftArm.armRoll = gait.armOutwardClearance; // clear away from left hip (-X side)
  out.leftArm.armYaw = Math.max(0, -armWaveLeft) * 0.16; // gentle inward athletic pump on upswing
  out.leftArm.elbowBend =
    gait.elbowBaseBend + (-armWaveLeft) * gait.elbowSwingAmp * 0.55 - Math.abs(armWaveLeft) * 0.08;
  out.leftArm.handPitch = -armWaveLeft * 0.09;

  // Right arm (exact opposite phase)
  out.rightArm.shoulderPitch = -armWaveRight * gait.shoulderSwingAmp * 0.35;
  out.rightArm.shoulderYaw = -armWaveRight * gait.shoulderSwingAmp;
  out.rightArm.armPitch = armWaveRight * gait.armSwingAmp - 0.12;
  out.rightArm.armRoll = -gait.armOutwardClearance; // clear away from right hip (+X side)
  out.rightArm.armYaw = -Math.max(0, -armWaveRight) * 0.16;
  out.rightArm.elbowBend =
    gait.elbowBaseBend + (-armWaveRight) * gait.elbowSwingAmp * 0.55 - Math.abs(armWaveRight) * 0.08;
  out.rightArm.handPitch = -armWaveRight * 0.09;

  return out;
}

export interface FinishPoseKinematics {
  bodyOffsetY: number;
  bodyRollZ: number;
  bodyTiltX: number;
  hipsPitch: number;
  hipsYaw: number;
  hipsRoll: number;
  spinePitch: number;
  spineYaw: number;
  chestPitch: number;
  chestYaw: number;
  upperChestPitch: number;
  neckPitch: number;
  headPitch: number;
  headRoll: number;
  leftShoulderPitch: number;
  leftShoulderRoll: number;
  rightShoulderPitch: number;
  rightShoulderRoll: number;
  leftArmPitch: number;
  leftArmYaw: number;
  leftArmRoll: number;
  leftArmTwist: number;
  leftElbowBend: number;
  leftForeArmTwist: number;
  leftHandPitch: number;
  leftHandYaw: number;
  leftHandRoll: number;
  rightArmPitch: number;
  rightArmYaw: number;
  rightArmRoll: number;
  rightArmTwist: number;
  rightElbowBend: number;
  rightForeArmTwist: number;
  rightHandPitch: number;
  rightHandYaw: number;
  rightHandRoll: number;
  leftThighPitch: number;
  leftThighYaw: number;
  leftThighRoll: number;
  leftKneeFlex: number;
  leftAnklePitch: number;
  leftToePitch: number;
  rightThighPitch: number;
  rightThighYaw: number;
  rightThighRoll: number;
  rightKneeFlex: number;
  rightAnklePitch: number;
  rightToePitch: number;
  fingerCurlBase: number;
  fingerSpread: number;
  showConfetti: boolean;
}

/**
 * Computes biomechanically natural Finish Pose joint angles for 52-bone GLB rigs.
 * Coordinate conventions in applyLimbBonePose (axes.right=+X, axes.up=+Y, axes.forward=+Z):
 * - Left clavicle extends along +X: POSITIVE leftShoulderRoll elevates shoulder (+Y),
 *   and NEGATIVE rightShoulderRoll elevates right shoulder (-X side) toward +Y.
 * - Overhead arm (armPitch ~ -2.5 rad, pointing toward +Y/+Z): NEGATIVE leftArmRoll flares
 *   left arm outward (+X) and POSITIVE rightArmRoll flares right arm outward (-X).
 * - Grounded stance feet stay flush to terrain when (hipsPitch + thighPitch + kneeFlex + anklePitch) ~ 0.
 */
export function evaluateFinishPoseKinematics(
  poseStyle: 'celebrate-jump' | 'exhausted-bow' | 'victory-raise',
  timeSec: number,
): FinishPoseKinematics {
  if (poseStyle === 'exhausted-bow') {
    const breath = Math.sin(timeSec * 2.8);
    const breathSoft = Math.sin(timeSec * 1.4);
    return {
      bodyOffsetY: -0.055 + breath * 0.008,
      bodyRollZ: 0,
      bodyTiltX: 0,
      hipsPitch: 0.24,
      hipsYaw: 0.02,
      hipsRoll: 0,
      spinePitch: 0.2 + breath * 0.022,
      spineYaw: 0,
      chestPitch: 0.18 + breath * 0.024,
      chestYaw: 0,
      upperChestPitch: 0.12 + breath * 0.016,
      neckPitch: -0.24,
      headPitch: -0.22 + breath * 0.022, // athletes catch breath looking forward-down
      headRoll: breathSoft * 0.024,
      // Protract shoulders slightly forward while relaxing clavicles down
      leftShoulderPitch: 0.14,
      leftShoulderRoll: -0.04,
      rightShoulderPitch: 0.14,
      rightShoulderRoll: 0.04,
      // Arms angle cleanly from bowed shoulders onto lower thighs just above knees
      leftArmPitch: -0.38 - breath * 0.015,
      leftArmYaw: -0.06,
      leftArmRoll: -0.08,
      leftArmTwist: -0.14,
      leftElbowBend: -0.26,
      leftForeArmTwist: 0.16,
      leftHandPitch: -0.34,
      leftHandYaw: -0.06,
      leftHandRoll: -0.12,
      rightArmPitch: -0.38 - breath * 0.015,
      rightArmYaw: 0.06,
      rightArmRoll: 0.08,
      rightArmTwist: 0.14,
      rightElbowBend: -0.26,
      rightForeArmTwist: -0.16,
      rightHandPitch: -0.34,
      rightHandYaw: 0.06,
      rightHandRoll: 0.12,
      // Staggered athletic knee-bend stance with flat grounded ankles (sum ~ 0.00)
      leftThighPitch: -0.7,
      leftThighYaw: 0.08,
      leftThighRoll: 0.07,
      leftKneeFlex: 0.76,
      leftAnklePitch: -0.3,
      leftToePitch: 0.04,
      rightThighPitch: -0.58,
      rightThighYaw: -0.08,
      rightThighRoll: -0.07,
      rightKneeFlex: 0.64,
      rightAnklePitch: -0.3,
      rightToePitch: 0.04,
      fingerCurlBase: 0.16,
      fingerSpread: 0.08,
      showConfetti: false,
    };
  }

  if (poseStyle === 'victory-raise') {
    const sway = Math.sin(timeSec * 2.0);
    const armWave = Math.sin(timeSec * 2.8) * 0.065;
    return {
      bodyOffsetY: Math.sin(timeSec * 1.7) * 0.012,
      bodyRollZ: sway * 0.025,
      bodyTiltX: 0,
      hipsPitch: -0.02,
      hipsYaw: 0.03,
      hipsRoll: sway * 0.015,
      spinePitch: -0.03,
      spineYaw: sway * 0.02,
      chestPitch: -0.03,
      chestYaw: sway * 0.03,
      upperChestPitch: -0.02,
      neckPitch: -0.05,
      headPitch: -0.08,
      headRoll: sway * 0.025,
      // Scapulohumeral elevation: clavicles lift upward (+left / -right) as arms rise overhead
      leftShoulderPitch: -0.1,
      leftShoulderRoll: 0.18,
      rightShoulderPitch: -0.1,
      rightShoulderRoll: -0.18,
      // High natural overhead Victory V clear of head/ears
      leftArmPitch: -2.56 + armWave,
      leftArmYaw: 0.16,
      leftArmRoll: -0.36,
      leftArmTwist: -0.18,
      leftElbowBend: -0.22,
      leftForeArmTwist: 0.2,
      leftHandPitch: -0.06,
      leftHandYaw: 0.05,
      leftHandRoll: -0.08,
      rightArmPitch: -2.56 - armWave,
      rightArmYaw: -0.16,
      rightArmRoll: 0.36,
      rightArmTwist: 0.18,
      rightElbowBend: -0.22,
      rightForeArmTwist: -0.2,
      rightHandPitch: -0.06,
      rightHandYaw: -0.05,
      rightHandRoll: 0.08,
      // Split planted finish stance with flat ankles
      leftThighPitch: -0.16,
      leftThighYaw: 0.06,
      leftThighRoll: 0.05,
      leftKneeFlex: 0.24,
      leftAnklePitch: -0.06,
      leftToePitch: 0,
      rightThighPitch: 0.12,
      rightThighYaw: -0.06,
      rightThighRoll: -0.05,
      rightKneeFlex: 0.1,
      rightAnklePitch: -0.2,
      rightToePitch: 0.12,
      fingerCurlBase: 0.14,
      fingerSpread: 0.08,
      showConfetti: true,
    };
  }

  // 'celebrate-jump': Realistic countermovement gather -> parabolic airborne apex -> cushioned landing
  const cycle = ((timeSec * 1.45) % 1 + 1) % 1;
  let flightNorm = 0;
  let crouchNorm = 0;
  if (cycle < 0.22) {
    const p = cycle / 0.22;
    crouchNorm = Math.sin(p * Math.PI);
  } else if (cycle < 0.78) {
    const p = (cycle - 0.22) / 0.56;
    flightNorm = 4 * p * (1 - p);
  } else {
    const p = (cycle - 0.78) / 0.22;
    crouchNorm = Math.sin(p * Math.PI) * 0.85;
  }

  const armBounce = Math.sin(timeSec * 4.2) * 0.07;
  const sway = Math.sin(timeSec * 2.1);

  return {
    bodyOffsetY: flightNorm * 0.28 - crouchNorm * 0.065,
    bodyRollZ: sway * 0.032,
    bodyTiltX: 0,
    hipsPitch: -0.02 + crouchNorm * 0.08,
    hipsYaw: -0.03,
    hipsRoll: sway * 0.018,
    spinePitch: -0.03 + crouchNorm * 0.06,
    spineYaw: sway * 0.02,
    chestPitch: -0.03 + crouchNorm * 0.04,
    chestYaw: sway * 0.03,
    upperChestPitch: -0.02,
    neckPitch: -0.04,
    headPitch: -0.06 - flightNorm * 0.03,
    headRoll: sway * 0.04,
    leftShoulderPitch: -0.12,
    leftShoulderRoll: 0.2,
    rightShoulderPitch: -0.12,
    rightShoulderRoll: -0.2,
    leftArmPitch: -2.32 - flightNorm * 0.28 + crouchNorm * 0.14 + armBounce,
    leftArmYaw: 0.18,
    leftArmRoll: -0.38,
    leftArmTwist: -0.18,
    leftElbowBend: -0.24 - crouchNorm * 0.08,
    leftForeArmTwist: 0.22,
    leftHandPitch: -0.08,
    leftHandYaw: 0.06,
    leftHandRoll: -0.08,
    rightArmPitch: -2.32 - flightNorm * 0.28 + crouchNorm * 0.14 - armBounce,
    rightArmYaw: -0.18,
    rightArmRoll: 0.38,
    rightArmTwist: 0.18,
    rightElbowBend: -0.24 - crouchNorm * 0.08,
    rightForeArmTwist: -0.22,
    rightHandPitch: -0.08,
    rightHandYaw: -0.06,
    rightHandRoll: 0.08,
    // Athletic mid-air knee tuck + knee-absorbing landing
    leftThighPitch: -0.08 - flightNorm * 0.36 - crouchNorm * 0.28,
    leftThighYaw: 0.05,
    leftThighRoll: 0.05,
    leftKneeFlex: 0.14 + flightNorm * 0.62 + crouchNorm * 0.48,
    leftAnklePitch: -0.04 + flightNorm * 0.22 - crouchNorm * 0.24,
    leftToePitch: 0.04,
    rightThighPitch: 0.06 + flightNorm * 0.12 - crouchNorm * 0.2,
    rightThighYaw: -0.05,
    rightThighRoll: -0.05,
    rightKneeFlex: 0.12 + flightNorm * 0.52 + crouchNorm * 0.42,
    rightAnklePitch: -0.06 + flightNorm * 0.26 - crouchNorm * 0.22,
    rightToePitch: 0.06,
    fingerCurlBase: 0.2,
    fingerSpread: 0.07,
    showConfetti: true,
  };
}

/**
 * Smoothly slows stride cadence across the final 4.5% before the finish line (0.835..0.88)
 * so the runner naturally decelerates instead of snapping out of full sprint.
 */
export function computePreFinishGaitScale(
  timelineProgress: number,
  includeFinishPose: boolean,
  isManualFinishMode: boolean,
): number {
  if (isManualFinishMode) return 0;
  if (!includeFinishPose) return 1;
  if (timelineProgress <= 0.835) return 1;
  if (timelineProgress >= 0.88) return 0.28;
  const p = smoothStep((timelineProgress - 0.835) / 0.045);
  return lerpNum(1, 0.28, p);
}

/**
 * Computes normalized 0..1 transition progress from running gait into Finish Pose
 * across 0.88..0.922 (or 1.0 immediately in manual 'finish-pose' camera mode).
 */
export function computeFinishTransitionBlend(
  timelineProgress: number,
  includeFinishPose: boolean,
  cameraMode: string,
): number {
  if (cameraMode === 'finish-pose') return 1;
  if (!includeFinishPose || timelineProgress < 0.88) return 0;
  if (timelineProgress >= 0.922) return 1;
  return smoothStep((timelineProgress - 0.88) / 0.042);
}

/**
 * Crossfades a full 52-bone running gait frame into a FinishPoseKinematics target
 * with a wide lateral arm swing arc so arms clear the torso/head mid-transition.
 */
export function blendGaitToFinishPoseKinematics(
  gaitPose: GaitFramePose,
  finishPose: FinishPoseKinematics,
  blendAlpha: number,
  gaitBaseFingerCurl: number,
): FinishPoseKinematics {
  const s = smoothStep(blendAlpha);
  // Lateral outward yaw arc at mid-swing when raising arms overhead (prevents torso/ear clipping)
  const isOverheadFinish = finishPose.leftArmPitch < -1.2;
  const lateralSwingArc = isOverheadFinish ? Math.sin(s * Math.PI) * 0.24 : 0;

  return {
    bodyOffsetY: lerpNum(gaitPose.bounceY, finishPose.bodyOffsetY, s),
    bodyRollZ: lerpNum(gaitPose.turnLeanRoll, finishPose.bodyRollZ, s),
    bodyTiltX: lerpNum(0, finishPose.bodyTiltX, s),
    hipsPitch: lerpNum(gaitPose.pelvisPitch, finishPose.hipsPitch, s),
    hipsYaw: lerpNum(gaitPose.pelvisYaw, finishPose.hipsYaw, s),
    hipsRoll: lerpNum(0, finishPose.hipsRoll, s),
    spinePitch: lerpNum(gaitPose.spinePitch, finishPose.spinePitch, s),
    spineYaw: lerpNum(gaitPose.spineYaw, finishPose.spineYaw, s),
    chestPitch: lerpNum(gaitPose.chestPitch, finishPose.chestPitch, s),
    chestYaw: lerpNum(gaitPose.chestYaw, finishPose.chestYaw, s),
    upperChestPitch: lerpNum(gaitPose.chestPitch * 0.48, finishPose.upperChestPitch, s),
    neckPitch: lerpNum(gaitPose.neckPitch, finishPose.neckPitch, s),
    headPitch: lerpNum(gaitPose.headPitch, finishPose.headPitch, s),
    headRoll: lerpNum(0, finishPose.headRoll, s),
    leftShoulderPitch: lerpNum(gaitPose.leftArm.shoulderPitch, finishPose.leftShoulderPitch, s),
    leftShoulderRoll: lerpNum(0, finishPose.leftShoulderRoll, s),
    rightShoulderPitch: lerpNum(gaitPose.rightArm.shoulderPitch, finishPose.rightShoulderPitch, s),
    rightShoulderRoll: lerpNum(0, finishPose.rightShoulderRoll, s),
    leftArmPitch: lerpNum(gaitPose.leftArm.armPitch, finishPose.leftArmPitch, s),
    leftArmYaw: lerpNum(gaitPose.leftArm.armYaw, finishPose.leftArmYaw, s) + lateralSwingArc,
    leftArmRoll: lerpNum(gaitPose.leftArm.armRoll, finishPose.leftArmRoll, s),
    leftArmTwist: lerpNum(gaitPose.leftArm.armYaw * 0.35, finishPose.leftArmTwist, s),
    leftElbowBend: lerpNum(gaitPose.leftArm.elbowBend, finishPose.leftElbowBend, s),
    leftForeArmTwist: lerpNum(gaitPose.leftArm.armYaw * 0.25, finishPose.leftForeArmTwist, s),
    leftHandPitch: lerpNum(gaitPose.leftArm.handPitch, finishPose.leftHandPitch, s),
    leftHandYaw: lerpNum(0, finishPose.leftHandYaw, s),
    leftHandRoll: lerpNum(0, finishPose.leftHandRoll, s),
    rightArmPitch: lerpNum(gaitPose.rightArm.armPitch, finishPose.rightArmPitch, s),
    rightArmYaw: lerpNum(gaitPose.rightArm.armYaw, finishPose.rightArmYaw, s) - lateralSwingArc,
    rightArmRoll: lerpNum(gaitPose.rightArm.armRoll, finishPose.rightArmRoll, s),
    rightArmTwist: lerpNum(gaitPose.rightArm.armYaw * 0.35, finishPose.rightArmTwist, s),
    rightElbowBend: lerpNum(gaitPose.rightArm.elbowBend, finishPose.rightElbowBend, s),
    rightForeArmTwist: lerpNum(gaitPose.rightArm.armYaw * 0.25, finishPose.rightForeArmTwist, s),
    rightHandPitch: lerpNum(gaitPose.rightArm.handPitch, finishPose.rightHandPitch, s),
    rightHandYaw: lerpNum(0, finishPose.rightHandYaw, s),
    rightHandRoll: lerpNum(0, finishPose.rightHandRoll, s),
    leftThighPitch: lerpNum(gaitPose.leftLeg.thighPitch, finishPose.leftThighPitch, s),
    leftThighYaw: lerpNum(0, finishPose.leftThighYaw, s),
    leftThighRoll: lerpNum(0, finishPose.leftThighRoll, s),
    leftKneeFlex: lerpNum(gaitPose.leftLeg.kneeFlex, finishPose.leftKneeFlex, s),
    leftAnklePitch: lerpNum(gaitPose.leftLeg.anklePitch, finishPose.leftAnklePitch, s),
    leftToePitch: lerpNum(gaitPose.leftLeg.toePitch, finishPose.leftToePitch, s),
    rightThighPitch: lerpNum(gaitPose.rightLeg.thighPitch, finishPose.rightThighPitch, s),
    rightThighYaw: lerpNum(0, finishPose.rightThighYaw, s),
    rightThighRoll: lerpNum(0, finishPose.rightThighRoll, s),
    rightKneeFlex: lerpNum(gaitPose.rightLeg.kneeFlex, finishPose.rightKneeFlex, s),
    rightAnklePitch: lerpNum(gaitPose.rightLeg.anklePitch, finishPose.rightAnklePitch, s),
    rightToePitch: lerpNum(gaitPose.rightLeg.toePitch, finishPose.rightToePitch, s),
    fingerCurlBase: lerpNum(gaitBaseFingerCurl, finishPose.fingerCurlBase, s),
    fingerSpread: lerpNum(0.03, finishPose.fingerSpread, s),
    showConfetti: finishPose.showConfetti && s > 0.35,
  };
}

// ---------- FULL 52-BONE HUMANOID RIG MAPPER & BIND-POSE VALIDATOR ----------

export type HumanoidSlotKey =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'leftArm'
  | 'leftArmTwist'
  | 'leftForeArm'
  | 'leftForeArmTwist'
  | 'leftHand'
  | 'rightShoulder'
  | 'rightArm'
  | 'rightArmTwist'
  | 'rightForeArm'
  | 'rightForeArmTwist'
  | 'rightHand'
  | 'leftThigh'
  | 'leftShin'
  | 'leftFoot'
  | 'leftToe'
  | 'rightThigh'
  | 'rightShin'
  | 'rightFoot'
  | 'rightToe';

export interface BoneRigSlot {
  bone: THREE.Bone;
  restQuat: THREE.Quaternion;
  restWorldQuat: THREE.Quaternion;
  invRestWorldQuat: THREE.Quaternion;
  dropCharQuat: THREE.Quaternion;
  childDirChar: THREE.Vector3;
}

export interface FingerRigSlot {
  bone: THREE.Bone;
  side: 'left' | 'right';
  isThumb: boolean;
  phalanxOrder: 1 | 2 | 3;
  restQuat: THREE.Quaternion;
  restWorldQuat: THREE.Quaternion;
  invRestWorldQuat: THREE.Quaternion;
  curlAxisChar: THREE.Vector3;
}

export interface CalibratedCharAxes {
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  facingFlippedZ: boolean;
}

export type HumanoidRigMap = Partial<Record<HumanoidSlotKey, BoneRigSlot>>;

export function normalizeBoneName(raw: string): string {
  return raw
    .replace(/mixamorig[:_]?/gi, '')
    .replace(/^(bip01|cc_base|j_bip|def|org|mch)[_: ]+/gi, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export function detectBoneSide(normName: string): 'left' | 'right' | null {
  if (
    /(^|[._\-\s])(left)/.test(normName) ||
    /(^|[._\-\s])(l|lt)($|[._\-\s\d])/.test(normName)
  ) {
    return 'left';
  }
  if (
    /(^|[._\-\s])(right)/.test(normName) ||
    /(^|[._\-\s])(r|rt)($|[._\-\s\d])/.test(normName)
  ) {
    return 'right';
  }
  return null;
}

function findPrimaryChildBone(parentBone: THREE.Bone | undefined): THREE.Bone | undefined {
  if (!parentBone) return undefined;
  return parentBone.children.find((c): c is THREE.Bone => {
    if (!(c as THREE.Bone).isBone) return false;
    const norm = normalizeBoneName(c.name);
    return !/(end|nub|twist|roll|helper)/.test(norm);
  });
}

export function computeArmDropCharQuat(
  upperArmDirWorld: THREE.Vector3,
  charUp = new THREE.Vector3(0, 1, 0),
  charForward = new THREE.Vector3(0, 0, 1),
): THREE.Quaternion {
  const dir = upperArmDirWorld.clone();
  if (dir.lengthSq() < 1e-6) {
    return new THREE.Quaternion();
  }
  dir.normalize();
  // Already hanging near vertical downward
  if (dir.dot(charUp) < -0.92) {
    return new THREE.Quaternion();
  }
  const lat = dir.x;
  const sideSign = Math.abs(lat) >= 0.02 ? Math.sign(lat) : 1;
  const targetHangDir = new THREE.Vector3(
    sideSign * 0.14,
    -0.985 * charUp.y,
    0.05 * charForward.z,
  ).normalize();
  return new THREE.Quaternion().setFromUnitVectors(dir, targetHangDir);
}

export function computeElbowBendLocalCharQuat(
  elbowPitchRad: number,
  parentArmDropCharQuat: THREE.Quaternion,
  out?: THREE.Quaternion,
  charRightAxis?: THREE.Vector3,
): THREE.Quaternion {
  const res = out ?? new THREE.Quaternion();
  const axis = charRightAxis ?? new THREE.Vector3(1, 0, 0);
  const qBend = new THREE.Quaternion().setFromAxisAngle(axis, elbowPitchRad);
  const invDrop = parentArmDropCharQuat.clone().invert();
  res.copy(invDrop).multiply(qBend).multiply(parentArmDropCharQuat);
  return res;
}

function createRigSlot(bone: THREE.Bone, isUpperArm: boolean, charUp: THREE.Vector3, charFwd: THREE.Vector3): BoneRigSlot {
  const worldQuat = new THREE.Quaternion();
  bone.getWorldQuaternion(worldQuat);
  const invWorldQuat = worldQuat.clone().invert();

  const childBone = findPrimaryChildBone(bone) ?? bone.children.find((c): c is THREE.Bone => (c as THREE.Bone).isBone);
  const childDirChar = new THREE.Vector3(0, -1, 0);
  let dropCharQuat = new THREE.Quaternion();

  if (childBone) {
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    bone.getWorldPosition(p0);
    childBone.getWorldPosition(p1);
    const diff = p1.sub(p0);
    if (diff.lengthSq() > 1e-6) {
      childDirChar.copy(diff.normalize());
      if (isUpperArm) {
        dropCharQuat = computeArmDropCharQuat(childDirChar, charUp, charFwd);
      }
    }
  }

  return {
    bone,
    restQuat: bone.quaternion.clone(),
    restWorldQuat: worldQuat,
    invRestWorldQuat: invWorldQuat,
    dropCharQuat,
    childDirChar,
  };
}

function createFingerRigSlot(
  bone: THREE.Bone,
  side: 'left' | 'right',
  isThumb: boolean,
  phalanxOrder: 1 | 2 | 3,
): FingerRigSlot {
  const worldQuat = new THREE.Quaternion();
  bone.getWorldQuaternion(worldQuat);
  const invWorldQuat = worldQuat.clone().invert();

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  bone.getWorldPosition(p0);

  const childBone = bone.children.find((c): c is THREE.Bone => (c as THREE.Bone).isBone);
  const fingerDir = new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0);
  if (childBone) {
    childBone.getWorldPosition(p1);
    const diff = p1.sub(p0);
    if (diff.lengthSq() > 1e-6) {
      fingerDir.copy(diff.normalize());
    }
  } else if (bone.parent && (bone.parent as THREE.Bone).isBone) {
    bone.parent.getWorldPosition(p1);
    const diff = p0.clone().sub(p1);
    if (diff.lengthSq() > 1e-6) {
      fingerDir.copy(diff.normalize());
    }
  }

  const sideSign = side === 'left' ? 1 : -1;
  const inwardTarget = isThumb
    ? new THREE.Vector3(-sideSign * 0.65, -0.7, 0.35).normalize()
    : fingerDir.y < -0.82
      ? new THREE.Vector3(-sideSign, 0, 0.25).normalize()
      : new THREE.Vector3(0, -1, 0.16).normalize();

  const curlAxisChar = new THREE.Vector3().crossVectors(fingerDir, inwardTarget);
  if (curlAxisChar.lengthSq() < 1e-5) {
    curlAxisChar.set(0, 0, side === 'left' ? -1 : 1);
  } else {
    curlAxisChar.normalize();
  }

  return {
    bone,
    side,
    isThumb,
    phalanxOrder,
    restQuat: bone.quaternion.clone(),
    restWorldQuat: worldQuat,
    invRestWorldQuat: invWorldQuat,
    curlAxisChar,
  };
}

/**
 * Extracts all 50+ humanoid bones (Avaturn 52-bone, Mixamo, ReadyPlayerMe, Rigify, VRM)
 * including 3-segment spine, arm twist bones, full 30 finger/thumb phalanges, and toe bones,
 * calibrating character-space anatomical & curl axes directly from bind-pose joint positions.
 */
export function extractFullHumanoidRig(sceneObj: THREE.Object3D): {
  rig: HumanoidRigMap;
  fingers: FingerRigSlot[];
  count: number;
  totalSkeletonBones: number;
  axes: CalibratedCharAxes;
} {
  sceneObj.updateMatrixWorld(true);
  const rawBones: Partial<Record<HumanoidSlotKey, THREE.Bone>> = {};
  const rawFingers: Array<{
    bone: THREE.Bone;
    side: 'left' | 'right';
    isThumb: boolean;
    phalanxOrder: 1 | 2 | 3;
  }> = [];
  const seenFingerBones = new Set<THREE.Bone>();
  let totalSkeletonBones = 0;

  sceneObj.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (!bone.isBone) return;
    totalSkeletonBones += 1;
    const norm = normalizeBoneName(bone.name);
    // Skip only end/nub stubs and non-locomotion facial/hair accessories
    if (/(end|nub|top|leaf|eye|jaw|eyelid|teeth|tongue|hair|breast)/.test(norm)) {
      return;
    }

    const side = detectBoneSide(norm);

    if (!side) {
      if (/(hips|pelvis|hip_root)/.test(norm) && !rawBones.hips) {
        rawBones.hips = bone;
      } else if (/(upper_?chest|spine_?0?2|spine2|spine_?0?3)/.test(norm) && !rawBones.upperChest) {
        rawBones.upperChest = bone;
      } else if (/(spine_?0?1|spine1|chest)/.test(norm) && !rawBones.chest) {
        rawBones.chest = bone;
      } else if (/(^spine$|spine_?0?0|torso)/.test(norm) && !rawBones.spine) {
        rawBones.spine = bone;
      } else if (/(^|[._\-\s])neck/.test(norm) && !rawBones.neck) {
        rawBones.neck = bone;
      } else if (/(^|[._\-\s])head($|[._\-\s])/.test(norm) && !rawBones.head) {
        rawBones.head = bone;
      }
      return;
    }

    const isLeft = side === 'left';

    // Twist / Roll forearm & upper-arm helpers
    if (/(twist|roll)/.test(norm)) {
      if (/(fore_?arm|lower_?arm|low_?arm)/.test(norm)) {
        if (isLeft && !rawBones.leftForeArmTwist) rawBones.leftForeArmTwist = bone;
        if (!isLeft && !rawBones.rightForeArmTwist) rawBones.rightForeArmTwist = bone;
      } else if (/(arm|bicep|upper_?arm)/.test(norm)) {
        if (isLeft && !rawBones.leftArmTwist) rawBones.leftArmTwist = bone;
        if (!isLeft && !rawBones.rightArmTwist) rawBones.rightArmTwist = bone;
      }
      return;
    }

    // All 30 finger & thumb bones (Thumb/Index/Middle/Ring/Pinky 1..3)
    if (/(thumb|index|middle|ring|pinky|little|finger|digit)/.test(norm)) {
      const isThumb = /thumb/.test(norm);
      const phalanxOrder: 1 | 2 | 3 = /3|distal/.test(norm)
        ? 3
        : /2|inter|mid/.test(norm)
          ? 2
          : 1;
      seenFingerBones.add(bone);
      rawFingers.push({ bone, side, isThumb, phalanxOrder });
      return;
    }

    if (/(shoulder|clavicle|collar)/.test(norm)) {
      if (isLeft && !rawBones.leftShoulder) rawBones.leftShoulder = bone;
      if (!isLeft && !rawBones.rightShoulder) rawBones.rightShoulder = bone;
    } else if (/(fore_?arm|lower_?arm|low_?arm|elbow|ulna)/.test(norm)) {
      if (isLeft && !rawBones.leftForeArm) rawBones.leftForeArm = bone;
      if (!isLeft && !rawBones.rightForeArm) rawBones.rightForeArm = bone;
    } else if (/(^|[._\-\s])(hand|wrist)($|[._\-\s])/.test(norm)) {
      if (isLeft && !rawBones.leftHand) rawBones.leftHand = bone;
      if (!isLeft && !rawBones.rightHand) rawBones.rightHand = bone;
    } else if (/(upper_?arm|up_?arm|(?<!fore)arm|bicep)/.test(norm)) {
      if (isLeft && !rawBones.leftArm) rawBones.leftArm = bone;
      if (!isLeft && !rawBones.rightArm) rawBones.rightArm = bone;
    } else if (/(up_?leg|upper_?leg|thigh|femur)/.test(norm)) {
      if (isLeft && !rawBones.leftThigh) rawBones.leftThigh = bone;
      if (!isLeft && !rawBones.rightThigh) rawBones.rightThigh = bone;
    } else if (/(shin|calf|lower_?leg|low_?leg|knee|tibia|(?<!up_?)leg)/.test(norm) && !/thigh/.test(norm)) {
      if (isLeft && !rawBones.leftShin) rawBones.leftShin = bone;
      if (!isLeft && !rawBones.rightShin) rawBones.rightShin = bone;
    } else if (/(toe|ball)/.test(norm)) {
      if (isLeft && !rawBones.leftToe) rawBones.leftToe = bone;
      if (!isLeft && !rawBones.rightToe) rawBones.rightToe = bone;
    } else if (/(foot|ankle)/.test(norm)) {
      if (isLeft && !rawBones.leftFoot) rawBones.leftFoot = bone;
      if (!isLeft && !rawBones.rightFoot) rawBones.rightFoot = bone;
    }
  });

  // Hierarchy fallbacks so every articulated chain resolves completely
  if (!rawBones.spine && rawBones.hips) {
    const c = findPrimaryChildBone(rawBones.hips);
    if (c && c !== rawBones.leftThigh && c !== rawBones.rightThigh) rawBones.spine = c;
  }
  if (!rawBones.chest && rawBones.spine) {
    const c = findPrimaryChildBone(rawBones.spine);
    if (c && c !== rawBones.neck && c !== rawBones.head && c !== rawBones.upperChest) rawBones.chest = c;
  }
  if (!rawBones.upperChest && rawBones.chest) {
    const c = findPrimaryChildBone(rawBones.chest);
    if (c && c !== rawBones.neck && c !== rawBones.head && c !== rawBones.leftShoulder && c !== rawBones.rightShoulder) {
      rawBones.upperChest = c;
    }
  }
  // If a skeleton has only 2 spine bones mapped into spine+upperChest, promote upperChest -> chest
  if (!rawBones.chest && rawBones.upperChest) {
    rawBones.chest = rawBones.upperChest;
    rawBones.upperChest = undefined;
  }

  if (!rawBones.leftArm && rawBones.leftShoulder && rawBones.leftForeArm) {
    rawBones.leftArm = rawBones.leftShoulder;
    rawBones.leftShoulder = undefined;
  }
  if (!rawBones.rightArm && rawBones.rightShoulder && rawBones.rightForeArm) {
    rawBones.rightArm = rawBones.rightShoulder;
    rawBones.rightShoulder = undefined;
  }
  if (rawBones.leftArm && !rawBones.leftForeArm) {
    rawBones.leftForeArm = findPrimaryChildBone(rawBones.leftArm);
  }
  if (rawBones.rightArm && !rawBones.rightForeArm) {
    rawBones.rightForeArm = findPrimaryChildBone(rawBones.rightArm);
  }
  if (rawBones.leftForeArm && !rawBones.leftHand) {
    rawBones.leftHand = findPrimaryChildBone(rawBones.leftForeArm);
  }
  if (rawBones.rightForeArm && !rawBones.rightHand) {
    rawBones.rightHand = findPrimaryChildBone(rawBones.rightForeArm);
  }
  if (rawBones.leftThigh && !rawBones.leftShin) {
    rawBones.leftShin = findPrimaryChildBone(rawBones.leftThigh);
  }
  if (rawBones.rightThigh && !rawBones.rightShin) {
    rawBones.rightShin = findPrimaryChildBone(rawBones.rightThigh);
  }
  if (rawBones.leftShin && !rawBones.leftFoot) {
    rawBones.leftFoot = findPrimaryChildBone(rawBones.leftShin);
  }
  if (rawBones.rightShin && !rawBones.rightFoot) {
    rawBones.rightFoot = findPrimaryChildBone(rawBones.rightShin);
  }
  if (rawBones.leftFoot && !rawBones.leftToe) {
    rawBones.leftToe = findPrimaryChildBone(rawBones.leftFoot);
  }
  if (rawBones.rightFoot && !rawBones.rightToe) {
    rawBones.rightToe = findPrimaryChildBone(rawBones.rightFoot);
  }

  // Hierarchy fallback for unnamed finger bones descending from leftHand / rightHand
  const collectChildFingers = (handBone: THREE.Bone | undefined, side: 'left' | 'right') => {
    if (!handBone) return;
    const walk = (node: THREE.Object3D, depth: 1 | 2 | 3) => {
      for (const child of node.children) {
        const b = child as THREE.Bone;
        if (!b.isBone) continue;
        const norm = normalizeBoneName(b.name);
        if (/(end|nub|top|leaf)/.test(norm)) continue;
        if (!seenFingerBones.has(b)) {
          seenFingerBones.add(b);
          rawFingers.push({
            bone: b,
            side,
            isThumb: /thumb/.test(norm),
            phalanxOrder: depth,
          });
        }
        if (depth < 3) walk(b, (depth + 1) as 1 | 2 | 3);
      }
    };
    walk(handBone, 1);
  };
  collectChildFingers(rawBones.leftHand, 'left');
  collectChildFingers(rawBones.rightHand, 'right');

  // Calibrate character coordinate axes from actual bind pose
  const charUp = new THREE.Vector3(0, 1, 0);
  const charForward = new THREE.Vector3(0, 0, 1);
  const charRight = new THREE.Vector3(1, 0, 0);
  let facingFlippedZ = false;

  const pL = new THREE.Vector3();
  const pR = new THREE.Vector3();
  const leftAnchor = rawBones.leftArm ?? rawBones.leftThigh;
  const rightAnchor = rawBones.rightArm ?? rawBones.rightThigh;
  if (leftAnchor && rightAnchor) {
    leftAnchor.getWorldPosition(pL);
    rightAnchor.getWorldPosition(pR);
    const rightToLeft = pL.clone().sub(pR);
    rightToLeft.y = 0;
    if (rightToLeft.lengthSq() > 1e-6) {
      rightToLeft.normalize();
      charRight.copy(rightToLeft);
      charForward.crossVectors(charRight, charUp).normalize();
      facingFlippedZ = charForward.z < 0;
    }
  } else if (rawBones.leftFoot && rawBones.leftToe) {
    rawBones.leftFoot.getWorldPosition(pL);
    rawBones.leftToe.getWorldPosition(pR);
    const footFwd = pR.sub(pL);
    footFwd.y = 0;
    if (footFwd.lengthSq() > 1e-6) {
      charForward.copy(footFwd.normalize());
      charRight.crossVectors(charUp, charForward).normalize();
      facingFlippedZ = charForward.z < 0;
    }
  }

  const rig: HumanoidRigMap = {};
  (Object.keys(rawBones) as HumanoidSlotKey[]).forEach((slotKey) => {
    const bone = rawBones[slotKey];
    if (!bone) return;
    rig[slotKey] = createRigSlot(
      bone,
      slotKey === 'leftArm' || slotKey === 'rightArm',
      charUp,
      charForward,
    );
  });

  const fingers = rawFingers.map((f) =>
    createFingerRigSlot(f.bone, f.side, f.isThumb, f.phalanxOrder),
  );

  return {
    rig,
    fingers,
    count: Object.keys(rig).length + fingers.length,
    totalSkeletonBones,
    axes: {
      right: charRight,
      up: charUp,
      forward: charForward,
      facingFlippedZ,
    },
  };
}
