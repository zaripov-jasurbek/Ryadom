import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { billStanding, calculateTotals, personItems, type Bill, type BillItem, type PaymentStatus } from './calculations.ts'
import { readOwnerToken, routeCheckId } from './routes.ts'
import { errorMessage } from './errors.ts'
import { detailLines, paymentLine, safeFileName } from './export.ts'
import { paymentCopyValue, portionCount } from './format.ts'
import { installHintFor } from './platform.ts'

const people = ['Jasur', 'Aziz', 'Bekzod'].map((name, i) => ({ id: `${i}`, name, paid: 0, status: 'unpaid' as const }))
const emptyBill = (): Bill => ({ id: 'b', dbId: 'db', title: 'Ужин', servicePercent: 0, participants: people, items: [], createdAt: '', ownerToken: 't' })
/** A check as loadRemoteCheck shapes it: who holds each serving, by serving index. */
const withItems = (...items: BillItem[]): Bill => ({ ...emptyBill(), items })
const item = (id: string, name: string, quantity: number, unitPrice: number, unitSelections: Record<string, string[]> = {}): BillItem => ({ id, name, quantity, unitPrice, unitSelections })
const paying = (bill: Bill, personId: string, paid: number, status: PaymentStatus): Bill =>
  ({ ...bill, participants: bill.participants.map(person => person.id === personId ? { ...person, paid, status } : person) })

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

describe('check summaries', () => {
  it('lists what each participant pays for', () => {
    const bill = withItems(item('bread', 'Хлеб', 1, 30_000, { '0': ['0', '1'] }), item('tea', 'Чай', 2, 5_000, { '0': ['0'], '1': ['0'] }))
    assert.deepEqual(personItems(bill, '0'), [
      { id: 'bread', name: 'Хлеб', amount: 15_000, units: 1, shared: true, sharedAll: false },
      { id: 'tea', name: 'Чай', amount: 10_000, units: 2, shared: false, sharedAll: false },
    ])
    assert.deepEqual(personItems(bill, '2'), [])
  })

  it('labels only "split among everyone" items with a word of their own', () => {
    const halves = withItems(item('bread', 'Хлеб', 2, 3_000, { '0': ['0', '1'], '1': ['0', '1'] }))
    assert.deepEqual(personItems(halves, '1').map(line => line.sharedAll), [false])
    const everyone = withItems({ ...item('bread', 'Хлеб', 2, 3_000, { '0': ['0', '1'], '1': ['0', '1'] }), sharedAll: true })
    assert.deepEqual(personItems(everyone, '0').map(line => line.sharedAll), [true])
    assert.match(detailLines(everyone, calculateTotals(everyone)[0]).join('\n'), /^Хлеб \(на всех\) — 3\s000\sсум$/)
  })

  it('tells the creator what is still owed and a guest what they still owe', () => {
    assert.deepEqual(billStanding(emptyBill(), '0', true), { kind: 'empty' })
    assert.deepEqual(billStanding(withItems(item('tea', 'Чай', 2, 10_000, { '0': ['1'] })), '0', true), { kind: 'unassigned' })
    let bill = withItems(item('tea', 'Чай', 2, 10_000, { '0': ['1'], '1': ['0'] }))
    assert.deepEqual(billStanding(bill, '0', true), { kind: 'owed', amount: 10_000 })
    assert.deepEqual(billStanding(bill, '1', false), { kind: 'owes', amount: 10_000 })
    assert.deepEqual(billStanding(bill, '2', false), { kind: 'nothing-marked' })
    bill = paying(bill, '1', 10_000, 'proof_submitted')
    assert.deepEqual(billStanding(bill, '0', true), { kind: 'pending' })
    assert.deepEqual(billStanding(bill, '1', false), { kind: 'pending' })
    bill = paying(bill, '1', 10_000, 'paid')
    assert.deepEqual(billStanding(bill, '0', true), { kind: 'settled' })
    assert.deepEqual(billStanding(bill, '1', false), { kind: 'settled' })
  })
})

describe('payment details', () => {
  it('copies a card or phone number as digits only', () => {
    assert.equal(paymentCopyValue('8600 1234 5678 9012'), '8600123456789012')
    assert.equal(paymentCopyValue('+998 (90) 123-45-67'), '+998901234567')
    assert.equal(paymentCopyValue('Humo 9860 … Jasur'), 'Humo 9860 … Jasur')
  })
})

describe('portions', () => {
  it('counts a shared serving as a part', () => {
    assert.deepEqual([0, 1, 3, 4.5, 0.5, 1 / 3 + 1 / 3, 1 / 3 * 3, 1 / 7].map(portionCount), ['0', '1', '3', '4½', '½', '⅔', '1', '0,1'])
  })
})

describe('error messages', () => {
  it('translates server errors and falls back for unknown ones', () => {
    assert.equal(errorMessage({ message: 'Owner access required', code: 'P0001' }, 'x'), 'Это может сделать только создатель чека')
    assert.equal(errorMessage(new TypeError('Failed to fetch'), 'x'), 'Нет интернета — проверьте подключение и попробуйте ещё раз')
    assert.equal(errorMessage(new Error('something odd'), 'Не удалось'), 'Не удалось')
  })
  it('says the server did not answer when a request times out', () => {
    for (const error of [{ message: 'TimeoutError: Request timed out' }, new Error('Request timed out'), { message: 'AbortError: Fetch is aborted' }])
      assert.equal(errorMessage(error, 'x'), 'Сервер не ответил — попробуйте ещё раз')
  })
  it('never shows a guest the names of the services behind the app', () => {
    for (const message of ['Supabase is not configured. Add VITE_SUPABASE_URL', 'Anonymous sign-ins are disabled'])
      assert.doesNotMatch(errorMessage(new Error(message), 'x'), /supabase|анонимн/i)
  })
})

describe('install hint', () => {
  const ua = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    oldMacSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
    windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
    android: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  }
  it('shows the share-menu steps on iPhone and iPad, in Safari and in other iOS browsers', () => {
    assert.equal(installHintFor(ua.iphone, 5, false), 'ios')
    assert.equal(installHintFor(ua.iphoneChrome, 5, false), 'ios')
    assert.equal(installHintFor(ua.ipad, 5, false), 'ios')
  })
  it('shows "Add to Dock" in Safari 17+ on a Mac only', () => {
    assert.equal(installHintFor(ua.macSafari, 0, false), 'mac')
    assert.equal(installHintFor(ua.oldMacSafari, 0, false), null)
    assert.equal(installHintFor(ua.macChrome, 0, false), null)
  })
  it('leaves Windows and Android to their own install prompt, and hides once installed', () => {
    assert.equal(installHintFor(ua.windowsEdge, 0, false), null)
    assert.equal(installHintFor(ua.android, 5, false), null)
    assert.equal(installHintFor(ua.iphone, 5, true), null)
  })
})

describe('export', () => {
  it('makes file names safe on every platform', () => {
    assert.equal(safeFileName('Ужин 12/10: "друзья"?'), 'Ужин 12 10 друзья')
    assert.equal(safeFileName('///'), 'чек')
  })
  it('says the creator paid the bill instead of what they still owe', () => {
    const bill = withItems(item('tea', 'Чай', 2, 10_000, { '0': ['0'], '1': ['1'] }))
    const [jasur, aziz] = calculateTotals(bill)
    assert.equal(paymentLine(jasur, '0'), 'платил по счёту')
    assert.match(paymentLine(aziz, '0'), /^оплачено .* · осталось /)
  })
  it('lists what each amount is made of under the name', () => {
    const bill = { ...withItems(item('tea', 'Чай', 2, 10_000, { '0': ['0'], '1': ['0', '1'] })), servicePercent: 10 }
    const [jasur, aziz] = calculateTotals(bill)
    const [tea, service] = detailLines(bill, jasur)
    assert.match(tea, /^Чай × 2 \(доля\) — 15\s000\sсум$/)
    assert.match(service, /^Обслуживание 10% — /)
    assert.match(detailLines(bill, aziz)[0], /^Чай \(доля\) — 5\s000\sсум$/)
  })
})
