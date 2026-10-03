// Demo-mode state changes. Each function returns a new Bill and mirrors the matching server RPC.
import { calculateTotals, type Bill, type BillItem, type CommentMessage } from './calculations.ts'

const updateItem = (bill: Bill, itemId: string, change: (item: BillItem) => BillItem): Bill =>
  ({ ...bill, items: bill.items.map(item => item.id === itemId ? change(item) : item) })

/** Mirrors reconcile_check_payments: reopens confirmed or submitted payments that no longer cover the participant's total. */
export function reconcilePayments(bill: Bill): Bill {
  const due = new Map(calculateTotals(bill).map(total => [total.id, total.due]))
  return { ...bill, participants: bill.participants.map(person => (person.status === 'paid' || person.status === 'proof_submitted') && person.paid < (due.get(person.id) ?? 0) ? { ...person, status: person.paid > 0 ? 'partially_paid' : 'unpaid', proofUrl: undefined } : person) }
}

/** Adds or removes one participant from a unit's equal split; also used for optimistic remote updates. */
export function withSelection(item: BillItem, unit: number, personId: string, enabled: boolean): BillItem {
  const key = String(unit), current = item.unitSelections[key] ?? []
  const unitAmounts = { ...item.unitAmounts }
  delete unitAmounts[key]
  const next = enabled ? (current.includes(personId) ? current : [...current, personId]) : current.filter(id => id !== personId)
  return { ...item, unitAmounts, unitSelections: { ...item.unitSelections, [key]: next } }
}

// Mirrors resplit_unit_equally: a custom unit becomes an equal split among everyone with a non-zero share.
function withoutCustomSplit(item: BillItem, key: string, removedId?: string): BillItem {
  const amounts = item.unitCustomAmounts?.[key] ?? {}
  const unitModes = { ...item.unitModes }, unitCustomAmounts = { ...item.unitCustomAmounts }
  delete unitModes[key]; delete unitCustomAmounts[key]
  return { ...item, unitModes, unitCustomAmounts, unitSelections: { ...item.unitSelections, [key]: Object.keys(amounts).filter(id => id !== removedId && amounts[id] > 0) } }
}

export function addItem(bill: Bill, name: string, quantity: number, unitPrice: number, id: string = crypto.randomUUID()): Bill {
  return reconcilePayments({ ...bill, items: [...bill.items, { id, name, quantity, unitPrice, unitSelections: {} }] })
}

export function removeItem(bill: Bill, itemId: string): Bill {
  return reconcilePayments({ ...bill, items: bill.items.filter(item => item.id !== itemId), comments: bill.comments?.filter(comment => comment.itemId !== itemId) })
}

export function toggleUnit(bill: Bill, itemId: string, unit: number, personId: string): Bill {
  return reconcilePayments(updateItem(bill, itemId, item => item.unitModes?.[String(unit)] === 'custom' ? item : withSelection(item, unit, personId, !(item.unitSelections[String(unit)] ?? []).includes(personId))))
}

export function setCustomShares(bill: Bill, itemId: string, unit: number, amounts: Record<string, number>): Bill {
  const key = String(unit)
  return reconcilePayments(updateItem(bill, itemId, item => ({
    ...item,
    unitSelections: { ...item.unitSelections, [key]: bill.participants.filter(person => amounts[person.id] > 0).map(person => person.id) },
    unitModes: { ...item.unitModes, [key]: 'custom' },
    unitCustomAmounts: { ...item.unitCustomAmounts, [key]: amounts },
  })))
}

export function resetCustomShares(bill: Bill, itemId: string, unit: number): Bill {
  return reconcilePayments(updateItem(bill, itemId, item => withoutCustomSplit(item, String(unit))))
}

export function submitPayment(bill: Bill, personId: string, amount: number, proofUrl: string | null, due: number): Bill {
  const paid = Math.min(due, Math.max(0, Math.floor(amount)))
  return { ...bill, participants: bill.participants.map(person => person.id !== personId ? person : { ...person, paid, proofUrl: proofUrl ?? undefined, status: proofUrl ? 'proof_submitted' : paid > 0 ? 'partially_paid' : 'unpaid' }) }
}

export function confirmPayment(bill: Bill, personId: string, due: number): Bill {
  return { ...bill, participants: bill.participants.map(person => person.id === personId ? { ...person, paid: due, status: 'paid' } : person) }
}

export function addComment(bill: Bill, participantId: string, body: string): Bill {
  const comment: CommentMessage = { id: crypto.randomUUID(), participantId, body, createdAt: new Date().toISOString() }
  return { ...bill, comments: [...(bill.comments ?? []), comment] }
}

export function deleteComment(bill: Bill, commentId: string): Bill {
  return { ...bill, comments: bill.comments?.filter(comment => comment.id !== commentId) }
}

export function removeParticipant(bill: Bill, personId: string): Bill {
  const items = bill.items.map(item => {
    let next: BillItem = { ...item, unitSelections: Object.fromEntries(Object.entries(item.unitSelections).map(([key, ids]) => [key, ids.filter(id => id !== personId)])) }
    // A custom split no longer adds up without this person, so the unit falls back to an equal split among the rest.
    for (const [key, amounts] of Object.entries(item.unitCustomAmounts ?? {})) {
      if (item.unitModes?.[key] === 'custom' && amounts[personId] > 0) next = withoutCustomSplit(next, key, personId)
    }
    return next
  })
  return reconcilePayments({ ...bill, participants: bill.participants.filter(person => person.id !== personId), items, comments: bill.comments?.filter(comment => comment.participantId !== personId) })
}
