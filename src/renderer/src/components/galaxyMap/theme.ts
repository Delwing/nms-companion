/**
 * Colour scale for the region map.
 *
 * The rest of the app distinguishes guilds by icon alone (Landmark / Compass
 * / Swords) and never by hue, so this is the first place colour carries guild
 * meaning. Every legend and panel entry pairs the colour with that same icon
 * so the mapping stays learnable rather than arbitrary.
 */
import { Compass, HelpCircle, Landmark, Swords } from 'lucide-react'
import type { KnownGuild } from '@shared/regionGuilds'

export type GuildKey = KnownGuild | 'unknown'

export const GUILD_KEYS: GuildKey[] = ['Merchants', 'Explorers', 'Mercenaries', 'unknown']

export const GUILD_COLORS: Record<GuildKey, string> = {
  Merchants: '#fbbf24',
  Explorers: '#38bdf8',
  Mercenaries: '#fb7185',
  unknown: '#94a3b8'
}

export const GUILD_ICONS: Record<GuildKey, typeof Compass> = {
  Merchants: Landmark,
  Explorers: Compass,
  Mercenaries: Swords,
  unknown: HelpCircle
}

export const GUILD_LABELS: Record<GuildKey, string> = {
  Merchants: 'Merchants',
  Explorers: 'Explorers',
  Mercenaries: 'Mercenaries',
  unknown: 'Guild unknown'
}

export function guildKey(guild: KnownGuild | null): GuildKey {
  return guild ?? 'unknown'
}

/** Scene units per voxel, and the cube's share of that (leaving a visual gap). */
export const CELL_SIZE = 1
export const CUBE_SCALE = 0.9

/**
 * Density shading floor. A one-system region still has to be visible, so
 * brightness spans this fraction of the guild colour up to the full value
 * rather than fading to black.
 */
export const MIN_DENSITY = 0.35

/**
 * Overview scene units per voxel. Neighbourhoods sit thousands of voxels
 * apart, so the overview needs its own scale — but only a linear one: the
 * catalogue straddles the core, so true relative positions already fit in
 * one view and nothing has to be compressed or faked.
 */
export const OVERVIEW_SCALE = 0.02

/** Distance rings on the overview floor, in light years. */
export const RING_STEP_LY = 200_000

/** Colour of the galactic core, matching the catalogue's "Nearest core" chip. */
export const CORE_COLOR = '#e879f9'

/** Neighbourhood markers. Size carries system count; guild lives per region. */
export const MARKER_COLOR = '#22d3ee'
export const MARKER_BASE = 0.8
export const MARKER_GROWTH = 1.2

/**
 * "You are here". Deliberately outside the guild palette and away from the
 * core's magenta and the marker cyan, so the player's position never reads as
 * a guild, a selection (white) or the core.
 */
export const CURRENT_COLOR = '#4ade80'
