/**
 * Freighter-battle readiness: when the game may next roll a pirate ambush
 * on the freighter you warp in on (the "rescue the freighter" encounter).
 *
 * The save only records when the last space battle happened —
 * `TimeLastSpaceBattle` (in play-time seconds) and `WarpsLastSpaceBattle`
 * (the warp counter at that moment). Both gates must clear before the game
 * rolls again on warp-in. The thresholds live in the game's
 * GAMEPLAYGLOBALS as GcGameplayGlobals.WarpsBetweenBattles /
 * HoursBetweenBattles — not in the save — so they are mirrored here.
 *
 * Note the time gate runs on *play* time, not wall-clock: it only advances
 * while the game is running.
 */
import type { FreighterBattleState } from './types'

/** GcGameplayGlobals.WarpsBetweenBattles. */
export const WARPS_BETWEEN_BATTLES = 5
/** GcGameplayGlobals.HoursBetweenBattles. */
export const HOURS_BETWEEN_BATTLES = 3
export const SECONDS_BETWEEN_BATTLES = HOURS_BETWEEN_BATTLES * 3600

export interface FreighterBattleReadiness {
  /** A battle is in progress right now. */
  inBattle: boolean
  /** Both gates cleared — the next warp may roll a battle. */
  ready: boolean
  /** Play-time seconds since the last battle. */
  secondsSince: number
  /** Play-time seconds still to wait (0 once cleared). */
  secondsRemaining: number
  timeReady: boolean
  /** Warps since the last battle; null when the save has no warp counter. */
  warpsSince: number | null
  /** Warps still to make (0 once cleared); null when unknown. */
  warpsRemaining: number | null
  /** Null when the warp counter is unknown — then readiness rests on time alone. */
  warpsReady: boolean | null
}

export function evaluateFreighterBattle(state: FreighterBattleState): FreighterBattleReadiness {
  // A save written mid-battle can stamp the battle time slightly ahead of
  // the play clock; never report a negative age.
  const secondsSince = Math.max(0, state.totalPlayTime - state.timeLastSpaceBattle)
  const secondsRemaining = Math.max(0, SECONDS_BETWEEN_BATTLES - secondsSince)
  const timeReady = secondsRemaining === 0

  const warpsSince =
    state.warpCount === null ? null : Math.max(0, state.warpCount - state.warpsLastSpaceBattle)
  const warpsRemaining = warpsSince === null ? null : Math.max(0, WARPS_BETWEEN_BATTLES - warpsSince)
  const warpsReady = warpsRemaining === null ? null : warpsRemaining === 0

  const inBattle = state.activeBattleType !== null && state.activeBattleType !== 'None'
  return {
    inBattle,
    ready: timeReady && warpsReady !== false,
    secondsSince,
    secondsRemaining,
    timeReady,
    warpsSince,
    warpsRemaining,
    warpsReady
  }
}

/** "3h 26m" / "26m" / "40s" — compact enough for a status bar. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}
