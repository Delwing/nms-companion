import { Compass, Landmark, Swords } from 'lucide-react'
import type { GuildStanding, GuildType } from '@shared/types'
import { GUILD_RANKS } from '@shared/guildRanks'

type KnownGuild = Exclude<GuildType, null>

const GUILDS: { guild: KnownGuild; icon: React.JSX.Element }[] = [
  { guild: 'Merchants', icon: <Landmark className="h-3 w-3" /> },
  { guild: 'Explorers', icon: <Compass className="h-3 w-3" /> },
  { guild: 'Mercenaries', icon: <Swords className="h-3 w-3" /> }
]

/**
 * Player's rank with each guild: auto-updated by envoy scans, editable by
 * hand. Standing decides which envoy stock badges render as locked.
 */
export function GuildStandingStrip({
  standings,
  onSet
}: {
  standings: GuildStanding[]
  onSet: (guild: KnownGuild, rank: string) => void
}): React.JSX.Element {
  const rankOf = (guild: KnownGuild): string =>
    standings.find((s) => s.guild === guild)?.rank ?? ''

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[10px] tracking-wide text-slate-500 uppercase">Guild standing</span>
      {GUILDS.map(({ guild, icon }) => (
        <label
          key={guild}
          title={`Your ${guild} Guild rank — set by envoy scans, or pick one`}
          className="flex items-center gap-1 rounded-full border border-slate-600/60 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300"
        >
          {icon} {guild}
          <select
            value={rankOf(guild)}
            onChange={(e) => e.target.value && onSet(guild, e.target.value)}
            className={`cursor-pointer bg-transparent outline-none ${
              rankOf(guild) ? 'text-amber-300' : 'text-slate-500'
            }`}
          >
            <option value="" disabled className="bg-slate-900">
              —
            </option>
            {GUILD_RANKS.map((rank) => (
              <option key={rank} value={rank} className="bg-slate-900">
                {rank}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
}
