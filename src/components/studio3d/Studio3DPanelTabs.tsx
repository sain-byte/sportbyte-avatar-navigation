        {activeTab === 'peta' && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            data-testid="studio3d-panel-peta"
          >
            {/* Kolom 1: Mode Peta OpenFreeMap (Light/Night) & Bangunan 3D */}
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Peta Vektor OpenFreeMap
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

              <div className="space-y-1.5">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Tema Peta
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="studio3d-mapstyle-light"
                    onClick={() => onChangeMapConfig({ ...mapConfig, mapStyle: 'light' })}
                    className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      mapConfig.mapStyle === 'light'
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    Light
                  </button>
                  <button
                    type="button"
                    data-testid="studio3d-mapstyle-dark"
                    onClick={() => onChangeMapConfig({ ...mapConfig, mapStyle: 'dark' })}
                    className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      mapConfig.mapStyle === 'dark'
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    Night
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Bangunan 3D
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="studio3d-buildings-on"
                    onClick={() => onChangeMapConfig({ ...mapConfig, buildings3d: true })}
                    className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      mapConfig.buildings3d
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    3D ON
                  </button>
                  <button
                    type="button"
                    data-testid="studio3d-buildings-off"
                    onClick={() => onChangeMapConfig({ ...mapConfig, buildings3d: false })}
                    className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      !mapConfig.buildings3d
                        ? 'border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    3D OFF
                  </button>
                </div>
              </div>

              {/* Gaya Garis Rute */}
              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Gaya Rute
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

              <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-1">
                © OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors
              </p>
            </section>

            {/* Kolom 2: Pencahayaan & Header Info Video */}
            <section className="space-y-4 md:border-l md:border-slate-100 md:dark:border-slate-800 md:pl-6">
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pencahayaan Avatar
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
