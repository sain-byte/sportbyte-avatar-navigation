import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  normalizeMapStyle3D,
  type LightingMood3D,
  type MapLoadStatus,
  type MapStyle3D,
  type OsmBuildingFootprint,
  type OsmRoadWay,
  type RouteVisualStyle3D,
  type Studio3DLandmark,
  type Studio3DTrack,
} from '../../types/studio3d';
import {
  buildPaceColoredRouteRibbonGeometry,
  buildSlimRouteRibbonGeometry,
  sampleGroundedRouteAtProgress,
  type GroundedRoutePath,
} from '../../utils/studio3dGpsEngine';
import {
  buildMapCompositeTexture,
  buildMergedOsmBuildingsGeometry,
  buildOsmRoadNetworkGeometry,
  createTerrainReliefOverlayTexture,
  createTerrainSurfaceDetailMaps,
  fetchOsmBuildingsForTrack,
  fetchOsmRoadsForTrack,
  latLonToLocalMeters,
  sampleTerrainY,
  type RealDemGrid,
  type TerrainGridConfig,
} from '../../utils/studio3dMapTiles';

interface TerrainMap3DProps {
  track: Studio3DTrack;
  grid: TerrainGridConfig;
  demGrid: RealDemGrid | null;
  mapStyle: MapStyle3D;
  routeStyle?: RouteVisualStyle3D;
  buildings3d: boolean;
  overlayRelief?: boolean;
  overlaySurface?: boolean;
  overlayLabels?: boolean;
  resolvedMood: Exclude<LightingMood3D, 'auto'>;
  jerseyColor: string;
  routeProgress: number;
  groundedPath: GroundedRoutePath;
  mapReloadNonce: number;
  onMapLoadStatus?: (status: MapLoadStatus) => void;
}

function createGoogleMapsChevronTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    // Crisp forward-pointing chevron (v=0 bottom -> v=1 top along runner direction)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(32, 82);
    ctx.lineTo(64, 42);
    ctx.lineTo(96, 82);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function createLandmarkSpriteTexture(
  landmark: Studio3DLandmark,
  sportByteDarkBadge = false,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const bgColor =
      landmark.type === 'start'
        ? sportByteDarkBadge
          ? '#35D07F'
          : '#10B981'
        : landmark.type === 'finish'
          ? sportByteDarkBadge
            ? '#FF626D'
            : '#F97316'
          : landmark.type === 'peak'
            ? '#8B5CF6'
            : landmark.type === 'custom'
              ? '#EC4899'
              : sportByteDarkBadge
                ? '#111C25'
                : '#0F172A';

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(14, 14, 292, 74, 18);
    ctx.fill();

    ctx.strokeStyle =
      sportByteDarkBadge && landmark.type !== 'start' && landmark.type !== 'finish'
        ? 'rgba(166, 240, 75, 0.92)'
        : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(landmark.label.slice(0, 18), 160, 52);

    ctx.fillStyle =
      sportByteDarkBadge && landmark.type !== 'start' && landmark.type !== 'finish'
        ? '#A6F04B'
        : '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(148, 88);
    ctx.lineTo(172, 88);
    ctx.lineTo(160, 106);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const LandmarkMarker3D: React.FC<{
  landmark: Studio3DLandmark;
  position: THREE.Vector3;
  scaleFactor: number;
  sportByteDarkBadge?: boolean;
}> = ({ landmark, position, scaleFactor, sportByteDarkBadge = false }) => {
  const spriteTex = useMemo(
    () => createLandmarkSpriteTexture(landmark, sportByteDarkBadge),
    [landmark, sportByteDarkBadge],
  );
  useEffect(() => () => spriteTex.dispose(), [spriteTex]);

  const pinColor =
    landmark.type === 'start'
      ? '#10B981'
      : landmark.type === 'finish'
        ? '#F97316'
        : landmark.type === 'peak'
          ? '#8B5CF6'
          : landmark.type === 'custom'
            ? '#EC4899'
            : '#38BDF8';

  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh position={[0, scaleFactor * 1.4, 0]}>
        <cylinderGeometry args={[scaleFactor * 0.12, scaleFactor * 0.12, scaleFactor * 2.8, 10]} />
        <meshStandardMaterial color="#F8FAFC" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, scaleFactor * 2.9, 0]}>
        <sphereGeometry args={[scaleFactor * 0.38, 12, 12]} />
        <meshStandardMaterial color={pinColor} roughness={0.35} emissive={pinColor} emissiveIntensity={0.25} />
      </mesh>
      <sprite position={[0, scaleFactor * 5.0, 0]} scale={[scaleFactor * 7.8, scaleFactor * 2.7, 1]}>
        <spriteMaterial map={spriteTex} transparent depthTest={false} />
      </sprite>
    </group>
  );
};

export const TerrainMap3D: React.FC<TerrainMap3DProps> = ({
  track,
  grid,
  demGrid,
  mapStyle,
  routeStyle = 'google-maps',
  buildings3d,
  overlayRelief = true,
  overlaySurface = true,
  overlayLabels = true,
  resolvedMood,
  jerseyColor,
  routeProgress,
  groundedPath,
  mapReloadNonce,
  onMapLoadStatus,
}) => {
  const { gl } = useThree();
  const [mapTexture, setMapTexture] = useState<THREE.CanvasTexture | null>(null);
  const [osmBuildings, setOsmBuildings] = useState<OsmBuildingFootprint[]>([]);
  const [osmRoads, setOsmRoads] = useState<OsmRoadWay[]>([]);
  const activeTextureRef = useRef<THREE.CanvasTexture | null>(null);

  const normalizedStyle = normalizeMapStyle3D(mapStyle);
  const isNight = resolvedMood === 'night' || resolvedMood === 'night-run';
  const isEvening = resolvedMood === 'evening';
  const showOsmBuildings = buildings3d || normalizedStyle === 'city3d';
  const showOsmRoads =
    normalizedStyle === 'standard' ||
    normalizedStyle === 'liberty' ||
    normalizedStyle === 'city3d' ||
    normalizedStyle === 'terrain' ||
    normalizedStyle === 'hybrid' ||
    normalizedStyle === 'monochrome';

  // Align Mercator tile box center strictly with track local meter coordinates
  const { gridCenterX, gridCenterZ } = useMemo(() => {
    const nw = latLonToLocalMeters(grid.northLat, grid.westLon, track.centerLat, track.centerLon);
    const se = latLonToLocalMeters(grid.southLat, grid.eastLon, track.centerLat, track.centerLon);
    return {
      gridCenterX: (nw.xM + se.xM) / 2,
      gridCenterZ: (nw.zM + se.zM) / 2,
    };
  }, [grid, track.centerLat, track.centerLon]);

  // Higher-resolution 112x112 elevation-displaced terrain mapped 1:1 to Mercator extents & DEM
  const terrainGeometry = useMemo(() => {
    const geom = new THREE.PlaneGeometry(grid.widthMeters, grid.depthMeters, 112, 112);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const worldX = gridCenterX + vx;
      const worldZ = gridCenterZ - vy; // After -90deg X rotation, +vy maps to -Z
      const h = sampleTerrainY(worldX, worldZ, track, demGrid);
      pos.setZ(i, h);
    }
    geom.computeVertexNormals();
    return geom;
  }, [grid.widthMeters, grid.depthMeters, gridCenterX, gridCenterZ, track, demGrid]);

  useEffect(() => () => terrainGeometry.dispose(), [terrainGeometry]);

  // Procedural Three.js PBR bump & roughness detail maps for ground realism
  const surfaceMaps = useMemo(
    () =>
      createTerrainSurfaceDetailMaps(
        mapStyle,
        grid.widthMeters,
        grid.depthMeters,
        gl.capabilities.getMaxAnisotropy(),
      ),
    [mapStyle, grid.widthMeters, grid.depthMeters, gl],
  );
  useEffect(() => {
    return () => {
      surfaceMaps.bumpMap.dispose();
      surfaceMaps.roughnessMap.dispose();
    };
  }, [surfaceMaps]);

  // Procedural Three.js NW solar hillshade & elevation contour overlay texture
  const reliefOverlayTex = useMemo(
    () =>
      createTerrainReliefOverlayTexture(
        gridCenterX,
        gridCenterZ,
        grid.widthMeters,
        grid.depthMeters,
        track,
        demGrid,
        mapStyle,
        gl.capabilities.getMaxAnisotropy(),
      ),
    [gridCenterX, gridCenterZ, grid.widthMeters, grid.depthMeters, track, demGrid, mapStyle, gl],
  );
  useEffect(() => () => reliefOverlayTex.dispose(), [reliefOverlayTex]);

  // Load CORS-safe Web Mercator raster tiles onto CanvasTexture and report exact progress
  useEffect(() => {
    const controller = new AbortController();
    let createdTexture: THREE.CanvasTexture | null = null;
    const maxAniso = gl.capabilities.getMaxAnisotropy();

    if (activeTextureRef.current) {
      activeTextureRef.current.dispose();
      activeTextureRef.current = null;
    }
    setMapTexture(null);

    void buildMapCompositeTexture(
      grid,
      mapStyle,
      maxAniso,
      controller.signal,
      (status) => {
        if (!controller.signal.aborted) {
          onMapLoadStatus?.(status);
        }
      },
      mapReloadNonce,
      overlayLabels,
    ).then(({ texture }) => {
      if (controller.signal.aborted) {
        texture.dispose();
        return;
      }
      if (activeTextureRef.current && activeTextureRef.current !== texture) {
        activeTextureRef.current.dispose();
      }
      createdTexture = texture;
      activeTextureRef.current = texture;
      setMapTexture(texture);
    });

    return () => {
      controller.abort();
      if (createdTexture) {
        createdTexture.dispose();
        if (activeTextureRef.current === createdTexture) {
          activeTextureRef.current = null;
        }
      }
    };
  }, [grid, mapStyle, gl, mapReloadNonce, overlayLabels, onMapLoadStatus]);

  useEffect(() => {
    return () => {
      if (activeTextureRef.current) {
        activeTextureRef.current.dispose();
        activeTextureRef.current = null;
      }
    };
  }, []);

  // Fetch real OSM vector roads around route corridor
  useEffect(() => {
    setOsmRoads([]);
    if (!showOsmRoads) return;
    const controller = new AbortController();
    void fetchOsmRoadsForTrack(track, controller.signal).then((ways) => {
      if (!controller.signal.aborted) {
        setOsmRoads(ways);
      }
    });
    return () => controller.abort();
  }, [track, showOsmRoads, mapReloadNonce]);

  // Fetch corridor-prioritized OSM 3D building footprints
  useEffect(() => {
    setOsmBuildings([]);
    if (!showOsmBuildings) return;
    const controller = new AbortController();
    void fetchOsmBuildingsForTrack(track, controller.signal).then((items) => {
      if (!controller.signal.aborted) {
        setOsmBuildings(items);
      }
    });
    return () => controller.abort();
  }, [track, showOsmBuildings, mapReloadNonce]);

  // Build single batched terrain-draped OSM road network BufferGeometry
  const osmRoadsGeo = useMemo(
    () =>
      showOsmRoads
        ? buildOsmRoadNetworkGeometry(osmRoads, track, demGrid, isNight, mapStyle)
        : null,
    [showOsmRoads, osmRoads, track, demGrid, isNight, mapStyle],
  );
  useEffect(() => () => osmRoadsGeo?.dispose(), [osmRoadsGeo]);

  // Build single batched OSM 3D building BufferGeometry
  const osmBuildingsGeo = useMemo(
    () =>
      showOsmBuildings
        ? buildMergedOsmBuildingsGeometry(osmBuildings, track, demGrid, isNight, isEvening, mapStyle)
        : null,
    [showOsmBuildings, osmBuildings, track, demGrid, isNight, isEvening, mapStyle],
  );
  useEffect(() => () => osmBuildingsGeo?.dispose(), [osmBuildingsGeo]);

  // Google Maps-style layered route ribbons (outer casing, upcoming guide path, active ribbon, directional chevrons)
  const routeHalfWidth = Math.max(0.55, Math.min(1.25, track.spanMeters * 0.00062));
  const chevronTileM = Math.max(4.5, routeHalfWidth * 7.2);
  const showCasing = routeStyle !== 'minimal-clean';
  const showChevrons = routeStyle !== 'minimal-clean';

  const chevronTex = useMemo(() => createGoogleMapsChevronTexture(), []);
  useEffect(() => () => chevronTex.dispose(), [chevronTex]);

  const casingRibbonGeo = useMemo(
    () => buildSlimRouteRibbonGeometry(groundedPath, routeHalfWidth * 1.42, { tileLenM: chevronTileM }),
    [groundedPath, routeHalfWidth, chevronTileM],
  );
  const guideRibbonGeo = useMemo(
    () => buildSlimRouteRibbonGeometry(groundedPath, routeHalfWidth * 0.88, { tileLenM: chevronTileM }),
    [groundedPath, routeHalfWidth, chevronTileM],
  );
  const activeRibbonGeo = useMemo(
    () =>
      routeStyle === 'google-pace'
        ? buildPaceColoredRouteRibbonGeometry(groundedPath, track.points, routeHalfWidth * 1.06, {
            tileLenM: chevronTileM,
          })
        : buildSlimRouteRibbonGeometry(groundedPath, routeHalfWidth * 1.06, {
            tileLenM: chevronTileM,
          }),
    [groundedPath, track.points, routeStyle, routeHalfWidth, chevronTileM],
  );
  const chevronRibbonGeo = useMemo(
    () => buildSlimRouteRibbonGeometry(groundedPath, routeHalfWidth * 0.94, { tileLenM: chevronTileM }),
    [groundedPath, routeHalfWidth, chevronTileM],
  );

  useEffect(() => {
    return () => {
      casingRibbonGeo.dispose();
      guideRibbonGeo.dispose();
      activeRibbonGeo.dispose();
      chevronRibbonGeo.dispose();
    };
  }, [casingRibbonGeo, guideRibbonGeo, activeRibbonGeo, chevronRibbonGeo]);

  // Slice traversed route ribbon strictly by cumulative arc distance matching runnerPos
  useEffect(() => {
    const verts = groundedPath.vertices;
    if (verts.length < 2 || routeProgress <= 0.003) {
      activeRibbonGeo.setDrawRange(0, 0);
      return;
    }
    if (routeProgress >= 0.999) {
      activeRibbonGeo.setDrawRange(0, (verts.length - 1) * 6);
      return;
    }
    const targetDist = routeProgress * groundedPath.totalArcMeters;
    let lo = 0;
    let hi = verts.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (verts[mid].distM <= targetDist) lo = mid;
      else hi = mid;
    }
    const segCount = Math.max(1, Math.min(verts.length - 1, lo + 1));
    activeRibbonGeo.setDrawRange(0, segCount * 6);
  }, [activeRibbonGeo, groundedPath, routeProgress]);

  const isSportByteLime = routeStyle === 'sportbyte-lime';
  const casingColor =
    routeStyle === 'google-maps'
      ? '#174EA6'
      : isSportByteLime
        ? '#14232C'
        : routeStyle === 'google-pace'
          ? '#1E293B'
          : '#0F172A';
  const guideColor =
    routeStyle === 'google-maps'
      ? isNight
        ? '#3B82F6'
        : '#93C5FD'
      : isSportByteLime
        ? isNight
          ? '#4D7C0F'
          : '#64748B'
        : isNight
          ? '#64748B'
          : '#94A3B8';
  const activeBaseColor =
    routeStyle === 'google-maps'
      ? '#1A73E8'
      : isSportByteLime
        ? '#A6F04B'
        : routeStyle === 'google-pace'
          ? '#FFFFFF'
          : jerseyColor;

  // Landmarks pinned directly onto grounded route path by cumulative distance progress
  const landmarkMarkers = useMemo(() => {
    return track.landmarks
      .filter((lm) => lm.type !== 'start' && lm.type !== 'finish')
      .map((lm) => {
        const { position } = sampleGroundedRouteAtProgress(
          groundedPath,
          THREE.MathUtils.clamp(lm.progress, 0, 1),
        );
        return { landmark: lm, position };
      });
  }, [track.landmarks, groundedPath]);

  const landmarkScale = Math.max(1.1, Math.min(3.2, track.spanMeters * 0.002));

  return (
    <group name="TerrainMapRoot">
      {/* Ground Elevation Mesh with Real Web Mercator Raster Map Texture + PBR Surface Detail */}
      <mesh
        position={[gridCenterX, 0, gridCenterZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={terrainGeometry}
        receiveShadow
      >
        <meshStandardMaterial
          key={`${mapTexture ? mapTexture.uuid : 'pending'}-${overlaySurface ? 'surf' : 'flat'}-${normalizedStyle}`}
          map={mapTexture}
          bumpMap={overlaySurface ? surfaceMaps.bumpMap : null}
          bumpScale={
            normalizedStyle === 'terrain'
              ? 0.45
              : normalizedStyle === 'satellite' || normalizedStyle === 'hybrid'
                ? 0.3
                : 0.16
          }
          roughnessMap={overlaySurface ? surfaceMaps.roughnessMap : null}
          roughness={overlaySurface ? 0.98 : 0.96}
          metalness={0.0}
          envMapIntensity={0.14}
          color={isNight && mapStyle !== 'night' ? '#7B8CA6' : '#FFFFFF'}
        />
      </mesh>

      {/* Three.js Elevation Hillshade & Topographic Contour Overlay Texture */}
      {overlayRelief && (
        <mesh
          name="TerrainReliefOverlay"
          position={[gridCenterX, 0.035, gridCenterZ]}
          rotation={[-Math.PI / 2, 0, 0]}
          geometry={terrainGeometry}
          renderOrder={1}
        >
          <meshBasicMaterial
            key={reliefOverlayTex.uuid}
            map={reliefOverlayTex}
            transparent
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-0.3}
          />
        </mesh>
      )}

      {/* Batched OSM Terrain-Draped Road Network (1 draw call) */}
      {osmRoadsGeo && (
        <mesh geometry={osmRoadsGeo} receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={0.88}
            metalness={0.02}
            transparent={
              normalizedStyle === 'terrain' ||
              normalizedStyle === 'hybrid' ||
              normalizedStyle === 'monochrome'
            }
            opacity={
              normalizedStyle === 'hybrid'
                ? 0.42
                : normalizedStyle === 'terrain'
                  ? 0.52
                  : normalizedStyle === 'monochrome'
                    ? 0.65
                    : 0.78
            }
            polygonOffset
            polygonOffsetFactor={-0.5}
          />
        </mesh>
      )}

      {/* Google Maps-style Outer Route Casing */}
      {showCasing && (
        <mesh geometry={casingRibbonGeo} position={[0, 0, 0]}>
          <meshStandardMaterial
            key={`casing-${routeStyle}`}
            color={casingColor}
            roughness={0.55}
            metalness={0.05}
            polygonOffset
            polygonOffsetFactor={-1.0}
          />
        </mesh>
      )}

      {/* Remaining Route Path Guide */}
      <mesh geometry={guideRibbonGeo} position={[0, 0.015, 0]}>
        <meshStandardMaterial
          key={`guide-${routeStyle}-${isNight}`}
          color={guideColor}
          transparent
          opacity={routeStyle === 'google-maps' ? 0.85 : 0.82}
          roughness={0.58}
          polygonOffset
          polygonOffsetFactor={-1.8}
        />
      </mesh>

      {/* Active Traversed Route Ribbon (Google Maps Blue / Sport Byte Lime / Pace Gradient / Jersey Color) */}
      <mesh geometry={activeRibbonGeo} position={[0, 0.032, 0]}>
        <meshStandardMaterial
          key={`active-${routeStyle}-${jerseyColor}`}
          color={activeBaseColor}
          vertexColors={routeStyle === 'google-pace'}
          emissive={routeStyle === 'google-pace' ? '#0F172A' : activeBaseColor}
          emissiveIntensity={
            routeStyle === 'google-pace'
              ? 0.14
              : isSportByteLime
                ? isNight
                  ? 0.95
                  : 0.22
                : isNight
                  ? 1.15
                  : 0.3
          }
          roughness={0.34}
          metalness={0.08}
          polygonOffset
          polygonOffsetFactor={-2.8}
        />
      </mesh>

      {/* Crisp Directional Chevrons along Route */}
      {showChevrons && (
        <mesh geometry={chevronRibbonGeo} position={[0, 0.05, 0]}>
          <meshBasicMaterial
            map={chevronTex}
            color={isSportByteLime ? '#14232C' : '#FFFFFF'}
            transparent
            opacity={routeStyle === 'google-maps' ? 0.92 : isSportByteLime ? 0.72 : 0.85}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-3.8}
          />
        </mesh>
      )}

      {/* Route Landmarks (KM markers, Peak, Custom; Start & Finish use popup banners) */}
      {landmarkMarkers.map((item) => (
        <LandmarkMarker3D
          key={item.landmark.id}
          landmark={item.landmark}
          position={item.position}
          scaleFactor={landmarkScale}
          sportByteDarkBadge={isSportByteLime || normalizedStyle === 'liberty'}
        />
      ))}

      {/* Batched 3D OpenStreetMap Buildings (1 draw call, real footprints & heights) */}
      {osmBuildingsGeo && (
        <mesh geometry={osmBuildingsGeo} castShadow receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={0.76}
            metalness={0.08}
            envMapIntensity={0.3}
            emissive={isNight ? '#1E3A8A' : '#000000'}
            emissiveIntensity={isNight ? 0.25 : 0}
          />
        </mesh>
      )}
    </group>
  );
};
