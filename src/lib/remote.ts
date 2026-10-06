import { loadSupabase } from './supabase'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Bill, BillItem, CommentMessage, Participant, PaymentStatus, ShareMode } from './calculations'
import type { Database } from './database.types'

// Realtime is only used after a sign-in, which loads the client; keeping it here lets
// subscribeToRemoteCheck stay synchronous, so the caller closes the old channel right before opening the new one.
let realtimeClient: SupabaseClient<Database> | null = null

// Concurrent callers share one sign-in instead of each creating an anonymous user.
let sessionPromise: Promise<string> | null = null
let watchingAuth = false
export function ensureAnonymousSession() {
  sessionPromise ??= (async () => {
    const db = realtimeClient = await loadSupabase()
    if (!watchingAuth) {
      watchingAuth = true
      // A revoked or deleted session signs out; the next call signs in again instead of reusing the old user id.
      db.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { sessionPromise = null; touchedAt = 0 } })
    }
    const { data: sessionData, error: sessionError } = await db.auth.getSession()
    if (sessionError) throw sessionError
    if (sessionData.session) return sessionData.session.user.id
    const { data, error } = await db.auth.signInAnonymously()
    if (error) throw error
    if (!data.user) throw new Error('Unable to create an anonymous session')
    return data.user.id
  })().catch(error => { sessionPromise = null; throw error })
  return sessionPromise
}

/**
 * Every RPC is granted to signed-in users only, so these mean the request went out without a usable session:
 * 42501 — no session at all (anon role), PGRST301/PGRST303 — an invalid or expired token.
 */
const lostSession = new Set(['42501', 'PGRST301', 'PGRST303'])

// Anonymous accounts unused for 10 days are deleted (public.account_lifetime()); using the app renews them.
// The server writes at most once an hour anyway, so the client does not ask more often.
let touchedAt = 0
function touchAccount(db: SupabaseClient<Database>) {
  if (Date.now() - touchedAt < 3_600_000) return
  touchedAt = Date.now()
  void db.rpc('touch_account').then(({ error }) => { if (error) touchedAt = 0 })
}

type Rpc = Database['public']['Functions']
async function call<K extends keyof Rpc>(fn: K, args: Rpc[K]['Args']): Promise<unknown> {
  for (let retried = false; ; retried = true) {
    await ensureAnonymousSession()
    const db = await loadSupabase()
    touchAccount(db)
    const { data, error } = await db.rpc(fn, args)
    if (!error) return data
    if (retried || !lostSession.has(error.code)) throw error
    // Drop the broken session and retry once as a fresh anonymous user; get_check then reports the check
    // as unknown, and the store re-attaches this browser with its owner or guest token.
    await db.auth.signOut({ scope: 'local' }).catch(() => {})
    sessionPromise = null; touchedAt = 0
  }
}

type Created = { id: string; public_id: string; participant_id: string }

export const createRemoteCheck = (title: string, servicePercent: number, ownerName: string, ownerToken: string, paymentDetails: string) =>
  call('create_check', { p_title: title, p_service_percent: servicePercent, p_owner_name: ownerName, p_owner_token: ownerToken, p_payment_details: paymentDetails || null }) as Promise<Created>
export const claimRemoteCheckOwner = (publicId: string, ownerToken: string) => call('claim_check_owner', { p_public_id: publicId, p_owner_token: ownerToken })
export const joinRemoteCheck = (publicId: string, name: string, sessionToken: string) => call('join_check', { p_public_id: publicId, p_name: name, p_session_token: sessionToken }) as Promise<Created>
export const addRemoteItem = (checkId: string, name: string, quantity: number, price: number) => call('add_item', { p_check_id: checkId, p_name: name, p_quantity: quantity, p_unit_price: price })
/** All rows or none, in one request; scanned receipts add many at once. */
export const addRemoteItems = (checkId: string, items: { name: string; quantity: number; unitPrice: number }[]) =>
  call('add_items', { p_check_id: checkId, p_items: items.map(entry => ({ name: entry.name, quantity: entry.quantity, unit_price: entry.unitPrice })) })
export const updateRemoteItem = (checkId: string, itemId: string, name: string, quantity: number, price: number) => call('update_item', { p_check_id: checkId, p_item_id: itemId, p_name: name, p_quantity: quantity, p_unit_price: price })
export const updateRemoteCheck = (checkId: string, title: string, servicePercent: number, paymentDetails: string) => call('update_check', { p_check_id: checkId, p_title: title, p_service_percent: servicePercent, p_payment_details: paymentDetails })
export const shareRemoteItemEqually = (checkId: string, itemId: string) => call('share_item_equally', { p_check_id: checkId, p_item_id: itemId })
export const unconfirmRemotePayment = (checkId: string, participantId: string) => call('unconfirm_payment', { p_check_id: checkId, p_participant_id: participantId })
export const deleteRemoteItem = (checkId: string, itemId: string) => call('delete_item', { p_check_id: checkId, p_item_id: itemId })
export const toggleRemoteUnit = (unitId: string, enabled: boolean) => call('toggle_unit_share', { p_item_unit: unitId, p_enabled: enabled })
export const addRemoteComment = (checkId: string, itemId: string | null, body: string) => call('add_comment', { p_check_id: checkId, p_item_id: itemId, p_body: body })
export const deleteRemoteComment = (commentId: string) => call('delete_comment', { p_comment_id: commentId })
export const removeRemoteParticipant = (checkId: string, participantId: string) => call('remove_participant', { p_check_id: checkId, p_participant_id: participantId })
export const setRemoteCustomShares = (unitId: string, allocations: Record<string, number>) => call('set_unit_custom_shares', { p_item_unit: unitId, p_allocations: allocations })
export const resetRemoteCustomShares = (unitId: string) => call('reset_unit_custom_shares', { p_item_unit: unitId })
export const submitRemotePayment = (checkId: string, amount: number) => call('submit_payment', { p_check_id: checkId, p_amount: amount })
export const confirmRemotePayment = (checkId: string, participantId: string) => call('confirm_payment', { p_check_id: checkId, p_participant_id: participantId })
export const deleteRemoteCheck = (checkId: string) => call('delete_check', { p_check_id: checkId })

/** Title, names and total for the invitation page; null when the check is gone or expired. */
export type CheckPreview = { title: string; servicePercent: number; participants: string[]; items: number; foodTotal: number }
export async function previewRemoteCheck(publicId: string): Promise<CheckPreview | null> {
  const row = await call('check_preview', { p_public_id: publicId }) as { title: string; service_percent: number; participants: string[]; items: number; food_total: number } | null
  return row && { title: row.title, servicePercent: Number(row.service_percent), participants: row.participants, items: Number(row.items), foodTotal: Number(row.food_total) }
}

/** True when the check is gone or the current user is no longer one of its participants. */
export function isRemoteCheckGone(error: unknown) {
  const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined
  return code === 'P0002' || code === 'PGRST116'
}

type Snapshot = {
  id: string; public_id: string; title: string; service_percent: number; payment_details: string | null; created_at: string; me: string; owner_id: string | null; is_owner: boolean
  participants: { id: string; name: string; paid: number; status: PaymentStatus }[]
  items: { id: string; name: string; quantity: number; unit_price: number; units: { id: string; shares: { participant_id: string; amount: number; mode: ShareMode }[] }[] }[]
  comments: { id: string; item_id: string | null; participant_id: string; body: string; created_at: string }[]
}

export type RemoteBill = Bill & { me: string; isOwner: boolean }

export async function loadRemoteCheck(publicId: string): Promise<RemoteBill> {
  const row = await call('get_check', { p_public_id: publicId }) as Snapshot
  const participants: Participant[] = row.participants.map(person => ({ id: person.id, name: person.name, paid: Number(person.paid), status: person.status }))
  const items: BillItem[] = row.items.map(item => {
    const next: BillItem = { id: item.id, name: item.name, quantity: item.quantity, unitPrice: Number(item.unit_price), unitIds: item.units.map(unit => unit.id), unitSelections: {}, unitModes: {}, unitCustomAmounts: {}, unitAmounts: {} }
    item.units.forEach((unit, index) => {
      if (!unit.shares.length) return
      const key = String(index)
      next.unitSelections[key] = unit.shares.map(share => share.participant_id)
      next.unitAmounts![key] = Object.fromEntries(unit.shares.map(share => [share.participant_id, Number(share.amount)]))
      if (unit.shares.some(share => share.mode === 'custom')) {
        next.unitModes![key] = 'custom'
        next.unitCustomAmounts![key] = next.unitAmounts![key]
      }
    })
    return next
  })
  const comments: CommentMessage[] = row.comments.map(comment => ({ id: comment.id, itemId: comment.item_id ?? undefined, participantId: comment.participant_id, body: comment.body, createdAt: comment.created_at }))
  return { id: row.public_id, dbId: row.id, title: row.title, servicePercent: Number(row.service_percent), paymentDetails: row.payment_details ?? undefined, ownerId: row.owner_id ?? undefined, participants, items, comments, createdAt: row.created_at, ownerToken: '', me: row.me, isOwner: row.is_owner }
}

export type PresenceUser = { participantId: string | null; name: string; activity: string }
export type RemoteSubscription = { close: () => void; setPresence: (user: PresenceUser) => void }

/**
 * Listens on the check's private channel: the database broadcasts "changed" once per transaction,
 * and presence shows who is looking at the check. Changes made by this device are skipped,
 * because the action that made them reloads the check itself.
 */
export function subscribeToRemoteCheck(publicId: string, userId: string, onChange: () => void, onPresence: (users: PresenceUser[]) => void, self: PresenceUser): RemoteSubscription {
  const db = realtimeClient
  if (!db) throw new Error('Sign in with ensureAnonymousSession() before subscribing')
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  let current = self, joined = false, joinedBefore = false
  const channel: RealtimeChannel = db.channel(`check:${publicId}`, { config: { private: true, presence: { key: userId } } })
  channel.on('broadcast', { event: 'changed' }, ({ payload }) => {
    if ((payload as { by?: string } | undefined)?.by === userId) return
    clearTimeout(reloadTimer); reloadTimer = setTimeout(onChange, 150)
  })
  channel.on('presence', { event: 'sync' }, () => {
    const byPerson = new Map<string, PresenceUser>()
    for (const [key, metas] of Object.entries(channel.presenceState<PresenceUser>())) {
      const latest = metas.at(-1)
      if (latest) byPerson.set(latest.participantId ?? key, { participantId: latest.participantId, name: latest.name, activity: latest.activity })
    }
    onPresence([...byPerson.values()])
  })
  const track = () => void channel.track({ ...current, since: new Date().toISOString() })
  channel.subscribe(status => {
    if (status !== 'SUBSCRIBED') { joined = false; return }
    // After a reconnect, reload in case broadcasts were missed while offline.
    if (joinedBefore) onChange()
    joined = joinedBefore = true; track()
  })
  return {
    close: () => { clearTimeout(reloadTimer); void db.removeChannel(channel) },
    setPresence: user => { current = user; if (joined) track() },
  }
}
