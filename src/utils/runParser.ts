import type { RunCategory } from '../types';

export interface ParsedRunFields {
  date: string;
  distanceKm: number | null;
  durationStr: string;
  durationSec: number | null;
  paceStr: string;
  paceSecPerKm: number | null;
  hr: number | null;
  cadence: number | null;
  strideCm: number | null;
  category: RunCategory | null;
  vo2max: number | null;
  note: string;
  matchedFields: string[];
  warnings: string[];
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  januari: 1,
  january: 1,
  feb: 2,
  februari: 2,
  february: 2,
  mar: 3,
  maret: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  mei: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  aug: 8,
  agu: 8,
  agustus: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  okt: 10,
  oktober: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  des: 12,
  desember: 12,
  december: 12,
};

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '0:00';
  const rounded = Math.round(totalSec);
  const hours = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) {
    return `${hours}:${pad2(mins)}:${pad2(secs)}`;
  }
  return `${mins}:${pad2(secs)}`;
}

export function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '0:00';
  const rounded = Math.round(secPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${pad2(secs)}`;
}

export function parseTimeToSec(input: string): number | null {
  const cleaned = input.trim().replace(/["']/g, ':').replace(/::+/g, ':');
  const parts = cleaned.split(':').map((p) => Number(p.trim()));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [m, s] = parts;
    if (s >= 60) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m >= 60 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

export function normalizeCategory(raw: string): RunCategory | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes('interval')) return 'Interval Run';
  if (v.includes('tempo')) return 'Tempo Run';
  if (v.includes('fast') || v.includes('speed') || v.includes('cepat')) return 'Fast Run';
  if (v.includes('recovery') || v.includes('pemulihan')) return 'Recovery Run';
  if (v.includes('easy') || v.includes('santai')) return 'Easy Run';
  return null;
}

function parseDateFromText(text: string): string | null {
  // 1. ISO format YYYY-MM-DD
  const isoMatch = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${pad2(Number(isoMatch[2]))}-${pad2(Number(isoMatch[3]))}`;
  }

  // 2. DD MMM YYYY (e.g. "tgl 18 Nov 2026", "18 November 2026")
  const dmyTextMatch = text.match(
    /(?:tgl|tanggal|date)?\s*[:=-]?\s*\b(0?[1-9]|[12]\d|3[01])\s+([A-Za-z]+)\s+(20\d{2})\b/i,
  );
  if (dmyTextMatch) {
    const day = Number(dmyTextMatch[1]);
    const month = MONTH_MAP[dmyTextMatch[2].toLowerCase()];
    const year = Number(dmyTextMatch[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // 3. MMM DD, YYYY (e.g. "Nov 18, 2026")
  const mdyTextMatch = text.match(
    /\b([A-Za-z]+)\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2})\b/i,
  );
  if (mdyTextMatch) {
    const month = MONTH_MAP[mdyTextMatch[1].toLowerCase()];
    const day = Number(mdyTextMatch[2]);
    const year = Number(mdyTextMatch[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // 4. DD/MM/YYYY or DD-MM-YYYY
  const dmyNumMatch = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])[-/](20\d{2})\b/);
  if (dmyNumMatch) {
    return `${dmyNumMatch[3]}-${pad2(Number(dmyNumMatch[2]))}-${pad2(Number(dmyNumMatch[1]))}`;
  }

  return null;
}

function parseDecimalNumber(raw: string): number | null {
  const normalized = raw.replace(',', '.').trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function parseRunPasteText(input: string, fallbackDate = ''): ParsedRunFields {
  const text = input.trim();
  const matchedFields: string[] = [];
  const warnings: string[] = [];

  if (!text) {
    return {
      date: fallbackDate,
      distanceKm: null,
      durationStr: '',
      durationSec: null,
      paceStr: '',
      paceSecPerKm: null,
      hr: null,
      cadence: null,
      strideCm: null,
      category: null,
      vo2max: null,
      note: '',
      matchedFields,
      warnings,
    };
  }

  // Date
  const parsedDate = parseDateFromText(text);
  if (parsedDate) matchedFields.push('date');

  // Distance: "jarak 5,06 km" or "distance: 10.2 km" or "5,06km"
  let distanceKm: number | null = null;
  const distLabeled = text.match(
    /(?:jarak|distance|dist)\s*[:=-]?\s*(\d+(?:[.,]\d+)?)\s*(?:km)?/i,
  );
  if (distLabeled) {
    distanceKm = parseDecimalNumber(distLabeled[1]);
  } else {
    const distUnit = text.match(/\b(\d+(?:[.,]\d+)?)\s*km\b/i);
    if (distUnit) {
      distanceKm = parseDecimalNumber(distUnit[1]);
    }
  }
  if (distanceKm !== null && distanceKm > 0) {
    distanceKm = Math.round(distanceKm * 100) / 100;
    matchedFields.push('distance');
  } else {
    distanceKm = null;
  }

  // Duration: "waktu 32:17" or "durasi 1:42:10" or "time 24:05"
  let durationSec: number | null = null;
  let durationStr = '';
  const durMatch = text.match(
    /(?:waktu|durasi|duration|time)\s*[:=-]?\s*(\d{1,2}:\d{2}(?::\d{2})?)/i,
  );
  if (durMatch) {
    const sec = parseTimeToSec(durMatch[1]);
    if (sec !== null && sec > 0) {
      durationSec = sec;
      durationStr = formatDuration(sec);
      matchedFields.push('duration');
    }
  }

  // Pace: "pace 6:23" or "pace: 5'12\"" or "pace 5:12/km"
  let paceSecPerKm: number | null = null;
  let paceStr = '';
  const paceMatch = text.match(
    /(?:pace)\s*[:=-]?\s*(\d{1,2}[:']\d{2}"?)(?:\s*\/?\s*km)?/i,
  );
  if (paceMatch) {
    const sec = parseTimeToSec(paceMatch[1]);
    if (sec !== null && sec > 0) {
      paceSecPerKm = sec;
      paceStr = formatPace(sec);
      matchedFields.push('pace');
    }
  }

  // Derive missing pace or duration if distance is available
  if (distanceKm !== null && distanceKm > 0) {
    if (durationSec !== null && paceSecPerKm === null) {
      paceSecPerKm = Math.round(durationSec / distanceKm);
      paceStr = formatPace(paceSecPerKm);
      matchedFields.push('pace');
    } else if (paceSecPerKm !== null && durationSec === null) {
      durationSec = Math.round(paceSecPerKm * distanceKm);
      durationStr = formatDuration(durationSec);
      matchedFields.push('duration');
    }
  }

  // Heart rate: "hr 160", "heart rate: 158 bpm"
  let hr: number | null = null;
  const hrMatch = text.match(
    /(?:heart\s*rate|detak\s*jantung|hr)\s*[:=-]?\s*(\d{2,3})(?:\s*bpm)?/i,
  );
  if (hrMatch) {
    const val = Number(hrMatch[1]);
    if (val >= 40 && val <= 230) {
      hr = val;
      matchedFields.push('hr');
    }
  }

  // Cadence: "cadence 155" or "cadance 155" or "kadens 172 spm"
  let cadence: number | null = null;
  const cadMatch = text.match(
    /(?:cadence|cadance|kadens)\s*[:=-]?\s*(\d{2,3})(?:\s*spm)?/i,
  );
  if (cadMatch) {
    const val = Number(cadMatch[1]);
    if (val >= 80 && val <= 240) {
      cadence = val;
      matchedFields.push('cadence');
    }
  }

  // Stride: "stride 101" (cm) or "stride 1.01m"
  let strideCm: number | null = null;
  const strideMatch = text.match(
    /(?:stride(?:\s*length)?|langkah)\s*[:=-]?\s*(\d+(?:[.,]\d+)?)\s*(cm|m)?/i,
  );
  if (strideMatch) {
    const rawVal = parseDecimalNumber(strideMatch[1]);
    const unit = strideMatch[2]?.toLowerCase();
    if (rawVal !== null && rawVal > 0) {
      if (unit === 'm' || (!unit && rawVal < 3)) {
        strideCm = Math.round(rawVal * 100);
      } else {
        strideCm = Math.round(rawVal);
      }
      matchedFields.push('stride');
    }
  }

  // Category: "kategori Interval", "category: Tempo Run"
  let category: RunCategory | null = null;
  const catLabeled = text.match(
    /(?:kategori|category|jenis|type)\s*[:=-]?\s*([A-Za-z]+(?:\s+run)?)/i,
  );
  if (catLabeled) {
    category = normalizeCategory(catLabeled[1]);
  }
  if (!category) {
    category = normalizeCategory(text);
  }
  if (category) matchedFields.push('category');

  // VO2Max: "vo2max 39", "vo2 max: 44"
  let vo2max: number | null = null;
  const vo2Match = text.match(/(?:vo2\s*max|vo2)\s*[:=-]?\s*(\d{2}(?:[.,]\d+)?)/i);
  if (vo2Match) {
    const val = parseDecimalNumber(vo2Match[1]);
    if (val !== null && val >= 15 && val <= 95) {
      vo2max = Math.round(val * 10) / 10;
      matchedFields.push('vo2max');
    }
  }

  // Note: "note: ...", "catatan: ..."
  let note = '';
  const noteMatch = text.match(/(?:catatan|notes?)\s*[:=-]\s*([^\n]+)$/i);
  if (noteMatch) {
    note = noteMatch[1].trim();
    matchedFields.push('note');
  }

  if (matchedFields.length === 0) {
    warnings.push('No recognized running fields found. Try including labels like jarak, waktu, pace, hr, cadence, stride, kategori, vo2max.');
  }

  return {
    date: parsedDate || fallbackDate,
    distanceKm,
    durationStr,
    durationSec,
    paceStr,
    paceSecPerKm,
    hr,
    cadence,
    strideCm,
    category,
    vo2max,
    note,
    matchedFields,
    warnings,
  };
}
