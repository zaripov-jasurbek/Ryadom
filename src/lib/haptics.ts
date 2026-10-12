// Haptic feedback on both phone platforms, without a library.
//
// Android: the Vibration API, called from the tap handler as usual.
//
// iOS: Safari has no Vibration API. The only haptic a web page gets is the native tick of
// <input type="checkbox" switch> (Safari 17.4+), and on iOS 26 only when the finger itself toggles it:
// a script calling .click() on a hidden switch is silent. So on iOS `tactile` lays a transparent switch
// over the control; the user's own tap toggles it, Safari ticks, and the click bubbles on to the button's
// handler as before. The `haptic.*` calls stay in the code and simply do nothing there.

type Pattern = number | number[]

const patterns = {
  light: 15,
  selection: 8,
  success: [30, 60, 40],
  warning: [40, 100, 40],
  error: [40, 40, 40, 40, 40],
} satisfies Record<string, Pattern>

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

function vibrate(pattern: Pattern) {
  if (!canVibrate) return
  try { navigator.vibrate(pattern) } catch { /* blocked without a user gesture: nothing to feel, nothing to break */ }
}

export const haptic = {
  light: () => vibrate(patterns.light),
  selection: () => vibrate(patterns.selection),
  success: () => vibrate(patterns.success),
  warning: () => vibrate(patterns.warning),
  error: () => vibrate(patterns.error),
}

// iPadOS reports itself as a Mac, so touch points tell them apart.
export const isIOS = typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

// Svelte attachment: <button {@attach tactile}>. A no-op off iOS, where `haptic.*` already vibrates.
export function tactile(node: HTMLElement) {
  if (!isIOS) return
  const knob = document.createElement('input')
  knob.type = 'checkbox'
  knob.setAttribute('switch', '')
  knob.className = 'tactile'
  knob.tabIndex = -1
  knob.setAttribute('aria-hidden', 'true')
  if (getComputedStyle(node).position === 'static') node.style.position = 'relative'
  node.append(knob)
  return () => knob.remove()
}
