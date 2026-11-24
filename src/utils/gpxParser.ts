import type { KmSplit, RoutePoint, TelemetryPoint } from '../types';
import { formatDuration, formatPace } from './runParser';

export interface GpxRunSummary {
  date: string; // YYYY-MM-DD
  distanceKm: number;
  durationSec: number;
  durationStr: string;
  paceSecPerKm: number;
  paceStr: string;
  avgHr?: number;
  avgCadence?: number;
  elevationGainM?: number;
  fileType?: 'gpx' | 'fit';
  trackpointCount: number;
}

export interface ParsedGpxResult {
  splits: KmSplit[];
  routePoints: RoutePoint[];
  telemetryPoints: TelemetryPoint[];
  summary: GpxRunSummary;
}

interface GpxTrackpoint {
  lat: number;
  lon: number;
  ele?: number;
  timeMs: number;
  hr?: number;
  cad?: number;
}

interface ActiveStep {
  lat: number;
  lon: number;
  ele: number;
  distKm: number;
  durMs: number;
  hr?: number;
  cad?: number;
}

const EARTH_RADIUS_KM = 6371;
export const MAX_KM_SPLITS = 100;
export const MAX_ROUTE_POINTS = 100;
export const MAX_TELEMETRY_POINTS = 100;

// Speed thresholds (meters / second) for distinguishing running/walking from pauses & GPS glitches
const STATIONARY_SPEED_MPS = 0.85; // ~19:36 /km (catches stopped/jitter dwell while keeping slow walks)
const MAX_PLAUSIBLE_SPEED_MPS = 12.0; // ~1:23 /km (filters GPS teleport spikes)

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function normalizeCadenceValue(raw: number): number | undefined {
  if (!Number.isFinite(raw) || raw < 35) return undefined;
  const spm = raw < 120 ? Math.round(raw * 2) : Math.round(raw);
  return spm >= 80 && spm <= 240 ? spm : undefined;
}

function parseHrAndCadFromNode(node: Element): { hr?: number; cad?: number } {
  let hr: number | undefined;
  let cad: number | undefined;
  const all = node.getElementsByTagName('*');
  for (let i = 0; i < all.length; i += 1) {
    const el = all[i];
    const local = (el.localName || el.tagName || '').toLowerCase();
    if (hr === undefined && (local === 'hr' || local.endsWith(':hr') || local === 'heartrate')) {
      const val = Math.round(Number(el.textContent?.trim()));
      if (Number.isFinite(val) && val >= 40 && val <= 230) {
        hr = val;
      }
    } else if (
      cad === undefined &&
      (local === 'cad' || local.endsWith(':cad') || local === 'cadence' || local.endsWith(':cadence'))
    ) {
      const val = normalizeCadenceValue(Number(el.textContent?.trim()));
      if (val !== undefined) {
        cad = val;
      }
    }
  }
  return { hr, cad };
}

function extractPointsFromTrkptElements(nodes: Element[]): GpxTrackpoint[] {
  const points: GpxTrackpoint[] = [];
  for (const node of nodes) {
    const lat = Number(node.getAttribute('lat'));
    const lon = Number(node.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const timeEl =
      node.getElementsByTagName('time')[0] ??
      node.getElementsByTagNameNS('*', 'time')[0];
    const timeText = timeEl?.textContent?.trim() ?? '';
    const timeMs = Date.parse(timeText);
    if (!Number.isFinite(timeMs)) continue;

    const eleEl =
      node.getElementsByTagName('ele')[0] ??
      node.getElementsByTagNameNS('*', 'ele')[0];
    const eleRaw = eleEl?.textContent ? Number(eleEl.textContent.trim()) : NaN;
    const ele = Number.isFinite(eleRaw) && eleRaw >= -500 && eleRaw <= 9000 ? eleRaw : undefined;

    const { hr, cad } = parseHrAndCadFromNode(node);
    const point: GpxTrackpoint = {
      lat,
      lon,
      timeMs,
      ...(ele !== undefined ? { ele } : {}),
      ...(hr !== undefined ? { hr } : {}),
      ...(cad !== undefined ? { cad } : {}),
    };
    const prev = points[points.length - 1];
    if (!prev || point.timeMs >= prev.timeMs) {
      points.push(point);
    }
  }
  return points;
}

function parseTrkSegmentsWithDomParser(xmlText: string): GpxTrackpoint[][] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid GPX XML file.');
  }

  let segNodes = Array.from(doc.getElementsByTagName('trkseg'));
  if (segNodes.length === 0) {
    segNodes = Array.from(doc.getElementsByTagNameNS('*', 'trkseg'));
  }

  const segments: GpxTrackpoint[][] = [];
  if (segNodes.length > 0) {
    for (const segNode of segNodes) {
      let ptNodes = Array.from(segNode.getElementsByTagName('trkpt'));
      if (ptNodes.length === 0) {
        ptNodes = Array.from(segNode.getElementsByTagNameNS('*', 'trkpt'));
      }
      const pts = extractPointsFromTrkptElements(ptNodes);
      if (pts.length > 0) segments.push(pts);
    }
    return segments;
  }

  // Fallback if GPX omits <trkseg> wrapper
  let ptNodes = Array.from(doc.getElementsByTagName('trkpt'));
  if (ptNodes.length === 0) {
    ptNodes = Array.from(doc.getElementsByTagNameNS('*', 'trkpt'));
  }
  const pts = extractPointsFromTrkptElements(ptNodes);
  return pts.length > 0 ? [pts] : [];
}

function parseTrkptStringBlock(xmlFragment: string): GpxTrackpoint[] {
  const points: GpxTrackpoint[] = [];
  const trkptRegex = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = trkptRegex.exec(xmlFragment)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const latMatch = attrs.match(/\blat\s*=\s*["']([^"']+)["']/i);
    const lonMatch = attrs.match(/\blon\s*=\s*["']([^"']+)["']/i);
    if (!latMatch || !lonMatch) continue;
    const lat = Number(latMatch[1]);
    const lon = Number(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const timeMatch = body.match(/<time[^>]*>([\s\S]*?)<\/time>/i);
    if (!timeMatch) continue;
    const timeMs = Date.parse(timeMatch[1].trim());
    if (!Number.isFinite(timeMs)) continue;

    let ele: number | undefined;
    const eleMatch = body.match(/<ele[^>]*>([^<]+)<\/ele>/i);
    if (eleMatch) {
      const eleVal = Number(eleMatch[1].trim());
      if (Number.isFinite(eleVal) && eleVal >= -500 && eleVal <= 9000) {
        ele = eleVal;
      }
    }

    let hr: number | undefined;
    const hrMatch = body.match(/<(?:[a-z0-9_-]+:)?(?:hr|heartrate)\b[^>]*>(\d+)<\/(?:[a-z0-9_-]+:)?(?:hr|heartrate)>/i);
    if (hrMatch) {
      const val = Math.round(Number(hrMatch[1]));
      if (val >= 40 && val <= 230) {
        hr = val;
      }
    }

    let cad: number | undefined;
    const cadMatch = body.match(/<(?:[a-z0-9_-]+:)?(?:cad|cadence)\b[^>]*>(\d+(?:\.\d+)?)<\/(?:[a-z0-9_-]+:)?(?:cad|cadence)>/i);
    if (cadMatch) {
      cad = normalizeCadenceValue(Number(cadMatch[1]));
    }

    const point: GpxTrackpoint = {
      lat,
      lon,
      timeMs,
      ...(ele !== undefined ? { ele } : {}),
      ...(hr !== undefined ? { hr } : {}),
      ...(cad !== undefined ? { cad } : {}),
    };
    const prev = points[points.length - 1];
    if (!prev || point.timeMs >= prev.timeMs) {
      points.push(point);
    }
  }
  return points;
}

function parseTrkSegmentsFallback(xmlText: string): GpxTrackpoint[][] {
  const segments: GpxTrackpoint[][] = [];
  const segRegex = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi;
  let segMatch: RegExpExecArray | null = null;
  while ((segMatch = segRegex.exec(xmlText)) !== null) {
    const pts = parseTrkptStringBlock(segMatch[1]);
    if (pts.length > 0) segments.push(pts);
  }
  if (segments.length > 0) return segments;
  const pts = parseTrkptStringBlock(xmlText);
  return pts.length > 0 ? [pts] : [];
}

function computeMedianDtSec(segments: GpxTrackpoint[][]): number {
  const dts: number[] = [];
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i += 1) {
      const dt = (seg[i].timeMs - seg[i - 1].timeMs) / 1000;
      if (dt > 0 && dt <= 60) dts.push(dt);
    }
  }
  if (dts.length === 0) return 5;
  dts.sort((a, b) => a - b);
  return dts[Math.floor(dts.length / 2)];
}

/**
 * Splits a continuous <trkseg> into active moving sub-segments, stripping:
 * - Watch pause timestamp gaps (auto-pause or manual pause inside a single <trkseg>)
 * - Sustained stationary dwell (standing still with GPS drift)
 * - Impossible GPS teleport spikes (> 12 m/s)
 */
function extractMovingSubSegments(
  rawSegments: GpxTrackpoint[][],
  medianDtSec: number,
): GpxTrackpoint[][] {
  const activeSegments: GpxTrackpoint[][] = [];
  const pauseGapThresholdSec = Math.max(10, medianDtSec * 5);

  for (const seg of rawSegments) {
    if (seg.length < 2) continue;

    // Precompute local ~6-second window speed around each point for dense tracks
    const isDense = medianDtSec <= 4;
    let currentSub: GpxTrackpoint[] = [seg[0]];

    for (let i = 1; i < seg.length; i += 1) {
      const prev = seg[i - 1];
      const curr = seg[i];
      const dtMs = curr.timeMs - prev.timeMs;
      const dtSec = dtMs / 1000;
      if (dtSec <= 0) continue;

      const distMeters = haversineDistanceKm(prev.lat, prev.lon, curr.lat, curr.lon) * 1000;
      const instantSpeedMps = distMeters / dtSec;

      // 1. GPS teleport spike -> break continuity so spike doesn't corrupt distance
      if (instantSpeedMps > MAX_PLAUSIBLE_SPEED_MPS) {
        if (currentSub.length >= 2) activeSegments.push(currentSub);
        currentSub = [curr];
        continue;
      }

      // 2. Watch pause timestamp gap inside a single <trkseg>
      const isPauseGap =
        (dtSec >= pauseGapThresholdSec && instantSpeedMps < 1.35) ||
        (dtSec >= 25 && instantSpeedMps < 1.65);
      if (isPauseGap) {
        if (currentSub.length >= 2) activeSegments.push(currentSub);
        currentSub = [curr];
        continue;
      }

      // 3. Sustained stationary dwell (e.g., stopped at intersection without auto-pause)
      if (isDense) {
        // Compute displacement & path speed across ~6s window around i
        let wStart = i - 1;
        while (wStart > 0 && curr.timeMs - seg[wStart].timeMs < 5000) {
          wStart -= 1;
        }
        let wEnd = i;
        while (wEnd < seg.length - 1 && seg[wEnd].timeMs - seg[wStart].timeMs < 6000) {
          wEnd += 1;
        }
        const winDtSec = (seg[wEnd].timeMs - seg[wStart].timeMs) / 1000;
        const winNetMeters =
          haversineDistanceKm(seg[wStart].lat, seg[wStart].lon, seg[wEnd].lat, seg[wEnd].lon) * 1000;
        let maxRadiusMeters = 0;
        for (let k = wStart + 1; k <= wEnd; k += 1) {
          const r = haversineDistanceKm(seg[wStart].lat, seg[wStart].lon, seg[k].lat, seg[k].lon) * 1000;
          if (r > maxRadiusMeters) maxRadiusMeters = r;
        }
        const winSpeedMps = winDtSec >= 4 ? winNetMeters / winDtSec : instantSpeedMps;

        if (
          winDtSec >= 5 &&
          winSpeedMps < STATIONARY_SPEED_MPS &&
          instantSpeedMps < 1.1 &&
          maxRadiusMeters < 5.0
        ) {
          if (currentSub.length >= 2) activeSegments.push(currentSub);
          currentSub = [curr];
          continue;
        }
      } else if (dtSec >= 8 && instantSpeedMps < STATIONARY_SPEED_MPS) {
        if (currentSub.length >= 2) activeSegments.push(currentSub);
        currentSub = [curr];
        continue;
      }

      currentSub.push(curr);
    }

    if (currentSub.length >= 2) {
      activeSegments.push(currentSub);
    }
  }

  return activeSegments;
}

/**
 * Lightly smooths 1s–3s GPS coordinates with a [0.25, 0.5, 0.25] kernel and samples
 * chords spaced >= 3.5s (or >= 6m) so 1-second lateral GPS zigzag doesn't inflate distance.
 * Sparse tracks (medianDt > 3s) pass through unmodified.
 */
function buildActiveSteps(
  subSegments: GpxTrackpoint[][],
  medianDtSec: number,
): {
  steps: ActiveStep[];
  firstPoint?: { lat: number; lon: number; ele: number; hr?: number; cad?: number };
  firstHr?: number;
  startTimeMs: number;
  pointCount: number;
} {
  const steps: ActiveStep[] = [];
  const shouldSmoothDense = medianDtSec <= 3;
  let firstHr: number | undefined;
  let firstPoint: { lat: number; lon: number; ele: number; hr?: number; cad?: number } | undefined;
  let startTimeMs = 0;
  let pointCount = 0;
  let lastValidEle = 15;

  for (const sub of subSegments) {
    if (sub.length < 2) continue;
    if (startTimeMs === 0) startTimeMs = sub[0].timeMs;
    if (firstHr === undefined && sub[0].hr !== undefined) firstHr = sub[0].hr;
    if (!firstPoint) {
      if (sub[0].ele !== undefined) lastValidEle = sub[0].ele;
      firstPoint = {
        lat: sub[0].lat,
        lon: sub[0].lon,
        ele: sub[0].ele ?? lastValidEle,
        ...(sub[0].hr !== undefined ? { hr: sub[0].hr } : {}),
        ...(sub[0].cad !== undefined ? { cad: sub[0].cad } : {}),
      };
    }
    pointCount += sub.length;

    const coords: GpxTrackpoint[] =
      shouldSmoothDense && sub.length >= 5
        ? sub.map((pt, idx) => {
            if (idx === 0 || idx === sub.length - 1) return pt;
            const p0 = sub[idx - 1];
            const p2 = sub[idx + 1];
            // Only smooth if adjacent points are close in time (<= 4s)
            if (pt.timeMs - p0.timeMs <= 4500 && p2.timeMs - pt.timeMs <= 4500) {
              return {
                ...pt,
                lat: 0.25 * p0.lat + 0.5 * pt.lat + 0.25 * p2.lat,
                lon: 0.25 * p0.lon + 0.5 * pt.lon + 0.25 * p2.lon,
              };
            }
            return pt;
          })
        : sub;

    let anchor = coords[0];
    let hrSum = 0;
    let hrCount = 0;
    let cadSum = 0;
    let cadCount = 0;

    for (let i = 1; i < coords.length; i += 1) {
      const pt = coords[i];
      if (pt.ele !== undefined) lastValidEle = pt.ele;
      if (pt.hr !== undefined) {
        hrSum += pt.hr;
        hrCount += 1;
      }
      if (pt.cad !== undefined) {
        cadSum += pt.cad;
        cadCount += 1;
      }

      const isLast = i === coords.length - 1;
      const dtFromAnchorMs = pt.timeMs - anchor.timeMs;
      const distFromAnchorKm = haversineDistanceKm(anchor.lat, anchor.lon, pt.lat, pt.lon);

      if (
        !shouldSmoothDense ||
        isLast ||
        (dtFromAnchorMs >= 3500 && distFromAnchorKm >= 0.004) ||
        distFromAnchorKm >= 0.01
      ) {
        if (dtFromAnchorMs > 0) {
          const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : pt.hr;
          const avgCad = cadCount > 0 ? Math.round(cadSum / cadCount) : pt.cad;
          steps.push({
            lat: pt.lat,
            lon: pt.lon,
            ele: pt.ele ?? lastValidEle,
            distKm: distFromAnchorKm,
            durMs: dtFromAnchorMs,
            ...(avgHr !== undefined ? { hr: avgHr } : {}),
            ...(avgCad !== undefined ? { cad: avgCad } : {}),
          });
          anchor = pt;
          hrSum = 0;
          hrCount = 0;
          cadSum = 0;
          cadCount = 0;
        }
      }
    }
  }

  return { steps, firstPoint, firstHr, startTimeMs, pointCount };
}

function formatLocalIsoDateFromMs(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function downsampleTelemetryPoints(
  points: TelemetryPoint[],
  maxPoints = MAX_TELEMETRY_POINTS,
): TelemetryPoint[] {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 0) return [];
  if (maxPoints === 1) return [points[0]];
  if (maxPoints === 2) return [points[0], points[points.length - 1]];

  let peakIdx = 0;
  let maxEle = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].ele > maxEle) {
      maxEle = points[i].ele;
      peakIdx = i;
    }
  }
  const picked = new Set<number>([0, points.length - 1, peakIdx]);
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints && picked.size < maxPoints; i += 1) {
    picked.add(Math.min(points.length - 1, Math.round(i * step)));
  }
  return Array.from(picked)
    .sort((a, b) => a - b)
    .map((idx) => points[idx]);
}

export function parseGpxXml(xmlText: string): ParsedGpxResult {
  const trimmed = String(xmlText ?? '').trim();
  if (!trimmed || !/<gpx[\s>]/i.test(trimmed)) {
    throw new Error('File does not appear to be a valid .gpx track.');
  }

  const rawSegments =
    typeof DOMParser !== 'undefined'
      ? parseTrkSegmentsWithDomParser(trimmed)
      : parseTrkSegmentsFallback(trimmed);

  const totalRawPoints = rawSegments.reduce((sum, s) => sum + s.length, 0);
  if (totalRawPoints < 2) {
    throw new Error('GPX file needs at least 2 trackpoints with timestamps (<time>).');
  }

  const medianDtSec = computeMedianDtSec(rawSegments);
  const movingSegments = extractMovingSubSegments(rawSegments, medianDtSec);
  const { steps, firstPoint, firstHr, startTimeMs, pointCount } = buildActiveSteps(
    movingSegments,
    medianDtSec,
  );

  if (steps.length === 0) {
    throw new Error('GPX trackpoints do not contain valid elapsed moving timestamps.');
  }

  const splits: KmSplit[] = [];
  let totalDistKm = 0;
  let activeElapsedMs = 0;
  let nextTargetKm = 1;
  let splitStartActiveMs = 0;
  let splitHrSum = 0;
  let splitHrCount = 0;

  let totalHrSum = 0;
  let totalHrCount = 0;
  let totalCadSum = 0;
  let totalCadCount = 0;

  const rawTelemetry: TelemetryPoint[] = [];
  if (firstPoint) {
    rawTelemetry.push({
      lat: Math.round(firstPoint.lat * 1e6) / 1e6,
      lon: Math.round(firstPoint.lon * 1e6) / 1e6,
      ele: Math.round(firstPoint.ele * 10) / 10,
      tSec: 0,
      distKm: 0,
      paceSec: 360,
      ...(firstPoint.hr !== undefined ? { hr: firstPoint.hr } : {}),
      ...(firstPoint.cad !== undefined ? { cad: firstPoint.cad } : {}),
    });
    if (firstPoint.cad !== undefined) {
      totalCadSum += firstPoint.cad;
      totalCadCount += 1;
    }
  }

  if (firstHr !== undefined) {
    splitHrSum += firstHr;
    splitHrCount += 1;
    totalHrSum += firstHr;
    totalHrCount += 1;
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const segDist = step.distKm;
    const segMs = step.durMs;

    if (step.hr !== undefined) {
      totalHrSum += step.hr;
      totalHrCount += 1;
    }
    if (step.cad !== undefined) {
      totalCadSum += step.cad;
      totalCadCount += 1;
    }

    if (segDist <= 0) {
      activeElapsedMs += segMs;
      if (step.hr !== undefined) {
        splitHrSum += step.hr;
        splitHrCount += 1;
      }
      continue;
    }

    if (totalDistKm + segDist < nextTargetKm || splits.length >= MAX_KM_SPLITS - 1) {
      if (step.hr !== undefined) {
        splitHrSum += step.hr;
        splitHrCount += 1;
      }
    } else {
      let consumedCurrInClosing = false;
      while (
        totalDistKm + segDist >= nextTargetKm &&
        splits.length < MAX_KM_SPLITS - 1
      ) {
        const remainingToTarget = nextTargetKm - totalDistKm;
        const ratio = Math.min(1, Math.max(0, remainingToTarget / segDist));
        if (!consumedCurrInClosing && step.hr !== undefined && (ratio >= 0.5 || splitHrCount === 0)) {
          splitHrSum += step.hr;
          splitHrCount += 1;
          consumedCurrInClosing = true;
        }
        const crossActiveMs = activeElapsedMs + ratio * segMs;
        const splitDurSec = Math.min(
          7200,
          Math.max(1, Math.round((crossActiveMs - splitStartActiveMs) / 1000)),
        );
        const avgSplitHr =
          splitHrCount > 0 ? Math.round(splitHrSum / splitHrCount) : step.hr;

        splits.push({
          km: splits.length + 1,
          distanceKm: 1,
          durationSec: splitDurSec,
          paceSecPerKm: Math.min(3600, Math.max(1, splitDurSec)),
          paceStr: formatPace(Math.min(3600, Math.max(1, splitDurSec))),
          ...(avgSplitHr !== undefined ? { hr: avgSplitHr } : {}),
        });

        splitStartActiveMs = crossActiveMs;
        splitHrSum = step.hr !== undefined ? step.hr : 0;
        splitHrCount = step.hr !== undefined ? 1 : 0;
        nextTargetKm += 1;
      }
    }

    totalDistKm += segDist;
    activeElapsedMs += segMs;

    const instPaceSec = Math.min(
      3600,
      Math.max(120, Math.round(segMs / 1000 / Math.max(0.001, segDist))),
    );
    rawTelemetry.push({
      lat: Math.round(step.lat * 1e6) / 1e6,
      lon: Math.round(step.lon * 1e6) / 1e6,
      ele: Math.round(step.ele * 10) / 10,
      tSec: Math.min(86400, Math.max(0, Math.round(activeElapsedMs / 1000))),
      distKm: Math.min(250, Math.round(totalDistKm * 1000) / 1000),
      paceSec: instPaceSec,
      ...(step.hr !== undefined ? { hr: step.hr } : {}),
      ...(step.cad !== undefined ? { cad: step.cad } : {}),
    });
  }

  // Final partial (or exact) kilometer segment if >= 50 meters beyond last boundary
  const completedFullKm = splits.length;
  const remainderKm = totalDistKm - completedFullKm;
  if (remainderKm >= 0.05 && splits.length < MAX_KM_SPLITS) {
    const clampedRemDist = Math.min(2, Math.round(remainderKm * 100) / 100);
    const remSec = Math.min(
      7200,
      Math.max(1, Math.round((activeElapsedMs - splitStartActiveMs) / 1000)),
    );
    const paceSec = Math.min(
      3600,
      Math.max(1, Math.round(remSec / Math.max(0.05, remainderKm))),
    );
    const avgSplitHr =
      splitHrCount > 0 ? Math.round(splitHrSum / splitHrCount) : undefined;

    splits.push({
      km: splits.length + 1,
      distanceKm: clampedRemDist,
      durationSec: remSec,
      paceSecPerKm: paceSec,
      paceStr: formatPace(paceSec),
      ...(avgSplitHr !== undefined ? { hr: avgSplitHr } : {}),
    });
  }

  if (splits.length === 0) {
    throw new Error('GPX distance is too short (minimum 0.05 km required).');
  }

  const totalDistRounded = Math.min(250, Math.max(0.05, Math.round(totalDistKm * 100) / 100));
  const totalDurationSec = Math.min(
    86400,
    Math.max(1, Math.round(activeElapsedMs / 1000)),
  );
  const overallPaceSec = Math.min(
    3600,
    Math.max(1, Math.round(totalDurationSec / totalDistRounded)),
  );
  if (rawTelemetry.length > 0) {
    rawTelemetry[0].paceSec = Math.min(3600, Math.max(60, overallPaceSec));
  }

  // Compute smoothed elevation gain (1.2m hysteresis)
  let elevationGainM = 0;
  if (rawTelemetry.length >= 2) {
    let lastAnchorEle = rawTelemetry[0].ele;
    for (let i = 1; i < rawTelemetry.length; i += 1) {
      const prevE = rawTelemetry[Math.max(0, i - 1)].ele;
      const nextE = rawTelemetry[Math.min(rawTelemetry.length - 1, i + 1)].ele;
      const smoothE = 0.25 * prevE + 0.5 * rawTelemetry[i].ele + 0.25 * nextE;
      if (smoothE - lastAnchorEle >= 1.2) {
        elevationGainM += smoothE - lastAnchorEle;
        lastAnchorEle = smoothE;
      } else if (smoothE - lastAnchorEle <= -1.2) {
        lastAnchorEle = smoothE;
      }
    }
  }

  const avgHr = totalHrCount > 0 ? Math.round(totalHrSum / totalHrCount) : undefined;
  const avgCadence = totalCadCount > 0 ? Math.round(totalCadSum / totalCadCount) : undefined;
  const routePoints = extractRouteSilhouette(
    movingSegments.length > 0 ? movingSegments : rawSegments,
  );
  const telemetryPoints = downsampleTelemetryPoints(rawTelemetry, MAX_TELEMETRY_POINTS);

  return {
    splits,
    routePoints,
    telemetryPoints,
    summary: {
      date: formatLocalIsoDateFromMs(startTimeMs || rawSegments[0][0].timeMs),
      distanceKm: totalDistRounded,
      durationSec: totalDurationSec,
      durationStr: formatDuration(totalDurationSec),
      paceSecPerKm: overallPaceSec,
      paceStr: formatPace(overallPaceSec),
      ...(avgHr !== undefined ? { avgHr } : {}),
      ...(avgCadence !== undefined ? { avgCadence } : {}),
      elevationGainM: Math.round(elevationGainM),
      fileType: 'gpx',
      trackpointCount: pointCount,
    },
  };
}

function perpendicularDistance(pt: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) {
    return Math.hypot(pt.x - a.x, pt.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(pt.x - projX, pt.y - projY);
}

function simplifyRdp(points: RoutePoint[], epsilon: number): RoutePoint[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyRdp(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyRdp(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

export function extractRouteSilhouette(
  segments: GpxTrackpoint[][],
  maxPoints = 92,
): RoutePoint[] {
  const flat: GpxTrackpoint[] = [];
  for (const seg of segments) {
    for (const pt of seg) {
      flat.push(pt);
    }
  }
  if (flat.length < 2) return [];

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const pt of flat) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lon < minLon) minLon = pt.lon;
    if (pt.lon > maxLon) maxLon = pt.lon;
  }

  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.max(0.15, Math.cos(toRad(midLat)));
  const widthKm = (maxLon - minLon) * 111.32 * cosLat;
  const heightKm = (maxLat - minLat) * 111.32;
  const span = Math.max(widthKm, heightKm);
  if (!Number.isFinite(span) || span < 0.005) {
    return [];
  }

  const normalized: RoutePoint[] = [];
  for (const pt of flat) {
    const dxKm = (pt.lon - minLon) * 111.32 * cosLat;
    const dyKm = (maxLat - pt.lat) * 111.32;
    const x = Math.min(1, Math.max(0, 0.5 + (dxKm - widthKm / 2) / span));
    const y = Math.min(1, Math.max(0, 0.5 + (dyKm - heightKm / 2) / span));
    const prev = normalized[normalized.length - 1];
    if (!prev || Math.hypot(x - prev.x, y - prev.y) >= 0.0015) {
      normalized.push({ x, y });
    }
  }
  if (normalized.length < 2) {
    const last = flat[flat.length - 1];
    const dxKm = (last.lon - minLon) * 111.32 * cosLat;
    const dyKm = (maxLat - last.lat) * 111.32;
    normalized.push({
      x: Math.min(1, Math.max(0, 0.5 + (dxKm - widthKm / 2) / span)),
      y: Math.min(1, Math.max(0, 0.5 + (dyKm - heightKm / 2) / span)),
    });
  }

  let simplified = normalized;
  let epsilon = 0.004;
  for (let attempt = 0; attempt < 10 && simplified.length > maxPoints; attempt += 1) {
    simplified = simplifyRdp(normalized, epsilon);
    epsilon *= 1.45;
  }

  if (simplified.length > maxPoints) {
    const sampled: RoutePoint[] = [];
    const step = (simplified.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i += 1) {
      sampled.push(simplified[Math.round(i * step)]);
    }
    simplified = sampled;
  }

  const rounded: RoutePoint[] = [];
  for (const pt of simplified) {
    const rx = Math.min(1, Math.max(0, Math.round(pt.x * 10000) / 10000));
    const ry = Math.min(1, Math.max(0, Math.round(pt.y * 10000) / 10000));
    const prev = rounded[rounded.length - 1];
    if (!prev || prev.x !== rx || prev.y !== ry) {
      rounded.push({ x: rx, y: ry });
    }
  }

  return rounded.length >= 2 ? rounded : [];
}

export function sanitizeRoutePoints(raw: unknown): RoutePoint[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const cleaned: RoutePoint[] = [];
  for (let i = 0; i < Math.min(raw.length, MAX_ROUTE_POINTS); i += 1) {
    const item = raw[i] as Record<string, unknown> | null | undefined;
    if (!item || typeof item !== 'object') continue;
    const rx = Number(item.x);
    const ry = Number(item.y);
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) continue;
    cleaned.push({
      x: Math.min(1, Math.max(0, Math.round(rx * 10000) / 10000)),
      y: Math.min(1, Math.max(0, Math.round(ry * 10000) / 10000)),
    });
  }
  return cleaned.length >= 2 ? cleaned : undefined;
}

export function sanitizeKmSplits(raw: unknown): KmSplit[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const cleaned: KmSplit[] = [];
  for (let i = 0; i < Math.min(raw.length, MAX_KM_SPLITS); i += 1) {
    const item = raw[i] as Record<string, unknown> | null | undefined;
    if (!item || typeof item !== 'object') continue;
    const km = Math.min(MAX_KM_SPLITS, Math.max(1, Math.round(Number(item.km) || i + 1)));
    const rawDist = Number(item.distanceKm);
    const distanceKm =
      Number.isFinite(rawDist) && rawDist > 0
        ? Math.min(2, Math.max(0.01, Math.round(rawDist * 100) / 100))
        : 1;
    const durationSec = Math.min(
      7200,
      Math.max(1, Math.round(Number(item.durationSec) || 300)),
    );
    const rawPace = Number(item.paceSecPerKm);
    const paceSecPerKm =
      Number.isFinite(rawPace) && rawPace > 0
        ? Math.min(3600, Math.max(1, Math.round(rawPace)))
        : Math.min(3600, Math.max(1, Math.round(durationSec / distanceKm)));
    const paceStr = formatPace(paceSecPerKm).slice(0, 12);
    const rawHr = Number(item.hr);
    const hr =
      Number.isFinite(rawHr) && rawHr >= 40 && rawHr <= 230
        ? Math.round(rawHr)
        : undefined;

    cleaned.push({
      km,
      distanceKm,
      durationSec,
      paceSecPerKm,
      paceStr,
      ...(hr !== undefined ? { hr } : {}),
    });
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

export function sanitizeTelemetryPoints(raw: unknown): TelemetryPoint[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const cleaned: TelemetryPoint[] = [];
  for (let i = 0; i < Math.min(raw.length, MAX_TELEMETRY_POINTS); i += 1) {
    const item = raw[i] as Record<string, unknown> | null | undefined;
    if (!item || typeof item !== 'object') continue;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const ele = Number(item.ele);
    const tSec = Number(item.tSec);
    const distKm = Number(item.distKm);
    const paceSec = Number(item.paceSec);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(ele) ||
      !Number.isFinite(tSec) ||
      !Number.isFinite(distKm) ||
      !Number.isFinite(paceSec)
    ) {
      continue;
    }

    const rawHr = Number(item.hr);
    const hr =
      Number.isFinite(rawHr) && rawHr >= 40 && rawHr <= 230
        ? Math.round(rawHr)
        : undefined;
    const rawCad = Number(item.cad);
    const cad =
      Number.isFinite(rawCad) && rawCad >= 80 && rawCad <= 240
        ? Math.round(rawCad)
        : undefined;

    cleaned.push({
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      ele: Math.min(9000, Math.max(-500, Math.round(ele * 10) / 10)),
      tSec: Math.min(86400, Math.max(0, Math.round(tSec))),
      distKm: Math.min(250, Math.max(0, Math.round(distKm * 1000) / 1000)),
      paceSec: Math.min(3600, Math.max(60, Math.round(paceSec))),
      ...(hr !== undefined ? { hr } : {}),
      ...(cad !== undefined ? { cad } : {}),
    });
  }
  return cleaned.length >= 2 ? cleaned : undefined;
}
