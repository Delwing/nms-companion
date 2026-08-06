import { GLYPH_NAMES } from '@shared/galaxy'
import { GLYPH_IMAGES } from '../assets/glyphs'

/**
 * A portal address as the 12 in-game glyph images, each on a dark tile with
 * the glyph's 1–16 number on the portal dialler wheel — dial in reading
 * order. Tiles wrap to the container width, so a narrow parent (the HUD)
 * gets two rows of six.
 */
export function PortalGlyphStrip({
  code,
  large = false
}: {
  code: string
  /** Bigger tiles for the HUD, where the strip is read mid-game. */
  large?: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {[...code].map((c, i) => {
        const digit = parseInt(c, 16)
        return (
          <span
            key={i}
            title={`${GLYPH_NAMES[digit]} — glyph ${digit + 1} of 16 on the dialler`}
            className="flex flex-col items-center rounded bg-black/40 p-0.5"
          >
            <img
              src={GLYPH_IMAGES[digit]}
              alt={GLYPH_NAMES[digit]}
              className={large ? 'h-8 w-8' : 'h-6 w-6'}
            />
            <span
              className={`font-mono leading-tight text-slate-300 ${large ? 'text-[10px]' : 'text-[9px]'}`}
            >
              {digit + 1}
            </span>
          </span>
        )
      })}
    </div>
  )
}
