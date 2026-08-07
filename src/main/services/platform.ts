/**
 * Which of the overlay/scanning features this OS can actually deliver.
 *
 * The save-catalogue half of the app is portable — it reads files. The other
 * half is built on Win32 desktop semantics (grab a screenshot of whatever is
 * on screen, hand the foreground to another process, float a click-through
 * always-on-top window over a fullscreen game, read another process's memory),
 * and those have no equivalent everywhere. Rather than let them fail with a
 * cryptic native error, resolve what's supported up front and say so.
 */
import type { PlatformSupport } from '@shared/types'

/**
 * Wayland compositors deliberately deny apps the things the overlay relies on:
 * there is no global hotkey grab, no way to raise another app's window, and
 * screen capture only through a portal that prompts per session. Electron may
 * still be running through XWayland, where capture of the game (itself an X11
 * client under Proton) can work — so capture is attempted anyway and this only
 * decides what the UI warns about.
 */
function isWayland(): boolean {
  return process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
}

let cached: PlatformSupport | null = null

export function platformSupport(): PlatformSupport {
  if (cached) return cached

  const os = process.platform
  if (os === 'win32') {
    cached = {
      os,
      session: null,
      screenCapture: true,
      globalHotkeys: true,
      gameFocus: true,
      memoryScan: true,
      limitations: []
    }
    return cached
  }

  const wayland = isWayland()
  const limitations = [
    'Alt+S can’t hand the foreground back to the game — no equivalent of the Win32 call outside Windows. The HUD still toggles click-through.',
    'Pulling procedural names out of the running game reads process memory through a Windows API, so it is unavailable here.'
  ]
  if (wayland) {
    limitations.unshift(
      'Wayland blocks global hotkeys, so Alt+C and Alt+S won’t fire — use the Scan button.',
      'Wayland only allows screen capture through a portal. Scanning may prompt, or fail outright; an X11 session works normally.'
    )
  }

  cached = {
    os,
    session: os === 'linux' ? (wayland ? 'wayland' : 'x11') : null,
    screenCapture: !wayland,
    globalHotkeys: !wayland,
    gameFocus: false,
    memoryScan: false,
    limitations
  }
  return cached
}
