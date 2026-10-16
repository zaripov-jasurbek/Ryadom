import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Bill } from './calculations.ts'
import { billsKey, forgetDevice, guestToken, loadBills, parseBills, saveGuestToken, savePerson, savedPerson, updateBills } from './saved.ts'

/** A Map behind the Storage methods saved.ts uses; `broken` makes every call throw, as in a private window. */
function fakeStorage() {
  const data = new Map<string, string>()
  const storage = {
    broken: false,
    data,
    getItem(key: string) { if (storage.broken) throw new Error('blocked'); return data.get(key) ?? null },
    setItem(key: string, value: string) { if (storage.broken) throw new Error('blocked'); data.set(key, value) },
    removeItem(key: string) { if (storage.broken) throw new Error('blocked'); data.delete(key) },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  return storage
}

const bill = (id: string): Bill => ({ id, dbId: `db-${id}`, title: 'Ужин', servicePercent: 0, participants: [{ id: 'p', name: 'Jasur', mark: 'none', markedFor: 0 }], items: [], createdAt: '', ownerToken: '' })

describe('saved checks', () => {
  let storage: ReturnType<typeof fakeStorage>
  beforeEach(() => { storage = fakeStorage() })

  it('reads checks saved before payments became checkmarks', () => {
    const old = [{ ...bill('a'), participants: [{ id: 'p', name: 'Jasur', status: 'paid', paid: 50_000 }, { id: 'q', name: 'Aziz' }] }]
    const [parsed] = parseBills(JSON.stringify(old))!
    assert.deepEqual(parsed.participants.map(person => [person.mark, person.markedFor]), [['confirmed', 50_000], ['none', 0]])
    assert.equal(parseBills(null), null)
    assert.equal(parseBills('{not json'), null)
  })

  it('changes the list as another tab left it, not as this tab last saw it', () => {
    storage.data.set(billsKey, JSON.stringify([bill('from-other-tab')]))
    const written = updateBills([bill('stale')], bills => [bill('new'), ...bills])
    assert.deepEqual(written.map(entry => entry.id), ['new', 'from-other-tab'])
    assert.deepEqual(loadBills()?.map(entry => entry.id), ['new', 'from-other-tab'])
  })

  it('starts from what the tab has when nothing readable is stored', () => {
    storage.data.set(billsKey, 'broken')
    assert.deepEqual(updateBills([bill('kept')], bills => bills).map(entry => entry.id), ['kept'])
  })

  it('forgets who this browser was in a check, and only in that check', () => {
    savePerson('a', 'p1'); saveGuestToken('a', 'token-a'); savePerson('b', 'p2')
    forgetDevice('a')
    assert.equal(savedPerson('a'), null)
    assert.equal(guestToken('a'), null)
    assert.equal(savedPerson('b'), 'p2')
  })

  it('keeps working when storage is blocked', () => {
    storage.broken = true
    const warn = console.warn
    console.warn = () => {}
    try {
      assert.equal(loadBills(), null)
      assert.equal(savedPerson('a'), null)
      assert.deepEqual(updateBills([bill('kept')], bills => bills).map(entry => entry.id), ['kept'])
      assert.doesNotThrow(() => forgetDevice('a'))
    } finally { console.warn = warn }
  })
})
