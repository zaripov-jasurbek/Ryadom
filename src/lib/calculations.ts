export type PaymentStatus = 'unpaid' | 'partially_paid' | 'proof_submitted' | 'paid'
export type Participant = { id: string; name: string; token?: string; paid: number; proofUrl?: string; status: 'unpaid' | 'partially_paid' | 'proof_submitted' | 'paid' }
export type BillItem = { id: string; name: string; quantity: number; unitPrice: number; unitSelections: Record<string, string[]>; unitIds?: string[]; unitModes?: Record<string, 'equal' | 'by_quantity' | 'custom'>; unitCustomAmounts?: Record<string, Record<string, number>> }
export type CommentMessage = { id: string; itemId?: string; participantId: string; body: string; createdAt: string }
export type Bill = { id: string; dbId?: string; title: string; servicePercent: number; participants: Participant[]; items: BillItem[]; createdAt: string; ownerToken: string; comments?: CommentMessage[]; archived?: boolean }
export type ParticipantTotal = { id: string; name: string; subtotal: number; service: number; due: number; paid: number; remaining: number; status: Participant['status'] }

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

export function itemShares(item: BillItem, participants: Participant[]): Record<string, number> {
  const shares = Object.fromEntries(participants.map(p => [p.id, 0])) as Record<string, number>
  for (let unit = 0; unit < item.quantity; unit++) {
    const unitKey = String(unit)
    const consumers = item.unitSelections[unitKey] ?? []
    const custom = item.unitModes?.[unitKey] === 'custom' ? item.unitCustomAmounts?.[unitKey] : undefined
    const unitShares = custom ? participants.map(p => Math.max(0, Math.floor(custom[p.id] ?? 0))) : splitInteger(item.unitPrice, participants.map(p => consumers.includes(p.id) ? 1 : 0))
    participants.forEach((person, index) => { shares[person.id] += unitShares[index] })
  }
  return shares
}

export function calculateTotals(bill: Pick<Bill, 'participants' | 'items' | 'servicePercent'>): ParticipantTotal[] {
  const subtotals = bill.participants.map(p => bill.items.reduce((sum, item) => sum + (itemShares(item, bill.participants)[p.id] ?? 0), 0))
  const serviceTotal = Math.round(subtotals.reduce((a, b) => a + b, 0) * bill.servicePercent / 100)
  const services = splitInteger(serviceTotal, subtotals)
  return bill.participants.map((p, i) => {
    const due = subtotals[i] + services[i]
    const paid = Math.min(due, Math.max(0, p.paid))
    return { id: p.id, name: p.name, subtotal: subtotals[i], service: services[i], due, paid, remaining: due - paid, status: p.status }
  })
}

export function assignedSubtotal(bill: Pick<Bill, 'items' | 'participants'>): number {
  return bill.items.reduce((sum, item) => sum + Array.from({ length: item.quantity }, (_, unit) => { const key=String(unit); return item.unitModes?.[key] === 'custom' ? item.unitPrice : (item.unitSelections[key]?.length ? item.unitPrice : 0) }).reduce((a,b)=>a+b,0), 0)
}
export function formatUzs(amount: number): string { return `${new Intl.NumberFormat('uz-UZ').format(amount)} UZS` }

