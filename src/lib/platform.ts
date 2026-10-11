export type InstallHint = 'ios' | 'mac' | 'android' | null

/**
 * Safari never offers installation itself (no beforeinstallprompt), so its users get the steps instead:
 * iPhone and iPad through the share menu, a Mac through File → Add to Dock (Safari 17+).
 * Android gets the browser-menu steps as a fallback: Chrome offers its own prompt only on https, and not again for months
 * after it is dismissed; Samsung Internet and Firefox never offer it. When the prompt does come, it is used instead.
 * Chrome and Edge on Windows install through their own prompt and need no hint.
 */
export function installHintFor(userAgent: string, maxTouchPoints: number, standalone: boolean): InstallHint {
  if (standalone) return null
  // iPadOS reports itself as a Mac; touch points tell them apart.
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  if (!/Macintosh/.test(userAgent) || /Chrome|Chromium|Edg|Firefox|OPR/.test(userAgent)) return null
  return Number(/Version\/(\d+)/.exec(userAgent)?.[1] ?? 0) >= 17 ? 'mac' : null
}
