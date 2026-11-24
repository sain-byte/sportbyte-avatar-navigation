import type { KmSplit, TelemetryPoint } from '../types';
import type { Studio3DTrack } from '../types/studio3d';
import {
  downsampleTelemetryPoints,
  extractRouteSilhouette,
  haversineDistanceKm,
  MAX_KM_SPLITS,
  MAX_TELEMETRY_POINTS,
  type ParsedGpxResult,
} from './gpxParser';
import { formatDuration, formatPace } from './runParser';
import {
  buildStudio3DTrackFromRaw,
  type AthleteBioHints,
  type RawGeoSample,
} from './studio3dTrack';

// Garmin / ANT+ FIT epoch starts at 1989-12-31T00:00:00Z (631065600 sec after Unix epoch)
const FIT_EPOCH_OFFSET_SEC = 631065600;
const SEMICIRCLES_TO_DEGREES = 180 / 2147483648; // 180 / 2^31

interface FitFieldDef {
  defNum: number;
  size: number;
  baseType: number;
}

interface FitMessageDef {
  globalMsgNum: number;
  littleEndian: boolean;
  fields: FitFieldDef[];
  devDataSize: number;
}

interface DecodedFitResult {
  rawSamples: RawGeoSample[];
  sessionStartIso: string | null;
  sessionSportName: string;
  sessionTotalDistKm: number | null;
  sessionTotalDurSec: number | null;
}

function getInvalidSentinel(baseType: number): number | null {
  switch (baseType & 0x1f) {
    case 0: // enum
    case 2: // uint8
    case 10: // uint8z
      return 0xff;
    case 1: // sint8
      return 0x7f;
    case 3: // sint16
      return 0x7fff;
    case 4: // uint16
    case 11: // uint16z
      return 0xffff;
    case 5: // sint32
      return 0x7fffffff;
    case 6: // uint32
    case 12: // uint32z
      return 0xffffffff;
    default:
      return null;
  }
}

function readFitValue(
  view: DataView,
  offset: number,
  size: number,
  baseType: number,
  littleEndian: boolean,
): number | null {
  const typeId = baseType & 0x1f;
  if (offset + size > view.byteLength) return null;

  let val: number | null = null;
  try {
    switch (typeId) {
      case 0: // enum
      case 2: // uint8
      case 10: // uint8z
        if (size >= 1) val = view.getUint8(offset);
        break;
      case 1: // sint8
        if (size >= 1) val = view.getInt8(offset);
        break;
      case 3: // sint16
        if (size >= 2) val = view.getInt16(offset, littleEndian);
        break;
      case 4: // uint16
      case 11: // uint16z
        if (size >= 2) val = view.getUint16(offset, littleEndian);
        break;
      case 5: // sint32
        if (size >= 4) val = view.getInt32(offset, littleEndian);
        break;
      case 6: // uint32
      case 12: // uint32z
        if (size >= 4) val = view.getUint32(offset, littleEndian);
        break;
      case 8: // float32
        if (size >= 4) val = view.getFloat32(offset, littleEndian);
        break;
      case 9: // float64
        if (size >= 8) val = view.getFloat64(offset, littleEndian);
        break;
      default:
        return null;
    }
  } catch {
    return null;
  }

  if (val === null || !Number.isFinite(val)) return null;
  const invalid = getInvalidSentinel(baseType);
  if (invalid !== null && val === invalid) return null;
  if (typeId === 10 || typeId === 11 || typeId === 12) {
    if (val === 0) return null;
  }
  return val;
}

function decodeFitRecords(buffer: ArrayBuffer): DecodedFitResult {
  if (buffer.byteLength < 14) {
    throw new Error('File .FIT terlalu kecil atau tidak valid.');
  }

  const view = new DataView(buffer);
  const headerSize = view.getUint8(0);
  if (headerSize < 12 || headerSize > buffer.byteLength) {
    throw new Error('Header file .FIT tidak valid.');
  }

  const sig = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );
  if (sig !== '.FIT') {
    throw new Error('File bukan format ANT+/Garmin .FIT yang valid.');
  }

  const dataSize = view.getUint32(4, true);
  const dataEnd = Math.min(buffer.byteLength, headerSize + dataSize);
  let pos = headerSize;

  const definitions = new Map<number, FitMessageDef>();
  const rawSamples: RawGeoSample[] = [];

  let lastTimestampSec = 0;
  let sessionStartIso: string | null = null;
  let sessionSportName = '';
  let sessionTotalDistKm: number | null = null;
  let sessionTotalDurSec: number | null = null;

  while (pos < dataEnd) {
    const header = view.getUint8(pos);
    pos += 1;

    // Compressed timestamp header (bit 7 == 1)
    if ((header & 0x80) !== 0) {
      const localMsgType = (header >> 5) & 0x03;
      const timeOffset5 = header & 0x1f;
      const def = definitions.get(localMsgType);
      if (!def) break;

      if (lastTimestampSec > 0) {
        const lower5 = lastTimestampSec & 0x1f;
        let nextTs = (lastTimestampSec & ~0x1f) + timeOffset5;
        if (timeOffset5 < lower5) nextTs += 32;
        lastTimestampSec = nextTs;
      }

      const values = new Map<number, number>();
      for (const field of def.fields) {
        const val = readFitValue(view, pos, field.size, field.baseType, def.littleEndian);
        if (val !== null) values.set(field.defNum, val);
        pos += field.size;
      }
      pos += def.devDataSize;

      if (def.globalMsgNum === 20) {
        const latRaw = values.get(0);
        const lonRaw = values.get(1);
        if (latRaw !== undefined && lonRaw !== undefined) {
          const lat = latRaw * SEMICIRCLES_TO_DEGREES;
          const lon = lonRaw * SEMICIRCLES_TO_DEGREES;
          if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) {
            const altRaw = values.get(78) ?? values.get(2);
            const elevationM = altRaw !== undefined ? altRaw / 5 - 500 : 15;
            const hr = values.get(3);
            const rawCad = values.get(4);
            const cadence = rawCad !== undefined ? (rawCad < 120 ? rawCad * 2 : rawCad) : undefined;
            const distM = values.get(5);
            const speedRaw = values.get(73) ?? values.get(6);
            const speedMps = speedRaw !== undefined ? speedRaw / 1000 : undefined;

            rawSamples.push({
              lat,
              lon,
              elevationM,
              timeMs: (lastTimestampSec + FIT_EPOCH_OFFSET_SEC) * 1000,
              ...(hr !== undefined && hr >= 40 && hr <= 230 ? { hr: Math.round(hr) } : {}),
              ...(cadence !== undefined && cadence >= 80 && cadence <= 240
                ? { cadence: Math.round(cadence) }
                : {}),
              ...(distM !== undefined ? { distanceKm: distM / 100000 } : {}),
              ...(speedMps !== undefined && speedMps > 0.3 && speedMps < 12
                ? { paceSecPerKm: Math.round(1000 / speedMps) }
                : {}),
            });
          }
        }
      }
      continue;
    }

    const isDefinition = (header & 0x40) !== 0;
    const hasDevData = (header & 0x20) !== 0;
    const localMsgType = header & 0x0f;

    if (isDefinition) {
      if (pos + 5 > dataEnd) break;
      pos += 1; // reserved byte
      const arch = view.getUint8(pos);
      pos += 1;
      const littleEndian = arch === 0;
      const globalMsgNum = view.getUint16(pos, littleEndian);
      pos += 2;
      const numFields = view.getUint8(pos);
      pos += 1;

      const fields: FitFieldDef[] = [];
      for (let i = 0; i < numFields; i += 1) {
        if (pos + 3 > dataEnd) break;
        const defNum = view.getUint8(pos);
        const size = view.getUint8(pos + 1);
        const baseType = view.getUint8(pos + 2);
        pos += 3;
        fields.push({ defNum, size, baseType });
      }

      let devDataSize = 0;
      if (hasDevData && pos < dataEnd) {
        const numDevFields = view.getUint8(pos);
        pos += 1;
        for (let i = 0; i < numDevFields; i += 1) {
          if (pos + 3 > dataEnd) break;
          devDataSize += view.getUint8(pos + 1);
          pos += 3;
        }
      }

      definitions.set(localMsgType, {
        globalMsgNum,
        littleEndian,
        fields,
        devDataSize,
      });
    } else {
      const def = definitions.get(localMsgType);
      if (!def) break;

      const values = new Map<number, number>();
      for (const field of def.fields) {
        const val = readFitValue(view, pos, field.size, field.baseType, def.littleEndian);
        if (val !== null) values.set(field.defNum, val);
        pos += field.size;
      }
      pos += def.devDataSize;

      const ts = values.get(253);
      if (ts !== undefined && ts > 0) {
        lastTimestampSec = ts;
      }

      if (def.globalMsgNum === 20) {
        const latRaw = values.get(0);
        const lonRaw = values.get(1);
        if (latRaw !== undefined && lonRaw !== undefined) {
          const lat = latRaw * SEMICIRCLES_TO_DEGREES;
          const lon = lonRaw * SEMICIRCLES_TO_DEGREES;
          if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) {
            const recordTs = ts ?? lastTimestampSec;
            const altRaw = values.get(78) ?? values.get(2);
            const elevationM = altRaw !== undefined ? altRaw / 5 - 500 : 15;
            const hr = values.get(3);
            const rawCad = values.get(4);
            const fracCad = values.get(53) ?? 0;
            const combinedCad =
              rawCad !== undefined ? rawCad + fracCad / 128 : undefined;
            const cadence =
              combinedCad !== undefined
                ? combinedCad < 120
                  ? combinedCad * 2
                  : combinedCad
                : undefined;
            const distM = values.get(5);
            const speedRaw = values.get(73) ?? values.get(6);
            const speedMps = speedRaw !== undefined ? speedRaw / 1000 : undefined;

            rawSamples.push({
              lat,
              lon,
              elevationM,
              timeMs: (recordTs + FIT_EPOCH_OFFSET_SEC) * 1000,
              ...(hr !== undefined && hr >= 40 && hr <= 230 ? { hr: Math.round(hr) } : {}),
              ...(cadence !== undefined && cadence >= 80 && cadence <= 240
                ? { cadence: Math.round(cadence) }
                : {}),
              ...(distM !== undefined ? { distanceKm: distM / 100000 } : {}),
              ...(speedMps !== undefined && speedMps > 0.3 && speedMps < 12
                ? { paceSecPerKm: Math.round(1000 / speedMps) }
                : {}),
            });
          }
        }
      } else if (def.globalMsgNum === 18) {
        // Session summary message
        const startTimeFit = values.get(2);
        if (startTimeFit !== undefined && startTimeFit > 0) {
          sessionStartIso = new Date((startTimeFit + FIT_EPOCH_OFFSET_SEC) * 1000)
            .toISOString()
            .slice(0, 10);
        }
        const sport = values.get(5);
        if (sport === 1) sessionSportName = 'Running Session';
        else if (sport === 11) sessionSportName = 'Trail Run';
        const totTimer = values.get(8) ?? values.get(7);
        if (totTimer !== undefined && totTimer > 0) {
          sessionTotalDurSec = Math.round(totTimer / 1000);
        }
        const totDist = values.get(9);
        if (totDist !== undefined && totDist > 0) {
          sessionTotalDistKm = Math.round((totDist / 100000) * 100) / 100;
        }
      }
    }
  }

  if (rawSamples.length < 2) {
    throw new Error('File .FIT tidak memiliki cukup titik koordinat GPS (record position_lat/lon).');
  }

  return {
    rawSamples,
    sessionStartIso,
    sessionSportName,
    sessionTotalDistKm,
    sessionTotalDurSec,
  };
}

export function parseFitArrayBuffer(
  buffer: ArrayBuffer,
  fileName = 'run.fit',
  athleteBio?: AthleteBioHints,
): Studio3DTrack {
  const {
    rawSamples,
    sessionStartIso,
    sessionSportName,
    sessionTotalDistKm,
    sessionTotalDurSec,
  } = decodeFitRecords(buffer);

  const baseName = fileName.replace(/\.fit$/i, '').replace(/[_-]+/g, ' ').trim();
  return buildStudio3DTrackFromRaw({
    samples: rawSamples,
    source: 'fit',
    title: baseName || sessionSportName || 'FIT Running Session',
    date: sessionStartIso ?? undefined,
    overrideDistanceKm: sessionTotalDistKm ?? undefined,
    overrideDurationSec: sessionTotalDurSec ?? undefined,
    athleteBio,
  });
}

function formatLocalIsoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parses a binary Garmin/ANT+ .FIT file for Catat Lari / Edit Sesi:
 * extracts accurate KM splits, route silhouette, and compact telemetryPoints (<= 100)
 * preserving real recorded HR/cadence only where present in the sensor stream.
 */
export function parseFitForRunLog(buffer: ArrayBuffer, _fileName = 'run.fit'): ParsedGpxResult {
  const { rawSamples, sessionStartIso } = decodeFitRecords(buffer);
  const sorted = [...rawSamples].sort((a, b) => a.timeMs - b.timeMs);

  const splits: KmSplit[] = [];
  let totalDistKm = 0;
  let activeElapsedSec = 0;
  let nextTargetKm = 1;
  let splitStartSec = 0;
  let splitHrSum = 0;
  let splitHrCount = 0;

  let totalHrSum = 0;
  let totalHrCount = 0;
  let totalCadSum = 0;
  let totalCadCount = 0;

  const first = sorted[0];
  if (first.hr !== undefined) {
    splitHrSum += first.hr;
    splitHrCount += 1;
    totalHrSum += first.hr;
    totalHrCount += 1;
  }
  if (first.cadence !== undefined) {
    totalCadSum += first.cadence;
    totalCadCount += 1;
  }

  const rawTelemetry: TelemetryPoint[] = [
    {
      lat: Math.round(first.lat * 1e6) / 1e6,
      lon: Math.round(first.lon * 1e6) / 1e6,
      ele: Math.round((first.elevationM ?? 15) * 10) / 10,
      tSec: 0,
      distKm: 0,
      paceSec: first.paceSecPerKm ?? 360,
      ...(first.hr !== undefined ? { hr: first.hr } : {}),
      ...(first.cadence !== undefined ? { cad: first.cadence } : {}),
    },
  ];

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const segDist = haversineDistanceKm(prev.lat, prev.lon, curr.lat, curr.lon);
    const dtSecRaw = Math.max(0, (curr.timeMs - prev.timeMs) / 1000);
    const speedMps = dtSecRaw > 0 ? (segDist * 1000) / dtSecRaw : 0;

    // Skip impossible teleport jumps or watch pause gaps
    if (segDist >= 0.5 || speedMps > 12) continue;
    const segSec =
      dtSecRaw > 0 && dtSecRaw <= 45
        ? dtSecRaw
        : dtSecRaw > 45 && segDist > 0.02
          ? Math.min(45, Math.round(segDist * 360))
          : 0;
    if (segSec <= 0 && segDist <= 0) continue;

    if (curr.hr !== undefined) {
      totalHrSum += curr.hr;
      totalHrCount += 1;
    }
    if (curr.cadence !== undefined) {
      totalCadSum += curr.cadence;
      totalCadCount += 1;
    }

    if (segDist > 0) {
      if (totalDistKm + segDist < nextTargetKm || splits.length >= MAX_KM_SPLITS - 1) {
        if (curr.hr !== undefined) {
          splitHrSum += curr.hr;
          splitHrCount += 1;
        }
      } else {
        let consumedCurr = false;
        while (
          totalDistKm + segDist >= nextTargetKm &&
          splits.length < MAX_KM_SPLITS - 1
        ) {
          const remaining = nextTargetKm - totalDistKm;
          const ratio = Math.min(1, Math.max(0, remaining / segDist));
          if (!consumedCurr && curr.hr !== undefined && (ratio >= 0.5 || splitHrCount === 0)) {
            splitHrSum += curr.hr;
            splitHrCount += 1;
            consumedCurr = true;
          }
          const crossSec = activeElapsedSec + ratio * segSec;
          const splitDurSec = Math.min(7200, Math.max(1, Math.round(crossSec - splitStartSec)));
          const avgSplitHr = splitHrCount > 0 ? Math.round(splitHrSum / splitHrCount) : curr.hr;

          splits.push({
            km: splits.length + 1,
            distanceKm: 1,
            durationSec: splitDurSec,
            paceSecPerKm: Math.min(3600, Math.max(1, splitDurSec)),
            paceStr: formatPace(Math.min(3600, Math.max(1, splitDurSec))),
            ...(avgSplitHr !== undefined ? { hr: avgSplitHr } : {}),
          });

          splitStartSec = crossSec;
          splitHrSum = curr.hr !== undefined ? curr.hr : 0;
          splitHrCount = curr.hr !== undefined ? 1 : 0;
          nextTargetKm += 1;
        }
      }
    }

    totalDistKm += segDist;
    activeElapsedSec += segSec;

    const instPaceSec =
      curr.paceSecPerKm ??
      Math.min(
        3600,
        Math.max(120, Math.round(segSec / Math.max(0.001, segDist))),
      );

    rawTelemetry.push({
      lat: Math.round(curr.lat * 1e6) / 1e6,
      lon: Math.round(curr.lon * 1e6) / 1e6,
      ele: Math.round((curr.elevationM ?? 15) * 10) / 10,
      tSec: Math.min(86400, Math.max(0, Math.round(activeElapsedSec))),
      distKm: Math.min(250, Math.round(totalDistKm * 1000) / 1000),
      paceSec: Math.min(3600, Math.max(60, Math.round(instPaceSec))),
      ...(curr.hr !== undefined ? { hr: curr.hr } : {}),
      ...(curr.cadence !== undefined ? { cad: curr.cadence } : {}),
    });
  }

  // Final partial km split if >= 50 meters
  const remainderKm = totalDistKm - splits.length;
  if (remainderKm >= 0.05 && splits.length < MAX_KM_SPLITS) {
    const clampedRem = Math.min(2, Math.round(remainderKm * 100) / 100);
    const remSec = Math.min(7200, Math.max(1, Math.round(activeElapsedSec - splitStartSec)));
    const paceSec = Math.min(3600, Math.max(1, Math.round(remSec / Math.max(0.05, remainderKm))));
    const avgSplitHr = splitHrCount > 0 ? Math.round(splitHrSum / splitHrCount) : undefined;
    splits.push({
      km: splits.length + 1,
      distanceKm: clampedRem,
      durationSec: remSec,
      paceSecPerKm: paceSec,
      paceStr: formatPace(paceSec),
      ...(avgSplitHr !== undefined ? { hr: avgSplitHr } : {}),
    });
  }

  if (splits.length === 0 || totalDistKm < 0.05) {
    throw new Error('Jarak .FIT terlalu pendek (minimal 0.05 km).');
  }

  const totalDistRounded = Math.min(250, Math.max(0.05, Math.round(totalDistKm * 100) / 100));
  const totalDurationSec = Math.min(86400, Math.max(1, Math.round(activeElapsedSec)));
  const overallPaceSec = Math.min(3600, Math.max(1, Math.round(totalDurationSec / totalDistRounded)));
  rawTelemetry[0].paceSec = overallPaceSec;

  // Elevation gain (1.2m hysteresis)
  let elevationGainM = 0;
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

  const routePoints = extractRouteSilhouette([
    sorted.map((s) => ({
      lat: s.lat,
      lon: s.lon,
      timeMs: s.timeMs,
    })),
  ]);
  const telemetryPoints = downsampleTelemetryPoints(rawTelemetry, MAX_TELEMETRY_POINTS);
  const avgHr = totalHrCount > 0 ? Math.round(totalHrSum / totalHrCount) : undefined;
  const avgCadence = totalCadCount > 0 ? Math.round(totalCadSum / totalCadCount) : undefined;

  return {
    splits,
    routePoints,
    telemetryPoints,
    summary: {
      date: sessionStartIso ?? formatLocalIsoDate(first.timeMs),
      distanceKm: totalDistRounded,
      durationSec: totalDurationSec,
      durationStr: formatDuration(totalDurationSec),
      paceSecPerKm: overallPaceSec,
      paceStr: formatPace(overallPaceSec),
      ...(avgHr !== undefined ? { avgHr } : {}),
      ...(avgCadence !== undefined ? { avgCadence } : {}),
      elevationGainM: Math.round(elevationGainM),
      fileType: 'fit',
      trackpointCount: sorted.length,
    },
  };
}
