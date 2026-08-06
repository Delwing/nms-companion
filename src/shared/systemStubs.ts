import type { SystemRecord } from './types'

/**
 * True when a system record holds nothing but an address: no station name,
 * no planets, and no user metadata. These are warp pass-throughs and (in
 * catalogues built before hidden discovery records were skipped) network-
 * cached discoveries of systems the player never visited. The catalogue
 * hides them unless the player is currently there or has a base there —
 * the caller supplies those exceptions.
 */
export function isBareUnknownSystem(system: SystemRecord, planetCount: number): boolean {
  return (
    system.name === 'Unknown System' &&
    planetCount === 0 &&
    system.guildType === null &&
    system.station === 'normal' &&
    !system.isBlackHole &&
    !system.offersSfm &&
    !system.multiToolSClass &&
    system.economy === null &&
    system.conflict === null &&
    system.race === null &&
    system.customTags.length === 0 &&
    system.envoyItems.length === 0 &&
    system.notes === ''
  )
}
