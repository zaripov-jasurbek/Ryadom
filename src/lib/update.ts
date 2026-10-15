/**
 * A tab or installed app opened before a deploy still runs the old build, whose lazily loaded files (supabase-js,
 * the scanner) are gone from the server: loading one fails with a 404 that the browser reports like a network error.
 * Vite then fires vite:preloadError, and the page reloads once onto the new build. Offline it does not reload, so
 * the real "no internet" message shows; and not twice within a minute, so a file that is really missing cannot loop.
 */
const reloadedKey = 'ryadom:reloaded-for-update'
const quietMs = 60_000

export function shouldReloadForUpdate(online: boolean, lastReload: number | null, now: number) {
  return online && (lastReload === null || !(now - lastReload < quietMs))
}

export function reloadOnStaleBuild() {
  window.addEventListener('vite:preloadError', event => {
    let last: number | null = null
    try { last = Number(sessionStorage.getItem(reloadedKey)) || null } catch { /* storage blocked: reload at most once per load */ }
    if (!shouldReloadForUpdate(navigator.onLine, last, Date.now())) return
    event.preventDefault()
    try { sessionStorage.setItem(reloadedKey, String(Date.now())) } catch { /* see above */ }
    location.reload()
  })
}
