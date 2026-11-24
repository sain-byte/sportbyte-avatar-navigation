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

interface RealisticRunner3DProps {
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

/**
 * Built-in proportional realistic human athlete with articulated pelvis, spine,
 * hip, knee, ankle, shoulder, and elbow joints, Sportbyte BIB jersey, and walk/jog/run/sprint gait.
 */
export const RealisticRunner3D: React.FC<RealisticRunner3DProps> = ({
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
  const pelvisRef = useRef<THREE.Mesh>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftUpperArmRef = useRef<THREE.Group>(null);
  const leftForearmRef = useRef<THREE.Group>(null);
  const rightUpperArmRef = useRef<THREE.Group>(null);
  const rightForearmRef = useRef<THREE.Group>(null);
  const leftThighRef = useRef<THREE.Group>(null);
  const leftKneeRef = useRef<THREE.Group>(null);
  const leftAnkleRef = useRef<THREE.Group>(null);
  const rightThighRef = useRef<THREE.Group>(null);
  const rightKneeRef = useRef<THREE.Group>(null);
  const rightAnkleRef = useRef<THREE.Group>(null);
  const ponytailRef = useRef<THREE.Group>(null);
  const confettiRef = useRef<THREE.InstancedMesh>(null);
  const prevYawRef = useRef(yawRad);
  const runClockRef = useRef(0);
  const finishBlendRef = useRef(isFinishPose ? 1 : 0);
  const prevScrubRef = useRef(timelineProgress);
  const gaitPoseRef = useRef(createEmptyGaitFramePose());

  const dummyObj = useMemo(() => new THREE.Object3D(), []);
  const confettiSeeds = useMemo(() => buildConfettiSeeds(), []);

  const jerseyTexture = useMemo(
    () => createJerseyBibTexture(config.jerseyColor, config.bibNumber),
    [config.jerseyColor, config.bibNumber],
  );

  useEffect(() => () => jerseyTexture.dispose(), [jerseyTexture]);

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

    let yawDiff = yawRad - prevYawRef.current;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    prevYawRef.current = yawRad;
    const turnLean = THREE.MathUtils.clamp(yawDiff * 3.0, -0.18, 0.18);

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

      bodyBounceRef.current.position.y = blended.bodyOffsetY;
      bodyBounceRef.current.rotation.z = blended.bodyRollZ;

      if (pelvisRef.current) {
        pelvisRef.current.rotation.x = blended.hipsPitch;
        pelvisRef.current.rotation.y = blended.hipsYaw;
      }

      torsoRef.current.rotation.x = blended.spinePitch + blended.chestPitch + blended.upperChestPitch;
      torsoRef.current.rotation.y = blended.spineYaw + blended.chestYaw;
      torsoRef.current.rotation.z = pose.chestRoll * (1 - finishBlend);

      headRef.current.rotation.x = blended.neckPitch + blended.headPitch;
      headRef.current.rotation.y = pose.headYaw * (1 - finishBlend);
      headRef.current.rotation.z = blended.headRoll;

      if (
        leftThighRef.current &&
        rightThighRef.current &&
        leftKneeRef.current &&
        rightKneeRef.current
      ) {
        leftThighRef.current.rotation.x = blended.leftThighPitch;
        rightThighRef.current.rotation.x = blended.rightThighPitch;
        leftKneeRef.current.rotation.x = blended.leftKneeFlex;
        rightKneeRef.current.rotation.x = blended.rightKneeFlex;
      }

      if (leftAnkleRef.current && rightAnkleRef.current) {
        leftAnkleRef.current.rotation.x = blended.leftAnklePitch + blended.leftToePitch * 0.35;
        rightAnkleRef.current.rotation.x = blended.rightAnklePitch + blended.rightToePitch * 0.35;
      }

      if (
        leftUpperArmRef.current &&
        rightUpperArmRef.current &&
        leftForearmRef.current &&
        rightForearmRef.current
      ) {
        // RealisticRunner3D uses Euler XYZ with left arm at -X: Rz applies before Rx
        const isOverhead = rawFinish.leftArmPitch < -1.2;
        const targetRzL = isOverhead ? rawFinish.leftArmRoll : -rawFinish.leftArmRoll;
        const targetRzR = isOverhead ? rawFinish.rightArmRoll : -rawFinish.rightArmRoll;
        leftUpperArmRef.current.rotation.x = blended.leftArmPitch;
        leftUpperArmRef.current.rotation.y = -blended.leftArmYaw;
        leftUpperArmRef.current.rotation.z = THREE.MathUtils.lerp(
          -pose.leftArm.armRoll,
          targetRzL,
          finishBlend,
        );
        leftForearmRef.current.rotation.x = blended.leftElbowBend;

        rightUpperArmRef.current.rotation.x = blended.rightArmPitch;
        rightUpperArmRef.current.rotation.y = -blended.rightArmYaw;
        rightUpperArmRef.current.rotation.z = THREE.MathUtils.lerp(
          -pose.rightArm.armRoll,
          targetRzR,
          finishBlend,
        );
        rightForearmRef.current.rotation.x = blended.rightElbowBend;
      }

      if (ponytailRef.current) {
        const targetHairX = isExhausted
          ? 0.84 + Math.sin(t * 2.8) * 0.06
          : 0.24 + Math.max(0, blended.bodyOffsetY) * 1.1;
        ponytailRef.current.rotation.x = THREE.MathUtils.lerp(
          0.32 + Math.min(0.4, pose.bounceY * 2.2) + gait.forwardLean * 0.55,
          targetHairX,
          finishBlend,
        );
      }

      updateConfettiMesh(confettiRef.current, blended.showConfetti, t, confettiSeeds, dummyObj, 2.25);
    } else {
      updateConfettiMesh(confettiRef.current, false, t, confettiSeeds, dummyObj);

      bodyBounceRef.current.position.y = pose.bounceY;
      bodyBounceRef.current.rotation.z = pose.turnLeanRoll;

      if (pelvisRef.current) {
        pelvisRef.current.rotation.x = pose.pelvisPitch;
        pelvisRef.current.rotation.y = pose.pelvisYaw;
      }

      torsoRef.current.rotation.x = pose.spinePitch + pose.chestPitch;
      torsoRef.current.rotation.y = pose.spineYaw + pose.chestYaw;
      torsoRef.current.rotation.z = pose.chestRoll;

      headRef.current.rotation.x = pose.neckPitch + pose.headPitch;
      headRef.current.rotation.y = pose.headYaw;
      headRef.current.rotation.z = Math.sin(runClockRef.current * 0.5) * 0.02;

      if (
        leftThighRef.current &&
        rightThighRef.current &&
        leftKneeRef.current &&
        rightKneeRef.current
      ) {
        leftThighRef.current.rotation.x = pose.leftLeg.thighPitch;
        rightThighRef.current.rotation.x = pose.rightLeg.thighPitch;
        leftKneeRef.current.rotation.x = pose.leftLeg.kneeFlex;
        rightKneeRef.current.rotation.x = pose.rightLeg.kneeFlex;
      }

      if (leftAnkleRef.current && rightAnkleRef.current) {
        leftAnkleRef.current.rotation.x = pose.leftLeg.anklePitch + pose.leftLeg.toePitch * 0.35;
        rightAnkleRef.current.rotation.x = pose.rightLeg.anklePitch + pose.rightLeg.toePitch * 0.35;
      }

      if (
        leftUpperArmRef.current &&
        rightUpperArmRef.current &&
        leftForearmRef.current &&
        rightForearmRef.current
      ) {
        leftUpperArmRef.current.rotation.x = pose.leftArm.armPitch;
        leftUpperArmRef.current.rotation.z = -pose.leftArm.armRoll;
        leftUpperArmRef.current.rotation.y = pose.leftArm.armYaw;
        leftForearmRef.current.rotation.x = pose.leftArm.elbowBend;

        rightUpperArmRef.current.rotation.x = pose.rightArm.armPitch;
        rightUpperArmRef.current.rotation.z = -pose.rightArm.armRoll;
        rightUpperArmRef.current.rotation.y = pose.rightArm.armYaw;
        rightForearmRef.current.rotation.x = pose.rightArm.elbowBend;
      }

      if (ponytailRef.current) {
        ponytailRef.current.rotation.x =
          0.32 + Math.min(0.4, pose.bounceY * 2.2) + gait.forwardLean * 0.55;
      }
    }
  });

  const isFemale = config.gender === 'female';
  const skinColor = '#E8B796';
  const hairColor = '#1E293B';
  const shoulderHalfW = isFemale ? 0.185 : 0.215;

  return (
    <group ref={rootRef} name="RealisticRunnerRoot">
      {/* Grounded contact shadow disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow>
        <circleGeometry args={[0.48, 24]} />
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
        {/* Pelvis / Hips */}
        <mesh ref={pelvisRef} position={[0, 0.93, 0]} castShadow>
          <cylinderGeometry
            args={[isFemale ? 0.145 : 0.16, isFemale ? 0.155 : 0.162, 0.18, 18]}
          />
          <meshStandardMaterial color={config.shortsColor} roughness={0.82} metalness={0.05} />
        </mesh>

        {/* Torso & Upper Body */}
        <group ref={torsoRef} position={[0, 1.0, 0]}>
          {/* Athletic tapered ribcage with Sportbyte BIB texture */}
          <mesh position={[0, 0.24, 0]} castShadow>
            <cylinderGeometry
              args={[isFemale ? 0.168 : 0.205, isFemale ? 0.138 : 0.155, 0.46, 20]}
            />
            <meshStandardMaterial map={jerseyTexture} roughness={0.84} metalness={0.05} />
          </mesh>

          {/* Upper chest / shoulder yoke */}
          <mesh position={[0, 0.44, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <capsuleGeometry args={[0.068, shoulderHalfW * 1.75, 6, 12]} />
            <meshStandardMaterial color={config.jerseyColor} roughness={0.82} />
          </mesh>

          {/* Neck */}
          <mesh position={[0, 0.52, 0]} castShadow>
            <cylinderGeometry args={[0.052, 0.062, 0.13, 14]} />
            <meshStandardMaterial color={skinColor} roughness={0.62} />
          </mesh>

          {/* ACCESSORY: Trail Vest (fitted to athletic torso) */}
          {config.accessory === 'trail-vest' && (
            <group name="RealisticTrailVest">
              <mesh position={[0, 0.26, -0.01]} castShadow>
                <boxGeometry args={[isFemale ? 0.34 : 0.39, 0.38, 0.32]} />
                <meshStandardMaterial color="#1E293B" roughness={0.78} metalness={0.12} />
              </mesh>
              <mesh position={[0, 0.28, -0.18]} castShadow>
                <boxGeometry args={[0.24, 0.32, 0.1]} />
                <meshStandardMaterial color="#0F172A" roughness={0.7} metalness={0.15} />
              </mesh>
              <mesh position={[0, 0.24, -0.235]}>
                <boxGeometry args={[0.18, 0.04, 0.01]} />
                <meshStandardMaterial
                  color="#F97316"
                  emissive="#F97316"
                  emissiveIntensity={0.45}
                  roughness={0.35}
                />
              </mesh>
              {[-0.1, 0.1].map((fx, idx) => (
                <group key={idx} position={[fx, 0.25, 0.16]}>
                  <mesh castShadow>
                    <capsuleGeometry args={[0.032, 0.1, 6, 12]} />
                    <meshStandardMaterial color="#38BDF8" roughness={0.35} />
                  </mesh>
                  <mesh position={[0, 0.085, 0]}>
                    <cylinderGeometry args={[0.014, 0.018, 0.035, 10]} />
                    <meshStandardMaterial color="#E2E8F0" roughness={0.4} />
                  </mesh>
                </group>
              ))}
            </group>
          )}

          {/* HEAD GROUP (Natural human head ~1/7 body height) */}
          <group ref={headRef} position={[0, 0.68, 0.01]}>
            {/* Cranium & Face */}
            <mesh scale={[0.92, 1.12, 0.98]} castShadow>
              <sphereGeometry args={[0.125, 22, 18]} />
              <meshStandardMaterial color={skinColor} roughness={0.62} metalness={0.02} />
            </mesh>
            {/* Subtle jaw / chin contour */}
            <mesh position={[0, -0.055, 0.035]} scale={[0.82, 0.85, 0.85]}>
              <sphereGeometry args={[0.075, 14, 12]} />
              <meshStandardMaterial color={skinColor} roughness={0.62} />
            </mesh>
            {/* Nose bridge */}
            <mesh position={[0, -0.005, 0.122]} rotation={[-0.2, 0, 0]}>
              <boxGeometry args={[0.02, 0.04, 0.028]} />
              <meshStandardMaterial color={skinColor} roughness={0.6} />
            </mesh>
            {/* Ears */}
            {[-0.115, 0.115].map((ex, idx) => (
              <mesh key={idx} position={[ex, -0.01, -0.01]} scale={[0.45, 0.9, 0.6]}>
                <sphereGeometry args={[0.032, 10, 10]} />
                <meshStandardMaterial color={skinColor} roughness={0.64} />
              </mesh>
            ))}

            {/* Natural eyes + brows */}
            {[-0.042, 0.042].map((ex, idx) => (
              <group key={idx} position={[ex, 0.015, 0.112]}>
                <mesh>
                  <sphereGeometry args={[0.014, 10, 10]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.25} />
                </mesh>
                <mesh position={[0, 0.024, 0.004]}>
                  <boxGeometry args={[0.032, 0.008, 0.01]} />
                  <meshStandardMaterial color={hairColor} roughness={0.85} />
                </mesh>
              </group>
            ))}

            {/* GLASSES */}
            {config.glasses && (
              <group position={[0, 0.018, 0.118]}>
                {[-0.044, 0.044].map((lx, idx) => (
                  <mesh key={idx} position={[lx, 0, 0.008]}>
                    <boxGeometry args={[0.056, 0.034, 0.012]} />
                    <meshStandardMaterial
                      color="#0284C7"
                      roughness={0.12}
                      metalness={0.78}
                      emissive="#0369A1"
                      emissiveIntensity={0.25}
                    />
                  </mesh>
                ))}
                <mesh position={[0, 0.012, 0.008]}>
                  <boxGeometry args={[0.13, 0.01, 0.012]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.35} metalness={0.4} />
                </mesh>
                <mesh position={[-0.092, 0.006, -0.05]} rotation={[0, 0.18, 0]}>
                  <boxGeometry args={[0.009, 0.01, 0.12]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.35} />
                </mesh>
                <mesh position={[0.092, 0.006, -0.05]} rotation={[0, -0.18, 0]}>
                  <boxGeometry args={[0.009, 0.01, 0.12]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.35} />
                </mesh>
              </group>
            )}

            {/* HAIR STYLES */}
            <group name="RealisticHair">
              <mesh position={[0, 0.042, -0.012]} scale={[0.96, 0.92, 1.0]} castShadow>
                <sphereGeometry args={[0.124, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
                <meshStandardMaterial color={hairColor} roughness={0.82} />
              </mesh>
              {config.hairStyle === 'undercut' && (
                <mesh position={[0, 0.125, 0.03]} rotation={[-0.2, 0, 0]} castShadow>
                  <boxGeometry args={[0.11, 0.05, 0.14]} />
                  <meshStandardMaterial color={hairColor} roughness={0.8} />
                </mesh>
              )}
              {config.hairStyle === 'spiky' && (
                <group>
                  {[
                    [0, 0.16, 0.02, 0.2, 0],
                    [-0.045, 0.145, 0.04, 0.3, 0.35],
                    [0.045, 0.145, 0.04, 0.3, -0.35],
                    [0, 0.14, 0.08, 0.55, 0],
                  ].map(([sx, sy, sz, rx, rz], idx) => (
                    <mesh key={idx} position={[sx, sy, sz]} rotation={[rx, 0, rz]} castShadow>
                      <coneGeometry args={[0.028, 0.072, 8]} />
                      <meshStandardMaterial color={hairColor} roughness={0.82} />
                    </mesh>
                  ))}
                </group>
              )}
              {config.hairStyle === 'side-fade' && (
                <mesh position={[-0.03, 0.115, 0.035]} rotation={[-0.15, 0.25, 0.18]} castShadow>
                  <sphereGeometry args={[0.082, 12, 10]} />
                  <meshStandardMaterial color={hairColor} roughness={0.82} />
                </mesh>
              )}
              {isFemale && (
                <group ref={ponytailRef} position={[0, 0.05, -0.12]}>
                  <mesh>
                    <torusGeometry args={[0.02, 0.008, 8, 14]} />
                    <meshStandardMaterial color={config.jerseyColor} roughness={0.5} />
                  </mesh>
                  <mesh position={[0, -0.06, -0.035]} rotation={[0.35, 0, 0]} castShadow>
                    <capsuleGeometry args={[0.026, 0.09, 6, 10]} />
                    <meshStandardMaterial color={hairColor} roughness={0.82} />
                  </mesh>
                </group>
              )}
            </group>

            {/* HEAD ACCESSORIES */}
            {config.accessory === 'cap' && (
              <group position={[0, 0.062, 0]}>
                <mesh castShadow>
                  <sphereGeometry args={[0.132, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
                  <meshStandardMaterial color={config.jerseyColor} roughness={0.68} />
                </mesh>
                <mesh position={[0, 0.008, 0.132]} rotation={[0.18, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.09, 0.105, 0.014, 16, 1, false, -Math.PI / 2, Math.PI]} />
                  <meshStandardMaterial color={config.shortsColor} roughness={0.62} />
                </mesh>
              </group>
            )}
            {config.accessory === 'headband' && (
              <group position={[0, 0.055, 0]} rotation={[0.1, 0, 0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.126, 0.015, 10, 24]} />
                  <meshStandardMaterial color={config.jerseyColor} roughness={0.85} />
                </mesh>
              </group>
            )}
            {config.accessory === 'visor' && (
              <group position={[0, 0.055, 0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.128, 0.014, 10, 24]} />
                  <meshStandardMaterial color="#FFFFFF" roughness={0.55} />
                </mesh>
                <mesh position={[0, -0.004, 0.134]} rotation={[0.2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.092, 0.108, 0.012, 16, 1, false, -Math.PI / 2, Math.PI]} />
                  <meshStandardMaterial color={config.jerseyColor} roughness={0.48} />
                </mesh>
              </group>
            )}
            {config.accessory === 'trail-vest' && (
              <group position={[0, 0.06, 0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.128, 0.01, 8, 24]} />
                  <meshStandardMaterial color="#0F172A" roughness={0.7} />
                </mesh>
                <mesh position={[0, 0.008, 0.132]}>
                  <boxGeometry args={[0.045, 0.025, 0.022]} />
                  <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.5} />
                </mesh>
                <mesh position={[0, 0.008, 0.145]}>
                  <boxGeometry args={[0.032, 0.016, 0.006]} />
                  <meshStandardMaterial
                    color="#FEF08A"
                    emissive="#FDE047"
                    emissiveIntensity={isNightMood ? 2.4 : 0.9}
                    roughness={0.2}
                  />
                </mesh>
                {isNightMood && (
                  <pointLight position={[0, 0.02, 0.25]} color="#FEF08A" intensity={6} distance={14} />
                )}
              </group>
            )}
          </group>

          {/* LEFT ARTICULATED ARM (Shoulder + Elbow + Watch) */}
          <group ref={leftUpperArmRef} position={[-shoulderHalfW, 0.43, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[0.056, 12, 12]} />
              <meshStandardMaterial color={config.jerseyColor} roughness={0.8} />
            </mesh>
            <mesh position={[0, -0.13, 0]} castShadow>
              <capsuleGeometry args={[0.044, 0.2, 6, 12]} />
              <meshStandardMaterial color={skinColor} roughness={0.64} />
            </mesh>
            <group ref={leftForearmRef} position={[0, -0.26, 0]}>
              <mesh>
                <sphereGeometry args={[0.038, 10, 10]} />
                <meshStandardMaterial color={skinColor} roughness={0.64} />
              </mesh>
              <mesh position={[0, -0.12, 0]} castShadow>
                <capsuleGeometry args={[0.035, 0.18, 6, 12]} />
                <meshStandardMaterial color={skinColor} roughness={0.64} />
              </mesh>
              {/* GPS Watch */}
              <mesh position={[0, -0.19, 0]}>
                <cylinderGeometry args={[0.042, 0.042, 0.024, 12]} />
                <meshStandardMaterial color="#0F172A" roughness={0.3} metalness={0.6} />
              </mesh>
              {/* Hand */}
              <mesh position={[0, -0.24, 0]} castShadow>
                <sphereGeometry args={[0.04, 10, 10]} />
                <meshStandardMaterial color={skinColor} roughness={0.64} />
              </mesh>
            </group>
          </group>

          {/* RIGHT ARTICULATED ARM (Shoulder + Elbow) */}
          <group ref={rightUpperArmRef} position={[shoulderHalfW, 0.43, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[0.056, 12, 12]} />
              <meshStandardMaterial color={config.jerseyColor} roughness={0.8} />
            </mesh>
            <mesh position={[0, -0.13, 0]} castShadow>
              <capsuleGeometry args={[0.044, 0.2, 6, 12]} />
              <meshStandardMaterial color={skinColor} roughness={0.64} />
            </mesh>
            <group ref={rightForearmRef} position={[0, -0.26, 0]}>
              <mesh>
                <sphereGeometry args={[0.038, 10, 10]} />
                <meshStandardMaterial color={skinColor} roughness={0.64} />
              </mesh>
              <mesh position={[0, -0.12, 0]} castShadow>
                <capsuleGeometry args={[0.035, 0.18, 6, 12]} />
                <meshStandardMaterial color={skinColor} roughness={0.64} />
              </mesh>
              <mesh position={[0, -0.24, 0]} castShadow>
                <sphereGeometry args={[0.04, 10, 10]} />
                <meshStandardMaterial color={skinColor} roughness={0.64} />
              </mesh>
            </group>
          </group>
        </group>

        {/* LEFT ARTICULATED LEG (Thigh + Knee + Calf + Sculpted Running Shoe) */}
        <group ref={leftThighRef} position={[-0.095, 0.89, 0]}>
          {/* Running shorts leg */}
          <mesh position={[0, -0.12, 0]} castShadow>
            <cylinderGeometry args={[0.078, 0.064, 0.24, 14]} />
            <meshStandardMaterial color={config.shortsColor} roughness={0.82} />
          </mesh>
          {/* Exposed thigh */}
          <mesh position={[0, -0.29, 0]} castShadow>
            <capsuleGeometry args={[0.058, 0.16, 6, 12]} />
            <meshStandardMaterial color={skinColor} roughness={0.64} />
          </mesh>
          <group ref={leftKneeRef} position={[0, -0.42, 0]}>
            <mesh>
              <sphereGeometry args={[0.052, 10, 10]} />
              <meshStandardMaterial color={skinColor} roughness={0.64} />
            </mesh>
            {/* Calf */}
            <mesh position={[0, -0.2, 0]} castShadow>
              <capsuleGeometry args={[0.046, 0.28, 6, 12]} />
              <meshStandardMaterial color={skinColor} roughness={0.64} />
            </mesh>
            {/* Sculpted Running Shoe */}
            <group ref={leftAnkleRef} position={[0, -0.41, 0.045]}>
              <mesh position={[0, 0.025, 0]} castShadow>
                <boxGeometry args={[0.105, 0.068, 0.23]} />
                <meshStandardMaterial color={config.shoesColor} roughness={0.45} metalness={0.14} />
              </mesh>
              <mesh position={[0, -0.02, 0]}>
                <boxGeometry args={[0.112, 0.036, 0.24]} />
                <meshStandardMaterial color="#F8FAFC" roughness={0.55} />
              </mesh>
            </group>
          </group>
        </group>

        {/* RIGHT ARTICULATED LEG (Thigh + Knee + Calf + Sculpted Running Shoe) */}
        <group ref={rightThighRef} position={[0.095, 0.89, 0]}>
          <mesh position={[0, -0.12, 0]} castShadow>
            <cylinderGeometry args={[0.078, 0.064, 0.24, 14]} />
            <meshStandardMaterial color={config.shortsColor} roughness={0.82} />
          </mesh>
          <mesh position={[0, -0.29, 0]} castShadow>
            <capsuleGeometry args={[0.058, 0.16, 6, 12]} />
            <meshStandardMaterial color={skinColor} roughness={0.64} />
          </mesh>
          <group ref={rightKneeRef} position={[0, -0.42, 0]}>
            <mesh>
              <sphereGeometry args={[0.052, 10, 10]} />
              <meshStandardMaterial color={skinColor} roughness={0.64} />
            </mesh>
            <mesh position={[0, -0.2, 0]} castShadow>
              <capsuleGeometry args={[0.046, 0.28, 6, 12]} />
              <meshStandardMaterial color={skinColor} roughness={0.64} />
            </mesh>
            <group ref={rightAnkleRef} position={[0, -0.41, 0.045]}>
              <mesh position={[0, 0.025, 0]} castShadow>
                <boxGeometry args={[0.105, 0.068, 0.23]} />
                <meshStandardMaterial color={config.shoesColor} roughness={0.45} metalness={0.14} />
              </mesh>
              <mesh position={[0, -0.02, 0]}>
                <boxGeometry args={[0.112, 0.036, 0.24]} />
                <meshStandardMaterial color="#F8FAFC" roughness={0.55} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
};
