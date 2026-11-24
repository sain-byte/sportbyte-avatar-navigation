import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RunnerConfig } from '../../types/studio3d';
import {
  blendGaitToFinishPoseKinematics,
  buildConfettiSeeds,
  type BoneRigSlot,
  type CalibratedCharAxes,
  computeElbowBendLocalCharQuat,
  computeFinishTransitionBlend,
  computePreFinishGaitScale,
  CONFETTI_COLORS,
  CONFETTI_COUNT,
  createEmptyGaitFramePose,
  evaluateFinishPoseKinematics,
  evaluateMultiPhaseGaitFrame,
  extractFullHumanoidRig,
  type FingerRigSlot,
  type HumanoidRigMap,
  isClipLocomotion,
  resolveGaitProfile,
  updateConfettiMesh,
} from '../../utils/studio3dRunnerHelpers';

export interface CustomGlbStatus {
  loading: boolean;
  error: string | null;
  animationCount: number;
  hasLocomotionClip: boolean;
  rigMode: 'clip' | 'bones' | 'static';
  detectedBones: number;
  totalSkeletonBones?: number;
}

interface CustomGlbRunner3DProps {
  config: RunnerConfig;
  position: THREE.Vector3;
  yawRad: number;
  scale: number;
  cadenceSpm: number;
  paceSecPerKm: number;
  isPlaying: boolean;
  isFinishPose: boolean;
  includeFinishPose?: boolean;
  isManualFinishCamera?: boolean;
  timelineProgress: number;
  onStatusChange?: (status: CustomGlbStatus) => void;
}

const DEFAULT_AXES: CalibratedCharAxes = {
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 1, 0),
  forward: new THREE.Vector3(0, 0, 1),
  facingFlippedZ: false,
};

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    materials.forEach((mat) => {
      if (!mat) return;
      const stdMat = mat as THREE.MeshStandardMaterial;
      stdMat.map?.dispose();
      stdMat.normalMap?.dispose();
      stdMat.roughnessMap?.dispose();
      stdMat.metalnessMap?.dispose();
      stdMat.emissiveMap?.dispose();
      stdMat.aoMap?.dispose();
      mat.dispose();
    });
  });
}

function isUsableAnimationClip(clip: THREE.AnimationClip): boolean {
  const cleanName = clip.name.trim().toLowerCase();
  if (clip.duration < 0.25) return false;
  if (/^(t-?pose|a-?pose|bind|rest|static|default_pose)$/.test(cleanName)) return false;
  return clip.tracks.length > 0;
}

function pickClip(clips: THREE.AnimationClip[], pattern: RegExp): THREE.AnimationClip | null {
  return clips.find((c) => pattern.test(c.name)) ?? null;
}

export const CustomGlbRunner3D: React.FC<CustomGlbRunner3DProps> = ({
  config,
  position,
  yawRad,
  scale,
  cadenceSpm,
  paceSecPerKm,
  isPlaying,
  isFinishPose,
  includeFinishPose = true,
  isManualFinishCamera = false,
  timelineProgress,
  onStatusChange,
}) => {
  const rootRef = useRef<THREE.Group>(null);
  const modelMountRef = useRef<THREE.Group>(null);
  const flipMountRef = useRef<THREE.Group>(null);
  const confettiRef = useRef<THREE.InstancedMesh>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const runActionRef = useRef<THREE.AnimationAction | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const loadedSceneRef = useRef<THREE.Object3D | null>(null);
  const rigMapRef = useRef<HumanoidRigMap>({});
  const fingerRigRef = useRef<FingerRigSlot[]>([]);
  const axesRef = useRef<CalibratedCharAxes>(DEFAULT_AXES);
  const rigMetaRef = useRef<{
    animationCount: number;
    hasLocomotionClip: boolean;
    hasLimbRig: boolean;
    detectedBones: number;
    totalSkeletonBones: number;
  }>({
    animationCount: 0,
    hasLocomotionClip: false,
    hasLimbRig: false,
    detectedBones: 0,
    totalSkeletonBones: 0,
  });
  const rigModeRef = useRef<'clip' | 'bones' | 'static'>('static');
  const runClockRef = useRef(0);
  const prevYawRef = useRef(yawRad);
  const finishBlendRef = useRef(isFinishPose ? 1 : 0);
  const prevScrubRef = useRef(timelineProgress);
  const prevPoseStyleRef = useRef(config.finishPoseStyle ?? 'celebrate-jump');
  const poseStyleBlendTimerRef = useRef(0);
  const [loadedModel, setLoadedModel] = useState<THREE.Object3D | null>(null);

  const dummyObj = useMemo(() => new THREE.Object3D(), []);
  const confettiSeeds = useMemo(() => buildConfettiSeeds(), []);
  const gaitPoseRef = useRef(createEmptyGaitFramePose());

  // Pre-allocated quaternion scratch objects (zero GC inside useFrame)
  const qPitch = useMemo(() => new THREE.Quaternion(), []);
  const qYaw = useMemo(() => new THREE.Quaternion(), []);
  const qRoll = useMemo(() => new THREE.Quaternion(), []);
  const qCharOffset = useMemo(() => new THREE.Quaternion(), []);
  const qLocalDelta = useMemo(() => new THREE.Quaternion(), []);
  const qTargetBoneQuat = useMemo(() => new THREE.Quaternion(), []);
  const qElbowChar = useMemo(() => new THREE.Quaternion(), []);
  const qFingerChar = useMemo(() => new THREE.Quaternion(), []);
  const qZeroDrop = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => {
    if (!confettiRef.current) return;
    const color = new THREE.Color();
    for (let i = 0; i < CONFETTI_COUNT; i += 1) {
      color.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      confettiRef.current.setColorAt(i, color);
    }
    if (confettiRef.current.instanceColor) {
      confettiRef.current.instanceColor.needsUpdate = true;
    }
  }, []);

  useEffect(() => {
    const modelUrl = config.customModelUrl;
    if (!modelUrl) {
      setLoadedModel(null);
      return;
    }

    let cancelled = false;
    onStatusChange?.({
      loading: true,
      error: null,
      animationCount: 0,
      hasLocomotionClip: false,
      rigMode: 'static',
      detectedBones: 0,
      totalSkeletonBones: 0,
    });
    const loader = new GLTFLoader();

    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) {
          disposeObject3D(gltf.scene);
          return;
        }

        const sceneObj = gltf.scene;
        sceneObj.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        // Normalize bounding box to realistic athlete height (~1.78m) grounded flush at y = 0
        const box = new THREE.Box3().setFromObject(sceneObj);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const normScale = size.y > 0.001 ? 1.78 / size.y : 1;
        sceneObj.scale.setScalar(normScale);
        sceneObj.position.set(
          -center.x * normScale,
          -box.min.y * normScale,
          -center.z * normScale,
        );

        const rawClips = gltf.animations ?? [];
        const usableClips = rawClips.filter(isUsableAnimationClip);
        const locomotionClip = usableClips.find(isClipLocomotion) ?? null;

        const mixer = new THREE.AnimationMixer(sceneObj);
        const runClip =
          locomotionClip ??
          pickClip(usableClips, /run|jog|sprint|stride|walk/i) ??
          usableClips[0] ??
          null;
        const idleClip =
          pickClip(usableClips, /idle|stand|breath|victory|celebrate|cheer/i) ?? null;

        const runAction = runClip ? mixer.clipAction(runClip) : null;
        const idleAction = idleClip && idleClip !== runClip ? mixer.clipAction(idleClip) : null;

        const { rig, fingers, count, totalSkeletonBones, axes } = extractFullHumanoidRig(sceneObj);
        const hasLimbRig = Boolean(
          rig.leftThigh || rig.rightThigh || rig.leftArm || rig.rightArm || rig.spine,
        );
        const hasLocomotionClip = Boolean(locomotionClip);

        const prefMode = config.customModelAnimMode ?? 'auto';
        let detectedRigMode: 'clip' | 'bones' | 'static' = 'static';
        if (prefMode === 'bones' && hasLimbRig) {
          detectedRigMode = 'bones';
        } else if (prefMode === 'clip' && usableClips.length > 0) {
          detectedRigMode = 'clip';
        } else if (hasLimbRig) {
          // Engage full 52-bone humanoid rig by default for both running and Finish poses
          detectedRigMode = 'bones';
        } else if (hasLocomotionClip || usableClips.length > 0) {
          detectedRigMode = 'clip';
        }

        if (detectedRigMode === 'clip') {
          if (runAction) runAction.play();
          else if (idleAction) idleAction.play();
        }

        mixerRef.current = mixer;
        runActionRef.current = runAction;
        idleActionRef.current = idleAction;
        rigMapRef.current = rig;
        fingerRigRef.current = fingers;
        axesRef.current = axes;
        rigMetaRef.current = {
          animationCount: usableClips.length,
          hasLocomotionClip,
          hasLimbRig,
          detectedBones: count,
          totalSkeletonBones,
        };
        rigModeRef.current = detectedRigMode;
        loadedSceneRef.current = sceneObj;

        setLoadedModel(sceneObj);
        onStatusChange?.({
          loading: false,
          error: null,
          animationCount: usableClips.length,
          hasLocomotionClip,
          rigMode: detectedRigMode,
          detectedBones: count,
          totalSkeletonBones,
        });
      },
      undefined,
      () => {
        if (cancelled) return;
        setLoadedModel(null);
        onStatusChange?.({
          loading: false,
          error:
            'Gagal memuat file .GLB / .GLTF. Pastikan format valid dan tidak memakai kompresi Draco eksternal.',
          animationCount: 0,
          hasLocomotionClip: false,
          rigMode: 'static',
          detectedBones: 0,
          totalSkeletonBones: 0,
        });
      },
    );

    return () => {
      cancelled = true;
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      runActionRef.current = null;
      idleActionRef.current = null;
      rigMapRef.current = {};
      fingerRigRef.current = [];
      rigModeRef.current = 'static';
      if (loadedSceneRef.current) {
        disposeObject3D(loadedSceneRef.current);
        loadedSceneRef.current = null;
      }
    };
  }, [config.customModelUrl, onStatusChange]);

  // Switch cleanly between embedded animation clip & procedural skeleton bones without reloading file
  useEffect(() => {
    const meta = rigMetaRef.current;
    if (!loadedModel) return;

    const prefMode = config.customModelAnimMode ?? 'auto';
    let nextMode: 'clip' | 'bones' | 'static' = 'static';
    if (prefMode === 'bones' && meta.hasLimbRig) {
      nextMode = 'bones';
    } else if (prefMode === 'clip' && meta.animationCount > 0) {
      nextMode = 'clip';
    } else if (meta.hasLimbRig) {
      nextMode = 'bones';
    } else if (meta.hasLocomotionClip || meta.animationCount > 0) {
      nextMode = 'clip';
    }

    rigModeRef.current = nextMode;
    const mixer = mixerRef.current;
    if (mixer) {
      mixer.stopAllAction();
      if (nextMode === 'clip') {
        if (runActionRef.current) runActionRef.current.play();
        else if (idleActionRef.current) idleActionRef.current.play();
      }
    }
    Object.values(rigMapRef.current).forEach((slot) => {
      if (slot) slot.bone.quaternion.copy(slot.restQuat);
    });
    fingerRigRef.current.forEach((f) => {
      f.bone.quaternion.copy(f.restQuat);
    });

    onStatusChange?.({
      loading: false,
      error: null,
      animationCount: meta.animationCount,
      hasLocomotionClip: meta.hasLocomotionClip,
      rigMode: nextMode,
      detectedBones: meta.detectedBones,
      totalSkeletonBones: meta.totalSkeletonBones,
    });
  }, [config.customModelAnimMode, loadedModel, onStatusChange]);

  const applyCharRotationToBone = (
    slot: BoneRigSlot | undefined,
    charDelta: THREE.Quaternion,
    slerpAlpha = 1,
  ) => {
    if (!slot) return;
    qLocalDelta
      .copy(slot.invRestWorldQuat)
      .multiply(charDelta)
      .multiply(slot.restWorldQuat);
    qTargetBoneQuat.copy(slot.restQuat).multiply(qLocalDelta);
    if (slerpAlpha < 0.999) {
      slot.bone.quaternion.slerp(qTargetBoneQuat, slerpAlpha);
    } else {
      slot.bone.quaternion.copy(qTargetBoneQuat);
    }
  };

  const applyLimbBonePose = (
    slot: BoneRigSlot | undefined,
    pitchRad: number,
    yawRadLocal = 0,
    rollRadLocal = 0,
    slerpAlpha = 1,
  ) => {
    if (!slot) return;
    const axes = axesRef.current;
    qCharOffset.identity();
    if (Math.abs(yawRadLocal) > 1e-4) {
      qYaw.setFromAxisAngle(axes.up, yawRadLocal);
      qCharOffset.multiply(qYaw);
    }
    if (Math.abs(rollRadLocal) > 1e-4) {
      qRoll.setFromAxisAngle(axes.forward, rollRadLocal);
      qCharOffset.multiply(qRoll);
    }
    if (Math.abs(pitchRad) > 1e-4) {
      qPitch.setFromAxisAngle(axes.right, pitchRad);
      qCharOffset.multiply(qPitch);
    }
    // Apply T-pose/A-pose arm drop FIRST in character space, then anatomical rotation
    qCharOffset.multiply(slot.dropCharQuat);
    applyCharRotationToBone(slot, qCharOffset, slerpAlpha);
  };

  const applyElbowBonePose = (
    foreArmSlot: BoneRigSlot | undefined,
    upperArmSlot: BoneRigSlot | undefined,
    elbowPitchRad: number,
    slerpAlpha = 1,
  ) => {
    if (!foreArmSlot) return;
    const dropQuat = upperArmSlot?.dropCharQuat ?? qZeroDrop;
    computeElbowBendLocalCharQuat(elbowPitchRad, dropQuat, qElbowChar, axesRef.current.right);
    applyCharRotationToBone(foreArmSlot, qElbowChar, slerpAlpha);
  };

  const applyAllFingerCurl = (baseCurlRad: number, spreadScale = 1, slerpAlpha = 1) => {
    const fingers = fingerRigRef.current;
    if (fingers.length === 0) return;
    for (let i = 0; i < fingers.length; i += 1) {
      const f = fingers[i];
      const orderMult = f.phalanxOrder === 1 ? 0.85 : f.phalanxOrder === 2 ? 1.0 : 0.72;
      const thumbMult = f.isThumb ? 0.58 : 1.0;
      const fingerIdx = Math.floor(i / 3) % 5;
      const cascadeBias = fingerIdx * 0.035 * spreadScale;
      qFingerChar.setFromAxisAngle(
        f.curlAxisChar,
        (baseCurlRad + cascadeBias) * orderMult * thumbMult,
      );
      qLocalDelta
        .copy(f.invRestWorldQuat)
        .multiply(qFingerChar)
        .multiply(f.restWorldQuat);
      qTargetBoneQuat.copy(f.restQuat).multiply(qLocalDelta);
      if (slerpAlpha < 0.999) {
        f.bone.quaternion.slerp(qTargetBoneQuat, slerpAlpha);
      } else {
        f.bone.quaternion.copy(qTargetBoneQuat);
      }
    }
  };

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);
    if (!rootRef.current || !modelMountRef.current) return;

    rootRef.current.position.copy(position);
    rootRef.current.scale.setScalar(scale);
    rootRef.current.rotation.y = yawRad;

    let yawDiff = yawRad - prevYawRef.current;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    prevYawRef.current = yawRad;
    const turnLeanRoll = THREE.MathUtils.clamp(yawDiff * 3.0, -0.18, 0.18);

    if (flipMountRef.current) {
      flipMountRef.current.rotation.y = config.customModelFlip180 ? Math.PI : 0;
    }

    const gait = resolveGaitProfile(config.gaitMode ?? 'auto', paceSecPerKm, cadenceSpm);
    const poseStyle = config.finishPoseStyle ?? 'celebrate-jump';

    // Track poseStyle switches so changing finish pose triggers a silky quaternion slerp
    if (poseStyle !== prevPoseStyleRef.current) {
      prevPoseStyleRef.current = poseStyle;
      poseStyleBlendTimerRef.current = 0.36;
    } else if (poseStyleBlendTimerRef.current > 0) {
      poseStyleBlendTimerRef.current = Math.max(0, poseStyleBlendTimerRef.current - dt);
    }

    const targetFinishBlend = Math.max(
      isFinishPose && isManualFinishCamera ? 1 : 0,
      computeFinishTransitionBlend(
        timelineProgress,
        includeFinishPose,
        isManualFinishCamera ? 'finish-pose' : 'auto',
      ),
    );
    const largePausedScrub =
      !isPlaying && Math.abs(timelineProgress - prevScrubRef.current) > 0.08;
    prevScrubRef.current = timelineProgress;

    if (largePausedScrub) {
      finishBlendRef.current = targetFinishBlend;
    } else {
      finishBlendRef.current = THREE.MathUtils.damp(
        finishBlendRef.current,
        targetFinishBlend,
        isPlaying ? 6.5 : 14,
        dt,
      );
      if (Math.abs(finishBlendRef.current - targetFinishBlend) < 0.002) {
        finishBlendRef.current = targetFinishBlend;
      }
    }
    const finishBlend = finishBlendRef.current;

    const preFinishGaitScale = computePreFinishGaitScale(
      timelineProgress,
      includeFinishPose,
      isManualFinishCamera,
    );
    const activeGaitScale = preFinishGaitScale * (1 - finishBlend * 0.85);

    if (isPlaying) {
      const strideFreqHz = Math.max(0.35, (cadenceSpm / 60) * gait.freqScale * activeGaitScale);
      runClockRef.current += dt * strideFreqHz * Math.PI;
    } else {
      runClockRef.current = timelineProgress * 95 * gait.freqScale;
    }

    const t = state.clock.elapsedTime;
    const rigMode = rigModeRef.current;

    // 1. Embedded GLTF AnimationMixer Clips (smooth crossfade when user selects Klip Bawaan)
    const mixer = mixerRef.current;
    const runAction = runActionRef.current;
    const idleAction = idleActionRef.current;
    const engageBonesFinish =
      finishBlend > 0.005 && rigMetaRef.current.hasLimbRig && (rigMode === 'bones' || !idleAction);

    if (mixer && rigMode === 'clip') {
      if (finishBlend > 0.005) {
        if (idleAction && runAction) {
          runAction.enabled = true;
          runAction.setEffectiveWeight(1 - finishBlend);
          idleAction.enabled = true;
          idleAction.setEffectiveWeight(finishBlend);
          idleAction.play();
          mixer.update(dt);
        } else if (engageBonesFinish && runAction) {
          runAction.setEffectiveWeight(Math.max(0, 1 - finishBlend));
          if (finishBlend < 0.99) {
            mixer.update(dt * Math.max(0.15, activeGaitScale));
          }
        } else if (runAction) {
          runAction.setEffectiveWeight(1);
          mixer.update(dt * Math.max(0.2, 1 - finishBlend * 0.75));
        }
      } else {
        if (runAction) {
          runAction.enabled = true;
          runAction.setEffectiveWeight(1);
          if (idleAction) idleAction.setEffectiveWeight(0);
        }
        if (isPlaying) {
          const speedScale = Math.max(0.35, (cadenceSpm / 165) * gait.freqScale * preFinishGaitScale);
          mixer.update(dt * speedScale);
        } else {
          mixer.setTime((timelineProgress * 24 * gait.freqScale) % 10);
        }
      }
    }

    // 2. Full-Skeleton 52-Bone Rig Animation (Running -> Deceleration -> Smooth Crossfade -> Finish Pose)
    const gaitBaseFingerCurl =
      gait.resolvedGait === 'walk'
        ? 0.22
        : gait.resolvedGait === 'jog'
          ? 0.46
          : gait.resolvedGait === 'sprint'
            ? 0.72
            : 0.6;

    const gaitPose = evaluateMultiPhaseGaitFrame(
      runClockRef.current,
      gait,
      turnLeanRoll * (1 - finishBlend),
      gaitPoseRef.current,
    );

    const rawFinishPose =
      finishBlend > 0.002 ? evaluateFinishPoseKinematics(poseStyle, t) : null;
    const blendedFinishPose =
      rawFinishPose && finishBlend > 0.002
        ? finishBlend >= 0.998
          ? rawFinishPose
          : blendGaitToFinishPoseKinematics(gaitPose, rawFinishPose, finishBlend, gaitBaseFingerCurl)
        : null;

    if (rigMode === 'bones' || engageBonesFinish) {
      const rig = rigMapRef.current;
      const hasUpperChest = Boolean(rig.upperChest);
      const slerpAlpha =
        poseStyleBlendTimerRef.current > 0 || (rigMode === 'clip' && engageBonesFinish && finishBlend < 0.98)
          ? 1 - Math.exp(-10 * dt)
          : 1;

      if (blendedFinishPose) {
        applyLimbBonePose(
          rig.hips,
          blendedFinishPose.hipsPitch,
          blendedFinishPose.hipsYaw,
          blendedFinishPose.hipsRoll,
          slerpAlpha,
        );
        applyLimbBonePose(
          rig.spine,
          blendedFinishPose.spinePitch,
          blendedFinishPose.spineYaw,
          0,
          slerpAlpha,
        );
        applyLimbBonePose(
          rig.chest,
          blendedFinishPose.chestPitch * (hasUpperChest ? 0.65 : 1),
          blendedFinishPose.chestYaw * (hasUpperChest ? 0.65 : 1),
          0,
          slerpAlpha,
        );
        applyLimbBonePose(rig.upperChest, blendedFinishPose.upperChestPitch, 0, 0, slerpAlpha);
        applyLimbBonePose(rig.neck, blendedFinishPose.neckPitch, 0, 0, slerpAlpha);
        applyLimbBonePose(
          rig.head,
          blendedFinishPose.headPitch,
          0,
          blendedFinishPose.headRoll,
          slerpAlpha,
        );

        applyLimbBonePose(
          rig.leftShoulder,
          blendedFinishPose.leftShoulderPitch,
          0,
          blendedFinishPose.leftShoulderRoll,
          slerpAlpha,
        );
        applyLimbBonePose(
          rig.rightShoulder,
          blendedFinishPose.rightShoulderPitch,
          0,
          blendedFinishPose.rightShoulderRoll,
          slerpAlpha,
        );

        applyLimbBonePose(
          rig.leftArm,
          blendedFinishPose.leftArmPitch,
          blendedFinishPose.leftArmYaw,
          blendedFinishPose.leftArmRoll,
          slerpAlpha,
        );
        applyLimbBonePose(rig.leftArmTwist, 0, blendedFinishPose.leftArmTwist, 0, slerpAlpha);
        applyElbowBonePose(rig.leftForeArm, rig.leftArm, blendedFinishPose.leftElbowBend, slerpAlpha);
        applyLimbBonePose(
          rig.leftForeArmTwist,
          0,
          blendedFinishPose.leftForeArmTwist,
          0,
          slerpAlpha,
        );
        applyLimbBonePose(
          rig.leftHand,
          blendedFinishPose.leftHandPitch,
          blendedFinishPose.leftHandYaw,
          blendedFinishPose.leftHandRoll,
          slerpAlpha,
        );

        applyLimbBonePose(
          rig.rightArm,
          blendedFinishPose.rightArmPitch,
          blendedFinishPose.rightArmYaw,
          blendedFinishPose.rightArmRoll,
          slerpAlpha,
        );
        applyLimbBonePose(rig.rightArmTwist, 0, blendedFinishPose.rightArmTwist, 0, slerpAlpha);
        applyElbowBonePose(
          rig.rightForeArm,
          rig.rightArm,
          blendedFinishPose.rightElbowBend,
          slerpAlpha,
        );
        applyLimbBonePose(
          rig.rightForeArmTwist,
          0,
          blendedFinishPose.rightForeArmTwist,
          0,
          slerpAlpha,
        );
        applyLimbBonePose(
          rig.rightHand,
          blendedFinishPose.rightHandPitch,
          blendedFinishPose.rightHandYaw,
          blendedFinishPose.rightHandRoll,
          slerpAlpha,
        );

        applyLimbBonePose(
          rig.leftThigh,
          blendedFinishPose.leftThighPitch,
          blendedFinishPose.leftThighYaw,
          blendedFinishPose.leftThighRoll,
          slerpAlpha,
        );
        applyLimbBonePose(rig.leftShin, blendedFinishPose.leftKneeFlex, 0, 0, slerpAlpha);
        applyLimbBonePose(rig.leftFoot, blendedFinishPose.leftAnklePitch, 0, 0, slerpAlpha);
        applyLimbBonePose(rig.leftToe, blendedFinishPose.leftToePitch, 0, 0, slerpAlpha);

        applyLimbBonePose(
          rig.rightThigh,
          blendedFinishPose.rightThighPitch,
          blendedFinishPose.rightThighYaw,
          blendedFinishPose.rightThighRoll,
          slerpAlpha,
        );
        applyLimbBonePose(rig.rightShin, blendedFinishPose.rightKneeFlex, 0, 0, slerpAlpha);
        applyLimbBonePose(rig.rightFoot, blendedFinishPose.rightAnklePitch, 0, 0, slerpAlpha);
        applyLimbBonePose(rig.rightToe, blendedFinishPose.rightToePitch, 0, 0, slerpAlpha);

        applyAllFingerCurl(
          blendedFinishPose.fingerCurlBase,
          1 + blendedFinishPose.fingerSpread * 4,
          slerpAlpha,
        );
      } else {
        // Center chain: Hips -> Spine -> Chest -> UpperChest -> Neck -> Head
        applyLimbBonePose(rig.hips, gaitPose.pelvisPitch, gaitPose.pelvisYaw);
        applyLimbBonePose(rig.spine, gaitPose.spinePitch, gaitPose.spineYaw);
        applyLimbBonePose(
          rig.chest,
          gaitPose.chestPitch * (hasUpperChest ? 0.55 : 1),
          gaitPose.chestYaw * (hasUpperChest ? 0.55 : 1),
          gaitPose.chestRoll * (hasUpperChest ? 0.55 : 1),
        );
        applyLimbBonePose(
          rig.upperChest,
          gaitPose.chestPitch * 0.48,
          gaitPose.chestYaw * 0.48,
          gaitPose.chestRoll * 0.48,
        );
        applyLimbBonePose(rig.neck, gaitPose.neckPitch, 0);
        applyLimbBonePose(rig.head, gaitPose.headPitch, gaitPose.headYaw);

        // Left & Right Leg chains: Thigh -> Shin -> Foot -> Toe
        applyLimbBonePose(rig.leftThigh, gaitPose.leftLeg.thighPitch);
        applyLimbBonePose(rig.leftShin, gaitPose.leftLeg.kneeFlex);
        applyLimbBonePose(rig.leftFoot, gaitPose.leftLeg.anklePitch);
        applyLimbBonePose(rig.leftToe, gaitPose.leftLeg.toePitch);

        applyLimbBonePose(rig.rightThigh, gaitPose.rightLeg.thighPitch);
        applyLimbBonePose(rig.rightShin, gaitPose.rightLeg.kneeFlex);
        applyLimbBonePose(rig.rightFoot, gaitPose.rightLeg.anklePitch);
        applyLimbBonePose(rig.rightToe, gaitPose.rightLeg.toePitch);

        // Left & Right Arm chains: Shoulder/Clavicle -> UpperArm -> Twist -> ForeArm -> Twist -> Hand -> Fingers
        applyLimbBonePose(
          rig.leftShoulder,
          gaitPose.leftArm.shoulderPitch,
          gaitPose.leftArm.shoulderYaw,
        );
        applyLimbBonePose(
          rig.leftArm,
          gaitPose.leftArm.armPitch,
          gaitPose.leftArm.armYaw,
          gaitPose.leftArm.armRoll,
        );
        applyLimbBonePose(rig.leftArmTwist, 0, gaitPose.leftArm.armYaw * 0.35);
        applyElbowBonePose(rig.leftForeArm, rig.leftArm, gaitPose.leftArm.elbowBend);
        applyLimbBonePose(rig.leftForeArmTwist, 0, gaitPose.leftArm.armYaw * 0.25);
        applyLimbBonePose(rig.leftHand, gaitPose.leftArm.handPitch);

        applyLimbBonePose(
          rig.rightShoulder,
          gaitPose.rightArm.shoulderPitch,
          gaitPose.rightArm.shoulderYaw,
        );
        applyLimbBonePose(
          rig.rightArm,
          gaitPose.rightArm.armPitch,
          gaitPose.rightArm.armYaw,
          gaitPose.rightArm.armRoll,
        );
        applyLimbBonePose(rig.rightArmTwist, 0, gaitPose.rightArm.armYaw * 0.35);
        applyElbowBonePose(rig.rightForeArm, rig.rightArm, gaitPose.rightArm.elbowBend);
        applyLimbBonePose(rig.rightForeArmTwist, 0, gaitPose.rightArm.armYaw * 0.25);
        applyLimbBonePose(rig.rightHand, gaitPose.rightArm.handPitch);

        applyAllFingerCurl(gaitBaseFingerCurl);
      }
    }

    // 3. Separate Root Motion (vertical flight bounce + corner banking, keeps stance feet grounded)
    if (blendedFinishPose) {
      const bonesDriven = rigMode === 'bones' || engageBonesFinish;
      if (bonesDriven) {
        modelMountRef.current.position.y = blendedFinishPose.bodyOffsetY;
        modelMountRef.current.rotation.x = blendedFinishPose.bodyTiltX;
        modelMountRef.current.rotation.z = blendedFinishPose.bodyRollZ;
      } else if (poseStyle === 'exhausted-bow') {
        const breath = Math.sin(t * 2.8);
        modelMountRef.current.position.y = (-0.04 + breath * 0.015) * finishBlend;
        modelMountRef.current.rotation.x = (0.48 + breath * 0.04) * finishBlend;
        modelMountRef.current.rotation.z = 0;
      } else if (poseStyle === 'victory-raise') {
        modelMountRef.current.position.y = Math.sin(t * 1.8) * 0.02 * finishBlend;
        modelMountRef.current.rotation.x = -0.06 * finishBlend;
        modelMountRef.current.rotation.z = Math.sin(t * 2.1) * 0.03 * finishBlend;
      } else {
        const rawFp = rawFinishPose!;
        modelMountRef.current.position.y = rawFp.bodyOffsetY * finishBlend;
        modelMountRef.current.rotation.x = -0.04 * finishBlend;
        modelMountRef.current.rotation.z = rawFp.bodyRollZ * finishBlend;
      }
      updateConfettiMesh(
        confettiRef.current,
        blendedFinishPose.showConfetti,
        t,
        confettiSeeds,
        dummyObj,
        2.2,
      );
    } else {
      updateConfettiMesh(confettiRef.current, false, t, confettiSeeds, dummyObj);
      if (rigMode === 'bones') {
        modelMountRef.current.position.y = gaitPose.bounceY;
        modelMountRef.current.rotation.x = 0;
        modelMountRef.current.rotation.z = gaitPose.turnLeanRoll;
      } else if (rigMode === 'static') {
        const phase = runClockRef.current;
        const flightWave = Math.pow(Math.max(0, (Math.sin(phase * 2 - Math.PI * 0.25) + 1) * 0.5), 1.15);
        modelMountRef.current.position.y = flightWave * gait.bounceAmp;
        modelMountRef.current.rotation.x = gait.forwardLean * 0.75;
        modelMountRef.current.rotation.z = Math.sin(phase) * (gait.torsoTwistAmp * 0.45);
      } else {
        modelMountRef.current.position.y = 0;
        modelMountRef.current.rotation.x = 0;
        modelMountRef.current.rotation.z = 0;
      }
    }
  });

  return (
    <group ref={rootRef} name="CustomGlbRunnerRoot">
      {/* Grounded contact shadow disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <circleGeometry args={[0.46, 24]} />
        <meshBasicMaterial color="#020617" transparent opacity={0.28} depthWrite={false} />
      </mesh>

      <instancedMesh
        ref={confettiRef}
        args={[undefined, undefined, CONFETTI_COUNT]}
        visible={false}
      >
        <boxGeometry args={[0.075, 0.075, 0.015]} />
        <meshStandardMaterial roughness={0.4} metalness={0.1} />
      </instancedMesh>

      <group ref={modelMountRef}>
        <group ref={flipMountRef}>
          {loadedModel && <primitive object={loadedModel} />}
        </group>
      </group>
    </group>
  );
};
