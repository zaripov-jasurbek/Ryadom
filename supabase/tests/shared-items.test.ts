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
    assert.equal(azizTotal.due, 3_666)
    assert.equal(azizTotal.remaining, 0)
    assert.equal(azizTotal.overpaid, 1_834)
    const { rows } = await db.query<{ status: string }>('select status::text from public.payments where participant_id = $1', [aziz.id])
    assert.equal(rows[0].status, 'proof_submitted', 'a payment that still covers the total is not reopened')
    assert.equal(calculateTotals(bill).reduce((sum, person) => sum + person.due, 0), 11_000, 'the table still pays the whole check')
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

  it('ends the rule when someone marks a serving by hand', async () => {
    const t = await table(db, 3)
    const bread = await t.item('Хлеб', 2, 3_000)
    await t.shareAll(bread)
    const aziz = await t.join('Aziz')
    const bill = await t.bill()
    await db.rpc(aziz.user, 'toggle_unit_share', { p_item_unit: bill.items[0].unitIds![0], p_enabled: false })
    await t.join('Bekzod')
    const after = await assertSameTotals(t)
    assert.equal(after.items[0].sharedAll, false)
    assert.equal(calculateTotals(after)[2].due, 0, 'a guest after the hand-made change is not added')
    assert.equal(assignedSubtotal(after), 6_000, 'the parts kept for the guests on the way go back to the people on each serving')
  })
  it('ends the rule on a custom split too, and leaves no part of the other servings unassigned', async () => {
    const t = await table(db, 4)
    const bread = await t.item('Хлеб', 3, 4_000)
    await t.shareAll(bread)
    const aziz = await t.join('Aziz')
    const bill = await t.bill()
    await db.rpc(t.owner, 'set_unit_custom_shares', { p_item_unit: bill.items[0].unitIds![0], p_allocations: { [t.people[0].id]: 1_000, [aziz.id]: 3_000 } })
    const after = await assertSameTotals(t)
    assert.equal(after.items[0].sharedAll, false)
    assert.deepEqual(calculateTotals(after).map(person => person.due), [5_000, 7_000])
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
          await db.rpc(person.user, 'toggle_unit_share', { p_item_unit: unit, p_enabled: random(3) > 0 })
        }
        await assertSameTotals(t)
      }
    }
  })
})
