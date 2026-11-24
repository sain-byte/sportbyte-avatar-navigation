import React, { useRef, useState } from 'react';
import {
  Box,
  Check,
  Download,
  Film,
  Map as MapIcon,
  MapPin,
  Music,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  User,
  Volume2,
  X,
} from 'lucide-react';
import {
  normalizeMapStyle3D,
  type CanonicalMapStyle3D,
  type CharacterStyle3D,
  type CustomModelAnimMode,
  type DurationPresetSec,
  type ExportConfig,
  type FinishPoseStyle3D,
  type GaitMode3D,
  type LightingMood3D,
  type MapConfig,
  type MapLoadStatus,
  type MusicPreset3D,
  type RouteSnapMode3D,
  type RouteVisualStyle3D,
  type RunnerAccessory,
  type RunnerConfig,
  type RunnerGender,
  type RunnerHairStyle,
  type Studio3DTrack,
  type VideoQuality3D,
} from '../../types/studio3d';
import {
  formatAvatarSizeMb,
  type SavedGlbAvatarSummary,
} from '../../utils/studio3dAvatarStorage';
import { getExportDurationSec } from '../../utils/studio3dExporter';
import type { CustomGlbStatus } from './CustomGlbRunner3D';

export type Studio3DTab = 'pelari' | 'peta' | 'export';

interface Studio3DPanelTabsProps {
  activeTab: Studio3DTab;
  onChangeTab: (tab: Studio3DTab) => void;
  runner: RunnerConfig;
  onChangeRunner: (next: RunnerConfig) => void;
  customModelStatus: CustomGlbStatus;
  savedAvatars: SavedGlbAvatarSummary[];
  activeSavedAvatarId: string | null;
  avatarStorageNotice: string | null;
  onSelectGlbFile: (file: File, replaceSavedId?: string) => void;
  onSaveCurrentGlbAvatar: () => void;
  onLoadSavedGlbAvatar: (id: string) => void;
  onDeleteSavedGlbAvatar: (id: string) => void;
  onClearGlbModel: () => void;
  mapConfig: MapConfig;
  onChangeMapConfig: (next: MapConfig) => void;
  mapLoadStatus: MapLoadStatus;
  routeSnapStatus?: 'idle' | 'matching' | 'matched' | 'fallback';
  onReloadMap: () => void;
  exportConfig: ExportConfig;
  onChangeExportConfig: (next: ExportConfig) => void;
  track: Studio3DTrack | null;
  onUpdateTrackInfo: (patch: Partial<Pick<Studio3DTrack, 'title' | 'date' | 'location'>>) => void;
  onAddCustomLandmark: (label: string, progress: number) => void;
  onRemoveLandmark: (id: string) => void;
  isExporting: boolean;
  exportPercent: number;
  exportError: string | null;
  lastExportInfo: { filename: string; sizeMb: string } | null;
  onStartExport: () => void;
  onCancelExport: () => void;
}

const FINISH_POSE_OPTIONS: Array<{
  id: FinishPoseStyle3D;
  label: string;
  desc: string;
}> = [
  { id: 'celebrate-jump', label: 'Selebrasi Lompat', desc: 'Lompat ceria & konfeti' },
  { id: 'exhausted-bow', label: 'Menunduk Kelelahan', desc: 'Tangan di lutut terengah' },
  { id: 'victory-raise', label: 'Angkat Tangan', desc: 'Tangan V kemenangan' },
];

const GAIT_OPTIONS: Array<{ id: GaitMode3D; label: string; desc: string }> = [
  { id: 'auto', label: 'Auto', desc: 'Ikut pace' },
  { id: 'walk', label: 'Jalan', desc: 'Santai' },
  { id: 'jog', label: 'Jog', desc: 'Sedang' },
  { id: 'run', label: 'Lari', desc: 'Penuh' },
  { id: 'sprint', label: 'Sprint', desc: 'Cepat' },
];

const GLB_ANIM_OPTIONS: Array<{ id: CustomModelAnimMode; label: string }> = [
  { id: 'auto', label: 'Auto (52 Tulang)' },
  { id: 'bones', label: '52 Tulang Penuh' },
  { id: 'clip', label: 'Klip Bawaan' },
];

const JERSEY_SWATCHES = ['#F97316', '#EF4444', '#2563EB', '#10B981', '#8B5CF6', '#EC4899', '#F59E0B', '#0F172A'];
const SHORTS_SWATCHES = ['#0F172A', '#1E293B', '#334155', '#1D4ED8', '#065F46', '#7C2D12', '#F8FAFC'];
const SHOE_SWATCHES = ['#38BDF8', '#F97316', '#A3E635', '#F43F5E', '#FACC15', '#FFFFFF', '#0F172A'];

export const Studio3DPanelTabs: React.FC<Studio3DPanelTabsProps> = ({
  activeTab,
  onChangeTab,
  runner,
  onChangeRunner,
  customModelStatus,
  savedAvatars,
  activeSavedAvatarId,
  avatarStorageNotice,
  onSelectGlbFile,
  onSaveCurrentGlbAvatar,
  onLoadSavedGlbAvatar,
  onDeleteSavedGlbAvatar,
  onClearGlbModel,
  mapConfig,
  onChangeMapConfig,
  mapLoadStatus,
  routeSnapStatus = 'idle',
  onReloadMap,
  exportConfig,
  onChangeExportConfig,
  track,
  onUpdateTrackInfo,
  onAddCustomLandmark,
  onRemoveLandmark,
  isExporting,
  exportPercent,
  exportError,
  lastExportInfo,
  onStartExport,
  onCancelExport,
}) => {
  const [newLandmarkLabel, setNewLandmarkLabel] = useState('');
  const [newLandmarkPct, setNewLandmarkPct] = useState(50);
  const mp3InputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const pendingReplaceIdRef = useRef<string | undefined>(undefined);

  const visibleLandmarks = (track?.landmarks ?? []).filter(
    (lm) => lm.type !== 'start' && lm.type !== 'finish',
  );

  const activeSavedSummary = savedAvatars.find((a) => a.id === activeSavedAvatarId) ?? null;
  const isSavedUpToDate = Boolean(
    activeSavedSummary &&
      activeSavedSummary.flip180 === Boolean(runner.customModelFlip180) &&
      activeSavedSummary.animMode === (runner.customModelAnimMode ?? 'auto'),
  );

  const tabs: Array<{ id: Studio3DTab; label: string; icon: React.ReactNode }> = [
    { id: 'pelari', label: 'Pelari', icon: <User className="w-3.5 h-3.5" aria-hidden="true" /> },
    { id: 'peta', label: 'Peta & Info', icon: <MapIcon className="w-3.5 h-3.5" aria-hidden="true" /> },
    { id: 'export', label: 'Export 9:16', icon: <Film className="w-3.5 h-3.5" aria-hidden="true" /> },
  ];

  const triggerGlbPicker = (replaceSavedId?: string) => {
    pendingReplaceIdRef.current = replaceSavedId;
    glbInputRef.current?.click();
  };

  const handleGlbUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetReplaceId = pendingReplaceIdRef.current;
    pendingReplaceIdRef.current = undefined;
    e.target.value = '';
    if (!file) return;
    onSelectGlbFile(file, targetReplaceId);
  };

  const handleMp3Upload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (exportConfig.customAudioUrl && exportConfig.customAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(exportConfig.customAudioUrl);
    }
    const url = URL.createObjectURL(file);
    onChangeExportConfig({
      ...exportConfig,
      musicPreset: 'custom-mp3',
      customAudioUrl: url,
      customAudioName: file.name,
    });
    e.target.value = '';
  };

  const isMapLoading = mapLoadStatus.phase === 'loading';
  const mapStatusText = isMapLoading
    ? `Memuat tile peta z${mapLoadStatus.zoom} (${mapLoadStatus.loadedTiles}/${mapLoadStatus.totalTiles})`
    : mapLoadStatus.phase === 'ready'
      ? `Peta asli z${mapLoadStatus.zoom} siap (${mapLoadStatus.loadedTiles}/${mapLoadStatus.totalTiles} tile)`
      : mapLoadStatus.phase === 'partial'
        ? `${mapLoadStatus.loadedTiles}/${mapLoadStatus.totalTiles} tile dimuat (${mapLoadStatus.failedTiles} gagal)`
        : 'Gagal memuat tile peta';

  return (
    <div
      data-testid="studio3d-menu-panel"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs"
    >
      {/* Clean Horizontal Menu Tabs */}
      <div
        role="tablist"
        aria-label="Pengaturan Studio 3D"
        className="flex items-center border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 px-3 sm:px-5 pt-2 gap-1"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`studio3d-tab-${tab.id}`}
              onClick={() => onChangeTab(tab.id)}
              className={`h-10 px-4 rounded-t-xl text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                active
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Area - Flat 3-Column Grid (no nested cards or trapped scrollbox) */}
      <div className="p-4 sm:p-6">
        {activeTab === 'pelari' && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            data-testid="studio3d-panel-pelari"
          >
            {/* Kolom 1: Model 3D, Gaya Gerak & Pose Finish */}
            <section className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Box className="w-3.5 h-3.5" aria-hidden="true" />
                  Karakter 3D
                </h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'chibi', label: 'Chibi Sporty' },
                      { id: 'realistic', label: 'Atlet Realistis' },
                      { id: 'custom-glb', label: 'Upload .GLB' },
                    ] as Array<{ id: CharacterStyle3D; label: string }>
                  ).map((cs) => (
                    <button
                      key={cs.id}
                      type="button"
                      data-testid={`studio3d-char-${cs.id}`}
                      onClick={() => onChangeRunner({ ...runner, characterStyle: cs.id })}
                      className={`h-9 px-2 rounded-lg border text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                        runner.characterStyle === cs.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {cs.label}
                    </button>
                  ))}
                </div>

                {runner.characterStyle === 'custom-glb' && (
                  <div className="pt-2 space-y-2.5 border-t border-slate-100 dark:border-slate-800">
                    <input
                      ref={glbInputRef}
                      type="file"
                      accept=".glb,.gltf"
                      className="hidden"
                      data-testid="studio3d-glb-input"
                      onChange={handleGlbUpload}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="studio3d-glb-upload-btn"
                        onClick={() => triggerGlbPicker(undefined)}
                        className="flex-1 h-9 px-3 rounded-lg bg-slate-900 dark:bg-blue-600 hover:opacity-90 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {runner.customModelName || 'Pilih File .GLB / .GLTF'}
                        </span>
                      </button>
                      {runner.customModelUrl && (
                        <button
                          type="button"
                          onClick={onClearGlbModel}
                          aria-label="Hapus model 3D kustom"
                          className="h-9 px-2.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {runner.customModelUrl && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          data-testid="studio3d-glb-replace-btn"
                          onClick={() => triggerGlbPicker(activeSavedAvatarId ?? undefined)}
                          className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                          <span>Ganti .GLB</span>
                        </button>
                        <button
                          type="button"
                          data-testid="studio3d-glb-save-btn"
                          onClick={onSaveCurrentGlbAvatar}
                          className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                            isSavedUpToDate
                              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                              : 'border-blue-600 bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {isSavedUpToDate ? (
                            <>
                              <Check className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Tersimpan</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-3 h-3" aria-hidden="true" />
                              <span>{activeSavedSummary ? 'Perbarui Simpanan' : 'Simpan Avatar'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {avatarStorageNotice && (
                      <p
                        data-testid="studio3d-glb-notice"
                        className="text-[11px] font-medium text-blue-600 dark:text-blue-400"
                      >
                        {avatarStorageNotice}
                      </p>
                    )}

                    {!runner.customModelUrl && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Mendukung karakter <strong>.GLB / .GLTF</strong> (Mixamo, ReadyPlayerMe, Blender Rigify). Anda bisa simpan avatar agar otomatis termuat ulang.
                      </p>
                    )}
                    {runner.customModelUrl && customModelStatus.loading && (
                      <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                        Memuat model 3D ke kanvas...
                      </p>
                    )}
                    {runner.customModelUrl && !customModelStatus.loading && !customModelStatus.error && (
                      <div className="space-y-2">
                        <p
                          data-testid="studio3d-glb-status"
                          className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium"
                        >
                          {customModelStatus.rigMode === 'clip'
                            ? `Klip animasi aktif (${customModelStatus.animationCount} klip) · ${customModelStatus.detectedBones} tulang`
                            : customModelStatus.rigMode === 'bones'
                              ? `Skeleton ${customModelStatus.detectedBones}/${customModelStatus.totalSkeletonBones ?? customModelStatus.detectedBones} tulang aktif · Lari & Pose Finish`
                              : 'Gerak langkah prosedural aktif'}
                        </p>

                        <div className="space-y-1">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Mode Animasi .GLB
                          </span>
                          <div className="grid grid-cols-3 gap-1">
                            {GLB_ANIM_OPTIONS.map((opt) => {
                              const disabled =
                                (opt.id === 'clip' && customModelStatus.animationCount === 0) ||
                                (opt.id === 'bones' && customModelStatus.detectedBones === 0);
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  disabled={disabled}
                                  data-testid={`studio3d-glb-anim-${opt.id}`}
                                  onClick={() =>
                                    onChangeRunner({ ...runner, customModelAnimMode: opt.id })
                                  }
                                  className={`h-7 px-1.5 rounded-md border text-[10px] font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                    (runner.customModelAnimMode ?? 'auto') === opt.id
                                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <label className="flex items-center justify-between py-1 cursor-pointer">
                          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                            Putar Arah Model 180°
                          </span>
                          <input
                            type="checkbox"
                            data-testid="studio3d-glb-flip180"
                            checked={Boolean(runner.customModelFlip180)}
                            onChange={(e) =>
                              onChangeRunner({ ...runner, customModelFlip180: e.target.checked })
                            }
                            className="w-4 h-4 accent-orange-500 rounded cursor-pointer"
                          />
                        </label>
                      </div>
                    )}
                    {customModelStatus.error && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                        {customModelStatus.error}
                      </p>
                    )}

                    {/* Saved GLB Avatars List */}
                    {savedAvatars.length > 0 && (
                      <div
                        data-testid="studio3d-glb-saved-list"
                        className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5"
                      >
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Avatar Tersimpan ({savedAvatars.length})
                        </span>
                        <div className="space-y-1">
                          {savedAvatars.map((av) => {
                            const isActive = av.id === activeSavedAvatarId;
                            return (
                              <div
                                key={av.id}
                                className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] ${
                                  isActive
                                    ? 'border-blue-300 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30'
                                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50'
                                }`}
                              >
                                <button
                                  type="button"
                                  data-testid={`studio3d-glb-load-${av.id}`}
                                  onClick={() => onLoadSavedGlbAvatar(av.id)}
                                  className="min-w-0 flex-1 text-left cursor-pointer"
                                  title={`Muat avatar ${av.name}`}
                                >
                                  <span className="block font-semibold text-slate-800 dark:text-slate-100 truncate">
                                    {av.name}
                                  </span>
                                  <span className="block font-mono-tabular text-[10px] text-slate-500 dark:text-slate-400">
                                    {formatAvatarSizeMb(av.sizeBytes)}
                                    {isActive ? ' · Aktif' : ''}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  data-testid={`studio3d-glb-replace-saved-${av.id}`}
                                  onClick={() => triggerGlbPicker(av.id)}
                                  aria-label={`Ganti file ${av.name}`}
                                  className="h-6 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-200 shrink-0 cursor-pointer"
                                >
                                  Ganti
                                </button>
                                <button
                                  type="button"
                                  data-testid={`studio3d-glb-delete-saved-${av.id}`}
                                  onClick={() => onDeleteSavedGlbAvatar(av.id)}
                                  aria-label={`Hapus avatar ${av.name}`}
                                  className="h-6 px-1.5 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Gaya Gerak */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Gaya Gerak
                </span>
                <div className="grid grid-cols-5 gap-1">
                  {GAIT_OPTIONS.map((gm) => (
                    <button
                      key={gm.id}
                      type="button"
                      data-testid={`studio3d-gait-${gm.id}`}
                      onClick={() => onChangeRunner({ ...runner, gaitMode: gm.id })}
                      className={`py-1.5 px-1 rounded-lg border text-center transition-colors cursor-pointer ${
                        (runner.gaitMode ?? 'auto') === gm.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="block text-[11px] font-semibold">{gm.label}</span>
                      <span className="block text-[9px] opacity-75">{gm.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Gaya Pose Finish */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pose Finish
                </span>
                <div className="grid grid-cols-1 gap-1.5">
                  {FINISH_POSE_OPTIONS.map((pose) => (
                    <button
                      key={pose.id}
                      type="button"
                      data-testid={`studio3d-pose-${pose.id}`}
                      onClick={() => onChangeRunner({ ...runner, finishPoseStyle: pose.id })}
                      className={`px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer flex items-center justify-between ${
                        runner.finishPoseStyle === pose.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="text-xs font-semibold">{pose.label}</span>
                      <span className="text-[10px] opacity-80">{pose.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Kolom 2: Identitas, Gender & Aksesori */}
            <section className="space-y-4 md:border-l md:border-slate-100 md:dark:border-slate-800 md:pl-6">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Identitas &amp; Nomor BIB
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Nama Pelari
                    </label>
                    <input
                      type="text"
                      value={runner.runnerName}
                      maxLength={28}
                      onChange={(e) => onChangeRunner({ ...runner, runnerName: e.target.value })}
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Nama pelari..."
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      No. BIB
                    </label>
                    <input
                      type="text"
                      value={runner.bibNumber}
                      maxLength={6}
                      onChange={(e) =>
                        onChangeRunner({ ...runner, bibNumber: e.target.value.toUpperCase() })
                      }
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono-tabular text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="2026"
                    />
                  </div>
                </div>
              </div>

              {runner.characterStyle === 'custom-glb' ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                  Model <strong className="font-mono-tabular">.GLB / .GLTF</strong> memakai material asli bawaan file. Pilih <strong>Chibi Sporty</strong> atau <strong>Atlet Realistis</strong> untuk menyesuaikan rambut &amp; aksesori.
                </p>
              ) : (
                <>
                  <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Postur &amp; Kacamata
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: 'male', label: 'Laki-laki' },
                          { id: 'female', label: 'Perempuan' },
                        ] as Array<{ id: RunnerGender; label: string }>
                      ).map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => onChangeRunner({ ...runner, gender: g.id })}
                          className={`h-8 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                            runner.gender === g.id
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center justify-between py-1 cursor-pointer">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                        Pakai Kacamata Sporty
                      </span>
                      <input
                        type="checkbox"
                        checked={runner.glasses}
                        onChange={(e) => onChangeRunner({ ...runner, glasses: e.target.checked })}
                        className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                      />
                    </label>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Rambut &amp; Aksesori
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'undercut', label: 'Undercut' },
                          { id: 'spiky', label: 'Spiky' },
                          { id: 'side-fade', label: 'Side Fade' },
                        ] as Array<{ id: RunnerHairStyle; label: string }>
                      ).map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => onChangeRunner({ ...runner, hairStyle: h.id })}
                          className={`h-8 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                            runner.hairStyle === h.id
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {(
                        [
                          { id: 'none', label: 'Tanpa Aksesori' },
                          { id: 'cap', label: 'Topi Sporty' },
                          { id: 'headband', label: 'Headband' },
                          { id: 'visor', label: 'Visor' },
                          { id: 'trail-vest', label: 'Trail Vest + Headlamp' },
                        ] as Array<{ id: RunnerAccessory; label: string }>
                      ).map((acc) => (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => onChangeRunner({ ...runner, accessory: acc.id })}
                          className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold text-left transition-colors cursor-pointer ${
                            acc.id === 'trail-vest' ? 'col-span-2' : ''
                          } ${
                            runner.accessory === acc.id
                              ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {acc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* Kolom 3: Warna Outfit */}
            <section className="space-y-3 lg:border-l lg:border-slate-100 lg:dark:border-slate-800 lg:pl-6">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Warna Outfit
              </h3>
              {runner.characterStyle === 'custom-glb' ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Warna jersey untuk garis rute aktif mengikuti palet berikut:
                </p>
              ) : null}

              {(
                [
                  { key: 'jerseyColor', label: 'Jersey & Garis Rute', swatches: JERSEY_SWATCHES },
                  ...(runner.characterStyle === 'custom-glb'
                    ? []
                    : ([
                        { key: 'shortsColor', label: 'Celana', swatches: SHORTS_SWATCHES },
                        { key: 'shoesColor', label: 'Sepatu', swatches: SHOE_SWATCHES },
                      ] as const)),
                ] as ReadonlyArray<{
                  key: 'jerseyColor' | 'shortsColor' | 'shoesColor';
                  label: string;
                  swatches: string[];
                }>
              ).map((item) => (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {item.label}
                    </span>
                    <input
                      type="color"
                      aria-label={`Pilih warna ${item.label}`}
                      value={runner[item.key]}
                      onChange={(e) => onChangeRunner({ ...runner, [item.key]: e.target.value })}
                      className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.swatches.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`${item.label} ${hex}`}
                        onClick={() => onChangeRunner({ ...runner, [item.key]: hex })}
                        style={{ backgroundColor: hex }}
                        className={`w-6 h-6 rounded-md border transition-transform cursor-pointer ${
                          runner[item.key].toLowerCase() === hex.toLowerCase()
                            ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900 scale-110 border-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}

        {activeTab === 'peta' && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            data-testid="studio3d-panel-peta"
          >
            {/* Kolom 1: Peta Nyata, Load Map & Gedung OSM */}
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Peta Dunia Nyata
                </h3>
                <button
                  type="button"
                  data-testid="studio3d-panel-reload-map-btn"
                  onClick={onReloadMap}
                  className="h-7 px-2.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isMapLoading ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{isMapLoading ? 'Memuat...' : 'Muat Ulang Peta'}</span>
                </button>
              </div>

              <p className="font-mono-tabular text-[11px] text-slate-600 dark:text-slate-300">
                {mapStatusText}
              </p>

              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'standard', label: 'Street' },
                    { id: 'satellite', label: 'Satellite' },
                    { id: 'terrain', label: 'Terrain' },
                    { id: 'monochrome', label: 'Monochrome' },
                    { id: 'hybrid', label: 'Hybrid' },
                    { id: 'city3d', label: '3D City' },
                    { id: 'liberty', label: 'Liberty (Vector · OpenFreeMap)' },
                  ] as Array<{ id: CanonicalMapStyle3D; label: string }>
                ).map((ms) => {
                  const isActive = normalizeMapStyle3D(mapConfig.mapStyle) === ms.id;
                  return (
                    <button
                      key={ms.id}
                      type="button"
                      data-testid={`studio3d-mapstyle-${ms.id}`}
                      onClick={() =>
                        onChangeMapConfig({
                          ...mapConfig,
                          mapStyle: ms.id,
                          buildings3d:
                            ms.id === 'city3d' || ms.id === 'liberty'
                              ? true
                              : mapConfig.buildings3d,
                        })
                      }
                      className={`px-3 py-2 rounded-lg border text-xs font-semibold text-left transition-colors cursor-pointer ${
                        ms.id === 'liberty' ? 'col-span-2' : ''
                      } ${
                        isActive
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {ms.label}
                    </button>
                  );
                })}
              </div>

              {/* Layer Overlay Tekstur Three.js */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Layer Overlay 3D (Three.js)
                </span>
                <div className="space-y-1">
                  <label className="flex items-center justify-between py-1 cursor-pointer">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                      Kontur &amp; Hillshade 3D
                    </span>
                    <input
                      type="checkbox"
                      data-testid="studio3d-overlay-relief"
                      checked={mapConfig.overlayRelief ?? true}
                      onChange={(e) =>
                        onChangeMapConfig({ ...mapConfig, overlayRelief: e.target.checked })
                      }
                      className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between py-1 cursor-pointer">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                      Detail Permukaan PBR
                    </span>
                    <input
                      type="checkbox"
                      data-testid="studio3d-overlay-surface"
                      checked={mapConfig.overlaySurface ?? true}
                      onChange={(e) =>
                        onChangeMapConfig({ ...mapConfig, overlaySurface: e.target.checked })
                      }
                      className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between py-1 cursor-pointer">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                      Label &amp; Referensi Jalan
                    </span>
                    <input
                      type="checkbox"
                      data-testid="studio3d-overlay-labels"
                      checked={mapConfig.overlayLabels ?? true}
                      onChange={(e) =>
                        onChangeMapConfig({ ...mapConfig, overlayLabels: e.target.checked })
                      }
                      className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* Gaya Garis Rute (Google Maps) */}
              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Gaya Rute (Google Maps)
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'google-maps', label: 'Google Maps', desc: 'Biru + panah arah' },
                      { id: 'google-pace', label: 'Pace / Traffic', desc: 'Hijau–kuning–merah' },
                      { id: 'sport-jersey', label: 'Warna Jersey', desc: 'Sesuai jersey + arah' },
                      { id: 'minimal-clean', label: 'Minimal', desc: 'Garis polos bersih' },
                      { id: 'sportbyte-lime', label: 'Sport Byte Lime', desc: 'Lime #a6f04b + casing gelap' },
                    ] as Array<{ id: RouteVisualStyle3D; label: string; desc: string }>
                  ).map((rs) => {
                    const active = (mapConfig.routeStyle ?? 'google-maps') === rs.id;
                    return (
                      <button
                        key={rs.id}
                        type="button"
                        data-testid={`studio3d-routestyle-${rs.id}`}
                        onClick={() => onChangeMapConfig({ ...mapConfig, routeStyle: rs.id })}
                        className={`px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                          rs.id === 'sportbyte-lime' ? 'col-span-2' : ''
                        } ${
                          active
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="block text-[11px] font-semibold leading-tight">
                          {rs.label}
                        </span>
                        <span className="block text-[9px] opacity-75">{rs.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Penyesuaian Jalur (GPS Asli vs Snap ke Jalan OSRM) */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Penyesuaian Jalur
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'raw', label: 'GPS Asli' },
                      { id: 'snap-road', label: 'Snap ke Jalan (Maps)' },
                    ] as Array<{ id: RouteSnapMode3D; label: string }>
                  ).map((sm) => {
                    const active = (mapConfig.routeSnapMode ?? 'raw') === sm.id;
                    return (
                      <button
                        key={sm.id}
                        type="button"
                        data-testid={`studio3d-routesnap-${sm.id}`}
                        onClick={() => onChangeMapConfig({ ...mapConfig, routeSnapMode: sm.id })}
                        className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                          active
                            ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {sm.label}
                      </button>
                    );
                  })}
                </div>
                {(mapConfig.routeSnapMode ?? 'raw') === 'snap-road' && (
                  <p
                    data-testid="studio3d-routesnap-status"
                    className="text-[10px] font-medium text-slate-500 dark:text-slate-400"
                  >
                    {routeSnapStatus === 'matching'
                      ? 'Menyelaraskan rute GPS ke jalan OSM...'
                      : routeSnapStatus === 'matched'
                        ? 'Rute terselaraskan ke jalan (OSRM).'
                        : routeSnapStatus === 'fallback'
                          ? 'Jalan sekitar tidak ditemukan, memakai GPS asli.'
                          : 'Siap menyelaraskan ke jalan.'}
                  </p>
                )}
              </div>

              <label className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 cursor-pointer">
                <div>
                  <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">
                    Gedung &amp; Jalan 3D OSM
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Bangunan &amp; jaringan jalan nyata di sepanjang rute
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={mapConfig.buildings3d}
                  onChange={(e) => onChangeMapConfig({ ...mapConfig, buildings3d: e.target.checked })}
                  className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                />
              </label>

              <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-1">
                Data peta &amp; elevasi: © OpenStreetMap · Esri · Open-Meteo DEM
              </p>
            </section>

            {/* Kolom 2: Pencahayaan & Header Info Video */}
            <section className="space-y-4 md:border-l md:border-slate-100 md:dark:border-slate-800 md:pl-6">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pencahayaan &amp; Suasana
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'auto', label: 'Auto' },
                      { id: 'morning', label: 'Pagi' },
                      { id: 'evening', label: 'Sore' },
                      { id: 'night', label: 'Malam' },
                      { id: 'city-park', label: 'City Park' },
                      { id: 'mountain', label: 'Mountain' },
                      { id: 'night-run', label: 'Night Run' },
                    ] as Array<{ id: LightingMood3D; label: string }>
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onChangeMapConfig({ ...mapConfig, lightingMood: m.id })}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                        mapConfig.lightingMood === m.id
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Info Aktivitas (Overlay Video)
                </h3>
                {track ? (
                  <>
                    <input
                      type="text"
                      value={track.title}
                      onChange={(e) => onUpdateTrackInfo({ title: e.target.value })}
                      placeholder="Nama Aktivitas"
                      className="w-full h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-900 dark:text-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={track.date}
                        onChange={(e) => onUpdateTrackInfo({ date: e.target.value })}
                        className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono-tabular text-xs text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        value={track.location}
                        onChange={(e) => onUpdateTrackInfo({ location: e.target.value })}
                        placeholder="Lokasi Rute"
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Upload file <strong>.FIT</strong> / <strong>.GPX</strong> atau pilih riwayat lari untuk mengedit info rute.
                  </p>
                )}
              </div>
            </section>

            {/* Kolom 3: Landmark Rute */}
            <section className="space-y-3 lg:border-l lg:border-slate-100 lg:dark:border-slate-800 lg:pl-6">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                Landmark Rute ({visibleLandmarks.length})
              </h3>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  disabled={!track}
                  value={newLandmarkLabel}
                  onChange={(e) => setNewLandmarkLabel(e.target.value)}
                  placeholder="Label landmark (mis. Water Station)"
                  className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white disabled:opacity-50"
                />
                <input
                  type="number"
                  disabled={!track}
                  min={5}
                  max={95}
                  value={newLandmarkPct}
                  onChange={(e) => setNewLandmarkPct(Number(e.target.value))}
                  title="Posisi % di rute"
                  className="w-14 h-8 px-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono-tabular text-xs text-center text-slate-900 dark:text-white disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={!track}
                  onClick={() => {
                    const clean = newLandmarkLabel.trim();
                    if (!clean || !track) return;
                    onAddCustomLandmark(clean, Math.min(98, Math.max(2, newLandmarkPct)) / 100);
                    setNewLandmarkLabel('');
                  }}
                  className="h-8 px-2.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Pin
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {visibleLandmarks.map((lm) => (
                  <div
                    key={lm.id}
                    className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80 last:border-b-0 text-[11px]"
                  >
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {lm.label}
                      <span className="ml-1.5 font-mono-tabular text-slate-400">
                        · {lm.distanceKm.toFixed(1)} km
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveLandmark(lm.id)}
                      aria-label={`Hapus landmark ${lm.label}`}
                      className="text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'export' && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            data-testid="studio3d-panel-export"
          >
            {/* Kolom 1: Durasi & Pose Finish */}
            <section className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Durasi Video 9:16
                </h3>
                <div className="grid grid-cols-5 gap-1.5">
                  {(
                    [
                      { id: 15, label: '15d', sub: 'Story' },
                      { id: 30, label: '30d', sub: 'Reels' },
                      { id: 45, label: '45d', sub: 'Detail' },
                      { id: 60, label: '60d', sub: 'Penuh' },
                      { id: 'custom', label: 'Kustom', sub: 'Bebas' },
                    ] as Array<{ id: DurationPresetSec; label: string; sub: string }>
                  ).map((d) => (
                    <button
                      key={String(d.id)}
                      type="button"
                      onClick={() => onChangeExportConfig({ ...exportConfig, durationPreset: d.id })}
                      className={`py-2 px-1 rounded-lg border text-center transition-colors cursor-pointer ${
                        exportConfig.durationPreset === d.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="block font-mono-tabular text-xs font-bold">{d.label}</span>
                      <span className="block text-[9px] opacity-75">{d.sub}</span>
                    </button>
                  ))}
                </div>
                {exportConfig.durationPreset === 'custom' && (
                  <div className="flex items-center gap-2 pt-1">
                    <label className="text-xs text-slate-600 dark:text-slate-300">Detik:</label>
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={exportConfig.customDurationSec}
                      onChange={(e) =>
                        onChangeExportConfig({
                          ...exportConfig,
                          customDurationSec: Number(e.target.value) || 20,
                        })
                      }
                      className="w-24 h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono-tabular text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-orange-500" aria-hidden="true" />
                    <div>
                      <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">
                        + Pose Finish di Akhir Video
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        Animasi selebrasi &amp; banner hasil akhir
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={exportConfig.includeFinishPose}
                    onChange={(e) =>
                      onChangeExportConfig({
                        ...exportConfig,
                        includeFinishPose: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-orange-500 rounded cursor-pointer"
                  />
                </label>

                {exportConfig.includeFinishPose && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {FINISH_POSE_OPTIONS.map((pose) => (
                      <button
                        key={pose.id}
                        type="button"
                        onClick={() => onChangeRunner({ ...runner, finishPoseStyle: pose.id })}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold text-center transition-colors cursor-pointer ${
                          runner.finishPoseStyle === pose.id
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {pose.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Kolom 2: Musik Latar & Volume */}
            <section className="space-y-3 md:border-l md:border-slate-100 md:dark:border-slate-800 md:pl-6">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5" aria-hidden="true" />
                Musik Latar &amp; Volume
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'none', label: 'Tanpa Musik' },
                    { id: 'upbeat-synth', label: 'Upbeat Synth (128)' },
                    { id: 'lofi-stride', label: 'Lo-Fi Stride (96)' },
                    { id: 'epic-trail', label: 'Epic Trail (116)' },
                  ] as Array<{ id: MusicPreset3D; label: string }>
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onChangeExportConfig({ ...exportConfig, musicPreset: m.id })}
                    className={`px-2.5 py-2 rounded-lg border text-[11px] font-semibold text-left transition-colors cursor-pointer ${
                      exportConfig.musicPreset === m.id
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div>
                <input
                  ref={mp3InputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/*"
                  className="hidden"
                  onChange={handleMp3Upload}
                />
                <button
                  type="button"
                  onClick={() => mp3InputRef.current?.click()}
                  className={`w-full h-8 px-3 rounded-lg border text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    exportConfig.musicPreset === 'custom-mp3'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : 'border-dashed border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="truncate">
                    {exportConfig.customAudioName
                      ? `MP3: ${exportConfig.customAudioName}`
                      : 'Upload MP3 Sendiri'}
                  </span>
                </button>
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <Volume2 className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={exportConfig.volume}
                  aria-label="Volume musik latar"
                  onChange={(e) =>
                    onChangeExportConfig({ ...exportConfig, volume: Number(e.target.value) })
                  }
                  className="flex-1 accent-blue-600 cursor-pointer"
                />
                <span className="font-mono-tabular text-[11px] font-semibold text-slate-600 dark:text-slate-300 w-9 text-right">
                  {Math.round(exportConfig.volume * 100)}%
                </span>
              </div>
            </section>

            {/* Kolom 3: Kualitas & Tombol Render 9:16 */}
            <section className="space-y-3 lg:border-l lg:border-slate-100 lg:dark:border-slate-800 lg:pl-6 flex flex-col justify-between">
              <div className="space-y-2.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Kualitas &amp; Render (9:16)
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: '720p', title: 'HD Smooth 720p', sub: '720×1280 · 30fps' },
                      { id: '1080p', title: 'Full HD 1080p', sub: '1080×1920 · 30fps' },
                    ] as Array<{ id: VideoQuality3D; title: string; sub: string }>
                  ).map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => onChangeExportConfig({ ...exportConfig, quality: q.id })}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                        exportConfig.quality === q.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="block text-xs font-bold">{q.title}</span>
                      <span className="block font-mono-tabular text-[10px] opacity-80">{q.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {exportError && (
                <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  {exportError}
                </div>
              )}

              {lastExportInfo && !isExporting && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                  Video berhasil diekspor: <strong>{lastExportInfo.filename}</strong> ({lastExportInfo.sizeMb} MB)
                </div>
              )}

              <div>
                {isExporting ? (
                  <div className="space-y-2">
                    <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-orange-500 transition-all duration-150"
                        style={{ width: `${exportPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tabular text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Merender Video 9:16... {exportPercent}%
                      </span>
                      <button
                        type="button"
                        onClick={onCancelExport}
                        className="h-8 px-3 rounded-lg border border-rose-300 dark:border-rose-800 text-xs font-semibold text-rose-600 dark:text-rose-400 inline-flex items-center gap-1 cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="studio3d-export-btn"
                    disabled={!track}
                    onClick={onStartExport}
                    className="w-full h-11 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {track
                        ? `Render & Download 9:16 (${getExportDurationSec(exportConfig)}d · ${exportConfig.quality})`
                        : 'Upload .FIT / .GPX dulu untuk Export'}
                    </span>
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
