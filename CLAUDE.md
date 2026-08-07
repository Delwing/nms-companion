# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Electron companion app for No Man's Sky: watches save files to catalogue systems/stations/inventory, and OCR-scans the game screen (Alt+C) to record planet, system, and guild-envoy data. Feature overview in `README.md`.

## Commands

```bash
npm run dev        # dev mode with HMR
npm run build      # production bundles into out/
npm run rebuild    # no longer needed: better-sqlite3 >=12 ships ABI-stable N-API prebuilds that load as-is in Electron
npm run typecheck  # tsc over both projects (tsconfig.node.json = main/preload, tsconfig.web.json = renderer)
npm test           # tsc -p tests/tsconfig.json (emits to tests/.build) then node --test tests/*.test.js
npm run dist:win   # electron-builder: nsis installer + portable exe + zip into release/
```

Run a single test file (after the tests build step):

```bash
npx tsc -p tests/tsconfig.json && node --test tests/parser.test.js
```

**Tests compile only the files explicitly listed in `tests/tsconfig.json` `include`.** When a test needs a new file from `src/`, add it there — otherwise its import resolves to a stale or missing `.js` in `tests/.build`. Everything under test must be Electron-free (plain Node); Electron-touching modules like `db.ts` and `index.ts` are exercised only indirectly or not at all.

## Architecture

Standard electron-vite three-process layout; both main and renderer alias `@shared` → `src/shared`, renderer also aliases `@` → `src/renderer/src`.

- **`src/main/index.ts`** — window management (two windows: dashboard + always-on-top HUD overlay; each remembers bounds in `settings.json`), global hotkeys (Alt+C scan, Alt+S focus bounce/click-through), and every `ipcMain.handle` registration. Both windows load the *same* renderer bundle; a `?view=dashboard|hud` query param picks the UI.
- **`src/preload/index.ts`** — the entire IPC surface, exposed as `window.api` via contextBridge. Add new channels here and in `index.ts` together; renderer types come from `export type Api = typeof api`.
- **`src/renderer/src/`** — React + Tailwind 4. `App.tsx` switches dashboard vs HUD view; components fetch through `window.api` and subscribe to push events (`onSaveSynced`, `onOcrResult`, …).
- **`src/shared/`** — types plus bundled static game-data tables (item names/values, resources, trade economy, galaxies, guild ranks, region guild inference). Imported by main, renderer, and tests alike; keep it dependency-free.

### Two data pipelines feed one store

1. **Save watcher** (`saveWatcher.ts`): chokidar watches `%APPDATA%\HelloGames\NMS\` for `save*.hg` → read-only open → LZ4 decompress (`lz4.ts`, pure TS, no native deps) → `saveParser.ts` extracts teleporter endpoints, discovered systems, inventories, ships, language progress. Upserts are keyed by universal address; **user metadata (tags, notes, guild, toggles) must never be overwritten by a re-sync**. Obfuscated save keys are de-obfuscated via an optional user-supplied `%APPDATA%\nms-companion\nms-keymap.json`.
2. **OCR pipeline** (`ocrService.ts`): screenshot → `captureService.ts` proportional crop zones (16:9 and 21:9) → PP-OCR on onnxruntime (`paddleOcr.ts`) as primary engine, sharp-preprocess + tesseract.js as automatic fallback → text routed to `planetParser.ts` / `systemParser.ts` / `envoyParser.ts` (best-scoring zone wins). Both engines are created once and reused; the hotkey→DB-commit budget is 1.5 s. Every scan dumps intermediate images + raw text to a debug dir for tuning against real screenshots.

### Persistence

`db.ts` opens better-sqlite3 (WAL) in Electron's `userData` dir, with a transparent fallback to an atomic JSON file store when the native module isn't built. Any new store method must work in both backends.

**One store per save slot.** `slotStores.ts` owns a `CatalogueStore` per character (`userData/slots/<encoded-slot-id>.db`); `saveWatcher` writes each save into *its own* slot's store, and main's module-level `store` (what every IPC handler reads) points at the pinned slot's store, or the newest-written slot's when unpinned. Anything resolving a slot to a store must go through `SlotStores`, never `openStore` directly.

### Packaging

`electron-builder.yml` ships three Windows targets (nsis / portable / zip) and takes its icon from `build/icon.ico`, regenerated from `build/icon.svg` by `node scripts/make-icon.mjs`. `productName: NMS Companion` is the display name (install dir, shortcut, `NMS Companion.exe`); the data dir is `%APPDATA%\nms-companion` — Electron derives it from package.json `name`, which electron-builder copies into the asar verbatim, so changing `name` moves everyone's catalogue.

Both `BrowserWindow`s take `icon: windowIcon`, imported via electron-vite's `import … from '../../build/icon.png?asset'` (emitted to `out/main/chunks/`, typed by `src/main/modules.d.ts`). It's deliberately `undefined` when packaged — Windows then uses the icon embedded in the .exe rather than one inside app.asar.

### Conventions & invariants

- Save files are strictly read-only — never write to anything under the NMS save directory.
- Region guild inference (`regionGuilds.ts`) is derived at display time and never persisted.
- Parser changes are tested against real captured OCR text in `tests/fixtures/*.txt` (both tesseract and paddle variants exist — paddle output has different spacing/line-break quirks). Add a fixture when fixing a parsing bug.
- `tests/.build/` is generated output — never edit it.
