export type PaymentStatus = 'unpaid' | 'partially_paid' | 'proof_submitted' | 'paid'
export type ShareMode = 'equal' | 'by_quantity' | 'custom'
export type Participant = { id: string; name: string; paid: number; status: PaymentStatus }
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
export type Bill = {
  id: string; dbId?: string; title: string; servicePercent: number; participants: Participant[]; items: BillItem[]; createdAt: string; ownerToken: string; comments?: CommentMessage[]
  /** Card or phone number the creator wants transfers to; shown to every member. */
  paymentDetails?: string
  /** The creator's participant id; older saved checks lack it, and the creator is always listed first. */
  ownerId?: string
}
export const ownerIdOf = (bill: Pick<Bill, 'ownerId' | 'participants'>) => bill.ownerId ?? bill.participants[0]?.id

export type ParticipantTotal = { id: string; name: string; subtotal: number; service: number; due: number; paid: number; remaining: number; status: PaymentStatus }

/**
 * Splits whole UZS in proportion to whole-number weights; the largest fractions get the leftover sums.
 * Integer math, like participant_due_totals on the server: floats can order two equal fractions
 * differently and move a sum to another person, so a "full" payment would come up 1 UZS short.
 */
export function splitInteger(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) throw new Error('Amounts must be non-negative whole UZS values')
  const weightSum = BigInt(weights.reduce((a, b) => a + b, 0))
  if (!weightSum) return weights.map(() => 0)
  const parts = weights.map(w => BigInt(total) * BigInt(w))
  const result = parts.map(part => Number(part / weightSum))
  const remainder = total - result.reduce((a, b) => a + b, 0)
  const order = parts.map((part, index) => ({ index, fraction: part % weightSum }))
    .sort((a, b) => a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1)
  for (let i = 0; i < remainder; i++) result[order[i].index]++
  return result
}

/** The service fee on an amount, rounded half up like Postgres round(); the percent has at most two decimals. */
export function serviceFee(amount: number, percent: number): number {
  const scaled = BigInt(amount) * BigInt(Math.round(percent * 100))
  return Number((scaled * 2n + 10_000n) / 20_000n)
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
  const serviceTotal = serviceFee(subtotals.reduce((a, b) => a + b, 0), bill.servicePercent)
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

export const hasUnassignedUnit = (item: BillItem) => Array.from({ length: item.quantity }, (_, unit) => unit).some(unit => !isUnitAssigned(item, unit))

export function assignedSubtotal(bill: Pick<Bill, 'items'>): number {
  let sum = 0
  for (const item of bill.items) for (let unit = 0; unit < item.quantity; unit++) if (isUnitAssigned(item, unit)) sum += item.unitPrice
  return sum
}

// ru-RU groups thousands with a non-breaking space everywhere; uz-UZ gives "60,134" in some browsers and "60 134" in others.
const uzs = new Intl.NumberFormat('ru-RU')
/** "60 134 сум"; the non-breaking spaces keep an amount on one line. */
export function formatUzs(amount: number): string { return `${uzs.format(amount)} сум` }

export type PersonItem = { id: string; name: string; amount: number; units: number; shared: boolean }

/** What a participant's subtotal is made of: their amount per item, how many servings, and whether any was shared. */
export function personItems(bill: Pick<Bill, 'participants' | 'items'>, personId: string): PersonItem[] {
  const result: PersonItem[] = []
  for (const item of bill.items) {
    let amount = 0, units = 0, shared = false
    for (let unit = 0; unit < item.quantity; unit++) {
      const share = unitAmounts(item, unit, bill.participants)?.[personId] ?? 0
      if (!share) continue
      amount += share; units++
      if (share < item.unitPrice) shared = true
    }
    if (amount) result.push({ id: item.id, name: item.name, amount, units, shared })
  }
  return result
}

export type BillStanding =
  | { kind: 'empty' | 'unassigned' | 'nothing-marked' | 'pending' | 'settled' }
  | { kind: 'owed' | 'owes'; amount: number }

/** One line for the saved-checks list: what the creator is still owed, or what this guest still owes. */
export function billStanding(bill: Bill, me: string | null, owner: boolean): BillStanding | null {
  if (!bill.items.length) return { kind: 'empty' }
  const totals = calculateTotals(bill)
  if (owner) {
    const food = bill.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    if (assignedSubtotal(bill) < food) return { kind: 'unassigned' }
    const ownerId = ownerIdOf(bill)
    const others = totals.filter(person => person.id !== ownerId)
    const owed = others.reduce((sum, person) => sum + person.remaining, 0)
    if (owed > 0) return { kind: 'owed', amount: owed }
    return others.some(person => person.status === 'proof_submitted') ? { kind: 'pending' } : { kind: 'settled' }
  }
  const mine = totals.find(person => person.id === me)
  if (!mine) return null
  if (!mine.due) return { kind: 'nothing-marked' }
  if (mine.status === 'paid') return { kind: 'settled' }
  return mine.remaining > 0 ? { kind: 'owes', amount: mine.remaining } : { kind: 'pending' }
}
