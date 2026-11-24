import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  normalizeMapStyle3D,
  type CanonicalMapStyle3D,
  type MapStyle3D,
  type OsmBuildingFootprint,
  type OsmRoadWay,
  type Studio3DTrack,
} from '../types/studio3d';

export interface TerrainGridConfig {
  widthMeters: number;
  depthMeters: number;
  northLat: number;
  southLat: number;
  westLon: number;
  eastLon: number;
  zoom: number;
  tileXMin: number;
  tileXMax: number;
  tileYMin: number;
  tileYMax: number;
}

function latToTileYFloat(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
}

function lonToTileXFloat(lon: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  return ((lon + 180) / 360) * n;
}

function tileXToLon(tileX: number, zoom: number): number {
  return (tileX / Math.pow(2, zoom)) * 360 - 180;
}

function tileYToLat(tileY: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * tileY) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Computes the Web Mercator tile bounding grid and real-world metric dimensions
 * covering the track + generous surround so terrain never clips during overview or drone shots.
 */
export function computeTerrainGridConfig(track: Studio3DTrack): TerrainGridConfig {
  const spanDegLat = Math.max(0.005, track.maxLat - track.minLat);
  const spanDegLon = Math.max(0.005, track.maxLon - track.minLon);
  const padLat = Math.max(0.0032, spanDegLat * 0.52);
  const padLon = Math.max(0.0032, spanDegLon * 0.52);

  const rawSouth = Math.max(-84, track.minLat - padLat);
  const rawNorth = Math.min(84, track.maxLat + padLat);
  const rawWest = track.minLon - padLon;
  const rawEast = track.maxLon + padLon;

  // Choose zoom level favoring sharp z17/z16 street & satellite tiles when grid stays <= 7x7 tiles
  let zoom = 15;
  for (let z = 17; z >= 12; z -= 1) {
    const xMin = Math.floor(lonToTileXFloat(rawWest, z));
    const xMax = Math.floor(lonToTileXFloat(rawEast, z));
    const yMin = Math.floor(latToTileYFloat(rawNorth, z));
    const yMax = Math.floor(latToTileYFloat(rawSouth, z));
    const maxGrid = z >= 17 ? 7 : 6;
    if (xMax - xMin + 1 <= maxGrid && yMax - yMin + 1 <= maxGrid) {
      zoom = z;
      break;
    }
  }

  const maxIdx = Math.pow(2, zoom) - 1;
  const tileXMin = Math.max(0, Math.floor(lonToTileXFloat(rawWest, zoom)));
  const tileXMax = Math.min(maxIdx, Math.floor(lonToTileXFloat(rawEast, zoom)));
  const tileYMin = Math.max(0, Math.floor(latToTileYFloat(rawNorth, zoom)));
  const tileYMax = Math.min(maxIdx, Math.floor(latToTileYFloat(rawSouth, zoom)));

  const northLat = tileYToLat(tileYMin, zoom);
  const southLat = tileYToLat(tileYMax + 1, zoom);
  const westLon = tileXToLon(tileXMin, zoom);
  const eastLon = tileXToLon(tileXMax + 1, zoom);

  const cosLat = Math.max(0.15, Math.cos((track.centerLat * Math.PI) / 180));
  const widthMeters = (eastLon - westLon) * 111320 * cosLat;
  const depthMeters = (northLat - southLat) * 111320;

  return {
    widthMeters,
    depthMeters,
    northLat,
    southLat,
    westLon,
    eastLon,
    zoom,
    tileXMin,
    tileXMax,
    tileYMin,
    tileYMax,
  };
}

export function latLonToLocalMeters(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
): { xM: number; zM: number } {
  const cosLat = Math.max(0.15, Math.cos((centerLat * Math.PI) / 180));
  return {
    xM: (lon - centerLon) * 111320 * cosLat,
    zM: -(lat - centerLat) * 111320,
  };
}

export interface RealDemGrid {
  northLat: number;
  southLat: number;
  westLon: number;
  eastLon: number;
  rows: number;
  cols: number;
  elevationsM: number[];
  minDemM?: number;
  maxDemM?: number;
}

function sampleDemGridBilinearAbs(
  xM: number,
  zM: number,
  track: Studio3DTrack,
  demGrid: RealDemGrid,
): number {
  const cosLat = Math.max(0.15, Math.cos((track.centerLat * Math.PI) / 180));
  const lat = track.centerLat - zM / 111320;
  const lon = track.centerLon + xM / (111320 * cosLat);

  const u = THREE.MathUtils.clamp(
    (lon - demGrid.westLon) / Math.max(1e-6, demGrid.eastLon - demGrid.westLon),
    0,
    1,
  );
  const v = THREE.MathUtils.clamp(
    (demGrid.northLat - lat) / Math.max(1e-6, demGrid.northLat - demGrid.southLat),
    0,
    1,
  );

  const fx = u * (demGrid.cols - 1);
  const fy = v * (demGrid.rows - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(demGrid.cols - 1, x0 + 1);
  const y1 = Math.min(demGrid.rows - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const e00 = demGrid.elevationsM[y0 * demGrid.cols + x0];
  const e10 = demGrid.elevationsM[y0 * demGrid.cols + x1];
  const e01 = demGrid.elevationsM[y1 * demGrid.cols + x0];
  const e11 = demGrid.elevationsM[y1 * demGrid.cols + x1];
  return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
}

/**
 * Samples real 3D terrain elevation (Three.js world Y in meters) at any local (xM, zM) coordinate.
 * Fuses Copernicus/ASTER DEM grid with smoothed GPX/TCX elevation while damping GPS altitude noise,
 * with ZERO fictional sinusoidal hills so flat city venues remain accurately flat.
 */
export function sampleTerrainY(
  xM: number,
  zM: number,
  track: Studio3DTrack,
  demGrid?: RealDemGrid | null,
): number {
  const hasValidDem =
    Boolean(demGrid) &&
    demGrid!.elevationsM.length === demGrid!.rows * demGrid!.cols &&
    demGrid!.elevationsM.length >= 4;

  let demMin = demGrid?.minDemM;
  let demMax = demGrid?.maxDemM;
  if (hasValidDem && (demMin === undefined || demMax === undefined)) {
    demMin = Math.min(...demGrid!.elevationsM);
    demMax = Math.max(...demGrid!.elevationsM);
  }

  const demSpan =
    hasValidDem && demMin !== undefined && demMax !== undefined
      ? Math.max(0, demMax - demMin)
      : 0;
  const gpxSpan = Math.max(0, track.maxElevationM - track.minElevationM);
  const effectiveSpan = hasValidDem ? Math.max(demSpan, Math.min(gpxSpan, demSpan + 8)) : gpxSpan;

  // Subtle vertical relief scaling only for genuine hills (>= 10m); keep flat urban parks strictly 1:1
  const verticalScale =
    effectiveSpan >= 10 ? Math.min(1.5, Math.max(1.05, 16 / effectiveSpan)) : 1.0;

  let weightedSum = 0;
  let totalWeight = 0;
  const pts = track.points;
  const stride = pts.length > 140 ? Math.ceil(pts.length / 72) : 1;

  for (let i = 0; i < pts.length; i += stride) {
    const p = pts[i];
    const dx = xM - p.xM;
    const dz = zM - p.zM;
    const distSq = dx * dx + dz * dz;
    const weight = 1 / (distSq + 2200);
    weightedSum += (p.elevationM - track.minElevationM) * weight;
    totalWeight += weight;
  }

  const routeRel = totalWeight > 0 ? weightedSum / totalWeight : 0;

  if (!hasValidDem || demMin === undefined) {
    return Math.max(0, routeRel * verticalScale);
  }

  const demAbs = sampleDemGridBilinearAbs(xM, zM, track, demGrid!);
  const baseFloor = Math.min(demMin, track.minElevationM);
  const demRel = Math.max(0, demAbs - baseFloor);

  // Clamp GPX noise spikes that diverge strongly from authentic DEM surface (e.g. barometric drift)
  const routeAnchoredAbs = track.minElevationM + routeRel;
  const clampedRouteDiff = THREE.MathUtils.clamp(routeAnchoredAbs - demAbs, -4.5, 4.5);
  const denoisedRouteRel = Math.max(0, demRel + clampedRouteDiff * 0.45);

  const distFromCenter = Math.hypot(xM, zM);
  const outerWeight = THREE.MathUtils.clamp((distFromCenter - track.spanMeters * 0.25) / 420, 0.25, 0.92);
  return Math.max(0, (denoisedRouteRel * (1 - outerWeight) + demRel * outerWeight) * verticalScale);
}

/**
 * Fetches an adaptive 9x9 or 11x11 real Copernicus/ASTER DEM elevation grid from /api/map-elevation.
 */
export async function fetchRealDemGridForTrack(
  grid: TerrainGridConfig,
  signal?: AbortSignal,
  spanMeters = 1000,
): Promise<RealDemGrid | null> {
  const dim = spanMeters > 2400 ? 11 : 9;
  const rows = dim;
  const cols = dim;
  const lats: number[] = [];
  const lons: number[] = [];

  for (let r = 0; r < rows; r += 1) {
    const lat = grid.northLat - (r / (rows - 1)) * (grid.northLat - grid.southLat);
    for (let c = 0; c < cols; c += 1) {
      const lon = grid.westLon + (c / (cols - 1)) * (grid.eastLon - grid.westLon);
      lats.push(lat);
      lons.push(lon);
    }
  }

  try {
    const res = await fetch(
      `/api/map-elevation?lats=${lats.map((v) => v.toFixed(5)).join(',')}&lons=${lons.map((v) => v.toFixed(5)).join(',')}`,
      { signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { elevations?: number[] };
    if (!Array.isArray(data.elevations) || data.elevations.length !== rows * cols) {
      return null;
    }
    let minDemM = Infinity;
    let maxDemM = -Infinity;
    for (const e of data.elevations) {
      if (e < minDemM) minDemM = e;
      if (e > maxDemM) maxDemM = e;
    }
    return {
      northLat: grid.northLat,
      southLat: grid.southLat,
      westLon: grid.westLon,
      eastLon: grid.eastLon,
      rows,
      cols,
      elevationsM: data.elevations,
      minDemM: Number.isFinite(minDemM) ? minDemM : 0,
      maxDemM: Number.isFinite(maxDemM) ? maxDemM : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Draws a clean, neutral cartographic loading grid (no fake parks, rivers, or fictional roads)
 * while real Web Mercator map tiles download.
 */
export function drawLoadingTileGrid(
  canvas: HTMLCanvasElement,
  style: MapStyle3D,
  cols: number,
  rows: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const normalized = normalizeMapStyle3D(style);
  const isDark =
    style === 'night' || normalized === 'satellite' || normalized === 'hybrid';
  const bg = isDark
    ? '#0F172A'
    : normalized === 'monochrome'
      ? '#E2E8F0'
      : normalized === 'liberty'
        ? '#F4F0E8'
        : normalized === 'city3d'
          ? '#EEF2F6'
          : '#E8EDF2';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const tileW = w / Math.max(1, cols);
  const tileH = h / Math.max(1, rows);
  ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(100, 116, 139, 0.16)';
  ctx.lineWidth = 1;

  for (let c = 0; c <= cols; c += 1) {
    const x = Math.round(c * tileW);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r += 1) {
    const y = Math.round(r * tileH);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function loadTileImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export interface TileLoadProgress {
  phase: 'loading' | 'ready' | 'partial' | 'error';
  loadedTiles: number;
  failedTiles: number;
  totalTiles: number;
  zoom: number;
}

function resolveServerTileStyle(
  style: MapStyle3D,
  includeLabels = true,
): CanonicalMapStyle3D | 'night' | 'liberty-nolabels' {
  if (style === 'night') return 'night';
  const normalized = normalizeMapStyle3D(style);
  if (normalized === 'liberty' && !includeLabels) {
    return 'liberty-nolabels';
  }
  return normalized;
}

/**
 * Loads CORS-safe real Web Mercator raster tiles in controlled batches onto CanvasTexture
 * and streams exact progress updates without inventing fictional map artwork.
 */
export async function buildMapCompositeTexture(
  grid: TerrainGridConfig,
  style: MapStyle3D,
  maxAnisotropy: number,
  signal?: AbortSignal,
  onProgress?: (progress: TileLoadProgress) => void,
  cacheBust?: number,
  includeLabels = true,
): Promise<{ texture: THREE.CanvasTexture; canvas: HTMLCanvasElement; completion: Promise<void> }> {
  const cols = grid.tileXMax - grid.tileXMin + 1;
  const rows = grid.tileYMax - grid.tileYMin + 1;
  const totalTiles = cols * rows;
  const tileSize = 256;

  const canvas = document.createElement('canvas');
  canvas.width = cols * tileSize;
  canvas.height = rows * tileSize;
  drawLoadingTileGrid(canvas, style, cols, rows);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  onProgress?.({
    phase: 'loading',
    loadedTiles: 0,
    failedTiles: 0,
    totalTiles,
    zoom: grid.zoom,
  });

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { texture, canvas, completion: Promise.resolve() };
  }

  const jobs: Array<{ tx: number; ty: number; dx: number; dy: number; dist: number }> = [];
  const midC = (cols - 1) / 2;
  const midR = (rows - 1) / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      jobs.push({
        tx: grid.tileXMin + col,
        ty: grid.tileYMin + row,
        dx: col * tileSize,
        dy: row * tileSize,
        dist: Math.hypot(col - midC, row - midR),
      });
    }
  }
  jobs.sort((a, b) => a.dist - b.dist);

  let loadedTiles = 0;
  let failedTiles = 0;
  const bustQuery = cacheBust ? `?v=${cacheBust}` : '';
  const serverStyle = resolveServerTileStyle(style, includeLabels);
  const isMonochrome = serverStyle === 'monochrome';
  const overlayHybridLabels = serverStyle === 'hybrid' && includeLabels;
  const overlayMonoLabels = isMonochrome && includeLabels;

  // Scratch 256x256 canvas for clean grayscale luminance conversion on Monochrome fallback tiles
  const monoScratch = isMonochrome ? document.createElement('canvas') : null;
  if (monoScratch) {
    monoScratch.width = tileSize;
    monoScratch.height = tileSize;
  }
  const monoCtx = monoScratch?.getContext('2d') ?? null;

  const drawMonochromeTile = (img: HTMLImageElement, dx: number, dy: number) => {
    if (!monoCtx || !monoScratch) {
      ctx.drawImage(img, dx, dy, tileSize, tileSize);
      return;
    }
    monoCtx.clearRect(0, 0, tileSize, tileSize);
    monoCtx.drawImage(img, 0, 0, tileSize, tileSize);
    const imgData = monoCtx.getImageData(0, 0, tileSize, tileSize);
    const d = imgData.data;
    for (let p = 0; p < d.length; p += 4) {
      const lum = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
      const graded = Math.min(255, Math.max(0, (lum - 128) * 1.14 + 132));
      d[p] = graded;
      d[p + 1] = graded;
      d[p + 2] = Math.min(255, graded + 3);
    }
    monoCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(monoScratch, dx, dy, tileSize, tileSize);
  };

  const completion = (async () => {
    const batchSize = 6;
    for (let i = 0; i < jobs.length; i += batchSize) {
      if (signal?.aborted) return;
      const batch = jobs.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (job) => {
          if (signal?.aborted) return;
          const baseImg = await loadTileImage(
            `/api/map-tiles/${serverStyle}/${grid.zoom}/${job.tx}/${job.ty}${bustQuery}`,
          );
          if (signal?.aborted) return;

          if (baseImg) {
            if (isMonochrome) {
              drawMonochromeTile(baseImg, job.dx, job.dy);
            } else {
              ctx.drawImage(baseImg, job.dx, job.dy, tileSize, tileSize);
            }
            if (overlayHybridLabels || overlayMonoLabels) {
              const labelLayer = overlayHybridLabels ? 'satellite-labels' : 'monochrome-labels';
              const labelImg = await loadTileImage(
                `/api/map-tiles/${labelLayer}/${grid.zoom}/${job.tx}/${job.ty}${bustQuery}`,
              );
              if (!signal?.aborted && labelImg) {
                if (isMonochrome) {
                  ctx.save();
                  ctx.globalAlpha = 0.86;
                  ctx.drawImage(labelImg, job.dx, job.dy, tileSize, tileSize);
                  ctx.restore();
                } else {
                  ctx.drawImage(labelImg, job.dx, job.dy, tileSize, tileSize);
                }
              }
            }
            loadedTiles += 1;
            texture.needsUpdate = true;
          } else {
            failedTiles += 1;
          }

          const finished = loadedTiles + failedTiles;
          onProgress?.({
            phase:
              finished < totalTiles
                ? 'loading'
                : failedTiles === 0
                  ? 'ready'
                  : loadedTiles > 0
                    ? 'partial'
                    : 'error',
            loadedTiles,
            failedTiles,
            totalTiles,
            zoom: grid.zoom,
          });
        }),
      );
    }
  })();

  return { texture, canvas, completion };
}

function hash2d(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

/**
 * Computes seamless tileable micro-grain bump & roughness pixel buffers for Three.js PBR ground overlays.
 */
export function computeTerrainSurfaceDetailPixels(
  size: number,
  style: MapStyle3D,
): { bumpRgba: Uint8Array; roughnessRgba: Uint8Array } {
  const normalized = normalizeMapStyle3D(style);
  const bumpRgba = new Uint8Array(size * size * 4);
  const roughnessRgba = new Uint8Array(size * size * 4);

  const isNatural = normalized === 'terrain' || normalized === 'satellite' || normalized === 'hybrid';
  const baseRough = isNatural ? 215 : normalized === 'monochrome' ? 228 : 205;
  const roughVar = isNatural ? 34 : 20;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Tile-periodic trigonometric + pseudo-noise micro-relief
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const coarse = Math.sin(u * 3 + Math.cos(v * 2)) * Math.cos(v * 3 - Math.sin(u * 2));
      const grain = (hash2d(x % 64, y % 64) - 0.5) * 0.65 + (hash2d((x * 2) % 64, (y * 2) % 64) - 0.5) * 0.35;
      const heightVal = isNatural ? coarse * 0.48 + grain * 0.52 : grain * 0.72 + coarse * 0.28;

      const b = Math.min(255, Math.max(0, Math.round(128 + heightVal * 95)));
      const r = Math.min(255, Math.max(110, Math.round(baseRough - heightVal * roughVar)));
      const idx = (y * size + x) * 4;
      bumpRgba[idx] = b;
      bumpRgba[idx + 1] = b;
      bumpRgba[idx + 2] = b;
      bumpRgba[idx + 3] = 255;

      roughnessRgba[idx] = r;
      roughnessRgba[idx + 1] = r;
      roughnessRgba[idx + 2] = r;
      roughnessRgba[idx + 3] = 255;
    }
  }
  return { bumpRgba, roughnessRgba };
}

/**
 * Generates Three.js linear-space PBR bump & roughness DataTextures for the 3D terrain mesh.
 */
export function createTerrainSurfaceDetailMaps(
  style: MapStyle3D,
  widthMeters: number,
  depthMeters: number,
  maxAnisotropy: number,
): { bumpMap: THREE.DataTexture; roughnessMap: THREE.DataTexture } {
  const size = 128;
  const { bumpRgba, roughnessRgba } = computeTerrainSurfaceDetailPixels(size, style);
  const repeatX = Math.max(6, Math.round(widthMeters / 34));
  const repeatY = Math.max(6, Math.round(depthMeters / 34));

  const configureTex = (data: Uint8Array) => {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
    tex.needsUpdate = true;
    return tex;
  };

  return {
    bumpMap: configureTex(bumpRgba),
    roughnessMap: configureTex(roughnessRgba),
  };
}

/**
 * Computes RGBA pixel data for a Three.js terrain relief overlay texture:
 * directional NW solar hillshade, cartographic elevation contour lines, and subtle edge atmosphere blend.
 */
export function computeTerrainReliefOverlayPixels(
  size: number,
  gridCenterX: number,
  gridCenterZ: number,
  widthMeters: number,
  depthMeters: number,
  track: Studio3DTrack,
  demGrid: RealDemGrid | null,
  style: MapStyle3D,
): Uint8Array {
  const normalized = normalizeMapStyle3D(style);
  const rgba = new Uint8Array(size * size * 4);
  const elevGrid = new Float32Array(size * size);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let row = 0; row < size; row += 1) {
    const v = row / Math.max(1, size - 1);
    const zM = gridCenterZ + (v - 0.5) * depthMeters;
    for (let col = 0; col < size; col += 1) {
      const u = col / Math.max(1, size - 1);
      const xM = gridCenterX + (u - 0.5) * widthMeters;
      const y = sampleTerrainY(xM, zM, track, demGrid);
      elevGrid[row * size + col] = y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const reliefSpan = Math.max(0, maxY - minY);
  const contourInterval = reliefSpan >= 60 ? 10 : reliefSpan >= 20 ? 5 : 2.5;
  const stepX = widthMeters / Math.max(1, size - 1);
  const stepZ = depthMeters / Math.max(1, size - 1);

  // NW directional sun vector
  const lx = -0.62;
  const ly = 0.62;
  const lz = -0.48;

  const isSatellite = normalized === 'satellite' || normalized === 'hybrid';
  const isTerrain = normalized === 'terrain';
  const isMono = normalized === 'monochrome';

  for (let row = 0; row < size; row += 1) {
    const vNorm = row / Math.max(1, size - 1);
    const rPrev = Math.max(0, row - 1);
    const rNext = Math.min(size - 1, row + 1);
    for (let col = 0; col < size; col += 1) {
      const uNorm = col / Math.max(1, size - 1);
      const cPrev = Math.max(0, col - 1);
      const cNext = Math.min(size - 1, col + 1);

      const idx = (row * size + col) * 4;
      const yCenter = elevGrid[row * size + col];
      const dydx = (elevGrid[row * size + cNext] - elevGrid[row * size + cPrev]) / (stepX * (cNext - cPrev || 1));
      const dydz = (elevGrid[rNext * size + col] - elevGrid[rPrev * size + col]) / (stepZ * (rNext - rPrev || 1));

      // Surface normal (-dydx, 1, -dydz) normalized
      const invLen = 1 / Math.hypot(dydx, 1, dydz);
      const nx = -dydx * invLen;
      const ny = 1 * invLen;
      const nz = -dydz * invLen;
      const ndotl = Math.max(-1, Math.min(1, nx * lx + ny * ly + nz * lz));

      // Hillshade modulation vs neutral 0.62
      const shadeDelta = ndotl - 0.62;
      const slopeMag = Math.hypot(dydx, dydz);

      let outR = 128;
      let outG = 128;
      let outB = 128;
      let outA = 0;

      if (reliefSpan >= 1.5 && slopeMag > 0.008) {
        if (shadeDelta < 0) {
          // Valley / leeward slope shadow
          outR = isTerrain ? 32 : 15;
          outG = isTerrain ? 41 : 23;
          outB = isTerrain ? 52 : 42;
          outA = Math.min(isSatellite ? 92 : 112, Math.round(Math.abs(shadeDelta) * (isTerrain ? 210 : 165)));
        } else {
          // Warm sunlit ridge catch
          outR = 255;
          outG = isTerrain ? 248 : 252;
          outB = isTerrain ? 225 : 244;
          outA = Math.min(68, Math.round(shadeDelta * (isTerrain ? 155 : 110)));
        }
      }

      // Cartographic elevation contour lines
      if (reliefSpan >= 2.5 && (isTerrain || isMono || !isSatellite)) {
        const mod = (yCenter - minY) / contourInterval;
        const frac = mod - Math.floor(mod);
        const distToLine = Math.min(frac, 1 - frac);
        const lineThreshold = isTerrain ? 0.065 : isMono ? 0.055 : 0.04;
        if (distToLine < lineThreshold) {
          const contourStrength = (1 - distToLine / lineThreshold) * (isTerrain ? 0.42 : isMono ? 0.34 : 0.16);
          const contourA = Math.round(contourStrength * 255);
          if (contourA > outA) {
            outR = isTerrain ? 78 : 51;
            outG = isTerrain ? 64 : 65;
            outB = isTerrain ? 46 : 85;
            outA = contourA;
          }
        }
      }

      // Subtle atmospheric horizon feather at extreme perimeter (outer 8%)
      const edgeDist = Math.max(Math.abs(uNorm - 0.5) * 2, Math.abs(vNorm - 0.5) * 2);
      if (edgeDist > 0.88) {
        const fade = Math.min(1, (edgeDist - 0.88) / 0.12);
        const edgeAlpha = Math.round(fade * fade * (isSatellite ? 60 : 45));
        if (edgeAlpha > outA) {
          outR = isSatellite ? 15 : 226;
          outG = isSatellite ? 23 : 232;
          outB = isSatellite ? 42 : 240;
          outA = edgeAlpha;
        }
      }

      rgba[idx] = outR;
      rgba[idx + 1] = outG;
      rgba[idx + 2] = outB;
      rgba[idx + 3] = outA;
    }
  }

  return rgba;
}

/**
 * Generates a Three.js RGBA overlay DataTexture containing elevation hillshade and contour lines.
 */
export function createTerrainReliefOverlayTexture(
  gridCenterX: number,
  gridCenterZ: number,
  widthMeters: number,
  depthMeters: number,
  track: Studio3DTrack,
  demGrid: RealDemGrid | null,
  style: MapStyle3D,
  maxAnisotropy: number,
): THREE.DataTexture {
  const size = 192;
  const rgba = computeTerrainReliefOverlayPixels(
    size,
    gridCenterX,
    gridCenterZ,
    widthMeters,
    depthMeters,
    track,
    demGrid,
    style,
  );
  const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

/**
 * Fetches real OSM highway/road vectors around the route and converts to local meters.
 */
export async function fetchOsmRoadsForTrack(
  track: Studio3DTrack,
  signal?: AbortSignal,
): Promise<OsmRoadWay[]> {
  const padLat = Math.max(0.003, (track.maxLat - track.minLat) * 0.3);
  const padLon = Math.max(0.003, (track.maxLon - track.minLon) * 0.3);
  const south = Math.max(-85, track.minLat - padLat);
  const north = Math.min(85, track.maxLat + padLat);
  const west = track.minLon - padLon;
  const east = track.maxLon + padLon;

  try {
    const res = await fetch(
      `/api/map-roads?south=${south.toFixed(5)}&west=${west.toFixed(5)}&north=${north.toFixed(5)}&east=${east.toFixed(5)}`,
      { signal },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      roads?: Array<{
        id: string;
        highway: string;
        widthM: number;
        geometry: Array<{ lat: number; lon: number }>;
      }>;
    };
    if (!json.roads || json.roads.length === 0) return [];
    return json.roads.map((r) => ({
      id: r.id,
      highway: r.highway,
      widthM: r.widthM,
      layer: 0,
      points: r.geometry.map((pt) =>
        latLonToLocalMeters(pt.lat, pt.lon, track.centerLat, track.centerLon),
      ),
    }));
  } catch {
    return [];
  }
}

/**
 * Prioritizes footprints nearest to the running route corridor so detailed landmarks around
 * streets are always kept first even in dense downtown areas.
 */
export function prioritizeBuildingsNearRoute(
  buildings: OsmBuildingFootprint[],
  track: Studio3DTrack,
  limit = 320,
): OsmBuildingFootprint[] {
  if (buildings.length <= 1) return buildings.slice(0, limit);
  const pts = track.points;
  const stride = Math.max(1, Math.floor(pts.length / 80));

  const scored = buildings.map((b) => {
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < b.polygon.length; i += 1) {
      cx += b.polygon[i].xM;
      cz += b.polygon[i].zM;
    }
    cx /= Math.max(1, b.polygon.length);
    cz /= Math.max(1, b.polygon.length);

    let minDistSq = Infinity;
    for (let i = 0; i < pts.length; i += stride) {
      const dx = cx - pts[i].xM;
      const dz = cz - pts[i].zM;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDistSq) minDistSq = dSq;
    }

    return {
      ...b,
      distanceToRouteM: Math.sqrt(minDistSq),
    };
  });

  scored.sort((a, b) => (a.distanceToRouteM ?? 0) - (b.distanceToRouteM ?? 0));
  return scored.slice(0, limit);
}

/**
 * Fetches real OSM 3D building footprints around the route, prioritized by proximity to corridor.
 */
export async function fetchOsmBuildingsForTrack(
  track: Studio3DTrack,
  signal?: AbortSignal,
): Promise<OsmBuildingFootprint[]> {
  const padLat = Math.max(0.0025, (track.maxLat - track.minLat) * 0.25);
  const padLon = Math.max(0.0025, (track.maxLon - track.minLon) * 0.25);
  const south = Math.max(-85, track.minLat - padLat);
  const north = Math.min(85, track.maxLat + padLat);
  const west = track.minLon - padLon;
  const east = track.maxLon + padLon;

  try {
    const res = await fetch(
      `/api/map-buildings?south=${south.toFixed(5)}&west=${west.toFixed(5)}&north=${north.toFixed(5)}&east=${east.toFixed(5)}`,
      { signal },
    );
    if (res.ok) {
      const json = (await res.json()) as {
        buildings?: Array<{
          id: string;
          polygon: Array<{ lat: number; lon: number }>;
          heightM: number;
          levels?: number;
        }>;
      };
      if (json.buildings && json.buildings.length > 0) {
        const mapped: OsmBuildingFootprint[] = json.buildings.map((b) => ({
          id: b.id,
          heightM: b.heightM,
          ...(b.levels ? { levels: b.levels } : {}),
          polygon: b.polygon.map((pt) =>
            latLonToLocalMeters(pt.lat, pt.lon, track.centerLat, track.centerLon),
          ),
        }));
        return prioritizeBuildingsNearRoute(mapped, track, 320);
      }
    }
  } catch {
    // Return empty cleanly when offline or Overpass unavailable
  }

  return [];
}

/**
 * Builds a single terrain-draped BufferGeometry representing real OSM road ways
 * (1 GPU draw call, vertex-colored by road hierarchy).
 */
export function buildOsmRoadNetworkGeometry(
  roads: OsmRoadWay[],
  track: Studio3DTrack,
  demGrid: RealDemGrid | null,
  isNight: boolean,
  style: MapStyle3D = 'standard',
): THREE.BufferGeometry | null {
  if (roads.length === 0) return null;

  const isLiberty = normalizeMapStyle3D(style) === 'liberty';
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();

  for (let r = 0; r < roads.length; r += 1) {
    const way = roads[r];
    if (way.points.length < 2) continue;

    const halfW = Math.max(1.0, way.widthM * 0.45);
    const isHighway =
      way.highway.startsWith('motorway') ||
      way.highway.startsWith('trunk') ||
      way.highway.startsWith('primary');
    const isMajor = isHighway || way.highway.startsWith('secondary');
    const isPath =
      way.highway === 'footway' ||
      way.highway === 'path' ||
      way.highway === 'cycleway' ||
      way.highway === 'pedestrian';

    if (isNight) {
      c.set(isMajor ? '#334155' : isPath ? '#1E293B' : '#273549');
    } else if (isLiberty) {
      // OpenFreeMap Liberty highway palette: warm amber trunks/primaries, crisp white streets
      c.set(isHighway ? '#FCD673' : isMajor ? '#FEF3C7' : isPath ? '#ECE8DE' : '#FFFFFF');
    } else {
      c.set(isMajor ? '#FFFFFF' : isPath ? '#E2E8F0' : '#F1F5F9');
    }

    const liftY = isMajor ? 0.11 : isPath ? 0.06 : 0.085;

    for (let i = 0; i < way.points.length - 1; i += 1) {
      const a = way.points[i];
      const b = way.points[i + 1];
      const dx = b.xM - a.xM;
      const dz = b.zM - a.zM;
      const len = Math.hypot(dx, dz);
      if (len < 0.25) continue;

      const nx = (-dz / len) * halfW;
      const nz = (dx / len) * halfW;

      const ya = sampleTerrainY(a.xM, a.zM, track, demGrid) + liftY;
      const yb = sampleTerrainY(b.xM, b.zM, track, demGrid) + liftY;

      const ax0 = a.xM - nx;
      const az0 = a.zM - nz;
      const ax1 = a.xM + nx;
      const az1 = a.zM + nz;

      const bx0 = b.xM - nx;
      const bz0 = b.zM - nz;
      const bx1 = b.xM + nx;
      const bz1 = b.zM + nz;

      // Two triangles (a0, a1, b0) & (a1, b1, b0) facing +Y
      positions.push(
        ax0, ya, az0,
        ax1, ya, az1,
        bx0, yb, bz0,
        ax1, ya, az1,
        bx1, yb, bz1,
        bx0, yb, bz0,
      );
      for (let k = 0; k < 6; k += 1) {
        normals.push(0, 1, 0);
        colors.push(c.r, c.g, c.b);
      }
    }
  }

  if (positions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Extrudes and batches all real OSM building footprints into a single merged BufferGeometry
 * (1 draw call) with subtle architectural tone variation by height & footprint ID.
 */
export function buildMergedOsmBuildingsGeometry(
  buildings: OsmBuildingFootprint[],
  track: Studio3DTrack,
  demGrid: RealDemGrid | null,
  isNight: boolean,
  isEvening: boolean,
  style: MapStyle3D = 'standard',
): THREE.BufferGeometry | null {
  if (buildings.length === 0) return null;

  const isLiberty = normalizeMapStyle3D(style) === 'liberty';
  const partGeos: THREE.BufferGeometry[] = [];
  const paletteDay = isLiberty
    ? ['#EDE8DF', '#E5DFD3', '#F3EFE7', '#DFD8CB']
    : ['#E2E8F0', '#CBD5E1', '#F1F5F9', '#DCE4EE'];
  const paletteEvening = ['#CBD5E1', '#B8C4D4', '#E2E8F0'];
  const paletteNight = ['#1E293B', '#283548', '#172033'];
  const palette = isNight ? paletteNight : isEvening ? paletteEvening : paletteDay;
  const col = new THREE.Color();

  for (let i = 0; i < buildings.length; i += 1) {
    const b = buildings[i];
    if (b.polygon.length < 3) continue;

    let cx = 0;
    let cz = 0;
    for (let p = 0; p < b.polygon.length; p += 1) {
      cx += b.polygon[p].xM;
      cz += b.polygon[p].zM;
    }
    cx /= b.polygon.length;
    cz /= b.polygon.length;

    const shape = new THREE.Shape();
    b.polygon.forEach((pt, idx) => {
      const lx = pt.xM - cx;
      const ly = -(pt.zM - cz);
      if (idx === 0) shape.moveTo(lx, ly);
      else shape.lineTo(lx, ly);
    });
    shape.closePath();

    const rawGeo = new THREE.ExtrudeGeometry(shape, {
      depth: b.heightM,
      bevelEnabled: false,
    });
    rawGeo.rotateX(-Math.PI / 2);

    const baseY = sampleTerrainY(cx, cz, track, demGrid) - 1.8;
    rawGeo.translate(cx, baseY, cz);

    const nonIdx = rawGeo.index ? rawGeo.toNonIndexed() : rawGeo;
    if (nonIdx !== rawGeo) rawGeo.dispose();

    const posAttr = nonIdx.getAttribute('position');
    if (!posAttr || posAttr.count === 0) {
      nonIdx.dispose();
      continue;
    }

    // Remove uv attribute if not needed so merge attributes match uniformly
    if (nonIdx.getAttribute('uv')) nonIdx.deleteAttribute('uv');
    if (!nonIdx.getAttribute('normal')) nonIdx.computeVertexNormals();

    col.set(palette[i % palette.length]);
    const colorArr = new Float32Array(posAttr.count * 3);
    for (let v = 0; v < posAttr.count; v += 1) {
      // Slight roof brighten compared to foundation for natural daylight readability
      const relH = THREE.MathUtils.clamp((posAttr.getY(v) - baseY) / Math.max(4, b.heightM), 0, 1);
      const shade = 0.88 + relH * 0.14;
      colorArr[v * 3] = Math.min(1, col.r * shade);
      colorArr[v * 3 + 1] = Math.min(1, col.g * shade);
      colorArr[v * 3 + 2] = Math.min(1, col.b * shade);
    }
    nonIdx.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
    partGeos.push(nonIdx);
  }

  if (partGeos.length === 0) return null;

  const merged = mergeGeometries(partGeos, false);
  for (const g of partGeos) g.dispose();
  if (!merged) return null;

  merged.computeBoundingSphere();
  return merged;
}
