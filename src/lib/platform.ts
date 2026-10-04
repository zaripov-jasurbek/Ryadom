export type InstallHint = 'ios' | 'mac' | null

/**
 * Safari never offers installation itself (no beforeinstallprompt), so its users get the steps instead:
 * iPhone and iPad through the share menu, a Mac through File → Add to Dock (Safari 17+).
 * Chrome and Edge on Android and Windows install through their own prompt and need no hint.
 */
export function installHintFor(userAgent: string, maxTouchPoints: number, standalone: boolean): InstallHint {
  if (standalone) return null
  // iPadOS reports itself as a Mac; touch points tell them apart.
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios'
  if (!/Macintosh/.test(userAgent) || /Chrome|Chromium|Edg|Firefox|OPR/.test(userAgent)) return null
  return Number(/Version\/(\d+)/.exec(userAgent)?.[1] ?? 0) >= 17 ? 'mac' : null
}
