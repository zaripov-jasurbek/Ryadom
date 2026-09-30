import { supabase } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Bill, CommentMessage, Participant, PaymentStatus } from './calculations'

function client() {
  if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  return supabase
}

export async function ensureAnonymousSession() {
  const db = client()
  const { data: sessionData, error: sessionError } = await db.auth.getSession()
  if (sessionError) throw sessionError
  if (sessionData.session) return sessionData.session.user.id
  const { data, error } = await db.auth.signInAnonymously()
  if (error) throw error
  if (!data.user) throw new Error('Unable to create an anonymous session')
  return data.user.id
}

export async function createRemoteCheck(title: string, servicePercent: number, ownerName: string, ownerToken: string) {
  await ensureAnonymousSession()
  const { data, error } = await client().rpc('create_check', { p_title: title, p_service_percent: servicePercent, p_owner_name: ownerName, p_owner_token: ownerToken })
  if (error) throw error
  return data as { id: string; public_id: string; participant_id: string }
}

export async function claimRemoteCheckOwner(publicId: string, ownerToken: string) {
  await ensureAnonymousSession()
  const { error } = await client().rpc('claim_check_owner', { p_public_id: publicId, p_owner_token: ownerToken })
  if (error) throw error
}

export async function joinRemoteCheck(publicId: string, name: string, sessionToken: string) {
  await ensureAnonymousSession()
  const { data, error } = await client().rpc('join_check', { p_public_id: publicId, p_name: name, p_session_token: sessionToken })
  if (error) throw error
  return data as { id: string; public_id: string; participant_id: string }
}

export async function addRemoteItem(checkId: string, name: string, quantity: number, price: number, participantId: string) {
  const { error } = await client().rpc('add_item', { p_check_id: checkId, p_name: name, p_quantity: quantity, p_unit_price: price, p_creator_participant: participantId })
  if (error) throw error
}

export async function deleteRemoteItem(checkId: string, itemId: string) {
  const { error } = await client().rpc('delete_item', { p_check_id: checkId, p_item_id: itemId })
  if (error) throw error
}

export async function toggleRemoteUnit(unitId: string, enabled: boolean) {
  const { error } = await client().rpc('toggle_unit_share', { p_item_unit: unitId, p_enabled: enabled })
  if (error) throw error
}

export async function addRemoteComment(checkId: string, itemId: string | null, body: string) {
  const { error } = await client().rpc('add_comment', { p_check_id: checkId, p_item_id: itemId, p_body: body })
  if (error) throw error
}

export async function setRemoteCustomShares(unitId: string, allocations: Record<string, number>) {
  const { error } = await client().rpc('set_unit_custom_shares', { p_item_unit: unitId, p_allocations: allocations })
  if (error) throw error
}

export async function submitRemotePayment(checkId: string, amount: number, proofUrl: string | null) {
  const { error } = await client().rpc('submit_payment', { p_check_id: checkId, p_amount: amount, p_proof_url: proofUrl })
  if (error) throw error
}

export async function confirmRemotePayment(checkId: string, participantId: string) {
  const { error } = await client().rpc('confirm_payment', { p_check_id: checkId, p_participant_id: participantId })
  if (error) throw error
}

export async function deleteRemoteCheck(checkId: string) {
  const { error } = await client().rpc('delete_check', { p_check_id: checkId })
  if (error) throw error
}

export type RemoteBill = Bill & { dbId: string; publicId: string; unitIds: Record<string, string[]> }
export async function loadRemoteCheck(publicId: string): Promise<RemoteBill> {
  const db = client()
  const { data: row, error: checkError } = await db.from('checks').select('id,public_id,title,service_percent,created_at').eq('public_id', publicId).single()
  if (checkError) throw checkError
  const [peopleResult, itemsResult, paymentsResult, commentsResult] = await Promise.all([
    db.from('participants').select('id,name,sort_order').eq('check_id', row.id).order('sort_order'),
    db.from('items').select('id,name,quantity,unit_price').eq('check_id', row.id).order('created_at'),
    db.from('payments').select('participant_id,amount_paid,proof_url,status').eq('check_id', row.id),
    db.from('comments').select('id,item_id,participant_id,body,created_at').eq('check_id', row.id).order('created_at'),
  ])
  if (peopleResult.error) throw peopleResult.error
  if (itemsResult.error) throw itemsResult.error
  if (paymentsResult.error) throw paymentsResult.error
  if (commentsResult.error) throw commentsResult.error
  const itemIds=itemsResult.data.map(item => item.id)
  const unitsResult=itemIds.length ? await db.from('item_units').select('id,item_id,unit_index').in('item_id',itemIds) : null
  if (unitsResult?.error) throw unitsResult.error
  const units=unitsResult?.data ?? []
  const sharesResult=units.length ? await db.from('item_shares').select('item_unit_id,participant_id,amount,mode').in('item_unit_id',units.map(unit=>unit.id)) : null
  if (sharesResult?.error) throw sharesResult.error
  const shares=sharesResult?.data ?? []
  const paymentByPerson = new Map(paymentsResult.data.map(payment => [payment.participant_id, payment]))
  const participants: Participant[] = peopleResult.data.map(person => {
    const payment = paymentByPerson.get(person.id)
    return { id: person.id, name: person.name, paid: Number(payment?.amount_paid ?? 0), proofUrl: payment?.proof_url ?? undefined, status: (payment?.status ?? 'unpaid') as PaymentStatus }
  })
  const unitIds: Record<string, string[]> = {}
  const unitById = new Map<string, { item_id: string; unit_index: number }>()
  for (const unit of units) {
    unitById.set(unit.id, unit)
    ;(unitIds[unit.item_id] ??= [])[unit.unit_index - 1] = unit.id
  }
  const selectionsByItem = new Map<string, Record<string, string[]>>()
  const customByItem = new Map<string, Record<string, Record<string, number>>>()
  const modeByItem = new Map<string, Record<string, 'equal' | 'by_quantity' | 'custom'>>()
  for (const share of shares) {
    const unit = unitById.get(share.item_unit_id)
    if (!unit) continue
    const selection = selectionsByItem.get(unit.item_id) ?? {}
    const unitKey = String(unit.unit_index - 1)
    selection[unitKey] ??= []
    selection[unitKey].push(share.participant_id)
    selectionsByItem.set(unit.item_id, selection)
    const modes = modeByItem.get(unit.item_id) ?? {}; modes[unitKey] = share.mode; modeByItem.set(unit.item_id, modes)
    if (share.mode === 'custom') { const custom = customByItem.get(unit.item_id) ?? {}; custom[unitKey] ??= {}; custom[unitKey][share.participant_id] = Number(share.amount); customByItem.set(unit.item_id, custom) }
  }
  const items = itemsResult.data.map(item => ({ id: item.id, name: item.name, quantity: item.quantity, unitPrice: Number(item.unit_price), unitSelections: selectionsByItem.get(item.id) ?? {}, unitIds: unitIds[item.id] ?? [], unitModes: modeByItem.get(item.id) ?? {}, unitCustomAmounts: customByItem.get(item.id) ?? {} }))
  const comments: CommentMessage[] = commentsResult.data.map(comment => ({ id: comment.id, itemId: comment.item_id ?? undefined, participantId: comment.participant_id, body: comment.body, createdAt: comment.created_at }))
  return { id: row.public_id, publicId: row.public_id, dbId: row.id, title: row.title, servicePercent: Number(row.service_percent), participants, items, comments, createdAt: row.created_at, ownerToken: '', unitIds }
}

let activePresenceChannel: RealtimeChannel | null = null
let activePresenceName = 'Гость'
export async function updateRemoteActivity(activity: string) {
  if (!activePresenceChannel) return
  await activePresenceChannel.track({ name: activePresenceName, activity, since: new Date().toISOString() })
}

export function subscribeToRemoteCheck(dbId: string, publicId: string, onChange: () => void, onPresence?: (users: { name: string; activity: string }[]) => void, self?: { name: string; activity: string }) {
  const db = client()
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  const channel = db.channel(`check:${publicId}`, { config: { private: true, presence: { key: self?.name ?? 'guest' } } })
  const refresh = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(onChange, 180) }
  for (const table of ['checks', 'participants', 'items', 'item_units', 'item_shares', 'payments', 'comments']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: table === 'checks' ? `id=eq.${dbId}` : ['items','participants','payments','comments'].includes(table) ? `check_id=eq.${dbId}` : undefined }, refresh)
  }
  if (onPresence) channel.on('presence', { event: 'sync' }, () => {
    const users = Object.values(channel.presenceState()).flat() as unknown as { name: string; activity: string }[]
    onPresence(users)
  })
  activePresenceChannel=channel
  activePresenceName=self?.name ?? 'Гость'
  channel.subscribe(async status => {
    if (status === 'SUBSCRIBED' && self) {
      await channel.track({ name: self.name, activity: self.activity, since: new Date().toISOString() })
    }
  })
  return () => { clearTimeout(reloadTimer); if (activePresenceChannel===channel) { activePresenceChannel=null; activePresenceName='Гость' }; void db.removeChannel(channel) }
}
