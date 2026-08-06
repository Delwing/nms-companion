import koffi from 'koffi'

/**
 * Hands the Windows foreground to the game window via user32, because merely
 * un-focusing the overlay (setFocusable(false)) only tells Windows to pick
 * the next window in z-order — the game is not reliably activated until the
 * user clicks it.
 */

const SW_RESTORE = 9

interface User32 {
  findWindow: (className: string | null, title: string) => unknown
  setForegroundWindow: (hwnd: unknown) => boolean
  isIconic: (hwnd: unknown) => boolean
  showWindow: (hwnd: unknown, cmd: number) => boolean
}

let user32: User32 | null | undefined

function loadUser32(): User32 | null {
  if (user32 !== undefined) return user32
  try {
    const lib = koffi.load('user32.dll')
    user32 = {
      findWindow: lib.func('FindWindowW', 'void*', ['str16', 'str16']),
      setForegroundWindow: lib.func('SetForegroundWindow', 'bool', ['void*']),
      isIconic: lib.func('IsIconic', 'bool', ['void*']),
      showWindow: lib.func('ShowWindow', 'bool', ['void*', 'int'])
    }
  } catch (err) {
    console.warn('[gameFocus] user32 unavailable:', err)
    user32 = null
  }
  return user32
}

/**
 * Bring the window with the given title to the foreground. Succeeds only
 * when called while this process holds foreground rights (e.g. from a
 * global-shortcut handler). Returns false if the window isn't found.
 */
export function focusWindowByTitle(title: string): boolean {
  if (process.platform !== 'win32') return false
  const lib = loadUser32()
  if (!lib) return false
  // koffi maps a NULL HWND to null, so a plain truthiness check suffices.
  const hwnd = lib.findWindow(null, title)
  if (!hwnd) return false
  if (lib.isIconic(hwnd)) lib.showWindow(hwnd, SW_RESTORE)
  return lib.setForegroundWindow(hwnd)
}
