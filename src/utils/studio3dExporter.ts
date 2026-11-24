import type {
  ExportConfig,
  RunnerConfig,
  Studio3DTrack,
  Studio3DTrackPoint,
} from '../types/studio3d';
import { formatDuration, formatPace } from './runParser';
import type { Studio3DAudioEngine } from './studio3dAudio';
import { sampleTrackPointByDistance } from './studio3dGpsEngine';

export interface Studio3DFrameTelemetry {
  point: Studio3DTrackPoint;
  elapsedSec: number;
  distanceKm: number;
  elevGainSoFarM: number;
  isFinishPhase: boolean;
}

export function getExportDurationSec(config: ExportConfig): number {
  if (config.durationPreset === 'custom') {
    return Math.min(180, Math.max(5, Math.round(config.customDurationSec || 25)));
  }
  return config.durationPreset;
}

/**
 * Samples interpolated telemetry along the 3D route for any normalized timeline progress (0..1).
 */
export function sampleTrackTelemetryAtProgress(
  track: Studio3DTrack,
  rawProgress: number,
  includeFinishPose: boolean,
): Studio3DFrameTelemetry {
  const finishThreshold = includeFinishPose ? 0.88 : 1.0;
  const isFinishPhase = includeFinishPose && rawProgress >= finishThreshold;
  const routeProgress = Math.min(1, Math.max(0, rawProgress / finishThreshold));

  const pts = track.points;
  if (pts.length === 0) {
    throw new Error('Track has no points.');
  }
  if (pts.length === 1 || routeProgress <= 0) {
    return {
      point: pts[0],
      elapsedSec: 0,
      distanceKm: 0,
      elevGainSoFarM: 0,
      isFinishPhase: false,
    };
  }
  if (routeProgress >= 1) {
    return {
      point: pts[pts.length - 1],
      elapsedSec: track.totalDurationSec,
      distanceKm: track.totalDistanceKm,
      elevGainSoFarM: track.elevationGainM,
      isFinishPhase,
    };
  }

  const point = sampleTrackPointByDistance(pts, track.totalDistanceKm, routeProgress);

  return {
    point,
    elapsedSec: point.elapsedSec,
    distanceKm: point.distanceKm,
    elevGainSoFarM: Math.round(track.elevationGainM * routeProgress),
    isFinishPhase,
  };
}

export interface StartFinishBannerState {
  startAlpha: number; // 0..1
  startOffsetY: number; // px offset at 720p scale
  finishAlpha: number; // 0..1
  finishOffsetY: number; // px offset at 720p scale
}

/**
 * Computes synchronized Start (0..14%) and Finish (finishThreshold..100%) animated banner states
 * shared identically by the 9:16 React phone preview and the 2D video export compositor.
 */
export function computeStartFinishBannerState(
  rawProgress: number,
  includeFinishPose: boolean,
): StartFinishBannerState {
  const p = Math.min(1, Math.max(0, rawProgress));
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

  // Start banner: active from 0..0.14 (visible at t=0, slides/fades out smoothly 0.10..0.14)
  let startAlpha = 0;
  let startOffsetY = -14;
  if (p <= 0.14) {
    if (p < 0.02) {
      startAlpha = 0.72 + 0.28 * easeOutCubic(p / 0.02);
    } else if (p <= 0.105) {
      startAlpha = 1;
    } else {
      startAlpha = Math.max(0, 1 - (p - 0.105) / 0.035);
    }
    startOffsetY = (1 - startAlpha) * -14;
  }

  // Finish banner: enters cleanly on finish threshold
  const finishThreshold = includeFinishPose ? 0.88 : 0.94;
  let finishAlpha = 0;
  let finishOffsetY = 16;
  if (p >= finishThreshold) {
    const enterT = (p - finishThreshold) / 0.035;
    finishAlpha = p === finishThreshold ? 0.78 : easeOutCubic(enterT);
    finishOffsetY = (1 - finishAlpha) * 16;
  }

  return {
    startAlpha,
    startOffsetY,
    finishAlpha,
    finishOffsetY,
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export interface MiniMapPoint {
  x: number;
  y: number;
}

export interface MiniMapGeometry {
  polyline: MiniMapPoint[];
  startPt: MiniMapPoint;
  endPt: MiniMapPoint;
  runnerPt: MiniMapPoint;
}

/**
 * Projects a GPS track into normalized 2D coordinates inside a square mini-map box,
 * preserving geographic aspect ratio and returning the live runner marker along routeProgress (0..1).
 */
export function computeMiniMapGeometry(
  track: Studio3DTrack,
  routeProgress: number,
  boxSize: number,
  pad: number,
): MiniMapGeometry {
  const pts = track.points;
  const fallbackPt = { x: boxSize / 2, y: boxSize / 2 };
  if (pts.length === 0) {
    return { polyline: [fallbackPt], startPt: fallbackPt, endPt: fallbackPt, runnerPt: fallbackPt };
  }

  const latSpanRaw = Math.max(1e-5, track.maxLat - track.minLat);
  const cosLat = Math.max(0.25, Math.cos((track.centerLat * Math.PI) / 180));
  const lonSpanRaw = Math.max(1e-5, (track.maxLon - track.minLon) * cosLat);
  const maxSpan = Math.max(latSpanRaw, lonSpanRaw);
  const inner = Math.max(4, boxSize - pad * 2);

  const offsetX = pad + ((maxSpan - lonSpanRaw) / maxSpan) * inner * 0.5;
  const offsetY = pad + ((maxSpan - latSpanRaw) / maxSpan) * inner * 0.5;

  const project = (lat: number, lon: number): MiniMapPoint => {
    const nx = ((lon - track.minLon) * cosLat) / maxSpan;
    const ny = (track.maxLat - lat) / maxSpan;
    return {
      x: offsetX + nx * inner,
      y: offsetY + ny * inner,
    };
  };

  // Downsample long tracks cleanly to <= 120 vertices for crisp SVG/Canvas rendering
  const step = Math.max(1, Math.floor(pts.length / 120));
  const polyline: MiniMapPoint[] = [];
  for (let i = 0; i < pts.length; i += step) {
    polyline.push(project(pts[i].lat, pts[i].lon));
  }
  const last = pts[pts.length - 1];
  const lastProj = project(last.lat, last.lon);
  const tail = polyline[polyline.length - 1];
  if (!tail || Math.abs(tail.x - lastProj.x) > 0.1 || Math.abs(tail.y - lastProj.y) > 0.1) {
    polyline.push(lastProj);
  }

  const clampedP = Math.min(1, Math.max(0, routeProgress));
  const distPt = sampleTrackPointByDistance(pts, track.totalDistanceKm, clampedP);

  return {
    polyline,
    startPt: polyline[0],
    endPt: lastProj,
    runnerPt: project(distPt.lat, distPt.lon),
  };
}

/**
 * Draws the broadcast 9:16 HUD overlay onto the offscreen video compositor canvas.
 */
function paintBroadcastHudOverlay(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  track: Studio3DTrack;
  runner: RunnerConfig;
  telemetry: Studio3DFrameTelemetry;
  progress: number;
  includeFinishPose: boolean;
}) {
  const { ctx, width, height, track, runner, telemetry, progress, includeFinishPose } = params;
  const s = width / 720;
  const finishThreshold = includeFinishPose ? 0.88 : 1.0;
  const routeProgress = Math.min(1, Math.max(0, progress / finishThreshold));

  // Top & bottom contrast scrims for crisp WCAG AA legibility
  const topGrad = ctx.createLinearGradient(0, 0, 0, 220 * s);
  topGrad.addColorStop(0, 'rgba(2, 6, 23, 0.84)');
  topGrad.addColorStop(0.65, 'rgba(2, 6, 23, 0.42)');
  topGrad.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, width, 220 * s);

  const botGrad = ctx.createLinearGradient(0, height - 350 * s, 0, height);
  botGrad.addColorStop(0, 'rgba(2, 6, 23, 0)');
  botGrad.addColorStop(0.35, 'rgba(2, 6, 23, 0.56)');
  botGrad.addColorStop(1, 'rgba(2, 6, 23, 0.90)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, height - 350 * s, width, 350 * s);

  const padX = 36 * s;

  // Top-left header card (leaves room for top-right GPS mini-map inset)
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(16, 185, 129, 0.95)';
  ctx.font = `700 ${Math.round(13 * s)}px JetBrains Mono, monospace`;
  ctx.fillText(`SPORTBYTE · #${(runner.bibNumber || '001').slice(0, 8)}`, padX, 46 * s);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${Math.round(26 * s)}px Outfit, sans-serif`;
  ctx.fillText(track.title.slice(0, 24), padX, 78 * s);

  ctx.fillStyle = 'rgba(226, 232, 240, 0.86)';
  ctx.font = `600 ${Math.round(15 * s)}px JetBrains Mono, monospace`;
  ctx.fillText(
    `${track.date} · ${track.location.slice(0, 22)}`,
    padX,
    104 * s,
  );

  // Top-right GPS mini-map radar inset
  const mmSize = 114 * s;
  const mmX = width - padX - mmSize;
  const mmY = 30 * s;
  drawRoundedRect(ctx, mmX, mmY, mmSize, mmSize, 16 * s);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.stroke();

  ctx.fillStyle = 'rgba(148, 163, 184, 0.92)';
  ctx.font = `700 ${Math.round(11 * s)}px JetBrains Mono, monospace`;
  ctx.fillText('GPS', mmX + 10 * s, mmY + 18 * s);

  const mmGeom = computeMiniMapGeometry(track, routeProgress, mmSize, 18 * s);
  if (mmGeom.polyline.length >= 2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(mmX + mmGeom.polyline[0].x, mmY + mmGeom.polyline[0].y);
    for (let i = 1; i < mmGeom.polyline.length; i += 1) {
      ctx.lineTo(mmX + mmGeom.polyline[i].x, mmY + mmGeom.polyline[i].y);
    }
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = Math.max(2, 3.2 * s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Start marker
    ctx.beginPath();
    ctx.arc(mmX + mmGeom.startPt.x, mmY + mmGeom.startPt.y, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#10B981';
    ctx.fill();

    // Active runner GPS marker
    ctx.beginPath();
    ctx.arc(mmX + mmGeom.runnerPt.x, mmY + mmGeom.runnerPt.y, 5.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#0284C7';
    ctx.lineWidth = Math.max(1.5, 2.2 * s);
    ctx.stroke();
    ctx.restore();
  }

  // Animated Start & Finish Popup Overlay Banners (positioned clear below header & GPS inset)
  const banner = computeStartFinishBannerState(progress, includeFinishPose);

  if (banner.startAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = banner.startAlpha;
    const bx = padX;
    const bw = width - padX * 2;
    const bh = 88 * s;
    const by = (162 + banner.startOffsetY) * s;

    drawRoundedRect(ctx, bx, by, bw, bh, 18 * s);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
    ctx.lineWidth = Math.max(1.5, 2 * s);
    ctx.stroke();

    // START badge
    drawRoundedRect(ctx, bx + 18 * s, by + 20 * s, 96 * s, 48 * s, 12 * s);
    ctx.fillStyle = '#10B981';
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 ${Math.round(19 * s)}px JetBrains Mono, monospace`;
    ctx.fillText('START', bx + (18 + 48) * s, by + 51 * s);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${Math.round(21 * s)}px Outfit, sans-serif`;
    ctx.fillText(
      `${track.totalDistanceKm.toFixed(2)} KM · ${track.location.slice(0, 22)}`,
      bx + 132 * s,
      by + 42 * s,
    );
    ctx.fillStyle = '#A7F3D0';
    ctx.font = `600 ${Math.round(14 * s)}px JetBrains Mono, monospace`;
    ctx.fillText(
      `#${runner.bibNumber || '001'} ${(runner.runnerName || 'Pelari').slice(0, 22)}`,
      bx + 132 * s,
      by + 66 * s,
    );
    ctx.restore();
  }

  if (banner.finishAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = banner.finishAlpha;
    const bx = padX;
    const bw = width - padX * 2;
    const bh = 104 * s;
    const by = (162 + banner.finishOffsetY) * s;

    drawRoundedRect(ctx, bx, by, bw, bh, 20 * s);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.78)';
    ctx.lineWidth = Math.max(1.5, 2 * s);
    ctx.stroke();

    // FINISH badge
    drawRoundedRect(ctx, bx + 18 * s, by + 26 * s, 108 * s, 52 * s, 12 * s);
    ctx.fillStyle = '#F97316';
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 ${Math.round(20 * s)}px JetBrains Mono, monospace`;
    ctx.fillText('FINISH', bx + (18 + 54) * s, by + 59 * s);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${Math.round(21 * s)}px Outfit, sans-serif`;
    ctx.fillText(
      `${(runner.runnerName || 'Pelari').slice(0, 22)} · #${runner.bibNumber || '001'}`,
      bx + 142 * s,
      by + 44 * s,
    );
    ctx.fillStyle = '#FDE68A';
    ctx.font = `700 ${Math.round(16 * s)}px JetBrains Mono, monospace`;
    ctx.fillText(
      `${track.totalDistanceKm.toFixed(2)} km · ${formatDuration(track.totalDurationSec)} · ${formatPace(track.avgPaceSecPerKm)}/km`,
      bx + 142 * s,
      by + 74 * s,
    );
    ctx.restore();
  }

  // Bottom HUD Card (clean surface without backdrop blur, matching screenshot)
  const cardX = padX;
  const cardW = width - padX * 2;
  const cardH = 248 * s;
  const cardY = height - cardH - 32 * s;

  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 22 * s);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.stroke();

  // Headline live distance / total KM + elapsed time or FINISH!
  const distStr = telemetry.distanceKm.toFixed(2);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 ${Math.round(34 * s)}px JetBrains Mono, monospace`;
  ctx.fillText(distStr, cardX + 24 * s, cardY + 46 * s);
  const distW = ctx.measureText(distStr).width;

  ctx.fillStyle = '#34D399';
  ctx.font = `700 ${Math.round(16 * s)}px JetBrains Mono, monospace`;
  ctx.fillText(` / ${track.totalDistanceKm.toFixed(2)} KM`, cardX + 24 * s + distW, cardY + 45 * s);

  ctx.textAlign = 'right';
  ctx.fillStyle = telemetry.isFinishPhase ? '#34D399' : '#E2E8F0';
  ctx.font = `700 ${Math.round(18 * s)}px JetBrains Mono, monospace`;
  ctx.fillText(
    telemetry.isFinishPhase ? `FINISH · ${formatDuration(telemetry.elapsedSec)}` : formatDuration(telemetry.elapsedSec),
    cardX + cardW - 24 * s,
    cardY + 45 * s,
  );
  ctx.textAlign = 'left';

  // Progress bar directly under headline distance
  const barX = cardX + 24 * s;
  const barW = cardW - 48 * s;
  const barY = cardY + 62 * s;
  drawRoundedRect(ctx, barX, barY, barW, 8 * s, 4 * s);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fill();

  drawRoundedRect(ctx, barX, barY, Math.max(14 * s, barW * progress), 8 * s, 4 * s);
  ctx.fillStyle = runner.jerseyColor;
  ctx.fill();

  // 6 Live Metrics in clean 3x2 tabular grid
  const stats = [
    { label: 'PACE (/KM)', value: `${formatPace(telemetry.point.paceSecPerKm)} /km` },
    { label: 'HEART RATE', value: `${telemetry.point.hr} bpm` },
    { label: 'CADENCE', value: `${telemetry.point.cadence} spm` },
    { label: 'DISTANCE', value: `${telemetry.distanceKm.toFixed(2)} km` },
    { label: 'ELEV GAIN', value: `+${telemetry.elevGainSoFarM} m` },
    { label: 'TIME', value: formatDuration(telemetry.elapsedSec) },
  ];

  const colW = (cardW - 48 * s) / 3;
  stats.forEach((st, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const sx = cardX + 24 * s + col * colW;
    const sy = cardY + (102 + row * 68) * s;

    ctx.fillStyle = 'rgba(148, 163, 184, 0.92)';
    ctx.font = `600 ${Math.round(13 * s)}px JetBrains Mono, monospace`;
    ctx.fillText(st.label, sx, sy);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${Math.round(24 * s)}px JetBrains Mono, monospace`;
    ctx.fillText(st.value, sx, sy + 27 * s);
  });
}

export function pickSupportedVideoMimeType(): {
  mimeType: string;
  extension: 'mp4' | 'webm';
} {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: 'video/webm', extension: 'webm' };
  }
  const candidates: Array<{ mimeType: string; extension: 'mp4' | 'webm' }> = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
  for (const cand of candidates) {
    if (MediaRecorder.isTypeSupported(cand.mimeType)) {
      return cand;
    }
  }
  return { mimeType: '', extension: 'webm' };
}

export interface ExportVideoCallbacks {
  getSourceCanvas: () => HTMLCanvasElement | null;
  setProgress: (nextProgress: number) => void;
  audioEngine: Studio3DAudioEngine;
  track: Studio3DTrack;
  runner: RunnerConfig;
  exportConfig: ExportConfig;
  onPercent: (pct: number) => void;
  abortSignal: AbortSignal;
}

/**
 * Records a clean vertical 9:16 video (720x1280 or 1080x1920 at 30fps) combining
 * the live WebGL scene, broadcast HUD overlay, "Sportbyte" watermark, and Web Audio soundtrack.
 */
export async function recordStudio3DVideo({
  getSourceCanvas,
  setProgress,
  audioEngine,
  track,
  runner,
  exportConfig,
  onPercent,
  abortSignal,
}: ExportVideoCallbacks): Promise<{ blob: Blob; filename: string; extension: 'mp4' | 'webm' }> {
  const srcCanvas = getSourceCanvas();
  if (!srcCanvas) {
    throw new Error('Kanvas WebGL 3D belum siap.');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Browser ini belum mendukung perekaman video MediaRecorder.');
  }

  const width = exportConfig.quality === '1080p' ? 1080 : 720;
  const height = exportConfig.quality === '1080p' ? 1920 : 1280;
  const durationSec = getExportDurationSec(exportConfig);
  const fps = 30;

  const compCanvas = document.createElement('canvas');
  compCanvas.width = width;
  compCanvas.height = height;
  const ctx = compCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Gagal menginisialisasi kanvas kompositor 2D.');
  }

  // Configure and start Web Audio soundtrack synced with recording start
  await audioEngine.configure(
    exportConfig.musicPreset,
    exportConfig.customAudioUrl,
    exportConfig.volume,
  );
  if (exportConfig.musicPreset !== 'none') {
    await audioEngine.start();
  }

  const canvasStream = compCanvas.captureStream(fps);
  const combinedStream = new MediaStream();
  canvasStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

  if (exportConfig.musicPreset !== 'none') {
    const audioStream = audioEngine.getRecordingAudioStream();
    audioStream?.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
  }

  const { mimeType, extension } = pickSupportedVideoMimeType();
  const recorder = new MediaRecorder(combinedStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: exportConfig.quality === '1080p' ? 7_500_000 : 4_200_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    };
    recorder.onerror = () => {
      reject(new Error('Terjadi kesalahan saat merekam video 9:16.'));
    };
  });

  setProgress(0);
  recorder.start(250);

  const startMs = performance.now();
  const totalMs = durationSec * 1000;

  await new Promise<void>((resolve, reject) => {
    let rafId = 0;
    const step = () => {
      if (abortSignal.aborted) {
        cancelAnimationFrame(rafId);
        reject(new Error('Ekspor video dibatalkan.'));
        return;
      }

      const elapsedMs = performance.now() - startMs;
      const p = Math.min(1, elapsedMs / totalMs);
      setProgress(p);
      onPercent(Math.round(p * 100));

      const liveCanvas = getSourceCanvas();
      if (liveCanvas) {
        // Cover-fit WebGL source canvas into exact 9:16 export frame
        const scale = Math.max(width / liveCanvas.width, height / liveCanvas.height);
        const dw = liveCanvas.width * scale;
        const dh = liveCanvas.height * scale;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(liveCanvas, (width - dw) / 2, (height - dh) / 2, dw, dh);
      }

      const telemetry = sampleTrackTelemetryAtProgress(
        track,
        p,
        exportConfig.includeFinishPose,
      );
      paintBroadcastHudOverlay({
        ctx,
        width,
        height,
        track,
        runner,
        telemetry,
        progress: p,
        includeFinishPose: exportConfig.includeFinishPose,
      });

      if (p >= 1) {
        resolve();
      } else {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
  }).catch((err) => {
    if (recorder.state !== 'inactive') recorder.stop();
    audioEngine.stop();
    throw err;
  });

  if (recorder.state !== 'inactive') {
    recorder.stop();
  }
  audioEngine.stop();
  const blob = await stopPromise;

  const safeSlug = track.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);

  return {
    blob,
    filename: `sportbyte-3d-${track.date}-${safeSlug || 'run'}-${exportConfig.quality}.${extension}`,
    extension,
  };
}
