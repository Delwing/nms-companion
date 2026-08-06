import { Hourglass, Swords, Zap } from 'lucide-react'
import type { FreighterBattleState } from '@shared/types'
import {
  HOURS_BETWEEN_BATTLES,
  SECONDS_BETWEEN_BATTLES,
  WARPS_BETWEEN_BATTLES,
  evaluateFreighterBattle,
  formatDuration
} from '@shared/freighterBattle'

interface StatusBarProps {
  battle: FreighterBattleState | null
}

const EXPLAINER =
  `The game only rolls for a pirate-attacked freighter on warp-in once both gates have cleared: ` +
  `${WARPS_BETWEEN_BATTLES} warps and ${HOURS_BETWEEN_BATTLES} hours since the last space battle ` +
  `(pirate ambushes count too). The hours are *play* time — they only tick while the game runs. ` +
  `Read from the save's TimeLastSpaceBattle / WarpsLastSpaceBattle at the last autosave.`

/** One gate: a labelled mini progress meter that turns green when cleared. */
function Gate({
  icon,
  value,
  fill,
  cleared,
  title
}: {
  icon: React.JSX.Element
  value: string
  /** Progress towards the gate, 0..1. */
  fill: number
  cleared: boolean
  title: string
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className={cleared ? 'text-emerald-400' : 'text-slate-500'}>{icon}</span>
      <span className={`font-mono text-[11px] ${cleared ? 'text-emerald-300' : 'text-slate-300'}`}>
        {value}
      </span>
      <span className="h-1 w-14 overflow-hidden rounded-full bg-slate-700/70">
        <span
          className={`block h-full rounded-full ${cleared ? 'bg-emerald-400' : 'bg-cyan-500/70'}`}
          style={{ width: `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%` }}
        />
      </span>
    </span>
  )
}

/**
 * Bottom status bar: how close the character is to being able to run into
 * another freighter rescue (see `@shared/freighterBattle` for the gates).
 */
export function StatusBar({ battle }: StatusBarProps): React.JSX.Element {
  if (!battle) {
    return (
      <footer className="flex items-center gap-2 border-t border-slate-700/50 bg-slate-900/70 px-5 py-1.5 text-[11px] text-slate-500">
        <Swords className="h-3.5 w-3.5" /> Freighter battle — waiting for save data…
      </footer>
    )
  }

  const state = evaluateFreighterBattle(battle)
  const warpsLabel =
    state.warpsSince === null
      ? `? / ${WARPS_BETWEEN_BATTLES} warps`
      : `${state.warpsSince} / ${WARPS_BETWEEN_BATTLES} warps`

  const status = state.inBattle
    ? { text: `Battle in progress · ${battle.activeBattleType}`, tone: 'text-red-300' }
    : state.ready
      ? { text: 'Ready — next warp can roll a freighter battle', tone: 'text-emerald-300' }
      : {
          text: [
            state.warpsRemaining
              ? `${state.warpsRemaining} more warp${state.warpsRemaining === 1 ? '' : 's'}`
              : null,
            state.secondsRemaining ? `${formatDuration(state.secondsRemaining)} play time` : null
          ]
            .filter(Boolean)
            .join(' · ') + ' to go',
          tone: 'text-amber-300'
        }

  return (
    <footer className="flex items-center gap-4 border-t border-slate-700/50 bg-slate-900/70 px-5 py-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
        <Swords
          className={`h-3.5 w-3.5 ${state.ready || state.inBattle ? 'text-emerald-400' : 'text-slate-500'}`}
        />
        Freighter battle
      </span>

      <span className={`text-[11px] font-semibold ${status.tone}`} title={EXPLAINER}>
        {status.text}
      </span>

      <Gate
        icon={<Zap className="h-3 w-3" />}
        value={warpsLabel}
        fill={state.warpsSince === null ? 0 : state.warpsSince / WARPS_BETWEEN_BATTLES}
        cleared={state.warpsReady === true}
        title={
          state.warpsSince === null
            ? 'This save has no warp counter (^DIST_WARP stat missing)'
            : `${state.warpsSince} warps since the last space battle (warp counter ${battle.warpCount}, battle stamped at ${battle.warpsLastSpaceBattle})`
        }
      />

      <Gate
        icon={<Hourglass className="h-3 w-3" />}
        value={`${formatDuration(state.secondsSince)} / ${HOURS_BETWEEN_BATTLES}h`}
        fill={state.secondsSince / SECONDS_BETWEEN_BATTLES}
        cleared={state.timeReady}
        title={`${formatDuration(state.secondsSince)} of play time since the last space battle — this clock only runs while the game does`}
      />

      <span className="flex-1" />

      <span className="font-mono text-[10px] text-slate-500" title={EXPLAINER}>
        {battle.battlesFought !== null && `${battle.battlesFought} battles · `}
        save {new Date(battle.savedAt).toLocaleTimeString()}
      </span>
    </footer>
  )
}
