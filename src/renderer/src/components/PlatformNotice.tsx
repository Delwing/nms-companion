import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { PlatformSupport } from '@shared/types'

interface PlatformNoticeProps {
  platform: PlatformSupport | null
}

const OS_LABEL: Record<string, string> = {
  linux: 'Linux',
  darwin: 'macOS',
  win32: 'Windows'
}

function describe(platform: PlatformSupport): string {
  const os = OS_LABEL[platform.os] ?? platform.os
  return platform.session ? `${os} (${platform.session})` : os
}

/**
 * Says which overlay/scanning features the host OS can't provide. The save
 * catalogue works everywhere; the rest is built on Win32 desktop behaviour
 * with no portable equivalent, and silently dead hotkeys are worse than an
 * up-front explanation. Dismissal is remembered per platform+session, so a
 * different session type (X11 vs Wayland) surfaces its own list again.
 */
export function PlatformNotice({ platform }: PlatformNoticeProps): React.JSX.Element | null {
  const key = platform ? `platformNoticeDismissed:${platform.os}:${platform.session ?? ''}` : ''
  const [dismissed, setDismissed] = useState(() => !!key && localStorage.getItem(key) === '1')

  if (!platform || platform.limitations.length === 0 || dismissed) return null

  const dismiss = (): void => {
    localStorage.setItem(key, '1')
    setDismissed(true)
  }

  return (
    <div className="flex items-start gap-2.5 border-b border-amber-500/25 bg-amber-500/10 px-5 py-2 text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="flex-1 text-[11px] leading-relaxed">
        <p className="font-semibold">
          Running on {describe(platform)} — save cataloguing works, some overlay features don’t:
        </p>
        <ul className="mt-0.5 list-disc pl-4 text-amber-200/80">
          {platform.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </div>
      <button
        onClick={dismiss}
        title="Dismiss"
        className="no-drag rounded p-0.5 text-amber-300/70 transition-colors hover:bg-amber-500/20 hover:text-amber-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
