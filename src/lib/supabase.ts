import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const isSupabaseConfigured = Boolean(url && anonKey)

// A request stuck on a weak mobile network would keep the buttons disabled until the page is reloaded;
// after this long it fails like any network error, and the person can try again.
const requestTimeoutMs = 15_000
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController(), outer = init?.signal
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), requestTimeoutMs)
  if (outer?.aborted) controller.abort(outer.reason)
  else outer?.addEventListener('abort', () => controller.abort(outer.reason), { once: true })
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// supabase-js is most of the bundle, so it loads on first use instead of with the home page.
let clientPromise: Promise<SupabaseClient<Database>> | null = null
export function loadSupabase() {
  if (!url || !anonKey) return Promise.reject(new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'))
  clientPromise ??= import('@supabase/supabase-js')
    .then(({ createClient }) => createClient<Database>(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: fetchWithTimeout },
    }))
    .catch(error => { clientPromise = null; throw error })
  return clientPromise
}

/** Starts loading the client ahead of the first call, e.g. while a form is being filled in. */
export function preloadSupabase() {
  if (isSupabaseConfigured) loadSupabase().catch(() => { /* the real call reports the error */ })
}
