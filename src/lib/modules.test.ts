import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { calculateTotals, type Bill } from './calculations.ts'
import * as local from './local.ts'
import { readOwnerToken, routeCheckId } from './routes.ts'
import { errorMessage } from './errors.ts'
import { safeFileName } from './export.ts'

const people = ['Jasur', 'Aziz', 'Bekzod'].map((name, i) => ({ id: `${i}`, name, paid: 0, status: 'unpaid' as const }))
const emptyBill = (): Bill => ({ id: 'b', title: 'Ужин', servicePercent: 0, participants: people, items: [], createdAt: '', ownerToken: 't' })

describe('routes', () => {
  it('treats the GitHub Pages base path as home, not as a check id', () => {
    assert.equal(routeCheckId('/bill_splitter/', '/bill_splitter'), null)
    assert.equal(routeCheckId('/bill_splitter', '/bill_splitter'), null)
    assert.equal(routeCheckId('/bill_splitter/check/abc123', '/bill_splitter'), 'abc123')
    assert.equal(routeCheckId('/bill_splitter/check/abc123/', '/bill_splitter'), 'abc123')
    assert.equal(routeCheckId('/check/abc123', ''), 'abc123')
    assert.equal(routeCheckId('/', ''), null)
    assert.equal(routeCheckId('/check/', ''), null)
  })
  it('reads the owner token from the fragment and from older ?p= links', () => {
    assert.deepEqual(readOwnerToken('', '#p=abc'), { token: 'abc', legacy: false })
    assert.deepEqual(readOwnerToken('?p=old', ''), { token: 'old', legacy: true })
    assert.deepEqual(readOwnerToken('?p=old', '#p=new'), { token: 'new', legacy: false })
    assert.deepEqual(readOwnerToken('', ''), { token: '', legacy: false })
  })
})

describe('demo mode changes', () => {
  it('toggles a unit on and off', () => {
    let bill = local.addItem(emptyBill(), 'Хлеб', 1, 30_000, 'bread')
    bill = local.toggleUnit(bill, 'bread', 0, '0')
    bill = local.toggleUnit(bill, 'bread', 0, '1')
    assert.deepEqual(calculateTotals(bill).map(t => t.due), [15_000, 15_000, 0])
    bill = local.toggleUnit(bill, 'bread', 0, '0')
    assert.deepEqual(calculateTotals(bill).map(t => t.due), [0, 30_000, 0])
  })

  it('does not let a toggle break a custom split', () => {
    let bill = local.addItem(emptyBill(), 'Торт', 1, 30_000, 'cake')
    bill = local.setCustomShares(bill, 'cake', 0, { '0': 20_000, '1': 10_000, '2': 0 })
    assert.deepEqual(local.toggleUnit(bill, 'cake', 0, '2'), bill)
  })

  it('falls back to an equal split when a custom share holder leaves', () => {
    let bill = local.addItem(emptyBill(), 'Торт', 1, 30_000, 'cake')
    bill = local.setCustomShares(bill, 'cake', 0, { '0': 20_000, '1': 5_000, '2': 5_000 })
    bill = local.removeParticipant(bill, '0')
    assert.deepEqual(calculateTotals(bill).map(t => t.due), [15_000, 15_000])
    assert.equal(bill.items[0].unitModes?.['0'], undefined)
  })

  it('reopens a payment only when the participant now owes more', () => {
    let bill = local.addItem(emptyBill(), 'Чай', 1, 10_000, 'tea')
    bill = local.toggleUnit(bill, 'tea', 0, '1')
    bill = local.submitPayment(bill, '1', 10_000, 'https://pay.example', 10_000)
    bill = local.confirmPayment(bill, '1', 10_000)
    assert.equal(bill.participants[1].status, 'paid')
    bill = local.addItem(bill, 'Кофе', 1, 5_000, 'coffee')
    bill = local.toggleUnit(bill, 'coffee', 0, '0')
    assert.equal(bill.participants[1].status, 'paid', 'someone else’s coffee does not change what Aziz owes')
    bill = local.toggleUnit(bill, 'coffee', 0, '1')
    assert.equal(bill.participants[1].status, 'partially_paid')
    assert.equal(bill.participants[1].proofUrl, undefined)
  })

  it('removes item comments together with the item', () => {
    let bill = local.addItem(emptyBill(), 'Чай', 1, 10_000, 'tea')
    bill = { ...bill, comments: [{ id: 'c', itemId: 'tea', participantId: '0', body: 'x', createdAt: '' }] }
    assert.deepEqual(local.removeItem(bill, 'tea').comments, [])
  })
})

describe('error messages', () => {
  it('translates server errors and falls back for unknown ones', () => {
    assert.equal(errorMessage({ message: 'Owner access required', code: 'P0001' }, 'x'), 'Это может сделать только создатель чека')
    assert.equal(errorMessage(new TypeError('Failed to fetch'), 'x'), 'Нет соединения с сервером')
    assert.equal(errorMessage(new Error('something odd'), 'Не удалось'), 'Не удалось')
  })
})

describe('export', () => {
  it('makes file names safe on every platform', () => {
    assert.equal(safeFileName('Ужин 12/10: "друзья"?'), 'Ужин 12 10 друзья')
    assert.equal(safeFileName('///'), 'чек')
  })
})
