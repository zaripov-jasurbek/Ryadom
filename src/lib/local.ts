// Demo-mode state changes. Each function returns a new Bill and mirrors the matching server RPC.
import { calculateTotals, type Bill, type BillItem, type CommentMessage } from './calculations.ts'

const changeItem = (bill: Bill, itemId: string, change: (item: BillItem) => BillItem): Bill =>
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

/** Mirrors update_item: a new price re-splits each unit equally among the people who had it; a smaller quantity drops the last units. */
export function updateItem(bill: Bill, itemId: string, name: string, quantity: number, unitPrice: number): Bill {
  const kept = <T>(record: Record<string, T> | undefined) => record && Object.fromEntries(Object.entries(record).filter(([key]) => Number(key) < quantity))
  return reconcilePayments(changeItem(bill, itemId, item => {
    const priced = unitPrice === item.unitPrice
    let next: BillItem = { ...item, name, quantity, unitPrice, unitIds: item.unitIds?.slice(0, quantity), unitSelections: kept(item.unitSelections) ?? {}, unitModes: kept(item.unitModes), unitCustomAmounts: kept(item.unitCustomAmounts), unitAmounts: priced ? kept(item.unitAmounts) : undefined }
    if (!priced) for (const [key, mode] of Object.entries(next.unitModes ?? {})) if (mode === 'custom') next = withoutCustomSplit(next, key)
    return next
  }))
}

/** Mirrors update_check; a higher service fee can reopen payments. */
export function updateCheck(bill: Bill, title: string, servicePercent: number, paymentDetails: string): Bill {
  return reconcilePayments({ ...bill, title, servicePercent, paymentDetails: paymentDetails.trim() || undefined })
}

/** Mirrors share_item_equally: every unit goes to everyone in the check, replacing marks and custom splits. */
export function shareItemEqually(bill: Bill, itemId: string): Bill {
  const everyone = bill.participants.map(person => person.id)
  return reconcilePayments(changeItem(bill, itemId, item => ({
    ...item, unitModes: {}, unitCustomAmounts: {}, unitAmounts: undefined,
    unitSelections: Object.fromEntries(Array.from({ length: item.quantity }, (_, unit) => [String(unit), everyone])),
  })))
}

export function removeItem(bill: Bill, itemId: string): Bill {
  return reconcilePayments({ ...bill, items: bill.items.filter(item => item.id !== itemId), comments: bill.comments?.filter(comment => comment.itemId !== itemId) })
}

export function toggleUnit(bill: Bill, itemId: string, unit: number, personId: string): Bill {
  return reconcilePayments(changeItem(bill, itemId, item => item.unitModes?.[String(unit)] === 'custom' ? item : withSelection(item, unit, personId, !(item.unitSelections[String(unit)] ?? []).includes(personId))))
}

export function setCustomShares(bill: Bill, itemId: string, unit: number, amounts: Record<string, number>): Bill {
  const key = String(unit)
  return reconcilePayments(changeItem(bill, itemId, item => ({
    ...item,
    unitSelections: { ...item.unitSelections, [key]: bill.participants.filter(person => amounts[person.id] > 0).map(person => person.id) },
    unitModes: { ...item.unitModes, [key]: 'custom' },
    unitCustomAmounts: { ...item.unitCustomAmounts, [key]: amounts },
  })))
}

export function resetCustomShares(bill: Bill, itemId: string, unit: number): Bill {
  return reconcilePayments(changeItem(bill, itemId, item => withoutCustomSplit(item, String(unit))))
}

/** Mirrors submit_payment: the full amount, or any amount with a link, waits for the creator's confirmation. */
export function submitPayment(bill: Bill, personId: string, amount: number, proofUrl: string | null, due: number): Bill {
  const paid = Math.min(due, Math.max(0, Math.floor(amount)))
  return { ...bill, participants: bill.participants.map(person => person.id !== personId ? person : { ...person, paid, proofUrl: proofUrl ?? undefined, status: proofUrl || (paid > 0 && paid >= due) ? 'proof_submitted' : paid > 0 ? 'partially_paid' : 'unpaid' }) }
}

/** Mirrors mark_payment: the creator records the whole total as paid, or starts the payment over. */
export function markPayment(bill: Bill, personId: string, paid: boolean, due: number): Bill {
  return { ...bill, participants: bill.participants.map(person => person.id !== personId ? person : paid ? { ...person, paid: due, status: 'paid' } : { ...person, paid: 0, status: 'unpaid', proofUrl: undefined }) }
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
