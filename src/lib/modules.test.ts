import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { billStanding, calculateTotals, personItems, type Bill } from './calculations.ts'
import * as local from './local.ts'
import { readOwnerToken, routeCheckId } from './routes.ts'
import { errorMessage } from './errors.ts'
import { safeFileName, summaryText } from './export.ts'
import { formatPaymentDetails, paymentCopyValue } from './format.ts'

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
    bill = local.submitPayment(bill, '1', 10_000, 10_000)
    bill = local.confirmPayment(bill, '1', 10_000)
    assert.equal(bill.participants[1].status, 'paid')
    bill = local.addItem(bill, 'Кофе', 1, 5_000, 'coffee')
    bill = local.toggleUnit(bill, 'coffee', 0, '0')
    assert.equal(bill.participants[1].status, 'paid', 'someone else’s coffee does not change what Aziz owes')
    bill = local.toggleUnit(bill, 'coffee', 0, '1')
    assert.equal(bill.participants[1].status, 'partially_paid')
  })

  it('edits an item: a new price re-splits custom units equally, a smaller quantity drops the last units', () => {
    let bill = local.addItem(emptyBill(), 'Лимонад', 3, 15_000, 'lemonade')
    bill = local.toggleUnit(bill, 'lemonade', 0, '0')
    bill = local.toggleUnit(bill, 'lemonade', 2, '2')
    bill = local.setCustomShares(bill, 'lemonade', 1, { '0': 10_000, '1': 5_000, '2': 0 })
    const renamed = local.updateItem(bill, 'lemonade', 'Лимонад домашний', 3, 15_000)
    assert.equal(renamed.items[0].name, 'Лимонад домашний')
    assert.equal(renamed.items[0].unitModes?.['1'], 'custom', 'the same price keeps a custom split')
    bill = local.updateItem(bill, 'lemonade', 'Лимонад', 2, 20_000)
    assert.deepEqual(Object.keys(bill.items[0].unitSelections).sort(), ['0', '1'])
    assert.equal(bill.items[0].unitModes?.['1'], undefined)
    assert.deepEqual(calculateTotals(bill).map(t => t.due), [30_000, 10_000, 0])
  })

  it('edits the check and reopens payments a higher service no longer covers', () => {
    let bill = local.addItem(emptyBill(), 'Чай', 1, 10_000, 'tea')
    bill = local.toggleUnit(bill, 'tea', 0, '1')
    bill = local.submitPayment(bill, '1', 10_000, 10_000)
    assert.equal(bill.participants[1].status, 'proof_submitted', 'the full amount waits for confirmation')
    bill = local.confirmPayment(bill, '1', 10_000)
    bill = local.updateCheck(bill, 'Обед', 10, ' 8600123456789012 ')
    assert.equal(bill.title, 'Обед')
    assert.equal(bill.paymentDetails, '8600123456789012')
    assert.equal(local.updateCheck(bill, 'Обед', 10, '  ').paymentDetails, undefined)
    assert.equal(bill.participants[1].status, 'partially_paid')
    assert.equal(local.submitPayment(bill, '1', 5_000, 11_000).participants[1].status, 'partially_paid')
  })

  it('splits an item equally among everyone, replacing marks and custom splits', () => {
    let bill = local.addItem(emptyBill(), 'Хлеб', 2, 30_000, 'bread')
    bill = local.toggleUnit(bill, 'bread', 0, '1')
    bill = local.setCustomShares(bill, 'bread', 1, { '0': 30_000, '1': 0, '2': 0 })
    bill = local.shareItemEqually(bill, 'bread')
    assert.deepEqual(calculateTotals(bill).map(t => t.due), [20_000, 20_000, 20_000])
    assert.deepEqual(bill.items[0].unitModes, {})
  })

  it('lets the creator take a confirmation back', () => {
    let bill = local.addItem(emptyBill(), 'Чай', 1, 10_000, 'tea')
    bill = local.toggleUnit(bill, 'tea', 0, '1')
    bill = local.submitPayment(bill, '1', 10_000, 10_000)
    bill = local.confirmPayment(bill, '1', 10_000)
    assert.equal(calculateTotals(bill)[1].remaining, 0)
    bill = local.unconfirmPayment(bill, '1')
    assert.equal(bill.participants[1].status, 'proof_submitted')
    assert.equal(bill.participants[1].paid, 10_000)
  })

  it('removes item comments together with the item', () => {
    let bill = local.addItem(emptyBill(), 'Чай', 1, 10_000, 'tea')
    bill = { ...bill, comments: [{ id: 'c', itemId: 'tea', participantId: '0', body: 'x', createdAt: '' }] }
    assert.deepEqual(local.removeItem(bill, 'tea').comments, [])
  })
})

describe('check summaries', () => {
  it('lists what each participant pays for', () => {
    let bill = local.addItem(emptyBill(), 'Хлеб', 1, 30_000, 'bread')
    bill = local.addItem(bill, 'Чай', 2, 5_000, 'tea')
    bill = local.toggleUnit(bill, 'bread', 0, '0')
    bill = local.toggleUnit(bill, 'bread', 0, '1')
    bill = local.toggleUnit(bill, 'tea', 0, '0')
    bill = local.toggleUnit(bill, 'tea', 1, '0')
    assert.deepEqual(personItems(bill, '0'), [
      { id: 'bread', name: 'Хлеб', amount: 15_000, units: 1, shared: true },
      { id: 'tea', name: 'Чай', amount: 10_000, units: 2, shared: false },
    ])
    assert.deepEqual(personItems(bill, '2'), [])
  })

  it('tells the creator what is still owed and a guest what they still owe', () => {
    assert.deepEqual(billStanding(emptyBill(), '0', true), { kind: 'empty' })
    let bill = local.addItem(emptyBill(), 'Чай', 2, 10_000, 'tea')
    bill = local.toggleUnit(bill, 'tea', 0, '1')
    assert.deepEqual(billStanding(bill, '0', true), { kind: 'unassigned' })
    bill = local.toggleUnit(bill, 'tea', 1, '0')
    assert.deepEqual(billStanding(bill, '0', true), { kind: 'owed', amount: 10_000 })
    assert.deepEqual(billStanding(bill, '1', false), { kind: 'owes', amount: 10_000 })
    assert.deepEqual(billStanding(bill, '2', false), { kind: 'nothing-marked' })
    bill = local.submitPayment(bill, '1', 10_000, 10_000)
    assert.deepEqual(billStanding(bill, '0', true), { kind: 'pending' })
    assert.deepEqual(billStanding(bill, '1', false), { kind: 'pending' })
    bill = local.confirmPayment(bill, '1', 10_000)
    assert.deepEqual(billStanding(bill, '0', true), { kind: 'settled' })
    assert.deepEqual(billStanding(bill, '1', false), { kind: 'settled' })
  })
})

describe('payment details', () => {
  it('groups a card number and copies digits only', () => {
    assert.equal(formatPaymentDetails('8600123456789012'), '8600 1234 5678 9012')
    assert.equal(formatPaymentDetails('8600 1234 5678 9012'), '8600 1234 5678 9012')
    assert.equal(formatPaymentDetails('+998 90 123-45-67'), '+998 90 123-45-67')
    assert.equal(paymentCopyValue('8600 1234 5678 9012'), '8600123456789012')
    assert.equal(paymentCopyValue('+998 (90) 123-45-67'), '+998901234567')
    assert.equal(paymentCopyValue('Humo 9860 … Jasur'), 'Humo 9860 … Jasur')
  })
})

describe('error messages', () => {
  it('translates server errors and falls back for unknown ones', () => {
    assert.equal(errorMessage({ message: 'Owner access required', code: 'P0001' }, 'x'), 'Это может сделать только создатель чека')
    assert.equal(errorMessage(new TypeError('Failed to fetch'), 'x'), 'Нет интернета — проверьте подключение и попробуйте ещё раз')
    assert.equal(errorMessage(new Error('something odd'), 'Не удалось'), 'Не удалось')
  })
  it('never shows a guest the names of the services behind the app', () => {
    for (const message of ['Supabase is not configured. Add VITE_SUPABASE_URL', 'Anonymous sign-ins are disabled'])
      assert.doesNotMatch(errorMessage(new Error(message), 'x'), /supabase|анонимн/i)
  })
})

describe('export', () => {
  it('makes file names safe on every platform', () => {
    assert.equal(safeFileName('Ужин 12/10: "друзья"?'), 'Ужин 12 10 друзья')
    assert.equal(safeFileName('///'), 'чек')
  })
  it('says the creator paid the bill instead of what they still owe', () => {
    let bill = local.addItem(emptyBill(), 'Чай', 2, 10_000, 'tea')
    bill = local.toggleUnit(bill, 'tea', 0, '0')
    bill = local.toggleUnit(bill, 'tea', 1, '1')
    const lines = summaryText('Ужин', 20_000, calculateTotals(bill), '0').split('\n')
    assert.match(lines[3], /^Jasur: .* · платил по счёту$/)
    assert.match(lines[4], /^Aziz: .* · осталось /)
  })
})
