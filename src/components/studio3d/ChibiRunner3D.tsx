import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RunnerConfig } from '../../types/studio3d';
import {
  blendGaitToFinishPoseKinematics,
  buildConfettiSeeds,
  computeFinishTransitionBlend,
  computePreFinishGaitScale,
  CONFETTI_COLORS,
  CONFETTI_COUNT,
  createEmptyGaitFramePose,
  createJerseyBibTexture,
  evaluateFinishPoseKinematics,
  evaluateMultiPhaseGaitFrame,
  resolveGaitProfile,
  updateConfettiMesh,
} from '../../utils/studio3dRunnerHelpers';

interface ChibiRunner3DProps {
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
  isNightMood: boolean;
}

export const ChibiRunner3D: React.FC<ChibiRunner3DProps> = ({
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
  isNightMood,
}) => {
  const rootRef = useRef<THREE.Group>(null);
  const bodyBounceRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const leftForearmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const rightForearmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const ponytailRef = useRef<THREE.Group>(null);
  const confettiRef = useRef<THREE.InstancedMesh>(null);
  const prevYawRef = useRef(yawRad);
  const runClockRef = useRef(0);
  const finishBlendRef = useRef(isFinishPose ? 1 : 0);
  const prevScrubRef = useRef(timelineProgress);
  const gaitPoseRef = useRef(createEmptyGaitFramePose());

  // Reusable scratch objects for confetti & transforms (zero GC inside useFrame)
  const dummyObj = useMemo(() => new THREE.Object3D(), []);
  const confettiSeeds = useMemo(() => buildConfettiSeeds(), []);

  const jerseyTexture = useMemo(
    () => createJerseyBibTexture(config.jerseyColor, config.bibNumber),
    [config.jerseyColor, config.bibNumber],
  );

  useEffect(() => {
    return () => {
      jerseyTexture.dispose();
    };
  }, [jerseyTexture]);

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

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);
    if (!rootRef.current || !bodyBounceRef.current || !torsoRef.current || !headRef.current) return;

    rootRef.current.position.copy(position);
    rootRef.current.scale.setScalar(scale);

    // Compute smooth turn lean into corners
    let yawDiff = yawRad - prevYawRef.current;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    prevYawRef.current = yawRad;
    const turnLean = THREE.MathUtils.clamp(yawDiff * 3.5, -0.22, 0.22);

    rootRef.current.rotation.y = yawRad;

    const gait = resolveGaitProfile(config.gaitMode ?? 'auto', paceSecPerKm, cadenceSpm);
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

    const preFinishScale = computePreFinishGaitScale(
      timelineProgress,
      includeFinishPose,
      isManualFinishCamera,
    );
    const activeGaitScale = preFinishScale * (1 - finishBlend * 0.85);

    if (isPlaying) {
      const strideFreqHz = Math.max(0.35, (cadenceSpm / 60) * gait.freqScale * activeGaitScale);
      runClockRef.current += dt * strideFreqHz * Math.PI;
    } else {
      // Deterministic stride pose aligned to scrub position
      runClockRef.current = timelineProgress * 95 * gait.freqScale;
    }

    const t = state.clock.elapsedTime;
    const poseStyle = config.finishPoseStyle ?? 'celebrate-jump';
    const pose = evaluateMultiPhaseGaitFrame(
      runClockRef.current,
      gait,
      turnLean * (1 - finishBlend),
      gaitPoseRef.current,
    );

    if (finishBlend > 0.002) {
      const rawFinish = evaluateFinishPoseKinematics(poseStyle, t);
      const blended = blendGaitToFinishPoseKinematics(pose, rawFinish, finishBlend, 0.4);
      const isExhausted = poseStyle === 'exhausted-bow';

      bodyBounceRef.current.position.y = THREE.MathUtils.lerp(
        pose.bounceY * 1.1,
        blended.bodyOffsetY,
        finishBlend,
      );
      bodyBounceRef.current.rotation.z = blended.bodyRollZ;

      torsoRef.current.rotation.x = blended.spinePitch + blended.chestPitch + blended.upperChestPitch;
      torsoRef.current.rotation.y = blended.spineYaw + blended.chestYaw;
      torsoRef.current.rotation.z = pose.chestRoll * 0.8 * (1 - finishBlend);

      headRef.current.rotation.x = blended.neckPitch + blended.headPitch;
      headRef.current.rotation.y = pose.headYaw * (1 - finishBlend);
      headRef.current.rotation.z = blended.headRoll;

      if (leftLegRef.current && rightLegRef.current) {
        const gaitLX = pose.leftLeg.thighPitch + pose.leftLeg.kneeFlex * 0.12;
        const gaitRX = pose.rightLeg.thighPitch + pose.rightLeg.kneeFlex * 0.12;
        leftLegRef.current.rotation.x = THREE.MathUtils.lerp(
          gaitLX,
          blended.leftThighPitch + blended.leftKneeFlex * 0.28,
          finishBlend,
        );
        rightLegRef.current.rotation.x = THREE.MathUtils.lerp(
          gaitRX,
          blended.rightThighPitch + blended.rightKneeFlex * 0.28,
          finishBlend,
        );
      }
      if (leftArmRef.current && rightArmRef.current) {
        const isOverhead = rawFinish.leftArmPitch < -1.2;
        const targetRzL = isOverhead ? rawFinish.leftArmRoll : -rawFinish.leftArmRoll;
        const targetRzR = isOverhead ? rawFinish.rightArmRoll : -rawFinish.rightArmRoll;
        leftArmRef.current.rotation.x = blended.leftArmPitch;
        leftArmRef.current.rotation.y = -blended.leftArmYaw;
        leftArmRef.current.rotation.z = THREE.MathUtils.lerp(
          -pose.leftArm.armRoll,
          targetRzL,
          finishBlend,
        );

        rightArmRef.current.rotation.x = blended.rightArmPitch;
        rightArmRef.current.rotation.y = -blended.rightArmYaw;
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(
          -pose.rightArm.armRoll,
          targetRzR,
          finishBlend,
        );
      }
      if (leftForearmRef.current && rightForearmRef.current) {
        leftForearmRef.current.rotation.x = THREE.MathUtils.lerp(
          pose.leftArm.elbowBend * 0.72,
          blended.leftElbowBend * 0.85,
          finishBlend,
        );
        rightForearmRef.current.rotation.x = THREE.MathUtils.lerp(
          pose.rightArm.elbowBend * 0.72,
          blended.rightElbowBend * 0.85,
          finishBlend,
        );
      }
      if (ponytailRef.current) {
        const targetHairX = isExhausted
          ? 0.8 + Math.sin(t * 2.8) * 0.06
          : 0.25 + Math.max(0, blended.bodyOffsetY) * 1.1;
        ponytailRef.current.rotation.x = THREE.MathUtils.lerp(
          0.34 + Math.min(0.4, pose.bounceY * 2.2) + gait.forwardLean * 0.5,
          targetHairX,
          finishBlend,
        );
      }
      updateConfettiMesh(confettiRef.current, blended.showConfetti, t, confettiSeeds, dummyObj, 2.2);
    } else {
      if (confettiRef.current) confettiRef.current.visible = false;

      bodyBounceRef.current.position.y = pose.bounceY * 1.1;
      bodyBounceRef.current.rotation.z = pose.turnLeanRoll;

      torsoRef.current.rotation.x = pose.spinePitch + pose.chestPitch;
      torsoRef.current.rotation.y = pose.spineYaw + pose.chestYaw;
      torsoRef.current.rotation.z = pose.chestRoll * 0.8;

      headRef.current.rotation.x = pose.neckPitch + pose.headPitch;
      headRef.current.rotation.y = pose.headYaw;
      headRef.current.rotation.z = Math.sin(runClockRef.current * 0.5) * 0.025;

      if (leftLegRef.current && rightLegRef.current) {
        leftLegRef.current.rotation.x = pose.leftLeg.thighPitch + pose.leftLeg.kneeFlex * 0.12;
        rightLegRef.current.rotation.x = pose.rightLeg.thighPitch + pose.rightLeg.kneeFlex * 0.12;
      }
      if (leftArmRef.current && rightArmRef.current) {
        leftArmRef.current.rotation.x = pose.leftArm.armPitch;
        leftArmRef.current.rotation.z = -pose.leftArm.armRoll;
        leftArmRef.current.rotation.y = pose.leftArm.armYaw;

        rightArmRef.current.rotation.x = pose.rightArm.armPitch;
        rightArmRef.current.rotation.z = -pose.rightArm.armRoll;
        rightArmRef.current.rotation.y = pose.rightArm.armYaw;
      }
      if (leftForearmRef.current && rightForearmRef.current) {
        leftForearmRef.current.rotation.x = pose.leftArm.elbowBend * 0.72;
        rightForearmRef.current.rotation.x = pose.rightArm.elbowBend * 0.72;
      }
      if (ponytailRef.current) {
        ponytailRef.current.rotation.x =
          0.34 + Math.min(0.4, pose.bounceY * 2.2) + gait.forwardLean * 0.5;
      }
    }
  });

  const isFemale = config.gender === 'female';
  const skinColor = '#F3C6A5';
  const hairColor = '#1E293B';

  return (
    <group ref={rootRef} name="ChibiRunnerRoot">
      {/* Grounded contact shadow disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow>
        <circleGeometry args={[0.58, 24]} />
        <meshBasicMaterial color="#020617" transparent opacity={0.28} depthWrite={false} />
      </mesh>

      {/* Celebratory Finish Confetti InstancedMesh */}
      <instancedMesh
        ref={confettiRef}
        args={[undefined, undefined, CONFETTI_COUNT]}
        visible={false}
      >
        <boxGeometry args={[0.075, 0.075, 0.015]} />
        <meshStandardMaterial roughness={0.4} metalness={0.1} />
      </instancedMesh>

      <group ref={bodyBounceRef}>
        {/* Torso & Hip */}
        <group ref={torsoRef} position={[0, 0.92, 0]}>
          {/* Jersey chest with dynamic BIB number */}
          <mesh position={[0, 0.05, 0]} castShadow>
            <cylinderGeometry
              args={[isFemale ? 0.23 : 0.27, isFemale ? 0.21 : 0.23, 0.56, 20]}
            />
            <meshStandardMaterial map={jerseyTexture} roughness={0.85} metalness={0.04} />
          </mesh>

          {/* Pelvis / Shorts Waist */}
          <mesh position={[0, -0.22, 0]} castShadow>
            <cylinderGeometry args={[0.235, 0.22, 0.2, 18]} />
            <meshStandardMaterial color={config.shortsColor} roughness={0.82} metalness={0.05} />
          </mesh>

          {/* Neck */}
          <mesh position={[0, 0.37, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.1, 0.12, 14]} />
            <meshStandardMaterial color={skinColor} roughness={0.65} metalness={0.02} />
          </mesh>

          {/* ACCESSORY: Trail Vest (Hydration pack + soft flasks) */}
          {config.accessory === 'trail-vest' && (
            <group name="TrailVest">
              <mesh position={[0, 0.08, -0.02]} castShadow>
                <boxGeometry args={[0.48, 0.46, 0.48]} />
                <meshStandardMaterial color="#1E293B" roughness={0.78} metalness={0.12} />
              </mesh>
              {/* Rear hydration pack */}
              <mesh position={[0, 0.1, -0.27]} castShadow>
                <boxGeometry args={[0.3, 0.38, 0.14]} />
                <meshStandardMaterial color="#0F172A" roughness={0.7} metalness={0.15} />
              </mesh>
              {/* Safety reflective stripe */}
              <mesh position={[0, 0.06, -0.345]}>
                <boxGeometry args={[0.22, 0.05, 0.01]} />
                <meshStandardMaterial
                  color="#F97316"
                  emissive="#F97316"
                  emissiveIntensity={0.45}
                  roughness={0.35}
                />
              </mesh>
              {/* Dual front soft hydration flasks */}
              {[-0.14, 0.14].map((fx, idx) => (
                <group key={idx} position={[fx, 0.07, 0.24]}>
                  <mesh castShadow>
                    <capsuleGeometry args={[0.045, 0.14, 6, 12]} />
                    <meshStandardMaterial color="#38BDF8" roughness={0.35} metalness={0.15} />
                  </mesh>
                  <mesh position={[0, 0.12, 0]}>
                    <cylinderGeometry args={[0.018, 0.022, 0.05, 10]} />
                    <meshStandardMaterial color="#E2E8F0" roughness={0.4} />
                  </mesh>
                </group>
              ))}
            </group>
          )}

          {/* HEAD GROUP */}
          <group ref={headRef} position={[0, 0.72, 0]}>
            {/* Stylized Chibi Head */}
            <mesh scale={[1.05, 0.97, 1.0]} castShadow>
              <sphereGeometry args={[0.38, 24, 20]} />
              <meshStandardMaterial color={skinColor} roughness={0.66} metalness={0.02} />
            </mesh>

            {/* Ears */}
            <mesh position={[-0.38, -0.02, 0]}>
              <sphereGeometry args={[0.065, 10, 10]} />
              <meshStandardMaterial color={skinColor} roughness={0.66} />
            </mesh>
            <mesh position={[0.38, -0.02, 0]}>
              <sphereGeometry args={[0.065, 10, 10]} />
              <meshStandardMaterial color={skinColor} roughness={0.66} />
            </mesh>

            {/* Eyes + Highlights */}
            {[-0.13, 0.13].map((ex, idx) => (
              <group key={idx} position={[ex, 0.02, 0.345]}>
                <mesh scale={[0.9, 1.25, 0.6]}>
                  <sphereGeometry args={[0.048, 12, 12]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.22} metalness={0.1} />
                </mesh>
                <mesh position={[0.015, 0.02, 0.026]}>
                  <sphereGeometry args={[0.014, 8, 8]} />
                  <meshBasicMaterial color="#FFFFFF" />
                </mesh>
                {isFemale && (
                  <mesh position={[idx === 0 ? -0.04 : 0.04, 0.045, 0]} rotation={[0, 0, idx === 0 ? 0.5 : -0.5]}>
                    <boxGeometry args={[0.035, 0.012, 0.012]} />
                    <meshBasicMaterial color="#0F172A" />
                  </mesh>
                )}
              </group>
            ))}

            {/* Rosy cheeks for Perempuan Centil + cheerful smile */}
            {isFemale &&
              [-0.22, 0.22].map((cx, idx) => (
                <mesh key={idx} position={[cx, -0.07, 0.32]} scale={[1.2, 0.7, 0.4]}>
                  <sphereGeometry args={[0.042, 10, 10]} />
                  <meshStandardMaterial color="#FB7185" roughness={0.75} transparent opacity={0.65} />
                </mesh>
              ))}
            <mesh position={[0, -0.11, 0.355]} rotation={[Math.PI, 0, 0]}>
              <torusGeometry args={[0.055, 0.013, 8, 16, Math.PI]} />
              <meshBasicMaterial color="#7C2D12" />
            </mesh>

            {/* GLASSES TOGGLE */}
            {config.glasses && (
              <group position={[0, 0.03, 0.36]}>
                {/* Dual sporty wrap lenses */}
                {[-0.135, 0.135].map((lx, idx) => (
                  <mesh key={idx} position={[lx, 0, 0.015]}>
                    <boxGeometry args={[0.16, 0.095, 0.028]} />
                    <meshStandardMaterial
                      color="#0284C7"
                      roughness={0.12}
                      metalness={0.75}
                      emissive="#0369A1"
                      emissiveIntensity={0.25}
                    />
                  </mesh>
                ))}
                {/* Top frame bridge & temples */}
                <mesh position={[0, 0.032, 0.015]}>
                  <boxGeometry args={[0.38, 0.025, 0.032]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.35} metalness={0.4} />
                </mesh>
                <mesh position={[-0.27, 0.015, -0.14]} rotation={[0, 0.22, 0]}>
                  <boxGeometry args={[0.02, 0.024, 0.32]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.35} />
                </mesh>
                <mesh position={[0.27, 0.015, -0.14]} rotation={[0, -0.22, 0]}>
                  <boxGeometry args={[0.02, 0.024, 0.32]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.35} />
                </mesh>
              </group>
            )}

            {/* HAIR STYLES: undercut | spiky | side-fade */}
            <group name="HairGroup">
              {/* Main hair cap */}
              <mesh position={[0, 0.1, -0.03]} scale={[1.06, 0.88, 1.04]} castShadow>
                <sphereGeometry args={[0.375, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
                <meshStandardMaterial color={hairColor} roughness={0.82} metalness={0.05} />
              </mesh>

              {config.hairStyle === 'undercut' && (
                <group>
                  <mesh position={[0, 0.34, 0.08]} rotation={[-0.25, 0, 0]} castShadow>
                    <boxGeometry args={[0.34, 0.16, 0.42]} />
                    <meshStandardMaterial color={hairColor} roughness={0.8} />
                  </mesh>
                  <mesh position={[0.05, 0.29, 0.28]} rotation={[0.35, 0.2, 0]}>
                    <boxGeometry args={[0.26, 0.08, 0.16]} />
                    <meshStandardMaterial color={hairColor} roughness={0.8} />
                  </mesh>
                </group>
              )}

              {config.hairStyle === 'spiky' && (
                <group>
                  {[
                    [0, 0.45, 0.05, 0.2, 0],
                    [-0.14, 0.41, 0.12, 0.3, 0.35],
                    [0.14, 0.41, 0.12, 0.3, -0.35],
                    [-0.1, 0.43, -0.08, -0.25, 0.28],
                    [0.1, 0.43, -0.08, -0.25, -0.28],
                    [0, 0.38, 0.24, 0.55, 0],
                  ].map(([sx, sy, sz, rx, rz], idx) => (
                    <mesh key={idx} position={[sx, sy, sz]} rotation={[rx, 0, rz]} castShadow>
                      <coneGeometry args={[0.085, 0.22, 8]} />
                      <meshStandardMaterial color={hairColor} roughness={0.82} />
                    </mesh>
                  ))}
                </group>
              )}

              {config.hairStyle === 'side-fade' && (
                <group>
                  {/* Textured swept side sweep + clean tapered sides */}
                  <mesh position={[-0.08, 0.32, 0.1]} rotation={[-0.15, 0.25, 0.18]} castShadow>
                    <sphereGeometry args={[0.24, 14, 12]} />
                    <meshStandardMaterial color={hairColor} roughness={0.82} />
                  </mesh>
                  <mesh position={[0.12, 0.26, 0.22]} rotation={[0.25, -0.3, -0.25]}>
                    <boxGeometry args={[0.22, 0.09, 0.2]} />
                    <meshStandardMaterial color={hairColor} roughness={0.82} />
                  </mesh>
                </group>
              )}

              {/* Ponytail for Female (Perempuan Centil) */}
              {isFemale && (
                <group ref={ponytailRef} position={[0, 0.14, -0.35]}>
                  <mesh position={[0, 0, 0]}>
                    <torusGeometry args={[0.055, 0.022, 8, 16]} />
                    <meshStandardMaterial color={config.jerseyColor} roughness={0.5} />
                  </mesh>
                  <mesh position={[0, -0.16, -0.09]} rotation={[0.35, 0, 0]} castShadow>
                    <capsuleGeometry args={[0.075, 0.22, 6, 12]} />
                    <meshStandardMaterial color={hairColor} roughness={0.82} />
                  </mesh>
                </group>
              )}
            </group>

            {/* HEAD ACCESSORIES */}
            {config.accessory === 'cap' && (
              <group position={[0, 0.16, 0]}>
                <mesh castShadow>
                  <sphereGeometry args={[0.395, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
                  <meshStandardMaterial color={config.jerseyColor} roughness={0.68} />
                </mesh>
                <mesh position={[0, 0.02, 0.39]} rotation={[0.18, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.26, 0.3, 0.035, 18, 1, false, -Math.PI / 2, Math.PI]} />
                  <meshStandardMaterial color={config.shortsColor} roughness={0.62} />
                </mesh>
              </group>
            )}

            {config.accessory === 'headband' && (
              <group position={[0, 0.14, 0]} rotation={[0.1, 0, 0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.382, 0.042, 10, 28]} />
                  <meshStandardMaterial color={config.jerseyColor} roughness={0.85} />
                </mesh>
                <mesh position={[0.08, -0.04, -0.4]} rotation={[0.3, 0.2, 0]}>
                  <boxGeometry args={[0.06, 0.18, 0.015]} />
                  <meshStandardMaterial color={config.jerseyColor} roughness={0.85} />
                </mesh>
              </group>
            )}

            {config.accessory === 'visor' && (
              <group position={[0, 0.14, 0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.385, 0.04, 10, 28]} />
                  <meshStandardMaterial color="#FFFFFF" roughness={0.55} />
                </mesh>
                <mesh position={[0, -0.01, 0.4]} rotation={[0.2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.27, 0.32, 0.03, 18, 1, false, -Math.PI / 2, Math.PI]} />
                  <meshStandardMaterial color={config.jerseyColor} roughness={0.48} />
                </mesh>
              </group>
            )}

            {config.accessory === 'trail-vest' && (
              <group position={[0, 0.15, 0]}>
                {/* Headlamp strap + glowing LED housing */}
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.386, 0.025, 8, 28]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.7} />
                </mesh>
                <mesh position={[0, 0.02, 0.395]}>
                  <boxGeometry args={[0.12, 0.065, 0.055]} />
                  <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.5} />
                </mesh>
                <mesh position={[0, 0.02, 0.425]}>
                  <boxGeometry args={[0.085, 0.042, 0.012]} />
                  <meshStandardMaterial
                    color="#FEF08A"
                    emissive="#FDE047"
                    emissiveIntensity={isNightMood ? 2.4 : 0.9}
                    roughness={0.2}
                  />
                </mesh>
                {isNightMood && (
                  <pointLight position={[0, 0.05, 0.6]} color="#FEF08A" intensity={6} distance={14} />
                )}
              </group>
            )}
          </group>

          {/* LEFT ARM */}
          <group ref={leftArmRef} position={[-0.31, 0.24, 0]}>
            <mesh position={[0, -0.14, 0]} castShadow>
              <capsuleGeometry args={[0.068, 0.2, 6, 12]} />
              <meshStandardMaterial color={skinColor} roughness={0.66} />
            </mesh>
            <group ref={leftForearmRef} position={[0, -0.25, 0]}>
              <mesh position={[0, -0.09, 0]} castShadow>
                <capsuleGeometry args={[0.06, 0.18, 6, 12]} />
                <meshStandardMaterial color={skinColor} roughness={0.66} />
              </mesh>
              {/* GPS Running Watch */}
              <mesh position={[0, -0.15, 0]}>
                <cylinderGeometry args={[0.072, 0.072, 0.04, 12]} />
                <meshStandardMaterial color="#0F172A" roughness={0.3} metalness={0.6} />
              </mesh>
            </group>
          </group>

          {/* RIGHT ARM */}
          <group ref={rightArmRef} position={[0.31, 0.24, 0]}>
            <mesh position={[0, -0.14, 0]} castShadow>
              <capsuleGeometry args={[0.068, 0.2, 6, 12]} />
              <meshStandardMaterial color={skinColor} roughness={0.66} />
            </mesh>
            <group ref={rightForearmRef} position={[0, -0.25, 0]}>
              <mesh position={[0, -0.09, 0]} castShadow>
                <capsuleGeometry args={[0.06, 0.18, 6, 12]} />
                <meshStandardMaterial color={skinColor} roughness={0.66} />
              </mesh>
            </group>
          </group>
        </group>

        {/* LEFT LEG + RUNNING SHOE */}
        <group ref={leftLegRef} position={[-0.125, 0.64, 0]}>
          {/* Shorts thigh */}
          <mesh position={[0, -0.1, 0]} castShadow>
            <cylinderGeometry args={[0.105, 0.092, 0.22, 14]} />
            <meshStandardMaterial color={config.shortsColor} roughness={0.82} />
          </mesh>
          {/* Lower leg */}
          <mesh position={[0, -0.35, 0]} castShadow>
            <capsuleGeometry args={[0.068, 0.28, 6, 12]} />
            <meshStandardMaterial color={skinColor} roughness={0.66} />
          </mesh>
          {/* Shoe upper + white midsole */}
          <group position={[0, -0.57, 0.05]}>
            <mesh position={[0, 0.03, 0]} castShadow>
              <boxGeometry args={[0.14, 0.09, 0.25]} />
              <meshStandardMaterial color={config.shoesColor} roughness={0.48} metalness={0.12} />
            </mesh>
            <mesh position={[0, -0.025, 0]}>
              <boxGeometry args={[0.148, 0.045, 0.26]} />
              <meshStandardMaterial color="#F8FAFC" roughness={0.55} />
            </mesh>
          </group>
        </group>

        {/* RIGHT LEG + RUNNING SHOE */}
        <group ref={rightLegRef} position={[0.125, 0.64, 0]}>
          <mesh position={[0, -0.1, 0]} castShadow>
            <cylinderGeometry args={[0.105, 0.092, 0.22, 14]} />
            <meshStandardMaterial color={config.shortsColor} roughness={0.82} />
          </mesh>
          <mesh position={[0, -0.35, 0]} castShadow>
            <capsuleGeometry args={[0.068, 0.28, 6, 12]} />
            <meshStandardMaterial color={skinColor} roughness={0.66} />
          </mesh>
          <group position={[0, -0.57, 0.05]}>
            <mesh position={[0, 0.03, 0]} castShadow>
              <boxGeometry args={[0.14, 0.09, 0.25]} />
              <meshStandardMaterial color={config.shoesColor} roughness={0.48} metalness={0.12} />
            </mesh>
            <mesh position={[0, -0.025, 0]}>
              <boxGeometry args={[0.148, 0.045, 0.26]} />
              <meshStandardMaterial color="#F8FAFC" roughness={0.55} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
};
