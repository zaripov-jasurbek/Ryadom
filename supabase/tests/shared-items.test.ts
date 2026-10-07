import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createDb, token, type Db } from './harness.ts'
import { assignedSubtotal, calculateTotals, personItems } from '../../src/lib/calculations.ts'
import { billFromSnapshot, type Snapshot } from '../../src/lib/snapshot.ts'

type Created = { id: string; public_id: string; participant_id: string }

async function table(db: Db, expected: number | null, servicePercent = 0) {
  const owner = await db.newUser()
  const check = await db.rpc<Created>(owner, 'create_check', { p_title: 'Ужин', p_service_percent: servicePercent, p_owner_name: 'Jasur', p_owner_token: token(), p_expected_guests: expected })
  const people = [{ user: owner, id: check.participant_id }]
  const join = async (name: string) => {
    const user = await db.newUser()
    const joined = await db.rpc<Created>(user, 'join_check', { p_public_id: check.public_id, p_name: name, p_session_token: token() })
    people.push({ user, id: joined.participant_id })
    return people.at(-1)!
  }
  const item = (name: string, quantity: number, price: number) => db.rpc<string>(owner, 'add_item', { p_check_id: check.id, p_name: name, p_quantity: quantity, p_unit_price: price })
  const shareAll = (itemId: string) => db.rpc(owner, 'share_item_equally', { p_check_id: check.id, p_item_id: itemId })
  const bill = async () => billFromSnapshot(await db.rpc<Snapshot>(owner, 'get_check', { p_public_id: check.public_id }))
  const serverDue = async () => Object.fromEntries((await db.query<{ participant_id: string; due: string }>('select participant_id, due::text from public.participant_due_totals($1)', [check.id])).rows.map(row => [row.participant_id, Number(row.due)]))
  return { owner, check, people, join, item, shareAll, bill, serverDue }
}

/** The client's totals must be the server's, sum for sum: the server checks payments against its own numbers. */
async function assertSameTotals(t: Awaited<ReturnType<typeof table>>) {
  const bill = await t.bill(), server = await t.serverDue()
  for (const person of calculateTotals(bill)) assert.equal(person.due, server[person.id], `due of ${person.name}`)
  return bill
}

describe('split among everyone, with guests arriving later', () => {
  let db: Db
  before(async () => { db = await createDb() })

  it('keeps parts for expected guests, so the first ones pay their final share', async () => {
    const t = await table(db, 4)
    const bread = await t.item('Хлеб', 2, 3_000)
    await t.shareAll(bread)
    let bill = await assertSameTotals(t)
    assert.equal(calculateTotals(bill)[0].due, 1_500, 'the creator alone pays a quarter of both breads, not all of them')
    assert.equal(assignedSubtotal(bill), 1_500, 'the rest waits for the guests')
    for (const name of ['Aziz', 'Bekzod', 'Sardor']) {
      await t.join(name)
      bill = await assertSameTotals(t)
      assert.ok(calculateTotals(bill).every(person => person.due === 1_500), `still 1 500 each after ${name}`)
    }
    assert.equal(assignedSubtotal(bill), 6_000, 'everything is assigned once everyone is here')
    assert.equal(bill.items[0].sharedAll, true)
    assert.deepEqual(personItems(bill, t.people[1].id).map(line => line.sharedAll), [true])
  })

  it('splits among more people when more come than expected, and shows the early payer as overpaid', async () => {
    const t = await table(db, 2, 10)
    const tea = await t.item('Чай', 1, 10_000)
    await t.shareAll(tea)
    const aziz = await t.join('Aziz')
    assert.equal(calculateTotals(await assertSameTotals(t))[1].due, 5_500)
    await db.rpc(aziz.user, 'submit_payment', { p_check_id: t.check.id, p_amount: 5_500 })
    await t.join('Bekzod')
    const bill = await assertSameTotals(t)
    const azizTotal = calculateTotals(bill)[1]
    assert.equal(azizTotal.due, 3_667)
    assert.equal(azizTotal.remaining, 0)
    assert.equal(azizTotal.overpaid, 1_833)
    const { rows } = await db.query<{ status: string }>('select status::text from public.payments where participant_id = $1', [aziz.id])
    assert.equal(rows[0].status, 'proof_submitted', 'a payment that still covers the total is not reopened')
    assert.equal(calculateTotals(bill).reduce((sum, person) => sum + person.due, 0), 11_002, 'the table still pays the whole check, plus two sums from rounding up')
  })

  it('works without a number too, for checks created before it was asked', async () => {
    const t = await table(db, null)
    await t.join('Aziz')
    const bread = await t.item('Хлеб', 2, 3_000)
    await t.shareAll(bread)
    await t.join('Bekzod')
    const bill = await assertSameTotals(t)
    assert.deepEqual(calculateTotals(bill).map(person => person.due), [2_000, 2_000, 2_000])
  })

  it('lets nobody mark or split the item by hand until the creator ends the rule', async () => {
    const t = await table(db, 3)
    const bread = await t.item('Хлеб', 2, 3_000)
    await t.shareAll(bread)
    const aziz = await t.join('Aziz')
    const unit = (await t.bill()).items[0].unitIds![0]
    await assert.rejects(db.rpc(aziz.user, 'toggle_unit_share', { p_item_unit: unit, p_enabled: false }), /split among everyone/)
    await assert.rejects(db.rpc(t.owner, 'toggle_unit_share', { p_item_unit: unit, p_enabled: false }), /split among everyone/)
    await assert.rejects(db.rpc(t.owner, 'set_unit_custom_shares', { p_item_unit: unit, p_allocations: { [aziz.id]: 3_000 } }), /split among everyone/)
    await assert.rejects(db.rpc(aziz.user, 'unshare_item', { p_check_id: t.check.id, p_item_id: bread }), /Owner access required/)
    await db.rpc(t.owner, 'unshare_item', { p_check_id: t.check.id, p_item_id: bread })
    let bill = await assertSameTotals(t)
    assert.equal(bill.items[0].sharedAll, false)
    assert.deepEqual(calculateTotals(bill).map(person => person.due), [3_000, 3_000], 'the people already on it keep it, split among them')
    assert.equal(assignedSubtotal(bill), 6_000, 'no part is left waiting for guests')
    await db.rpc(aziz.user, 'toggle_unit_share', { p_item_unit: unit, p_enabled: false })
    await t.join('Bekzod')
    bill = await assertSameTotals(t)
    assert.deepEqual(calculateTotals(bill).map(person => person.due), [4_500, 1_500, 0], 'marks work again, and a later guest is not added')
  })

  it('charges everyone the same, rounded up, instead of handing the leftover sums to the first ones', async () => {
    const t = await table(db, null)
    await t.join('Aziz')
    await t.join('Bekzod')
    const tea = await t.item('Чай', 1, 10_000)
    await t.shareAll(tea)
    const bill = await assertSameTotals(t)
    assert.deepEqual(calculateTotals(bill).map(person => person.due), [3_334, 3_334, 3_334])
    assert.equal(assignedSubtotal(bill), 10_002, 'two extra sums for the payer')
  })

  it('re-splits when the creator changes the number of guests or the servings', async () => {
    const t = await table(db, 5)
    const plov = await t.item('Плов', 1, 100_000)
    await t.shareAll(plov)
    await t.join('Aziz')
    await db.rpc(t.owner, 'update_check', { p_check_id: t.check.id, p_title: 'Ужин', p_service_percent: 0, p_payment_details: '', p_expected_guests: 2 })
    assert.deepEqual(calculateTotals(await assertSameTotals(t)).map(person => person.due), [50_000, 50_000])
    await db.rpc(t.owner, 'update_item', { p_check_id: t.check.id, p_item_id: plov, p_name: 'Плов', p_quantity: 3, p_unit_price: 100_000 })
    const bill = await assertSameTotals(t)
    assert.deepEqual(calculateTotals(bill).map(person => person.due), [150_000, 150_000], 'new servings are shared by everyone too')
    assert.deepEqual(personItems(bill, t.people[0].id).map(line => line.sharedAll), [true])
    // Other edits leave the number alone.
    await db.rpc(t.owner, 'update_check', { p_check_id: t.check.id, p_title: 'Обед', p_service_percent: 0, p_payment_details: '' })
    assert.equal((await t.bill()).expectedGuests, 2)
    await assert.rejects(db.rpc(t.owner, 'update_check', { p_check_id: t.check.id, p_title: 'Обед', p_service_percent: 0, p_payment_details: '', p_expected_guests: 51 }), /Invalid check details/)
  })

  it('matches the client on random tables, joins and splits', async () => {
    let seed = 7
    const random = (n: number) => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % n }
    for (let round = 0; round < 12; round++) {
      const t = await table(db, 1 + random(6), [0, 10, 12, 15, 12.5][random(5)])
      const items: string[] = []
      for (let step = 0; step < 10; step++) {
        const action = random(4)
        if (action === 0 && t.people.length < 8) await t.join(`Гость ${step}`)
        else if (action === 1 || !items.length) items.push(await t.item(`Блюдо ${step}`, 1 + random(3), 1_000 + random(97_001)))
        else if (action === 2) await t.shareAll(items[random(items.length)])
        else {
          const bill = await t.bill(), item = bill.items[random(bill.items.length)], person = t.people[random(t.people.length)]
          const unit = item.unitIds![random(item.quantity)]
          if (item.sharedAll) await db.rpc(t.owner, 'unshare_item', { p_check_id: t.check.id, p_item_id: item.id })
          else await db.rpc(person.user, 'toggle_unit_share', { p_item_unit: unit, p_enabled: random(3) > 0 })
        }
        await assertSameTotals(t)
      }
    }
  })
})
