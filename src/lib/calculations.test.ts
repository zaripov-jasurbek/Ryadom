import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assignedSubtotal, calculateTotals, itemShares, splitInteger, type Bill, type BillItem } from './calculations.ts'
const people = ['Jasur', 'Aziz', 'Bekzod', 'Sardor'].map((name, i) => ({ id: `${i}`, name, paid: 0, status: 'unpaid' as const }))
describe('bill calculations', () => {
  it('splits indivisible sums deterministically and conserves the full item price', () => assert.deepEqual(splitInteger(20_000, [1, 1, 1]), [6_667, 6_667, 6_666]))
  it('supports separate sharing groups for identical units', () => {
    const item: BillItem = { id: 'bread', name: 'Bread', quantity: 2, unitPrice: 20_000, unitSelections: { '0': ['0', '1', '2'], '1': ['3'] } }
    assert.deepEqual(itemShares(item, people), { '0': 6_667, '1': 6_667, '2': 6_666, '3': 20_000 })
    assert.equal(Object.values(itemShares(item, people)).reduce((a, b) => a + b, 0), 40_000)
  })
  it('allocates service fee proportionally and totals correctly', () => {
    const bill: Bill = { id: 'x', title: 'Dinner', servicePercent: 10, participants: people.slice(0, 3), createdAt: '', ownerToken: '', items: [{ id: 'x', name: 'Food', quantity: 1, unitPrice: 100, unitSelections: { '0': ['0', '1', '2'] } }] }
    const totals = calculateTotals(bill)
    assert.equal(totals.reduce((n, p) => n + p.service, 0), 10)
    assert.equal(totals.reduce((n, p) => n + p.due, 0), 110)
  })
  it('applies custom whole-sum allocations exactly', () => {
    const bill: Bill = { id: 'custom', title: 'Cake', servicePercent: 0, participants: people.slice(0, 3), createdAt: '', ownerToken: '', items: [{ id: 'cake', name: 'Cake', quantity: 1, unitPrice: 120_000, unitSelections: { '0': ['0','1','2'] }, unitModes: { '0': 'custom' }, unitCustomAmounts: { '0': { '0': 60_000, '1': 30_000, '2': 30_000 } } }] }
    assert.deepEqual(itemShares(bill.items[0], bill.participants), { '0': 60_000, '1': 30_000, '2': 30_000 })
    assert.equal(assignedSubtotal(bill), 120_000)
  })
  it('tracks unassigned units without charging a participant for them', () => {
    const bill: Bill = { id: 'y', title: 'Lunch', servicePercent: 0, participants: people.slice(0, 2), createdAt: '', ownerToken: '', items: [{ id: 'a', name: 'Pizza', quantity: 2, unitPrice: 100, unitSelections: { '0': ['0'] } }] }
    assert.equal(assignedSubtotal(bill), 100)
    assert.equal(calculateTotals(bill).reduce((n, p) => n + p.due, 0), 100)
  })
})
