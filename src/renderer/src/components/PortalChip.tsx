import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { GLYPH_NAMES } from '@shared/galaxy'

/**
 * Portal address as a click-to-copy chip; glyph names live in the tooltip.
 * Copying also pins the code (HUD glyph strip + window title) so it stays
 * readable while dialling the portal in-game.
 */
export function PortalChip({ code }: { code: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const glyphNames = [...code]
    .map((c, i) => {
      const digit = parseInt(c, 16)
      return `${i + 1}. ${GLYPH_NAMES[digit]} (glyph ${digit + 1}/16)`
    })
    .join('\n')

  const copy = (): void => {
    void navigator.clipboard.writeText(code)
    void window.api.pinPortal(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={copy}
      title={`Portal glyphs (click to copy & pin)\n${glyphNames}`}
      className="no-drag flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.15em] text-purple-300 transition-colors hover:border-purple-400/50 hover:text-purple-200"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {code}
    </button>
  )
}
