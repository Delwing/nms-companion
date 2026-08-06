# Design: 3D region map

Status: approved, not yet implemented
Date: 2026-08-06

## Goal

A 3D view of the catalogue's **region structure** — which voxels have been
explored deeply and which guild owns each one — with a not-to-scale indicator
of the direction and distance to the galactic core.

Only catalogued regions are drawn. An earlier revision also outlined the
un-catalogued neighbours as a "frontier", which was cut: every voxel in the
galaxy holds systems, so those outlines marked nothing the player didn't
already know and merely wrapped the real data in a shell of noise.

The map is explicitly a self-contained, removable feature. It adds no store
method, no schema column, no IPC channel and no preload surface, so binning it
leaves nothing to unwind.

## Why regions, and why a lattice

In No Man's Sky a region *is* a voxel: every system sharing a 12/8/12-bit
signed voxel coordinate is in the same region, up to ~550 of them. `galaxy.ts`
already encodes this (`regionKey`, `regionLabel`, `distanceToCoreLy`, core at
voxel 0,0,0), so region geometry is derivable arithmetic, not game data.

Probing a real catalogue (Slot2: 163 systems, all Euclid, 42 distinct regions)
showed the shape the design has to accommodate:

| Cluster | Voxels | Systems | Bounding box | Filled |
| --- | --- | --- | --- | --- |
| Home | 34 | 150 | 18 x 3 x 16 = 864 cells | 4% |
| Satellite | 3 | 8 | 2 x 1 x 2 | 75% |
| 5 lone outposts | 1 each | 1 each | — | — |

Two conclusions drive the whole design:

1. **A bounding-box lattice over the whole catalogue is impossible.** The
   voxel extent is X -1344..1771, Y -80..2, Z -1981..1090 — a box of roughly
   785 million cells holding 42 filled ones. The view must work per-cluster.
2. **A per-cluster lattice is very comfortable.** The home cluster is 34
   filled cells in an 864-cell box — small enough to read as a shape and to
   draw in a single pass.

Clusters are flat by nature: voxel Y is 8-bit and the galaxy is a disc, so the
slab shape (3 cells thick here) is permanent. Y is rendered at true scale;
exaggerating it would misrepresent the geometry for no gain.

The catalogue sits 705k–880k ly out, essentially on Euclid's rim, so the core
direction is near-identical for every cluster — a stable compass rather than a
per-cube property.

## Shared math: `src/shared/galaxyMap.ts`

Dependency-free and pure, per the existing `@shared` invariant. Everything
below derives from the `SystemRecord[]` the renderer already holds in
`App.tsx` state.

```ts
type Voxel = { x: number; y: number; z: number }

interface RegionCell {
  key: string                        // regionKey(galaxy, x, y, z)
  x: number; y: number; z: number
  systems: SystemRecord[]
  guild: KnownGuild | null           // derived at display time, never persisted
}

interface RegionCluster {
  galaxy: string | null
  cells: RegionCell[]
  min: Voxel; max: Voxel; centroid: Voxel
  systemCount: number
  maxCellCount: number               // normaliser for density shading
  coreLy: number                     // from centroid
  coreDir: [number, number, number]  // unit vector toward voxel origin
}
```

- **`buildRegionCells(systems)`** — groups by galaxy + voxel. A cell's guild
  comes from the existing `inferRegionGuilds(systems).get(cell.key)`, which
  already computes exactly "the guild of this region". This is reuse, and it
  preserves the invariant that region guild inference is display-time only and
  is never written back to the store.
- **`clusterRegions(cells, radius = 2)`** — connected components under
  Chebyshev distance, computed per galaxy, sorted by system count descending.
  Radius 1/2/3 over the real catalogue yields 8/7/7 clusters, so the structure
  is insensitive to the parameter; 2 tolerates a one-voxel hop without merging
  distant outposts into the home cluster.
- **`starPositionIn(system)`** — a deterministic offset inside the cube,
  hashed from `solarSystemIndex`. This is not decorative randomness: the index
  is real data, stable across re-syncs, and with 550 possible values per
  region the stars spread naturally, so a 36-system voxel genuinely looks
  packed while a 1-system waypoint shows a lone point.

## The view: `src/renderer/src/components/galaxyMap/`

Rendered with three.js via `@react-three/fiber`, chosen over a hand-rolled
canvas projection for visual quality — real perspective, orbit controls, fog
and additive sprites without writing shader-adjacent code. The shared math is
identical either way, so the renderer choice is reversible.

| File | Role |
| --- | --- |
| `GalaxyMapView.tsx` | The screen. The only file `App.tsx` imports. |
| `Scene.tsx` | R3F `<Canvas>` contents |
| `RegionCubes.tsx` | Instanced region cubes + edge wireframes |
| `SystemStars.tsx` | Instanced additive star sprites |
| `CoreArrow.tsx` | Direction indicator + distance label |
| `RegionPanel.tsx` | Selected-region detail list |
| `useGalaxyMapData.ts` | Memoised `SystemRecord[]` -> clusters |

### Visual encoding

- **Filled cube** — translucent faces with brighter edges. Hue by guild,
  opacity scaled by `cellCount / maxCellCount` with a floor so single-system
  cells stay visible. The two 36-system voxels should read as the obvious
  centre of gravity.
- **Stars** — small additive sprites inside their cube at `starPositionIn`.
- **Y=0 plane** — a faint reference grid. The cluster is a flat slab, so the
  eye needs a horizon to read its orientation.
- **Core arrow** — from cluster centroid toward the voxel origin, labelled
  (e.g. `705,096 ly to core`) and explicitly marked not-to-scale. The core is
  ~1,780 voxels away against an 18-voxel-wide cluster; any honest rendering
  puts it off-screen.

The app currently has **no guild colour convention** — guilds are
distinguished by lucide icons (`Landmark` / `Compass` / `Swords`), never by
hue. The map introduces one, so the legend and `RegionPanel` must pair each
colour with its existing icon to keep the mapping learnable.

### Interaction

- OrbitControls: drag to rotate, wheel to zoom. Auto-frame the cluster on load
  and on cluster switch.
- Cluster picker listing neighbourhoods by system count ("Home — 34 regions,
  150 systems", "Satellite — 3 regions, 8 systems", then lone outposts).
- Hover a cube: highlight plus a tooltip with `regionLabel(x, y, z)`, system
  count, and guild.
- Click a cube: `RegionPanel` lists its systems; clicking a system calls the
  existing `onJumpToSystem` callback that the bases sidebar already uses, so
  map-to-catalogue navigation needs no new plumbing.
- A galaxy selector is rendered only when the catalogue spans more than one
  galaxy.

### Performance

The canvas runs `frameloop="demand"`, rendering only on interaction rather
than continuously. This companion app sits open *while the game is running*,
and a 60fps idle WebGL loop would tax the same GPU as No Man's Sky. On-demand
rendering makes the map cost nothing while untouched. With ~34 cubes and ~163
star sprites, the frames it does draw are trivial.

## Integration

Four lines in `App.tsx`:

1. add `'map'` to the `DashboardView` union
2. import `GalaxyMapView`
3. one `<ViewTab icon={<Boxes />} label="Galaxy Map" />` beside the existing
   five (`Orbit` is already taken by the "Nearest core" chip)
4. one render branch

It receives `systems` and `onJumpToSystem`, both already in scope.

## Removability

```
rm -r src/renderer/src/components/galaxyMap/
rm src/shared/galaxyMap.ts tests/galaxyMap.test.js
# revert 4 lines in App.tsx, 1 line in tests/tsconfig.json
npm uninstall three @react-three/fiber @react-three/drei @types/three
```

Enforced by one rule: **nothing outside `components/galaxyMap/` may import
three.** `src/shared/galaxyMap.ts` stays plain math with no imports beyond the
project's own types, so the clustering logic survives independently even if
the 3D layer is deleted.

## Dependency risk

The project is on React 18.3, and `@react-three/fiber` v9 targets React 19.
The install needs pinning to the v8 line, with a compatible drei alongside it.
**Confirm the resolved versions at install time** rather than assuming this
boundary — it is the single most likely source of an install-time surprise.

## Testing

`tests/galaxyMap.test.js`, with `../src/shared/galaxyMap.ts` added to
`tests/tsconfig.json`'s `include` — omitting it silently resolves the import
to a stale or missing `.js` in `tests/.build`.

- Clustering merges voxels 1 apart and keeps voxels 4 apart separate at radius 2.
- Clustering **never merges across galaxies**, even at identical coordinates
  (`regionKey` includes galaxy, so this must hold).
- Core vector magnitude agrees with the existing `distanceToCoreLy`; direction
  is unit-length toward the origin.
- `starPositionIn` is deterministic across calls and stays inside cube bounds.
- Systems with `null` voxels are skipped, not clustered at 0,0,0 — a real
  hazard, since OCR-sourced systems can lack coordinates.
- A small committed fixture of `[x, y, z, count]` tuples reproducing the real
  catalogue's shape (42 regions -> 7 clusters, largest 34 voxels / 150
  systems), following the existing convention of testing against real captured
  data. Coordinates only, no system names.

**Not covered by tests:** the R3F components. The project has no React
component test infrastructure and no component tests today, so the 3D layer is
verified by running the app, not by `npm test`. All logic worth
regression-testing is deliberately pushed into `@shared`, where the existing
Electron-free test setup already reaches.
