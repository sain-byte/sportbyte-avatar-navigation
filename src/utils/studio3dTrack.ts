import type { KmSplit, RunLog } from '../types';
import type {
  Studio3DLandmark,
  Studio3DTrack,
  Studio3DTrackPoint,
} from '../types/studio3d';
import { haversineDistanceKm } from './gpxParser';
import {
  cleanRawGeoSamples,
  latLonToMetricLocal,
  sampleTrackPointByDistance,
  simplifyGeoSamplesAdaptive,
} from './studio3dGpsEngine';

export interface RawGeoSample {
  lat: number;
  lon: number;
  elevationM?: number;
  timeMs: number;
  hr?: number;
  cadence?: number;
  distanceKm?: number;
  paceSecPerKm?: number;
}

export interface AthleteBioHints {
  restingHr?: number;
  maxHr?: number;
  strideCm?: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function smoothSeries3(values: number[]): number[] {
  if (values.length < 3) return values;
  return values.map((val, idx) => {
    const prev = values[Math.max(0, idx - 1)];
    const next = values[Math.min(values.length - 1, idx + 1)];
    return 0.25 * prev + 0.5 * val + 0.25 * next;
  });
}

function formatLocalIsoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inferCityFromCoords(lat: number, lon: number): string {
  // Recognizable Indonesian & global hubs fallback; clean GPS coordinate fallback otherwise
  if (lat >= -6.4 && lat <= -6.05 && lon >= 106.65 && lon <= 107.05) {
    return 'Jakarta, ID';
  }
  if (lat >= -7.0 && lat <= -6.8 && lon >= 107.45 && lon <= 107.75) {
    return 'Bandung, ID';
  }
  if (lat >= -7.9 && lat <= -7.65 && lon >= 110.25 && lon <= 110.5) {
    return 'Yogyakarta, ID';
  }
  if (lat >= -8.85 && lat <= -8.3 && lon >= 114.9 && lon <= 115.65) {
    return 'Bali, ID';
  }
  if (lat >= -7.4 && lat <= -7.15 && lon >= 112.6 && lon <= 112.85) {
    return 'Surabaya, ID';
  }
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

function fillMissingFromNeighbors(values: Array<number | undefined>): number[] | null {
  const firstValid = values.find((v) => v !== undefined);
  if (firstValid === undefined) return null;
  const out = new Array<number>(values.length);
  let last = firstValid;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] !== undefined) {
      last = values[i] as number;
    }
    out[i] = last;
  }
  return out;
}

export function buildStudio3DTrackFromRaw(options: {
  samples: RawGeoSample[];
  source: Studio3DTrack['source'];
  title: string;
  date?: string;
  location?: string;
  overrideDistanceKm?: number;
  overrideDurationSec?: number;
  athleteBio?: AthleteBioHints;
  fallbackAvgHr?: number;
  fallbackCadence?: number;
  kmSplits?: KmSplit[];
  hasRealHrOverride?: boolean;
  hasRealCadenceOverride?: boolean;
}): Studio3DTrack {
  const sorted = cleanRawGeoSamples(options.samples);
  if (sorted.length < 2) {
    throw new Error('Track needs at least 2 valid GPS points.');
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  // Compute cumulative distance and smooth elevation on full cleaned sequence before adaptive simplification
  let cumDistKm = 0;
  let activeElapsedSec = 0;
  const fullDistKm: number[] = [0];
  const fullElapsedSec: number[] = [0];
  const rawEle: number[] = [sorted[0].elevationM ?? 15];

  for (let i = 0; i < sorted.length; i += 1) {
    const s = sorted[i];
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;

    if (i > 0) {
      const prev = sorted[i - 1];
      const segKm = haversineDistanceKm(prev.lat, prev.lon, s.lat, s.lon);
      const dtSec = Math.max(0, (s.timeMs - prev.timeMs) / 1000);
      const speedMps = dtSec > 0 ? (segKm * 1000) / dtSec : 0;

      // Ignore teleport spikes and huge pause gaps (> 45s) while counting running movement
      if (segKm < 2.5 && speedMps <= 13.5) {
        cumDistKm += segKm;
      }
      if (dtSec > 0 && dtSec <= 45) {
        activeElapsedSec += dtSec;
      } else if (dtSec > 45 && segKm > 0.02) {
        activeElapsedSec += Math.min(45, Math.round(segKm * 360));
      }
      fullDistKm.push(cumDistKm);
      fullElapsedSec.push(activeElapsedSec);
      rawEle.push(s.elevationM ?? rawEle[rawEle.length - 1]);
    }
  }

  // Smooth elevation slightly (3-point moving window) & compute positive elevation gain (1.2m hysteresis)
  const smoothedEle = smoothSeries3(rawEle);

  let elevationGainM = 0;
  let lastEleAnchor = smoothedEle[0];
  for (let i = 1; i < smoothedEle.length; i += 1) {
    const diff = smoothedEle[i] - lastEleAnchor;
    if (diff >= 1.2) {
      elevationGainM += diff;
      lastEleAnchor = smoothedEle[i];
    } else if (diff <= -1.2) {
      lastEleAnchor = smoothedEle[i];
    }
  }

  // Attach derived cumulative metrics back to samples prior to direction-aware simplification
  const enrichedRaw: RawGeoSample[] = sorted.map((s, idx) => ({
    ...s,
    elevationM: Math.round(smoothedEle[idx] * 10) / 10,
    distanceKm: s.distanceKm !== undefined && s.distanceKm > 0 ? s.distanceKm : fullDistKm[idx],
    timeMs: sorted[0].timeMs + fullElapsedSec[idx] * 1000,
  }));

  const rawDistForBudget =
    options.overrideDistanceKm && options.overrideDistanceKm > 0.05
      ? options.overrideDistanceKm
      : cumDistKm;
  const sampled = simplifyGeoSamplesAdaptive(enrichedRaw, rawDistForBudget);
  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  const cosLat = Math.max(0.15, Math.cos(toRad(centerLat)));
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * cosLat;

  const spanX = (maxLon - minLon) * metersPerDegLon;
  const spanZ = (maxLat - minLat) * metersPerDegLat;
  const spanMeters = Math.max(250, spanX, spanZ);

  const rawMaxDistKm = sampled[sampled.length - 1].distanceKm ?? cumDistKm;
  const totalDistanceKm =
    options.overrideDistanceKm && options.overrideDistanceKm > 0.05
      ? options.overrideDistanceKm
      : Math.max(0.1, Math.round(rawMaxDistKm * 100) / 100);
  const rawMaxDurSec = Math.max(1, (sampled[sampled.length - 1].timeMs - sampled[0].timeMs) / 1000);
  const totalDurationSec =
    options.overrideDurationSec && options.overrideDurationSec > 10
      ? options.overrideDurationSec
      : Math.max(10, Math.round(rawMaxDurSec));

  const distScale = rawMaxDistKm > 0.01 ? totalDistanceKm / rawMaxDistKm : 1;
  const durScale = rawMaxDurSec > 1 ? totalDurationSec / rawMaxDurSec : 1;
  const avgPaceSecPerKm = Math.round(totalDurationSec / Math.max(0.05, totalDistanceKm));

  let minEle = Infinity;
  let maxEle = -Infinity;

  const baseCoords = sampled.map((s, idx) => {
    const { xM, zM } = latLonToMetricLocal(s.lat, s.lon, centerLat, centerLon);
    const elevationM = s.elevationM ?? 15;
    if (elevationM < minEle) minEle = elevationM;
    if (elevationM > maxEle) maxEle = elevationM;

    const elapsedSec = Math.round(((s.timeMs - sampled[0].timeMs) / 1000) * durScale);
    const distanceKm = Math.round((s.distanceKm ?? 0) * distScale * 1000) / 1000;

    let paceSecPerKm = s.paceSecPerKm ?? avgPaceSecPerKm;
    if (s.paceSecPerKm === undefined && idx > 0) {
      const lookBack = Math.max(0, idx - 3);
      const dKm = Math.max(0.005, ((s.distanceKm ?? 0) - (sampled[lookBack].distanceKm ?? 0)) * distScale);
      const dSec = Math.max(1, ((s.timeMs - sampled[lookBack].timeMs) / 1000) * durScale);
      const est = Math.round(dSec / dKm);
      if (est >= 140 && est <= 1200) {
        paceSecPerKm = est;
      }
    }

    return {
      lat: s.lat,
      lon: s.lon,
      xM,
      zM,
      elevationM,
      elapsedSec,
      distanceKm,
      paceSecPerKm: clamp(Math.round(paceSecPerKm), 140, 1200),
      rawHr: s.hr,
      rawCadence: s.cadence,
    };
  });

  // Compute local terrain slope (%) around +/-2 samples for physiological HR & cadence modeling
  const localGrades = baseCoords.map((pt, idx) => {
    const i0 = Math.max(0, idx - 2);
    const i1 = Math.min(baseCoords.length - 1, idx + 2);
    const dMeters = Math.max(10, (baseCoords[i1].distanceKm - baseCoords[i0].distanceKm) * 1000);
    const dEle = baseCoords[i1].elevationM - baseCoords[i0].elevationM;
    return clamp((dEle / dMeters) * 100, -15, 15);
  });

  // 1) Resolve Heart Rate: preserve authentic sensor telemetry when available, or synthesize realistic physiology
  const hasRealHr =
    options.hasRealHrOverride ?? sampled.some((s) => s.hr !== undefined);
  const filledRawHr = hasRealHr
    ? fillMissingFromNeighbors(baseCoords.map((p) => p.rawHr))
    : null;

  let resolvedHrSeries: number[];
  if (filledRawHr) {
    resolvedHrSeries = filledRawHr.map((v) => clamp(Math.round(v), 40, 230));
  } else {
    const restHr = clamp(options.athleteBio?.restingHr ?? 56, 35, 110);
    const maxHr = clamp(options.athleteBio?.maxHr ?? 192, 130, 230);
    const hrMinBound = Math.max(70, restHr + 20);
    const hrMaxBound = Math.max(hrMinBound + 15, maxHr - 1);
    const targetAvgHr =
      options.fallbackAvgHr && options.fallbackAvgHr >= 40 && options.fallbackAvgHr <= 230
        ? options.fallbackAvgHr
        : Math.round(restHr + (maxHr - restHr) * 0.72);

    const rawSynthHr = baseCoords.map((pt, idx) => {
      const t = idx / Math.max(1, baseCoords.length - 1);
      const warmup = -13 * Math.exp(-t * 5.2);
      const drift = 9 * Math.pow(t, 1.15);
      const paceRatio = avgPaceSecPerKm / Math.max(140, pt.paceSecPerKm);
      const effortDelta = clamp((paceRatio - 1) * 36, -14, 18);
      const uphillBoost = clamp(localGrades[idx] * 1.45, -5, 14);
      const kick = t > 0.86 ? ((t - 0.86) / 0.14) * 5 : 0;
      const microWave = Math.sin(t * Math.PI * 10) * 1.8;

      let synth = targetAvgHr + warmup + drift + effortDelta + uphillBoost + kick + microWave;
      if (options.kmSplits && options.kmSplits.length > 0) {
        const kmIdx = Math.min(options.kmSplits.length - 1, Math.floor(pt.distanceKm));
        const splitHr = options.kmSplits[kmIdx]?.hr;
        if (splitHr !== undefined && splitHr >= 40 && splitHr <= 230) {
          synth = splitHr * 0.6 + synth * 0.4;
        }
      }
      return synth;
    });

    // Re-center mean slightly toward targetAvgHr unless per-KM HR anchors were explicitly present
    const hasSplitHrs = Boolean(options.kmSplits?.some((sp) => sp.hr !== undefined));
    const synthMean = rawSynthHr.reduce((sum, v) => sum + v, 0) / rawSynthHr.length;
    const shift = hasSplitHrs ? 0 : targetAvgHr - synthMean;
    const smoothedSynthHr = smoothSeries3(
      rawSynthHr.map((v) => clamp(v + shift, hrMinBound, hrMaxBound)),
    );
    resolvedHrSeries = smoothedSynthHr.map((v) => clamp(Math.round(v), 40, 230));
  }

  // 2) Resolve Cadence: preserve authentic sensor telemetry when available, or synthesize dynamic stride turnover
  const hasRealCadence =
    options.hasRealCadenceOverride ?? sampled.some((s) => s.cadence !== undefined);
  const filledRawCadence = hasRealCadence
    ? fillMissingFromNeighbors(baseCoords.map((p) => p.rawCadence))
    : null;

  let resolvedCadenceSeries: number[];
  if (filledRawCadence) {
    resolvedCadenceSeries = filledRawCadence.map((v) => clamp(Math.round(v), 80, 240));
  } else {
    let baseCadence =
      options.fallbackCadence && options.fallbackCadence >= 80 && options.fallbackCadence <= 240
        ? options.fallbackCadence
        : 0;
    if (!baseCadence) {
      const strideM = (options.athleteBio?.strideCm ?? 102) / 100;
      const avgSpeedMpm = (1000 / Math.max(150, avgPaceSecPerKm)) * 60;
      const estCad = Math.round(avgSpeedMpm / Math.max(0.55, strideM));
      baseCadence = clamp(estCad, 152, 192);
    }

    const rawSynthCad = baseCoords.map((pt, idx) => {
      const t = idx / Math.max(1, baseCoords.length - 1);
      const speedMod = clamp((avgPaceSecPerKm / Math.max(140, pt.paceSecPerKm) - 1) * 28, -10, 14);
      const gradeMod = clamp(-localGrades[idx] * 0.45, -4, 5);
      const finishKick = t > 0.85 ? ((t - 0.85) / 0.15) * 4 : 0;
      const microWave = Math.sin(t * Math.PI * 8) * 2.4;
      return baseCadence + speedMod + gradeMod + finishKick + microWave;
    });

    const cadMean = rawSynthCad.reduce((sum, v) => sum + v, 0) / rawSynthCad.length;
    const cadShift = baseCadence - cadMean;
    const smoothedSynthCad = smoothSeries3(
      rawSynthCad.map((v) => clamp(v + cadShift, 135, 215)),
    );
    resolvedCadenceSeries = smoothedSynthCad.map((v) => clamp(Math.round(v), 135, 215));
  }

  let hrSum = 0;
  let cadSum = 0;
  const points: Studio3DTrackPoint[] = baseCoords.map((pt, idx) => {
    const hr = resolvedHrSeries[idx];
    const cadence = resolvedCadenceSeries[idx];
    hrSum += hr;
    cadSum += cadence;
    return {
      lat: pt.lat,
      lon: pt.lon,
      xM: pt.xM,
      zM: pt.zM,
      elevationM: pt.elevationM,
      elapsedSec: pt.elapsedSec,
      distanceKm: pt.distanceKm,
      paceSecPerKm: pt.paceSecPerKm,
      hr,
      cadence,
    };
  });

  const avgHr = Math.round(hrSum / points.length);
  const avgCadence = Math.round(cadSum / points.length);

  // Build automatic Landmarks: Start, KM markers, Peak Elevation, Finish
  const landmarks: Studio3DLandmark[] = [
    {
      id: 'lm-start',
      label: 'START',
      type: 'start',
      progress: 0,
      distanceKm: 0,
      elevationM: Math.round(points[0].elevationM),
    },
  ];

  // KM landmarks (every 1 km up to 5 markers for clean viewport) anchored by cumulative distance
  const maxPointDistKm = Math.max(0.01, points[points.length - 1].distanceKm || totalDistanceKm);
  const wholeKms = Math.floor(totalDistanceKm);
  const kmStep = wholeKms > 10 ? Math.ceil(wholeKms / 5) : wholeKms > 5 ? 2 : 1;
  for (let km = kmStep; km < totalDistanceKm - 0.15; km += kmStep) {
    const idx = points.findIndex((p) => p.distanceKm >= km);
    if (idx > 0 && idx < points.length - 1) {
      landmarks.push({
        id: `lm-km-${km}`,
        label: `KM ${km}`,
        type: 'km',
        progress: Math.min(0.99, Math.max(0.01, km / maxPointDistKm)),
        distanceKm: km,
        elevationM: Math.round(points[idx].elevationM),
      });
    }
  }

  // Peak elevation landmark if elevation range >= 8m
  if (maxEle - minEle >= 8) {
    let peakIdx = 0;
    for (let i = 0; i < points.length; i += 1) {
      if (points[i].elevationM >= maxEle - 0.05) {
        peakIdx = i;
        break;
      }
    }
    if (peakIdx > 2 && peakIdx < points.length - 2) {
      landmarks.push({
        id: 'lm-peak',
        label: `PUNCAK ${Math.round(maxEle)}m`,
        type: 'peak',
        progress: Math.min(
          0.99,
          Math.max(0.01, points[peakIdx].distanceKm / maxPointDistKm),
        ),
        distanceKm: Math.round(points[peakIdx].distanceKm * 10) / 10,
        elevationM: Math.round(points[peakIdx].elevationM),
      });
    }
  }

  landmarks.push({
    id: 'lm-finish',
    label: 'FINISH',
    type: 'finish',
    progress: 1,
    distanceKm: totalDistanceKm,
    elevationM: Math.round(points[points.length - 1].elevationM),
  });

  return {
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: options.title,
    date: options.date ?? formatLocalIsoDate(sorted[0].timeMs),
    location: options.location ?? inferCityFromCoords(centerLat, centerLon),
    source: options.source,
    points,
    totalDistanceKm,
    totalDurationSec,
    avgPaceSecPerKm,
    avgHr,
    avgCadence,
    elevationGainM: Math.round(elevationGainM),
    minElevationM: Math.round(minEle),
    maxElevationM: Math.round(maxEle),
    centerLat,
    centerLon,
    minLat,
    maxLat,
    minLon,
    maxLon,
    spanMeters,
    landmarks,
  };
}

function getTagText(node: Element, names: string[]): string | undefined {
  for (const name of names) {
    const byTag = node.getElementsByTagName(name)[0] ?? node.getElementsByTagNameNS('*', name)[0];
    const txt = byTag?.textContent?.trim();
    if (txt) return txt;
  }
  return undefined;
}

export function parseGpxToStudio3DTrack(
  xmlText: string,
  fileName = 'run.gpx',
  athleteBio?: AthleteBioHints,
): Studio3DTrack {
  const trimmed = String(xmlText ?? '').trim();
  if (!trimmed || !/<gpx[\s>]/i.test(trimmed)) {
    throw new Error('File bukan format .GPX yang valid.');
  }

  let docName = '';
  const samples: RawGeoSample[] = [];

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Struktur XML .GPX rusak atau tidak valid.');
    }

    const trk = doc.getElementsByTagName('trk')[0] ?? doc.getElementsByTagNameNS('*', 'trk')[0];
    docName = trk ? getTagText(trk, ['name']) ?? '' : '';

    let ptNodes = Array.from(doc.getElementsByTagName('trkpt'));
    if (ptNodes.length === 0) {
      ptNodes = Array.from(doc.getElementsByTagNameNS('*', 'trkpt'));
    }

    for (const node of ptNodes) {
      const lat = Number(node.getAttribute('lat'));
      const lon = Number(node.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const timeStr = getTagText(node, ['time']);
      const timeMs = timeStr ? Date.parse(timeStr) : NaN;
      if (!Number.isFinite(timeMs)) continue;

      const eleStr = getTagText(node, ['ele']);
      const eleNum = eleStr !== undefined ? Number(eleStr) : NaN;
      const hrStr = getTagText(node, ['hr', 'heartrate']);
      const hrNum = hrStr !== undefined ? Math.round(Number(hrStr)) : NaN;
      const cadStr = getTagText(node, ['cad', 'cadence']);
      const rawCadNum = cadStr !== undefined ? Math.round(Number(cadStr)) : NaN;
      const cadenceNum =
        Number.isFinite(rawCadNum) && rawCadNum > 30
          ? rawCadNum < 120
            ? rawCadNum * 2
            : rawCadNum
          : NaN;

      samples.push({
        lat,
        lon,
        elevationM: Number.isFinite(eleNum) ? eleNum : 15,
        timeMs,
        ...(Number.isFinite(hrNum) && hrNum >= 40 && hrNum <= 230 ? { hr: hrNum } : {}),
        ...(Number.isFinite(cadenceNum) && cadenceNum >= 80 && cadenceNum <= 240
          ? { cadence: cadenceNum }
          : {}),
      });
    }
  } else {
    // Regex fallback for Node test runtime without DOMParser
    const trkNameMatch = trimmed.match(/<trk\b[^>]*>[\s\S]*?<name>([^<]+)<\/name>/i);
    docName = trkNameMatch?.[1]?.trim() ?? '';
    const trkptRegex = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
    let m: RegExpExecArray | null;
    while ((m = trkptRegex.exec(trimmed)) !== null) {
      const attrs = m[1];
      const inner = m[2];
      const latM = attrs.match(/lat=["']([^"']+)["']/i);
      const lonM = attrs.match(/lon=["']([^"']+)["']/i);
      const timeM = inner.match(/<time>([^<]+)<\/time>/i);
      if (!latM || !lonM || !timeM) continue;
      const lat = Number(latM[1]);
      const lon = Number(lonM[1]);
      const timeMs = Date.parse(timeM[1].trim());
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timeMs)) continue;
      const eleM = inner.match(/<ele>([^<]+)<\/ele>/i);
      const hrM = inner.match(/<(?:[a-z0-9]+:)?hr>([^<]+)<\/(?:[a-z0-9]+:)?hr>/i);
      const cadM = inner.match(/<(?:[a-z0-9]+:)?cad(?:ence)?>([^<]+)<\/(?:[a-z0-9]+:)?cad(?:ence)?>/i);
      const ele = eleM ? Number(eleM[1]) : 15;
      const hr = hrM ? Math.round(Number(hrM[1])) : undefined;
      const rawCad = cadM ? Math.round(Number(cadM[1])) : undefined;
      const cadence =
        rawCad !== undefined && Number.isFinite(rawCad)
          ? rawCad < 120
            ? rawCad * 2
            : rawCad
          : undefined;
      samples.push({
        lat,
        lon,
        elevationM: Number.isFinite(ele) ? ele : 15,
        timeMs,
        ...(hr && hr >= 40 && hr <= 230 ? { hr } : {}),
        ...(cadence && cadence >= 80 && cadence <= 240 ? { cadence } : {}),
      });
    }
  }

  if (samples.length < 2) {
    throw new Error('File .GPX memerlukan minimal 2 titik <trkpt> dengan <time>.');
  }

  const baseName = fileName.replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ').trim();
  return buildStudio3DTrackFromRaw({
    samples,
    source: 'gpx',
    title: docName || baseName || 'GPX Outdoor Run',
    athleteBio,
  });
}

/**
 * Picks the newest saved run that contains authentic GPS telemetryPoints (>= 2).
 * Returns null when no GPS run exists so Studio 3D never injects a fake sample map.
 */
export function pickInitialGpsTrackFromRuns(
  runs: RunLog[],
  city = 'Indonesia',
  athleteBio?: AthleteBioHints,
): { runId: string; track: Studio3DTrack } | null {
  const gpsRun = runs.find(
    (r) => Array.isArray(r.telemetryPoints) && r.telemetryPoints.length >= 2,
  );
  if (!gpsRun) return null;
  return {
    runId: gpsRun.id,
    track: createTrackFromRunLog(gpsRun, city, athleteBio),
  };
}

/**
 * Converts a saved Sport Byte RunLog into a 3D animated track.
 * Prioritizes authentic saved telemetryPoints (real GPS, elevation, elapsed time, and sensor HR/cadence),
 * or falls back to saved routePoints silhouette with physiological live HR & cadence curves.
 */
export function createTrackFromRunLog(
  run: RunLog,
  city = 'Jakarta, ID',
  athleteBio?: AthleteBioHints,
): Studio3DTrack {
  const startMs = Date.parse(`${run.date}T06:00:00Z`) || Date.now();
  const bioHints: AthleteBioHints = {
    restingHr: athleteBio?.restingHr,
    maxHr: athleteBio?.maxHr,
    strideCm: run.strideCm || athleteBio?.strideCm,
  };

  if (run.telemetryPoints && run.telemetryPoints.length >= 2) {
    const samples: RawGeoSample[] = run.telemetryPoints.map((pt) => ({
      lat: pt.lat,
      lon: pt.lon,
      elevationM: pt.ele,
      timeMs: startMs + pt.tSec * 1000,
      distanceKm: pt.distKm,
      paceSecPerKm: pt.paceSec,
      ...(pt.hr !== undefined ? { hr: pt.hr } : {}),
      ...(pt.cad !== undefined ? { cadence: pt.cad } : {}),
    }));

    return buildStudio3DTrackFromRaw({
      samples,
      source: 'history',
      title: `${run.category} (${run.distanceKm.toFixed(2)} km)`,
      date: run.date,
      // Omit location override so authentic GPS center infers city/coords cleanly unless blank
      ...(city && city !== 'Indonesia' ? { location: city } : {}),
      overrideDistanceKm: run.distanceKm,
      overrideDurationSec: run.durationSec,
      athleteBio: bioHints,
      fallbackAvgHr: run.hr,
      fallbackCadence: run.cadence,
      kmSplits: run.kmSplits,
    });
  }

  const baseLat = -6.2186;
  const baseLon = 106.8024;
  const routeShape =
    run.routePoints && run.routePoints.length >= 2
      ? run.routePoints
      : Array.from({ length: 72 }, (_, idx) => {
          const a = (idx / 71) * Math.PI * 2;
          return {
            x: 0.5 + Math.cos(a) * 0.42,
            y: 0.5 + Math.sin(a) * (0.32 + 0.08 * Math.sin(a * 2)),
          };
        });

  // Approximate geographic footprint scaled proportionally to run.distanceKm
  const radiusDeg = Math.max(0.0025, Math.min(0.06, run.distanceKm * 0.0024));
  const samples: RawGeoSample[] = routeShape.map((pt, idx) => {
    const t = idx / (routeShape.length - 1);
    const lat = baseLat + (0.5 - pt.y) * radiusDeg * 2;
    const lon = baseLon + (pt.x - 0.5) * radiusDeg * 2;
    const elevationM = 16 + 12 * Math.sin(t * Math.PI * 2.5) + 4 * Math.cos(t * Math.PI * 5);

    const currentDist = t * run.distanceKm;
    const matchedSplit = run.kmSplits?.find(
      (sp, sIdx) =>
        currentDist <= sIdx + sp.distanceKm || sIdx === (run.kmSplits?.length ?? 1) - 1,
    );

    return {
      lat,
      lon,
      elevationM,
      timeMs: startMs + Math.round(t * run.durationSec * 1000),
      paceSecPerKm: matchedSplit?.paceSecPerKm ?? run.paceSecPerKm,
    };
  });

  return buildStudio3DTrackFromRaw({
    samples,
    source: 'history',
    title: `${run.category} (${run.distanceKm.toFixed(2)} km)`,
    date: run.date,
    location: city || 'Jakarta, ID',
    overrideDistanceKm: run.distanceKm,
    overrideDurationSec: run.durationSec,
    athleteBio: bioHints,
    fallbackAvgHr: run.hr,
    fallbackCadence: run.cadence,
    kmSplits: run.kmSplits,
    hasRealHrOverride: false,
    hasRealCadenceOverride: false,
  });
}

/**
 * Re-projects a Studio3DTrack onto road-matched coordinates returned by OSRM while
 * preserving the original run metadata, center projection, elevation, and HR/cadence telemetry.
 */
export function buildSnappedTrackFromCoordinates(
  baseTrack: Studio3DTrack,
  snappedCoords: Array<{ lat: number; lon: number }>,
): Studio3DTrack {
  if (!Array.isArray(snappedCoords) || snappedCoords.length < 2) {
    return baseTrack;
  }

  const cumKm: number[] = [0];
  let totalSnappedKm = 0;
  for (let i = 1; i < snappedCoords.length; i += 1) {
    const prev = snappedCoords[i - 1];
    const curr = snappedCoords[i];
    const segKm = haversineDistanceKm(prev.lat, prev.lon, curr.lat, curr.lon);
    totalSnappedKm += segKm;
    cumKm.push(totalSnappedKm);
  }

  if (totalSnappedKm < 0.02) {
    return baseTrack;
  }

  const points: Studio3DTrackPoint[] = snappedCoords.map((coord, idx) => {
    const progress = cumKm[idx] / totalSnappedKm;
    const sampled = sampleTrackPointByDistance(baseTrack.points, baseTrack.totalDistanceKm, progress);
    const { xM, zM } = latLonToMetricLocal(
      coord.lat,
      coord.lon,
      baseTrack.centerLat,
      baseTrack.centerLon,
    );
    return {
      lat: coord.lat,
      lon: coord.lon,
      xM,
      zM,
      elevationM: sampled.elevationM,
      elapsedSec: sampled.elapsedSec,
      distanceKm: Math.round(progress * baseTrack.totalDistanceKm * 1000) / 1000,
      paceSecPerKm: sampled.paceSecPerKm,
      hr: sampled.hr,
      cadence: sampled.cadence,
    };
  });

  return {
    ...baseTrack,
    points,
  };
}

/**
 * Calls server-side /api/map-match proxy to align GPS coordinates to real OSM roads/footpaths.
 * Returns original track gracefully if matching is unavailable.
 */
export async function fetchRoadSnappedTrack(
  baseTrack: Studio3DTrack,
  signal?: AbortSignal,
): Promise<{ track: Studio3DTrack; matched: boolean }> {
  if (baseTrack.points.length < 2) {
    return { track: baseTrack, matched: false };
  }
  try {
    const resp = await fetch('/api/map-match', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: baseTrack.points.map((pt) => ({ lat: pt.lat, lon: pt.lon })),
      }),
    });
    if (!resp.ok) {
      return { track: baseTrack, matched: false };
    }
    const payload = (await resp.json()) as {
      matched?: boolean;
      coordinates?: Array<{ lat: number; lon: number }>;
    };
    if (!payload.matched || !Array.isArray(payload.coordinates) || payload.coordinates.length < 2) {
      return { track: baseTrack, matched: false };
    }
    return {
      track: buildSnappedTrackFromCoordinates(baseTrack, payload.coordinates),
      matched: true,
    };
  } catch {
    return { track: baseTrack, matched: false };
  }
}
