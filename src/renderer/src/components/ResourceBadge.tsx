import { resourceMeta } from '@shared/resourceMeta'
import { useItemHover } from './ItemTooltip'

/**
 * The coloured diamond marker NMS puts next to substances, in the
 * game's own tint for the resource. A faint ring keeps near-background
 * colours (Basalt, Indium) visible on the dark UI.
 */
export function ResourceDiamond({
  name,
  className = 'h-2 w-2'
}: {
  name: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rotate-45 rounded-[1px] ring-1 ring-white/25 ${className}`}
      style={{ backgroundColor: resourceMeta(name).colour }}
    />
  )
}

/** Resource pill with the game-coloured diamond; hover shows the item card. */
export function ResourceChip({
  name,
  size = 'md'
}: {
  name: string
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const meta = resourceMeta(name)
  const { hoverProps, tooltip } = useItemHover(name, {
    fallback: { group: meta.group, colour: meta.colour }
  })
  return (
    <span
      {...hoverProps}
      className={`inline-flex items-center rounded-full border border-slate-600/50 bg-slate-800/60 whitespace-nowrap text-slate-200 ${
        size === 'sm' ? 'gap-1 px-1.5 text-[9px]' : 'gap-1.5 px-2 py-0.5 font-mono text-[10px]'
      }`}
    >
      <ResourceDiamond name={name} className={size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'} />
      {name}
      {tooltip}
    </span>
  )
}
