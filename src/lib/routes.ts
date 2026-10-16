export const basePath = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')
/**
 * A check's address is the home page with ?c=<id>. GitHub Pages has no /check/<id> file and answers it with
 * 404.html under status 404: the browser still runs the app, but Telegram and other messengers show no preview
 * for a 404. The home page answers 200, so ?c= links get the preview.
 */
export const checkPath = (id: string) => `${basePath}/?c=${encodeURIComponent(id)}`
export const homePath = () => basePath ? `${basePath}/` : '/'

const checkId = /^[A-Za-z0-9_-]+$/

/**
 * The check an address opens: ?c=<id> on the home page, or /check/<id> from links shared before 2.9.0.
 * The base path itself (e.g. /bill_splitter/) without ?c= is home.
 */
export function routeCheckId(pathname: string, base = basePath, search = ''): string | null {
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname
  const legacy = /^\/check\/([^/]+)\/?$/.exec(path)?.[1]
  if (legacy) return legacy
  if (path !== '' && path !== '/' && path !== '/index.html') return null
  const id = new URLSearchParams(search).get('c')
  return id && checkId.test(id) ? id : null
}

/**
 * Reads the owner secret from #p= (or the older ?p=) of owner links made by earlier versions.
 * The app no longer puts the secret in the address bar: whoever got a copy of it became the creator.
 */
export function readOwnerToken(search: string, hash: string): { token: string; legacy: boolean } {
  const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get('p')
  if (fromHash) return { token: fromHash, legacy: false }
  const fromQuery = new URLSearchParams(search).get('p')
  return { token: fromQuery ?? '', legacy: Boolean(fromQuery) }
}
