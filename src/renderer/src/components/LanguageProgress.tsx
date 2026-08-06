import { Languages } from 'lucide-react'
import type { LanguageProgressRecord } from '@shared/types'

interface LanguageProgressProps {
  languages: LanguageProgressRecord[]
}

/** Accent styling per language, tuned to each race's in-game palette. */
const ACCENTS: Record<string, { bar: string; text: string; border: string }> = {
  Gek: { bar: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-500/30' },
  "Vy'keen": { bar: 'bg-red-400', text: 'text-red-300', border: 'border-red-500/30' },
  Korvax: { bar: 'bg-cyan-400', text: 'text-cyan-300', border: 'border-cyan-500/30' },
  Atlas: { bar: 'bg-violet-400', text: 'text-violet-300', border: 'border-violet-500/30' },
  Autophage: { bar: 'bg-emerald-400', text: 'text-emerald-300', border: 'border-emerald-500/30' }
}

const FALLBACK_ACCENT = { bar: 'bg-slate-400', text: 'text-slate-300', border: 'border-slate-500/30' }

/**
 * Per-language word-learning progress bars. The primary count is word
 * groups — the unit the game's own "words learned" counter displays (and
 * the save stores); the dictionary-entry count including variant words a
 * group unlocks is shown as a secondary stat.
 */
export function LanguageProgress({ languages }: LanguageProgressProps): React.JSX.Element {
  if (languages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-center text-xs text-slate-500">
          No language data yet — it's imported from your save once it's synced.
        </p>
      </div>
    )
  }

  const totalKnown = languages.reduce((sum, l) => sum + l.groupsKnown, 0)
  const totalWords = languages.reduce((sum, l) => sum + l.totalGroups, 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
          Language Progress
        </h2>
        <span className="text-[11px] text-slate-500">
          {totalKnown.toLocaleString()} / {totalWords.toLocaleString()} words across all languages
        </span>
      </div>

      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {languages.map((lang) => {
          const accent = ACCENTS[lang.language] ?? FALLBACK_ACCENT
          const percent = lang.totalGroups > 0 ? (100 * lang.groupsKnown) / lang.totalGroups : 0
          return (
            <div
              key={lang.language}
              className={`rounded-xl border ${accent.border} bg-slate-900/60 px-4 py-3`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className={`flex items-center gap-1.5 text-sm font-semibold ${accent.text}`}>
                  <Languages className="h-3.5 w-3.5" /> {lang.language}
                </span>
                <span className="font-mono text-sm text-slate-200">{percent.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full ${accent.bar} transition-all`}
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                <span>
                  <span className="text-slate-300">{lang.groupsKnown.toLocaleString()}</span> /{' '}
                  {lang.totalGroups.toLocaleString()} words
                </span>
                <span>
                  {lang.wordsKnown.toLocaleString()} / {lang.totalWords.toLocaleString()} incl.
                  variants
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mx-auto mt-4 max-w-2xl text-[10px] leading-relaxed text-slate-600">
        Word counts match the game's own "words learned" counters. Learning one word can also
        unlock related variants in the dictionary — that larger tally is shown as "incl.
        variants". Totals come from a game-data dump and may drift slightly across game updates.
      </p>
    </div>
  )
}
