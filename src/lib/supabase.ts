import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

// supabase-js is most of the bundle, so it loads on first use instead of with the home page.
let clientPromise: Promise<SupabaseClient<Database>> | null = null
export function loadSupabase() {
  if (!url || !anonKey) return Promise.reject(new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'))
  clientPromise ??= import('@supabase/supabase-js')
    .then(({ createClient }) => createClient<Database>(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }))
    .catch(error => { clientPromise = null; throw error })
  return clientPromise
}

/** Starts loading the client ahead of the first call, e.g. while a form is being filled in. */
export function preloadSupabase() {
  if (isSupabaseConfigured) loadSupabase().catch(() => { /* the real call reports the error */ })
}
