export type PaymentStatus = 'unpaid' | 'partially_paid' | 'proof_submitted' | 'paid'
export type ShareMode = 'equal' | 'by_quantity' | 'custom'
export type Participant = { id: string; name: string; paid: number; proofUrl?: string; status: PaymentStatus }
export type BillItem = {
  id: string; name: string; quantity: number; unitPrice: number
  /** Unit index → ids of the participants sharing that unit. */
  unitSelections: Record<string, string[]>
  unitIds?: string[]
  unitModes?: Record<string, ShareMode>
  unitCustomAmounts?: Record<string, Record<string, number>>
  /** Amounts the server recorded per unit and participant; when present they win over a local equal split. */
  unitAmounts?: Record<string, Record<string, number>>
}
export type CommentMessage = { id: string; itemId?: string; participantId: string; body: string; createdAt: string }
export type Bill = { id: string; dbId?: string; title: string; servicePercent: number; participants: Participant[]; items: BillItem[]; createdAt: string; ownerToken: string; comments?: CommentMessage[] }
export type ParticipantTotal = { id: string; name: string; subtotal: number; service: number; due: number; paid: number; remaining: number; status: PaymentStatus }

export function splitInteger(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some(w => !Number.isFinite(w) || w < 0)) throw new Error('Amounts must be non-negative whole UZS values')
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (!weightSum) return weights.map(() => 0)
  const exact = weights.map(w => total * w / weightSum)
  const result = exact.map(Math.floor)
  const remainder = total - result.reduce((a, b) => a + b, 0)
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < remainder; i++) result[order[i % order.length].index]++
  return result
}

/** The amounts a unit is split into, or undefined while nobody has claimed it. */
export function unitAmounts(item: BillItem, unit: number, participants: Participant[]): Record<string, number> | undefined {
  const key = String(unit)
  const recorded = item.unitAmounts?.[key] ?? (item.unitModes?.[key] === 'custom' ? item.unitCustomAmounts?.[key] : undefined)
  if (recorded) return Object.fromEntries(participants.map(p => [p.id, Math.max(0, Math.floor(recorded[p.id] ?? 0))]))
  const consumers = new Set(item.unitSelections[key] ?? [])
  if (!consumers.size) return undefined
  const shares = splitInteger(item.unitPrice, participants.map(p => consumers.has(p.id) ? 1 : 0))
  return Object.fromEntries(participants.map((p, index) => [p.id, shares[index]]))
}

export function itemShares(item: BillItem, participants: Participant[]): Record<string, number> {
  const shares = Object.fromEntries(participants.map(p => [p.id, 0])) as Record<string, number>
  for (let unit = 0; unit < item.quantity; unit++) {
    const amounts = unitAmounts(item, unit, participants)
    if (amounts) for (const p of participants) shares[p.id] += amounts[p.id]
  }
  return shares
}

export function calculateTotals(bill: Pick<Bill, 'participants' | 'items' | 'servicePercent'>): ParticipantTotal[] {
  const perItem = bill.items.map(item => itemShares(item, bill.participants))
  const subtotals = bill.participants.map(p => perItem.reduce((sum, shares) => sum + shares[p.id], 0))
  const serviceTotal = Math.round(subtotals.reduce((a, b) => a + b, 0) * bill.servicePercent / 100)
  const services = splitInteger(serviceTotal, subtotals)
  return bill.participants.map((p, i) => {
    const due = subtotals[i] + services[i]
    const paid = Math.min(due, Math.max(0, p.paid))
    return { id: p.id, name: p.name, subtotal: subtotals[i], service: services[i], due, paid, remaining: due - paid, status: p.status }
  })
}

export function isUnitAssigned(item: BillItem, unit: number): boolean {
  const key = String(unit)
  return item.unitModes?.[key] === 'custom' || Boolean(item.unitSelections[key]?.length)
}

export function assignedSubtotal(bill: Pick<Bill, 'items'>): number {
  let sum = 0
  for (const item of bill.items) for (let unit = 0; unit < item.quantity; unit++) if (isUnitAssigned(item, unit)) sum += item.unitPrice
  return sum
}

const uzs = new Intl.NumberFormat('uz-UZ')
export function formatUzs(amount: number): string { return `${uzs.format(amount)} UZS` }
