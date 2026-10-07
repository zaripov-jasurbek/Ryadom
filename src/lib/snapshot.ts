import type { Bill, BillItem, Participant, PaymentStatus, ShareMode } from './calculations.ts'

/** What get_check returns. Kept apart from remote.ts, which needs the Supabase client, so tests can read it in Node. */
export type Snapshot = {
  id: string; public_id: string; title: string; service_percent: number; payment_details: string | null; expected_guests: number | null; created_at: string; me: string; owner_id: string | null; is_owner: boolean
  participants: { id: string; name: string; paid: number; status: PaymentStatus }[]
  items: { id: string; name: string; quantity: number; unit_price: number; shared_all?: boolean; units: { id: string; shares: { participant_id: string; amount: number; mode: ShareMode }[] }[] }[]
}

export type RemoteBill = Bill & { me: string; isOwner: boolean }

export function billFromSnapshot(row: Snapshot): RemoteBill {
  const participants: Participant[] = row.participants.map(person => ({ id: person.id, name: person.name, paid: Number(person.paid), status: person.status }))
  const items: BillItem[] = row.items.map(item => {
    const next: BillItem = { id: item.id, name: item.name, quantity: item.quantity, unitPrice: Number(item.unit_price), sharedAll: Boolean(item.shared_all), unitIds: item.units.map(unit => unit.id), unitSelections: {}, unitModes: {}, unitCustomAmounts: {}, unitAmounts: {} }
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
  return {
    id: row.public_id, dbId: row.id, title: row.title, servicePercent: Number(row.service_percent), paymentDetails: row.payment_details ?? undefined,
    expectedGuests: row.expected_guests ?? undefined, ownerId: row.owner_id ?? undefined, participants, items, createdAt: row.created_at, ownerToken: '', me: row.me, isOwner: row.is_owner,
  }
}
