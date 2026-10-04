export const basePath = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')
export const checkPath = (id: string) => `${basePath}/check/${id}`
export const homePath = () => basePath ? `${basePath}/` : '/'

/** Only /check/<id> under the app's base path is a check; the base path itself (e.g. /bill_splitter/) is home. */
export function routeCheckId(pathname: string, base = basePath): string | null {
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname
  return /^\/check\/([^/]+)\/?$/.exec(path)?.[1] ?? null
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
