import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assignedSubtotal, calculateTotals, sharedAllInfo, formatUzs, itemShares, serviceFee, splitInteger, withSelection, type Bill, type BillItem } from './calculations.ts'
const people = ['Jasur', 'Aziz', 'Bekzod', 'Sardor'].map((name, i) => ({ id: `${i}`, name, paid: 0, status: 'unpaid' as const }))
describe('bill calculations', () => {
  it('splits indivisible sums deterministically and conserves the full item price', () => assert.deepEqual(splitInteger(20_000, [1, 1, 1]), [6_667, 6_667, 6_666]))
  it('breaks ties between equal fractions by order, exactly like the server', () => {
    // 4034.6 and 15283.6 tie at .6; floats used to give the extra sum to the third person instead of the second.
    assert.deepEqual(splitInteger(30_300, [109_834, 40_334, 152_832]), [10_984, 4_033, 15_283])
    assert.deepEqual(splitInteger(109, [142, 126, 338, 246, 238]), [14, 13, 34, 24, 24])
  })
  it('formats amounts the way receipts in Uzbekistan read', () => {
    assert.equal(formatUzs(60_134), '60 134 сум')
    assert.equal(formatUzs(0), '0 сум')
  })
  it('rounds the service fee half up from the exact amount', () => {
    assert.equal(serviceFee(10_050, 10), 1_005)
    assert.equal(serviceFee(5, 10), 1)
    assert.equal(serviceFee(250_000, 12.34), 30_850)
    assert.equal(serviceFee(12_345, 0), 0)
  })
  it('supports separate sharing groups for identical units', () => {
    const item: BillItem = { id: 'bread', name: 'Bread', quantity: 2, unitPrice: 20_000, unitSelections: { '0': ['0', '1', '2'], '1': ['3'] } }
    assert.deepEqual(itemShares(item, people), { '0': 6_667, '1': 6_667, '2': 6_666, '3': 20_000 })
    assert.equal(Object.values(itemShares(item, people)).reduce((a, b) => a + b, 0), 40_000)
  })
  it('allocates service fee proportionally and totals correctly', () => {
    const bill: Bill = { id: 'x', dbId: 'db', title: 'Dinner', servicePercent: 10, participants: people.slice(0, 3), createdAt: '', ownerToken: '', items: [{ id: 'x', name: 'Food', quantity: 1, unitPrice: 100, unitSelections: { '0': ['0', '1', '2'] } }] }
    const totals = calculateTotals(bill)
    assert.equal(totals.reduce((n, p) => n + p.service, 0), 10)
    assert.equal(totals.reduce((n, p) => n + p.due, 0), 110)
  })
  it('applies custom whole-sum allocations exactly', () => {
    const bill: Bill = { id: 'custom', dbId: 'db', title: 'Cake', servicePercent: 0, participants: people.slice(0, 3), createdAt: '', ownerToken: '', items: [{ id: 'cake', name: 'Cake', quantity: 1, unitPrice: 120_000, unitSelections: { '0': ['0','1','2'] }, unitModes: { '0': 'custom' }, unitCustomAmounts: { '0': { '0': 60_000, '1': 30_000, '2': 30_000 } } }] }
    assert.deepEqual(itemShares(bill.items[0], bill.participants), { '0': 60_000, '1': 30_000, '2': 30_000 })
    assert.equal(assignedSubtotal(bill), 120_000)
  })
  it('tracks unassigned units without charging a participant for them', () => {
    const bill: Bill = { id: 'y', dbId: 'db', title: 'Lunch', servicePercent: 0, participants: people.slice(0, 2), createdAt: '', ownerToken: '', items: [{ id: 'a', name: 'Pizza', quantity: 2, unitPrice: 100, unitSelections: { '0': ['0'] } }] }
    assert.equal(assignedSubtotal(bill), 100)
    assert.equal(calculateTotals(bill).reduce((n, p) => n + p.due, 0), 100)
  })
  it('shows a tap at once and leaves the amounts of that serving to the server', () => {
    const item: BillItem = { id: 'tea', name: 'Tea', quantity: 2, unitPrice: 10_000, unitSelections: { '0': ['0'], '1': ['1'] }, unitAmounts: { '0': { '0': 10_000 }, '1': { '1': 10_000 } } }
    const tapped = withSelection(item, 0, '1', true)
    assert.deepEqual(tapped.unitSelections, { '0': ['0', '1'], '1': ['1'] })
    assert.deepEqual(tapped.unitAmounts, { '1': { '1': 10_000 } })
    assert.deepEqual(itemShares(tapped, people.slice(0, 2)), { '0': 5_000, '1': 15_000 })
    assert.deepEqual(withSelection(tapped, 0, '0', false).unitSelections['0'], ['1'])
  })
  it('uses the amounts recorded by the server instead of re-splitting', () => {
    // The server gave the remainder to the second participant; the client must not move it.
    const item: BillItem = { id: 'tea', name: 'Tea', quantity: 1, unitPrice: 10_001, unitSelections: { '0': ['0', '1'] }, unitAmounts: { '0': { '0': 5_000, '1': 5_001 } } }
    assert.deepEqual(itemShares(item, people.slice(0, 2)), { '0': 5_000, '1': 5_001 })
  })
  it('handles many participants and items without losing a sum', () => {
    const crowd = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, paid: 0, status: 'unpaid' as const }))
    const items: BillItem[] = Array.from({ length: 60 }, (_, i) => ({ id: `i${i}`, name: 'Dish', quantity: 3, unitPrice: 10_007 + i, unitSelections: { '0': crowd.slice(0, i % 40 + 1).map(p => p.id), '1': [crowd[i % 40].id], '2': crowd.map(p => p.id) } }))
    const bill: Bill = { id: 'big', dbId: 'db', title: 'Banquet', servicePercent: 12, participants: crowd, items, createdAt: '', ownerToken: '' }
    const food = items.reduce((n, item) => n + item.unitPrice * item.quantity, 0)
    assert.equal(calculateTotals(bill).reduce((n, p) => n + p.due, 0), food + Math.round(food * 0.12))
  })
  it('shows an overpayment instead of hiding it when a total goes down', () => {
    const bill: Bill = { id: 'x', dbId: 'db', title: 'Dinner', servicePercent: 0, createdAt: '', ownerToken: '',
      participants: [people[0], { ...people[1], paid: 5_000, status: 'proof_submitted' }],
      items: [{ id: 'tea', name: 'Tea', quantity: 1, unitPrice: 6_000, unitSelections: { '0': ['0', '1'] } }] }
    const aziz = calculateTotals(bill)[1]
    assert.deepEqual([aziz.due, aziz.paid, aziz.remaining, aziz.overpaid], [3_000, 3_000, 0, 2_000])
  })
  it('counts only what is on someone\'s total as assigned, not the parts kept for guests still on the way', () => {
    const item: BillItem = { id: 'bread', name: 'Bread', quantity: 2, unitPrice: 3_000, sharedAll: true, unitSelections: { '0': ['0'], '1': ['0'] }, unitAmounts: { '0': { '0': 750 }, '1': { '0': 750 } } }
    const bill = { participants: people.slice(0, 1), items: [item], expectedGuests: 4 }
    assert.equal(assignedSubtotal(bill), 1_500)
    assert.deepEqual(sharedAllInfo(item, bill), { parts: 4, perPerson: 1_500 })
  })
})
