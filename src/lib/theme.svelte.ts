export type Theme = 'system' | 'light' | 'dark'
export const themes: { value: Theme; icon: string; label: string }[] = [{ value: 'light', icon: '☀', label: 'Светлая тема' }, { value: 'system', icon: '◐', label: 'Как в системе' }, { value: 'dark', icon: '☾', label: 'Тёмная тема' }]
const storageKey = 'billsplit:theme'

export const theme = $state<{ current: Theme }>({ current: 'system' })

export function setTheme(next: Theme) {
  theme.current = next
  try { if (next === 'system') localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, next) } catch { /* theme still applies for this visit */ }
  if (next === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = next
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => { meta.content = next === 'system' ? meta.dataset.default ?? bar : bar })
}

/** index.html already applied the saved theme before first paint; this syncs the switch and the browser bar. */
export function restoreTheme() {
  try { const stored = localStorage.getItem(storageKey); if (stored === 'light' || stored === 'dark') setTheme(stored) } catch { /* system theme */ }
}
