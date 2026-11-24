import * as THREE from 'three';
import type { Studio3DTrackPoint } from '../types/studio3d';
import { haversineDistanceKm } from './gpxParser';

export interface CleanGeoSample {
  lat: number;
  lon: number;
  elevationM?: number;
  timeMs: number;
  hr?: number;
  cadence?: number;
  distanceKm?: number;
  paceSecPerKm?: number;
}

export interface GroundedRouteVertex {
  x: number;
  y: number;
  z: number;
  distM: number;
  yawRad: number;
}

export interface GroundedRoutePath {
  vertices: GroundedRouteVertex[];
  totalArcMeters: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function isValidGeoCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -85 &&
    lat <= 85 &&
    lon >= -180 &&
    lon <= 180 &&
    !(Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6)
  );
}

/**
 * Validates lat/lon coordinates, removes duplicate points (<0.35m), rejects GPS
 * outlier teleport spikes, and preserves strict monotonic time ordering.
 */
export function cleanRawGeoSamples<T extends CleanGeoSample>(samples: T[]): T[] {
  const valid = samples
    .filter((s) => isValidGeoCoord(s.lat, s.lon) && Number.isFinite(s.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs);

  if (valid.length <= 2) return valid;

  const cleaned: T[] = [valid[0]];

  for (let i = 1; i < valid.length; i += 1) {
    const prev = cleaned[cleaned.length - 1];
    const curr = valid[i];
    const segKm = haversineDistanceKm(prev.lat, prev.lon, curr.lat, curr.lon);
    const segM = segKm * 1000;
    const dtSec = Math.max(0.1, (curr.timeMs - prev.timeMs) / 1000);
    const speedMps = segM / dtSec;

    // Duplicate sample (< 0.35 m movement), except always keep final sample if needed
    if (segM < 0.35 && i < valid.length - 1) {
      continue;
    }

    // Reject isolated GPS teleport/multipath outlier spikes (>14 m/s or bounce-back spike)
    if (speedMps > 14.0 && segM > 35 && i < valid.length - 1) {
      const next = valid[i + 1];
      const skipDistKm = haversineDistanceKm(prev.lat, prev.lon, next.lat, next.lon);
      if (skipDistKm * 1000 < segM * 0.65 || speedMps > 22) {
        continue;
      }
    }

    cleaned.push(curr);
  }

  return cleaned.length >= 2 ? cleaned : valid;
}

/**
 * Computes adaptive target point budget based on route distance and geometric complexity.
 */
export function computeAdaptivePointBudget(totalDistanceKm: number): number {
  if (totalDistanceKm < 5) {
    return 420; // Short routes target 300-500 points
  }
  if (totalDistanceKm <= 20) {
    return Math.round(520 + ((totalDistanceKm - 5) / 15) * 440); // Medium routes: 520-960 points
  }
  // Long routes scale smoothly up to 1500 points without sacrificing bends
  return Math.min(1500, Math.round(960 + (totalDistanceKm - 20) * 14));
}

function perpDistance2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-8) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function headingAngleChangeRad(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): number {
  const v1x = bx - ax;
  const v1z = bz - az;
  const v2x = cx - bx;
  const v2z = cz - bz;
  const l1 = Math.hypot(v1x, v1z);
  const l2 = Math.hypot(v2x, v2z);
  if (l1 < 0.8 || l2 < 0.8) return 0;
  const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1z * v2z) / (l1 * l2)));
  return Math.acos(dot);
}

/**
 * Direction-aware Douglas-Peucker + sharp-turn/elevation anchor simplifier.
 * Preserves sharp corners, start/finish, and significant elevation peaks cleanly.
 */
export function simplifyGeoSamplesAdaptive<T extends CleanGeoSample>(
  samples: T[],
  totalDistanceKm: number,
  explicitTarget?: number,
): T[] {
  const targetBudget = explicitTarget ?? computeAdaptivePointBudget(totalDistanceKm);
  if (samples.length <= targetBudget) {
    return samples;
  }

  let latSum = 0;
  let lonSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    latSum += samples[i].lat;
    lonSum += samples[i].lon;
  }
  const cLat = latSum / samples.length;
  const cLon = lonSum / samples.length;
  const cosLat = Math.max(0.15, Math.cos(toRad(cLat)));
  const mLat = 111320;
  const mLon = 111320 * cosLat;

  const xs = new Float64Array(samples.length);
  const zs = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    xs[i] = (samples[i].lon - cLon) * mLon;
    zs[i] = -(samples[i].lat - cLat) * mLat;
  }

  // Anchor points: start, end, highest & lowest elevation, sharp direction turns (>= 22 deg)
  const anchors = new Uint8Array(samples.length);
  anchors[0] = 1;
  anchors[samples.length - 1] = 1;

  let minEleIdx = 0;
  let maxEleIdx = 0;
  for (let i = 1; i < samples.length - 1; i += 1) {
    const ele = samples[i].elevationM ?? 0;
    if (ele > (samples[maxEleIdx].elevationM ?? -Infinity)) maxEleIdx = i;
    if (ele < (samples[minEleIdx].elevationM ?? Infinity)) minEleIdx = i;

    const turnAngle = headingAngleChangeRad(
      xs[i - 1],
      zs[i - 1],
      xs[i],
      zs[i],
      xs[i + 1],
      zs[i + 1],
    );
    if (turnAngle >= 0.38) {
      // ~22 degrees
      anchors[i] = 1;
    }
  }
  anchors[minEleIdx] = 1;
  anchors[maxEleIdx] = 1;

  // Iterative Douglas-Peucker scoring every vertex by its max orthogonal error
  const scores = new Float64Array(samples.length);
  const stack: Array<[number, number]> = [[0, samples.length - 1]];
  while (stack.length > 0) {
    const [i0, i1] = stack.pop()!;
    if (i1 - i0 <= 1) continue;
    let maxDist = -1;
    let bestIdx = -1;
    for (let i = i0 + 1; i < i1; i += 1) {
      const d = perpDistance2D(xs[i], zs[i], xs[i0], zs[i0], xs[i1], zs[i1]);
      if (d > maxDist) {
        maxDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx > i0 && bestIdx < i1) {
      scores[bestIdx] = maxDist;
      stack.push([i0, bestIdx], [bestIdx, i1]);
    }
  }

  // Select top indices: all anchors + highest DP error points + sparse straight-line cadence coverage
  const ranked: number[] = [];
  for (let i = 1; i < samples.length - 1; i += 1) {
    ranked.push(i);
  }
  ranked.sort((a, b) => {
    const aScore = scores[a] + (anchors[a] ? 50 : 0);
    const bScore = scores[b] + (anchors[b] ? 50 : 0);
    return bScore - aScore;
  });

  const keep = new Set<number>([0, samples.length - 1]);
  // Reserve 80% for highest geometric value (DP + turns + peaks), 20% uniform coverage along long straights
  const geomSlots = Math.floor((targetBudget - 2) * 0.8);
  for (let k = 0; k < ranked.length && keep.size < geomSlots + 2; k += 1) {
    keep.add(ranked[k]);
  }
  const uniformStep = (samples.length - 1) / Math.max(1, targetBudget - 1);
  for (let u = 0; u < targetBudget && keep.size < targetBudget; u += 1) {
    keep.add(Math.min(samples.length - 1, Math.round(u * uniformStep)));
  }

  return Array.from(keep)
    .sort((a, b) => a - b)
    .map((idx) => samples[idx]);
}

export function latLonToMetricLocal(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
): { xM: number; zM: number } {
  const cosLat = Math.max(0.15, Math.cos(toRad(centerLat)));
  return {
    xM: (lon - centerLon) * 111320 * cosLat,
    zM: -(lat - centerLat) * 111320,
  };
}

/**
 * Binary-searches track points by cumulative distance (km) and returns an interpolated point.
 * Ensures timeline progress maps linearly to physical distance covered rather than point count.
 */
export function sampleTrackPointByDistance(
  points: Studio3DTrackPoint[],
  totalDistanceKm: number,
  routeProgress: number,
): Studio3DTrackPoint {
  if (points.length === 0) {
    throw new Error('Track has no points.');
  }
  const clampedP = Math.min(1, Math.max(0, routeProgress));
  if (points.length === 1 || clampedP <= 0) {
    return points[0];
  }
  const maxDistKm = Math.max(0.001, points[points.length - 1].distanceKm || totalDistanceKm);
  if (clampedP >= 1) {
    return points[points.length - 1];
  }

  const targetDistKm = clampedP * maxDistKm;

  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].distanceKm <= targetDistKm) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const p0 = points[lo];
  const p1 = points[hi];
  const spanKm = p1.distanceKm - p0.distanceKm;
  const frac = spanKm > 1e-6 ? Math.min(1, Math.max(0, (targetDistKm - p0.distanceKm) / spanKm)) : 0;
  const lerp = (a: number, b: number) => a + (b - a) * frac;

  return {
    lat: lerp(p0.lat, p1.lat),
    lon: lerp(p0.lon, p1.lon),
    xM: lerp(p0.xM, p1.xM),
    zM: lerp(p0.zM, p1.zM),
    elevationM: lerp(p0.elevationM, p1.elevationM),
    elapsedSec: Math.round(lerp(p0.elapsedSec, p1.elapsedSec)),
    distanceKm: lerp(p0.distanceKm, p1.distanceKm),
    paceSecPerKm: Math.round(lerp(p0.paceSecPerKm, p1.paceSecPerKm)),
    hr: Math.round(lerp(p0.hr, p1.hr)),
    cadence: Math.round(lerp(p0.cadence, p1.cadence)),
  };
}

/**
 * Builds an overshoot-free, terrain-grounded 3D polyline with tight quadratic corner fillets
 * clamped within maxCornerFilletM (default 2.0m) so sharp street corners never bulge off the road.
 */
export function buildGroundedRoutePath(
  points: Studio3DTrackPoint[],
  sampleGroundY: (xM: number, zM: number) => number,
  options?: {
    heightOffsetM?: number;
    maxSegmentLenM?: number;
    maxCornerFilletM?: number;
  },
): GroundedRoutePath {
  const heightOffsetM = options?.heightOffsetM ?? 0.22;
  const maxSegmentLenM = options?.maxSegmentLenM ?? 7.5;
  const maxCornerFilletM = options?.maxCornerFilletM ?? 1.8;

  if (points.length === 0) {
    return { vertices: [], totalArcMeters: 0 };
  }
  if (points.length === 1) {
    const p = points[0];
    return {
      vertices: [{ x: p.xM, y: sampleGroundY(p.xM, p.zM) + heightOffsetM, z: p.zM, distM: 0, yawRad: 0 }],
      totalArcMeters: 0,
    };
  }

  // First pass: clamp sharp corners with tiny tangent-bounded quadratic fillets (prevents spline overshoot)
  const xzRaw: Array<{ x: number; z: number }> = [];
  xzRaw.push({ x: points[0].xM, z: points[0].zM });

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dx1 = curr.xM - prev.xM;
    const dz1 = curr.zM - prev.zM;
    const l1 = Math.hypot(dx1, dz1);

    const dx2 = next.xM - curr.xM;
    const dz2 = next.zM - curr.zM;
    const l2 = Math.hypot(dx2, dz2);

    if (l1 < 0.4 || l2 < 0.4) {
      xzRaw.push({ x: curr.xM, z: curr.zM });
      continue;
    }

    const dot = Math.max(-1, Math.min(1, (dx1 * dx2 + dz1 * dz2) / (l1 * l2)));
    const turnAngle = Math.acos(dot);

    if (turnAngle < 0.26) {
      xzRaw.push({ x: curr.xM, z: curr.zM });
    } else {
      const trim = Math.min(maxCornerFilletM, l1 * 0.24, l2 * 0.24);
      const ax = curr.xM - (dx1 / l1) * trim;
      const az = curr.zM - (dz1 / l1) * trim;
      const bx = curr.xM + (dx2 / l2) * trim;
      const bz = curr.zM + (dz2 / l2) * trim;
      const midX = 0.25 * ax + 0.5 * curr.xM + 0.25 * bx;
      const midZ = 0.25 * az + 0.5 * curr.zM + 0.25 * bz;
      xzRaw.push({ x: ax, z: az }, { x: midX, z: midZ }, { x: bx, z: bz });
    }
  }
  const last = points[points.length - 1];
  xzRaw.push({ x: last.xM, z: last.zM });

  // Second pass: adaptive terrain subdivision along every straight span
  const vertices: GroundedRouteVertex[] = [];
  let cumDistM = 0;

  const pushVertex = (x: number, z: number) => {
    if (vertices.length > 0) {
      const prevV = vertices[vertices.length - 1];
      const seg = Math.hypot(x - prevV.x, z - prevV.z);
      if (seg < 0.15) return;
      cumDistM += seg;
    }
    vertices.push({
      x,
      y: sampleGroundY(x, z) + heightOffsetM,
      z,
      distM: cumDistM,
      yawRad: 0,
    });
  };

  pushVertex(xzRaw[0].x, xzRaw[0].z);
  for (let i = 1; i < xzRaw.length; i += 1) {
    const a = xzRaw[i - 1];
    const b = xzRaw[i];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen < 0.15 && i < xzRaw.length - 1) continue;
    const subDivs = Math.max(1, Math.min(8, Math.ceil(segLen / maxSegmentLenM)));
    for (let s = 1; s <= subDivs; s += 1) {
      const t = s / subDivs;
      pushVertex(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    }
  }

  // Third pass: smoothed forward yaw around a local metric window (+-6m) for fluid avatar turning
  for (let i = 0; i < vertices.length; i += 1) {
    const i0 = Math.max(0, i - 2);
    const i1 = Math.min(vertices.length - 1, i + 2);
    const dx = vertices[i1].x - vertices[i0].x;
    const dz = vertices[i1].z - vertices[i0].z;
    if (Math.hypot(dx, dz) > 0.05) {
      vertices[i].yawRad = Math.atan2(dx, dz);
    } else if (i > 0) {
      vertices[i].yawRad = vertices[i - 1].yawRad;
    }
  }

  return {
    vertices,
    totalArcMeters: cumDistM,
  };
}

/**
 * Samples smoothed 3D position and heading yaw along the grounded route by normalized
 * cumulative distance progress (0..1), with zero allocations when outPos is provided.
 */
export function sampleGroundedRouteAtProgress(
  path: GroundedRoutePath,
  routeProgress: number,
  outPos?: THREE.Vector3,
): { position: THREE.Vector3; yawRad: number } {
  const pos = outPos ?? new THREE.Vector3();
  const verts = path.vertices;
  if (verts.length === 0) {
    pos.set(0, 0, 0);
    return { position: pos, yawRad: 0 };
  }
  if (verts.length === 1 || routeProgress <= 0) {
    pos.set(verts[0].x, verts[0].y, verts[0].z);
    return { position: pos, yawRad: verts[0].yawRad };
  }
  if (routeProgress >= 1) {
    const tail = verts[verts.length - 1];
    pos.set(tail.x, tail.y, tail.z);
    return { position: pos, yawRad: tail.yawRad };
  }

  const targetDistM = routeProgress * path.totalArcMeters;
  let lo = 0;
  let hi = verts.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (verts[mid].distM <= targetDistM) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const v0 = verts[lo];
  const v1 = verts[hi];
  const spanM = v1.distM - v0.distM;
  const t = spanM > 1e-4 ? Math.min(1, Math.max(0, (targetDistM - v0.distM) / spanM)) : 0;

  pos.set(
    v0.x + (v1.x - v0.x) * t,
    v0.y + (v1.y - v0.y) * t,
    v0.z + (v1.z - v0.z) * t,
  );

  // Shortest-arc yaw interpolation
  let diff = v1.yawRad - v0.yawRad;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const yawRad = v0.yawRad + diff * t;

  return { position: pos, yawRad };
}

/**
 * Builds an index-capped tapered ribbon or slim tube BufferGeometry directly along grounded vertices,
 * preserving exact GPS shape with zero spline overshoot and clean single draw-call progress slicing.
 */
export function buildSlimRouteRibbonGeometry(
  path: GroundedRoutePath,
  halfWidthM: number,
  options?: { tileLenM?: number },
): THREE.BufferGeometry {
  const verts = path.vertices;
  const geo = new THREE.BufferGeometry();
  if (verts.length < 2) {
    geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    return geo;
  }

  const n = verts.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = new Uint32Array((n - 1) * 6);

  const tileLenM = options?.tileLenM ?? Math.max(3.6, halfWidthM * 6.5);

  for (let i = 0; i < n; i += 1) {
    const prev = verts[Math.max(0, i - 1)];
    const next = verts[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    // Perpendicular right vector on XZ plane
    const nx = -tz;
    const nz = tx;

    const curr = verts[i];
    const baseV = i * 2;

    positions[baseV * 3] = curr.x - nx * halfWidthM;
    positions[baseV * 3 + 1] = curr.y;
    positions[baseV * 3 + 2] = curr.z - nz * halfWidthM;

    positions[(baseV + 1) * 3] = curr.x + nx * halfWidthM;
    positions[(baseV + 1) * 3 + 1] = curr.y;
    positions[(baseV + 1) * 3 + 2] = curr.z + nz * halfWidthM;

    normals[baseV * 3 + 1] = 1;
    normals[(baseV + 1) * 3 + 1] = 1;

    const vCoord = curr.distM / tileLenM;
    uvs[baseV * 2] = 0;
    uvs[baseV * 2 + 1] = vCoord;
    uvs[(baseV + 1) * 2] = 1;
    uvs[(baseV + 1) * 2 + 1] = vCoord;
  }

  for (let i = 0; i < n - 1; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    const idxOffset = i * 6;
    indices[idxOffset] = a;
    indices[idxOffset + 1] = b;
    indices[idxOffset + 2] = c;
    indices[idxOffset + 3] = b;
    indices[idxOffset + 4] = d;
    indices[idxOffset + 5] = c;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  return geo;
}

const PACE_FAST_COLOR = new THREE.Color('#10B981');
const PACE_MOD_COLOR = new THREE.Color('#F59E0B');
const PACE_SLOW_COLOR = new THREE.Color('#EF4444');

export function paceSecToColor(paceSecPerKm: number, outColor?: THREE.Color): THREE.Color {
  const c = outColor ?? new THREE.Color();
  const clamped = Math.min(480, Math.max(210, Number.isFinite(paceSecPerKm) ? paceSecPerKm : 340));
  if (clamped <= 270) {
    return c.copy(PACE_FAST_COLOR);
  }
  if (clamped <= 345) {
    return c.lerpColors(PACE_FAST_COLOR, PACE_MOD_COLOR, (clamped - 270) / 75);
  }
  if (clamped <= 420) {
    return c.lerpColors(PACE_MOD_COLOR, PACE_SLOW_COLOR, (clamped - 345) / 75);
  }
  return c.copy(PACE_SLOW_COLOR);
}

/**
 * Builds a Google Maps traffic/pace-gradient route ribbon BufferGeometry with per-vertex
 * RGB colors smoothly interpolated from trackPoints pace (fast emerald -> amber -> slow coral).
 */
export function buildPaceColoredRouteRibbonGeometry(
  path: GroundedRoutePath,
  trackPoints: Studio3DTrackPoint[],
  halfWidthM: number,
  options?: { tileLenM?: number },
): THREE.BufferGeometry {
  const geo = buildSlimRouteRibbonGeometry(path, halfWidthM, options);
  const verts = path.vertices;
  if (verts.length < 2) return geo;

  const colors = new Float32Array(verts.length * 2 * 3);
  const totalMeters = Math.max(1, path.totalArcMeters);
  const maxDistKm =
    trackPoints.length > 0
      ? Math.max(0.01, trackPoints[trackPoints.length - 1].distanceKm)
      : totalMeters / 1000;
  const tmpColor = new THREE.Color();

  for (let i = 0; i < verts.length; i += 1) {
    const progress = verts[i].distM / totalMeters;
    const sampledPt =
      trackPoints.length > 0
        ? sampleTrackPointByDistance(trackPoints, maxDistKm, progress)
        : null;
    paceSecToColor(sampledPt?.paceSecPerKm ?? 340, tmpColor);

    const baseV = i * 2;
    colors[baseV * 3] = tmpColor.r;
    colors[baseV * 3 + 1] = tmpColor.g;
    colors[baseV * 3 + 2] = tmpColor.b;

    colors[(baseV + 1) * 3] = tmpColor.r;
    colors[(baseV + 1) * 3 + 1] = tmpColor.g;
    colors[(baseV + 1) * 3 + 2] = tmpColor.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}
