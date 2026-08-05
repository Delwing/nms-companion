# Guild standing & envoy stock availability

Date: 2026-08-05
Status: approved design, pending implementation plan

## Goal

Track the player's standing (rank) with each of the three guilds from envoy
scans, and render each system's captured envoy stock badges as available or
unavailable — unavailable badges drawn semi-transparent.

## Key insight

Envoy stock is a fixed-length, rank-ordered list. Every envoy screen shows
6 rows, and row *i* (0-based) unlocks at rank *i* of the shared guild rank
ladder, for free and purchasable rows alike:

```
Initiate → Apprentice → Journeyman → Associate → Master → Exalted
```

So no per-item requirement table is needed: an item's required rank is its
position in the scanned list, and

```
available(item at index i) = ladderIndex(currentRank for guild) >= i
```

Verified against the Onusko fixtures: banner reads "Rank: Journeyman"; items
rows 1–3 (Ion Battery / Warp Hypercore / Ionised Cobalt) are bright, rows 4–6
(Sac Venom / Anomaly Detector / Movement Module) are dim — exactly indices
0–2 available at ladder index 2.

## Components

### 1. Rank ladder + standing store

- `src/shared/guildRanks.ts`: `GUILD_RANKS` ladder constant,
  `rankIndex(name): number | null` with an OCR-tolerant normaliser
  (e.g. "Journeyrnan", "lnitiate"), shared by main and renderer.
- New persistent store `guildStandings`: `guild → { rank, updatedAt }`,
  implemented in both `db.ts` backends (SQLite table `guild_standings` +
  JSON-store field), following existing migration patterns.
- Envoy scan flow in `src/main/index.ts`: when a scan parses both a guild
  and a recognisable `Rank:` value (`EnvoyData.guildRank`, already extracted
  today but discarded), upsert that guild's standing.
- IPC pair `getGuildStandings` / `setGuildStanding(guild, rank)` exposed via
  preload; `setGuildStanding` backs the manual-edit UI.

### 2. Parser: preserve on-screen order

`extractItems` in `envoyParser.ts` currently returns signature-table order
(signatures are tested against the whole text, then line heuristics run).
Rework to walk lines top-to-bottom, matching signatures per line, deduping on
first occurrence, so the returned array is in screen order.

- Tesseract dual-pass join stays safe: locked rows are always a suffix, so
  `[bright-pass rows…, dim-pass-only rows…]` preserves rank order.
- Paddle path is already y-ordered by `assembleText`.
- `SystemRecord.envoyItems` stays `string[]`; its index becomes meaningful
  (index = required-rank ladder index). No schema change.

### 3. Incomplete-scan alert

`EXPECTED_ENVOY_ROWS = 6`. When an envoy scan captures a different count:

- The scan result carries an incomplete flag / message; the overlay header
  shows "captured N/6 envoy items — rescan recommended".
- The list is still stored (items remain useful), but availability dimming
  is disabled for any stored list whose length ≠ 6, because positions can't
  be trusted when a middle row was dropped.

### 4. Availability rendering in StationGrid

In the envoy badge row of `StationGrid.tsx`, badge at index *i* renders with
reduced opacity (~50%) when the system's guild is known (scanned or
region-inferred), that guild's standing is known, the stored list has exactly
6 entries, and `rankIndex(standing) < i`. Tooltip: "Requires Associate —
you're Journeyman". In every unknown/uncertain case the badge renders at full
opacity — never dim on a guess.

### 5. Guild standing strip

A slim row above the station grid with one chip per guild, e.g.
"Explorers: Journeyman", "Merchants: —". Each chip is a click-to-edit
dropdown over the six ranks (manual correction path). Fed by
`getGuildStandings`; edits call `setGuildStanding`.

## Data flow

```
envoy scan → parseEnvoyData { guild, guildRank, items[ordered] }
           → patch system (envoyItems, guildType, station)
           → upsert guildStandings[guild] when rank recognised
           → renderer: standings strip + per-badge availability
```

## Error handling

- Unrecognised `Rank:` text → standing untouched (no downgrade on garbage).
- Guild parsed but no rank line → items stored, standing untouched.
- Item count ≠ 6 → store items, flag rescan, no dimming for that system.
- Standing unknown for a guild → no dimming anywhere for that guild.
- Pre-feature records: `envoyItems` saved by older scans are in scrambled
  signature order; they may not have 6 entries, and where they do, dimming
  may be wrong until rescanned. Accepted: a rescan self-heals each system.

## Testing

- `guildRanks` normaliser: exact names, OCR garbles, unknown → null.
- Parser order: extend `parser.test.js` with the Onusko fixtures asserting
  the full 6-item array in screen order, plus a dropped-row fixture
  asserting count ≠ 6 detection.
- Standing upsert: envoy scan result updates the store; garbage rank leaves
  it untouched; manual set wins until next successful scan.
- Availability predicate: pure function tested over rank × index ×
  list-length cases (including the never-dim-on-guess branches).
