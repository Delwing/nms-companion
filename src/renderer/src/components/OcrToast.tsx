import { CheckCircle2, Globe } from 'lucide-react'
import type { ParsedPlanetData } from '@shared/types'

interface OcrToastProps {
  data?: ParsedPlanetData
  visible: boolean
}

/** Translucent glassmorphism feedback overlay shown when a scan completes. */
export function OcrToast({ data, visible }: OcrToastProps): React.JSX.Element | null {
  if (!visible || !data) return null

  return (
    <div className="fixed top-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-cyan-500/30 bg-slate-900/85 px-4 py-3 text-white shadow-2xl backdrop-blur-md transition-all duration-300">
      <Globe className="h-6 w-6 animate-pulse text-cyan-400" />
      <div>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-100">{data.name || 'Planet Catalogued'}</h4>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/20 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
            {data.planetType}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          {data.resources?.length || 0} Resources Extracted | Weather: {data.weather}
        </p>
      </div>
      <CheckCircle2 className="ml-2 h-5 w-5 text-emerald-400" />
    </div>
  )
}
