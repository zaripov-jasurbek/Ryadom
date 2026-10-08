import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createDb, token, type Db } from './harness.ts'

type Created = { id: string; public_id: string; participant_id: string }

async function setup(db: Db) {
  const owner = await db.newUser(), guest = await db.newUser(), ownerToken = token()
  const check = await db.rpc<Created>(owner, 'create_check', { p_title: 'Ужин', p_service_percent: 10, p_owner_name: 'Jasur', p_owner_token: ownerToken })
  const joined = await db.rpc<Created>(guest, 'join_check', { p_public_id: check.public_id, p_name: 'Aziz', p_session_token: token() })
  const itemId = await db.rpc<string>(owner, 'add_item', { p_check_id: check.id, p_name: 'Хлеб', p_quantity: 2, p_unit_price: 20_000 })
  const units = await db.query<{ id: string }>('select id from public.item_units where item_id = $1 order by unit_index', [itemId])
  return { owner, guest, ownerToken, check, ownerParticipant: check.participant_id, guestParticipant: joined.participant_id, itemId, unitIds: units.rows.map(row => row.id) }
}

async function shares(db: Db, unitId: string) {
  const { rows } = await db.query<{ participant_id: string; amount: string; mode: string }>('select participant_id, amount::text, mode::text from public.item_shares where item_unit_id = $1 order by amount desc, participant_id', [unitId])
  return rows
}

async function canRead(db: Db, userId: string, checkId: string) {
  return db.as(userId, async () => (await db.query<{ member: boolean }>('select public.is_check_member($1) as member', [checkId])).rows[0].member)
}

describe('upgrade to participant devices', () => {
  it('keeps access for creators and guests of existing checks', async () => {
    const db = await createDb({ before: '202610030001' })
    const owner = await db.newUser(), guest = await db.newUser(), ownerToken = token()
    const check = await db.rpc<Created>(owner, 'create_check', { p_title: 'Старый', p_service_percent: 0, p_owner_name: 'Jasur', p_owner_token: ownerToken })
    const joined = await db.rpc<Created>(guest, 'join_check', { p_public_id: check.public_id, p_name: 'Aziz', p_session_token: token() })
    await db.migrateRest()
    assert.ok(await canRead(db, owner, check.id))
    assert.ok(await canRead(db, guest, check.id))
    await db.rpc(owner, 'add_item', { p_check_id: check.id, p_name: 'Чай', p_quantity: 1, p_unit_price: 5_000 })
    const again = await db.rpc<Created>(guest, 'join_check', { p_public_id: check.public_id, p_name: 'Aziz', p_session_token: token() })
    assert.equal(again.participant_id, joined.participant_id)
  })
})

describe('check RPCs', () => {
  let db: Db
  before(async () => { db = await createDb() })

  it('splits a unit equally and keeps the sum equal to the unit price', async () => {
    const s = await setup(db)
    await db.rpc(s.owner, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    assert.deepEqual((await shares(db, s.unitIds[0])).map(row => row.amount), ['10000', '10000'])
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: false })
    assert.deepEqual((await shares(db, s.unitIds[0])).map(row => row.amount), ['20000'])
  })

  it('lets each person rename only themselves', async () => {
    const s = await setup(db)
    const names = async () => (await db.query<{ name: string }>('select name from public.participants where check_id = $1 order by sort_order', [s.check.id])).rows.map(row => row.name)
    await db.rpc(s.guest, 'rename_participant', { p_check_id: s.check.id, p_name: '  Азиз ' })
    await db.rpc(s.owner, 'rename_participant', { p_check_id: s.check.id, p_name: 'Жасур' })
    assert.deepEqual(await names(), ['Жасур', 'Азиз'])
    await assert.rejects(db.rpc(s.guest, 'rename_participant', { p_check_id: s.check.id, p_name: '   ' }), /Invalid participant name/)
    await assert.rejects(db.rpc(s.guest, 'rename_participant', { p_check_id: s.check.id, p_name: 'x'.repeat(49) }), /Invalid participant name/)
    await assert.rejects(db.rpc(await db.newUser(), 'rename_participant', { p_check_id: s.check.id, p_name: 'Чужой' }), /Participant access required/)
    assert.deepEqual(await names(), ['Жасур', 'Азиз'])
  })

  it('records the item creator from the session instead of trusting the client', async () => {
    const s = await setup(db)
    const { rows } = await db.query<{ created_by: string }>('select created_by from public.items where id = $1', [s.itemId])
    assert.equal(rows[0].created_by, s.ownerParticipant)
  })

  it('does not let a guest toggle into a custom split', async () => {
    const s = await setup(db)
    await db.rpc(s.owner, 'set_unit_custom_shares', { p_item_unit: s.unitIds[0], p_allocations: { [s.ownerParticipant]: 20_000 } })
    await assert.rejects(db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true }), /custom split/)
    assert.deepEqual(await shares(db, s.unitIds[0]), [{ participant_id: s.ownerParticipant, amount: '20000', mode: 'custom' }])
  })

  it('keeps the creator signed in on every device that opened the owner link', async () => {
    const s = await setup(db)
    const phone = await db.newUser()
    await db.rpc(phone, 'claim_check_owner', { p_public_id: s.check.public_id, p_owner_token: s.ownerToken })
    const fromPhone = await db.rpc<Created>(phone, 'join_check', { p_public_id: s.check.public_id, p_name: 'Jasur', p_session_token: token() })
    assert.equal(fromPhone.participant_id, s.ownerParticipant)
    assert.ok(await canRead(db, s.owner, s.check.id), 'laptop keeps access')
    assert.ok(await canRead(db, phone, s.check.id), 'phone gains access')
    await db.rpc(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Чай', p_quantity: 1, p_unit_price: 5_000 })
    await db.rpc(phone, 'add_item', { p_check_id: s.check.id, p_name: 'Кофе', p_quantity: 1, p_unit_price: 7_000 })
  })

  it('adds scanned rows in one transaction: all of them or none', async () => {
    const s = await setup(db)
    const names = async () => (await db.query<{ name: string; units: number }>('select i.name, (select count(*)::int from public.item_units u where u.item_id = i.id) as units from public.items i where i.check_id = $1 order by i.created_at, i.name', [s.check.id])).rows
    const ids = await db.rpc<string[]>(s.owner, 'add_items', { p_check_id: s.check.id, p_items: [{ name: 'Чай', quantity: 2, unit_price: 5_000 }, { name: ' Самса ', quantity: 1, unit_price: 8_000 }] })
    assert.equal(ids.length, 2)
    assert.deepEqual((await names()).map(row => [row.name, row.units]).sort(), [['Самса', 1], ['Хлеб', 2], ['Чай', 2]])
    // One bad row rolls back the good rows before it.
    await assert.rejects(db.rpc(s.owner, 'add_items', { p_check_id: s.check.id, p_items: [{ name: 'Кофе', quantity: 1, unit_price: 7_000 }, { name: '', quantity: 1, unit_price: 1_000 }] }), /Invalid item/)
    await assert.rejects(db.rpc(s.owner, 'add_items', { p_check_id: s.check.id, p_items: [{ name: 'Кофе', quantity: '1', unit_price: 7_000 }] }), /Invalid item/)
    await assert.rejects(db.rpc(s.owner, 'add_items', { p_check_id: s.check.id, p_items: [] }), /Invalid item/)
    await assert.rejects(db.rpc(s.guest, 'add_items', { p_check_id: s.check.id, p_items: [{ name: 'Торт', quantity: 1, unit_price: 1_000 }] }), /Owner access required/)
    assert.equal((await names()).length, 3)
  })

  it('keeps a scanned receipt in its order', async () => {
    const s = await setup(db)
    const order = ['Шашлык', 'Чай', 'Самса', 'Лагман', 'Компот', 'Нон', 'Салат', 'Кола']
    await db.rpc(s.owner, 'add_items', { p_check_id: s.check.id, p_items: order.map(name => ({ name, quantity: 1, unit_price: 1_000 })) })
    const snapshot = await db.rpc<{ items: { name: string }[] }>(s.owner, 'get_check', { p_public_id: s.check.public_id })
    assert.deepEqual(snapshot.items.map(item => item.name), ['Хлеб', ...order])
  })

  it('rejects a wrong owner token', async () => {
    const s = await setup(db)
    const stranger = await db.newUser()
    await assert.rejects(db.rpc(stranger, 'claim_check_owner', { p_public_id: s.check.public_id, p_owner_token: token() }), /Invalid owner link/)
    assert.equal(await canRead(db, stranger, s.check.id), false)
  })

  it('keeps guests out of owner actions and other checks', async () => {
    const s = await setup(db)
    await assert.rejects(db.rpc(s.guest, 'add_item', { p_check_id: s.check.id, p_name: 'Торт', p_quantity: 1, p_unit_price: 1 }), /Owner access required/)
    await assert.rejects(db.rpc(s.guest, 'remove_participant', { p_check_id: s.check.id, p_participant_id: s.ownerParticipant }), /Owner access required/)
    await assert.rejects(db.rpc(s.owner, 'remove_participant', { p_check_id: s.check.id, p_participant_id: s.ownerParticipant }), /cannot be removed/)
    const other = await setup(db)
    assert.equal(await canRead(db, s.guest, other.check.id), false)
  })

  it('runs the payment flow: mark, confirm, reset after an item change', async () => {
    const s = await setup(db)
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: true })
    await db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    const status = async () => (await db.query<{ status: string }>('select status::text from public.payments where participant_id = $1', [s.guestParticipant])).rows[0].status
    assert.equal(await status(), 'paid')
    // Changes that do not raise the guest's total keep the confirmation.
    const teaId = await db.rpc<string>(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Чай', p_quantity: 1, p_unit_price: 5_000 })
    const teaUnit = (await db.query<{ id: string }>('select id from public.item_units where item_id = $1', [teaId])).rows[0].id
    await db.rpc(s.owner, 'toggle_unit_share', { p_item_unit: s.unitIds[1], p_enabled: true })
    assert.equal(await status(), 'paid')
    await db.rpc(s.owner, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    assert.equal(await status(), 'paid', 'sharing the bread lowered the guest total')
    // 10 000 + 10 000 + 5 000 + 10% = 27 500 is more than the 22 000 marked: the mark comes off.
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[1], p_enabled: true })
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: teaUnit, p_enabled: true })
    assert.equal(await status(), 'unpaid')
  })

  it('keeps a submitted payment that still covers the total', async () => {
    const s = await setup(db)
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: true })
    await db.rpc(s.owner, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
  })

  it('re-splits units equally when a participant is removed', async () => {
    const s = await setup(db)
    await db.rpc(s.owner, 'set_unit_custom_shares', { p_item_unit: s.unitIds[0], p_allocations: { [s.ownerParticipant]: 5_000, [s.guestParticipant]: 15_000 } })
    await db.rpc(s.owner, 'remove_participant', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    assert.deepEqual(await shares(db, s.unitIds[0]), [{ participant_id: s.ownerParticipant, amount: '20000', mode: 'equal' }])
    assert.equal(await canRead(db, s.guest, s.check.id), false)
  })

  it('deletes a check with everything in it, only for the owner', async () => {
    const s = await setup(db)
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await assert.rejects(db.rpc(s.guest, 'delete_check', { p_check_id: s.check.id }), /Owner access required/)
    await db.rpc(s.owner, 'delete_check', { p_check_id: s.check.id })
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.participants where check_id = $1', [s.check.id])
    assert.equal(rows[0].n, 0)
  })

  it('edits an item: a new price re-splits each unit equally, a smaller quantity drops the last units', async () => {
    const s = await setup(db)
    await db.rpc(s.owner, 'set_unit_custom_shares', { p_item_unit: s.unitIds[0], p_allocations: { [s.ownerParticipant]: 5_000, [s.guestParticipant]: 15_000 } })
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[1], p_enabled: true })
    await assert.rejects(db.rpc(s.guest, 'update_item', { p_check_id: s.check.id, p_item_id: s.itemId, p_name: 'Хлеб', p_quantity: 2, p_unit_price: 1 }), /Owner access required/)
    await db.rpc(s.owner, 'update_item', { p_check_id: s.check.id, p_item_id: s.itemId, p_name: ' Лепёшка ', p_quantity: 3, p_unit_price: 30_000 })
    const units = (await db.query<{ id: string }>('select id from public.item_units where item_id = $1 order by unit_index', [s.itemId])).rows.map(row => row.id)
    assert.equal(units.length, 3)
    assert.deepEqual((await shares(db, units[0])).map(row => [row.amount, row.mode]), [['15000', 'equal'], ['15000', 'equal']])
    assert.deepEqual(await shares(db, units[1]), [{ participant_id: s.guestParticipant, amount: '30000', mode: 'equal' }])
    assert.deepEqual(await shares(db, units[2]), [])
    await db.rpc(s.owner, 'update_item', { p_check_id: s.check.id, p_item_id: s.itemId, p_name: 'Лепёшка', p_quantity: 1, p_unit_price: 30_000 })
    const { rows } = await db.query<{ name: string; quantity: number; units: number }>('select name, quantity, (select count(*)::int from public.item_units where item_id = i.id) as units from public.items i where id = $1', [s.itemId])
    assert.deepEqual(rows[0], { name: 'Лепёшка', quantity: 1, units: 1 })
    await assert.rejects(db.rpc(s.owner, 'update_item', { p_check_id: s.check.id, p_item_id: s.itemId, p_name: '', p_quantity: 1, p_unit_price: 1 }), /Invalid item/)
  })

  it('edits the check title and service; a higher service reopens payments it no longer covers', async () => {
    const s = await setup(db)
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: true })
    await db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    await assert.rejects(db.rpc(s.guest, 'update_check', { p_check_id: s.check.id, p_title: 'Обед', p_service_percent: 0 }), /Owner access required/)
    await assert.rejects(db.rpc(s.owner, 'update_check', { p_check_id: s.check.id, p_title: 'Обед', p_service_percent: 101 }), /Invalid check details/)
    const status = async () => (await db.query<{ status: string }>('select status::text from public.payments where participant_id = $1', [s.guestParticipant])).rows[0].status
    await db.rpc(s.owner, 'update_check', { p_check_id: s.check.id, p_title: ' Обед ', p_service_percent: 5 })
    assert.equal(await status(), 'paid', 'a lower service keeps the confirmation')
    await db.rpc(s.owner, 'update_check', { p_check_id: s.check.id, p_title: 'Обед', p_service_percent: 15 })
    assert.equal(await status(), 'unpaid')
    const { rows } = await db.query<{ title: string; service_percent: string }>('select title, service_percent::text from public.checks where id = $1', [s.check.id])
    assert.deepEqual(rows[0], { title: 'Обед', service_percent: '15.00' })
  })

  it('stores payment details for members and lets the creator change or clear them', async () => {
    const owner = await db.newUser(), guest = await db.newUser()
    const check = await db.rpc<Created>(owner, 'create_check', { p_title: 'Ужин', p_service_percent: 0, p_owner_name: 'Jasur', p_owner_token: token(), p_payment_details: ' 8600 1234 5678 9012 ' })
    await db.rpc(guest, 'join_check', { p_public_id: check.public_id, p_name: 'Aziz', p_session_token: token() })
    type Snapshot = { payment_details: string | null; owner_id: string }
    const read = () => db.rpc<Snapshot>(guest, 'get_check', { p_public_id: check.public_id })
    const snapshot = await read()
    assert.equal(snapshot.payment_details, '8600 1234 5678 9012')
    assert.equal(snapshot.owner_id, check.participant_id)
    await assert.rejects(db.rpc(owner, 'update_check', { p_check_id: check.id, p_title: 'Ужин', p_service_percent: 0, p_payment_details: 'x'.repeat(101) }), /Invalid check details/)
    await db.rpc(owner, 'update_check', { p_check_id: check.id, p_title: 'Ужин', p_service_percent: 0, p_payment_details: '+998 90 123 45 67' })
    assert.equal((await read()).payment_details, '+998 90 123 45 67')
    await db.rpc(owner, 'update_check', { p_check_id: check.id, p_title: 'Ужин', p_service_percent: 0, p_payment_details: '  ' })
    assert.equal((await read()).payment_details, null)
  })

  it('splits an item equally among everyone, replacing earlier marks and custom splits', async () => {
    const s = await setup(db)
    await db.rpc(s.owner, 'set_unit_custom_shares', { p_item_unit: s.unitIds[0], p_allocations: { [s.ownerParticipant]: 20_000 } })
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[1], p_enabled: true })
    await assert.rejects(db.rpc(s.guest, 'share_item_equally', { p_check_id: s.check.id, p_item_id: s.itemId }), /Owner access required/)
    await db.rpc(s.owner, 'share_item_equally', { p_check_id: s.check.id, p_item_id: s.itemId })
    for (const unitId of s.unitIds) assert.deepEqual((await shares(db, unitId)).map(row => [row.amount, row.mode]), [['10000', 'equal'], ['10000', 'equal']])
    const other = await setup(db)
    await assert.rejects(db.rpc(s.owner, 'share_item_equally', { p_check_id: s.check.id, p_item_id: other.itemId }), /Item not found/)
  })

  it('marks ✓ by the guest and ✓✓ by the creator, who can confirm without the guest and take it back', async () => {
    const s = await setup(db)
    const payment = async () => (await db.query<{ status: string; amount_paid: string }>('select status::text, amount_paid::text from public.payments where participant_id = $1', [s.guestParticipant])).rows[0]
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: true })
    assert.deepEqual(await payment(), { status: 'proof_submitted', amount_paid: '22000' })
    await db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: false })
    assert.deepEqual(await payment(), { status: 'unpaid', amount_paid: '0' })
    await assert.rejects(db.rpc(s.owner, 'unconfirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant }), /Payment is not confirmed/)
    // Cash handed over, nobody pressed anything: the creator confirms anyway, and undoing goes back to nothing.
    await db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    assert.deepEqual(await payment(), { status: 'paid', amount_paid: '22000' })
    await assert.rejects(db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant }), /Nothing to confirm/)
    await db.rpc(s.owner, 'unconfirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    assert.deepEqual(await payment(), { status: 'unpaid', amount_paid: '0' })
    // After the guest's ✓, undoing goes back to that ✓.
    await db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: true })
    await db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    await assert.rejects(db.rpc(s.guest, 'unconfirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant }), /Owner access required/)
    await db.rpc(s.owner, 'unconfirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    assert.deepEqual(await payment(), { status: 'proof_submitted', amount_paid: '22000' })
  })

  it('does not let the guest change a confirmed payment', async () => {
    const s = await setup(db)
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: true })
    await db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    await assert.rejects(db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: false }), /already confirmed/)
    await assert.rejects(db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: true }), /already confirmed/)
  })
})

describe('limits and expiry', () => {
  let db: Db
  before(async () => { db = await createDb() })
  const join = (userId: string, publicId: string, sessionToken = token()) => db.rpc<Created>(userId, 'join_check', { p_public_id: publicId, p_name: 'Гость', p_session_token: sessionToken })

  it('takes writes only through RPCs', async () => {
    const s = await setup(db)
    await assert.rejects(db.as(s.guest, () => db.query("update public.payments set status = 'proof_submitted', amount_paid = 1 where participant_id = $1", [s.guestParticipant])), /permission denied/)
    await assert.rejects(db.as(s.owner, () => db.query("update public.payments set status = 'paid', confirmed_at = now() where participant_id = $1", [s.guestParticipant])), /permission denied/)
  })

  it('caps the unit price', async () => {
    const s = await setup(db)
    await assert.rejects(db.rpc(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Опечатка', p_quantity: 1, p_unit_price: 100_000_001 }), /Invalid item/)
    await assert.rejects(db.rpc(s.owner, 'update_item', { p_check_id: s.check.id, p_item_id: s.itemId, p_name: 'Хлеб', p_quantity: 2, p_unit_price: 100_000_001 }), /Invalid item/)
    await db.rpc(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Банкет', p_quantity: 1, p_unit_price: 100_000_000 })
  })

  it('lets at most 50 people into a check; those already in still get back', async () => {
    const s = await setup(db)
    for (let i = 2; i < 50; i++) await join(await db.newUser(), s.check.public_id)
    await assert.rejects(join(await db.newUser(), s.check.public_id), /Participant limit reached/)
    assert.equal((await join(s.guest, s.check.public_id)).participant_id, s.guestParticipant)
  })

  it('brings a browser back to its participant by its saved token after a lost session', async () => {
    const s = await setup(db)
    const saved = token()
    const first = await join(await db.newUser(), s.check.public_id, saved)
    assert.equal((await join(await db.newUser(), s.check.public_id, saved)).participant_id, first.participant_id)
  })

  it('keeps at most 100 items per check', async () => {
    const s = await setup(db)
    for (let i = 1; i < 100; i++) await db.rpc(s.owner, 'add_item', { p_check_id: s.check.id, p_name: `#${i}`, p_quantity: 1, p_unit_price: 1_000 })
    await assert.rejects(db.rpc(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Ещё', p_quantity: 1, p_unit_price: 1_000 }), /Item limit reached/)
  })

  it('keeps at most 1000 portions per check, also when an item grows', async () => {
    const s = await setup(db)
    const tea = await db.rpc<string>(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Чай', p_quantity: 998, p_unit_price: 1_000 })
    await assert.rejects(db.rpc(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Ещё', p_quantity: 1, p_unit_price: 1_000 }), /Portion limit reached/)
    await assert.rejects(db.rpc(s.owner, 'update_item', { p_check_id: s.check.id, p_item_id: s.itemId, p_name: 'Хлеб', p_quantity: 3, p_unit_price: 20_000 }), /Portion limit reached/)
    await db.rpc(s.owner, 'update_item', { p_check_id: s.check.id, p_item_id: tea, p_name: 'Чай', p_quantity: 990, p_unit_price: 1_000 })
    await db.rpc(s.owner, 'update_item', { p_check_id: s.check.id, p_item_id: s.itemId, p_name: 'Хлеб', p_quantity: 10, p_unit_price: 20_000 })
  })

  it('lets one account create at most 20 checks a day', async () => {
    const owner = await db.newUser()
    const create = () => db.rpc(owner, 'create_check', { p_title: 'Ужин', p_service_percent: 0, p_owner_name: 'Jasur', p_owner_token: token() })
    for (let i = 0; i < 20; i++) await create()
    await assert.rejects(create(), /Check limit reached/)
    await db.query("update public.checks c set created_at = now() - interval '1 day 1 minute' from public.participant_devices d where d.participant_id = c.owner_participant_id and d.user_id = $1", [owner])
    await create()
  })

  it('gives clients no direct access to the tables', async () => {
    const s = await setup(db)
    await assert.rejects(db.as(s.guest, () => db.query('select owner_token_hash from public.checks where id = $1', [s.check.id])), /permission denied/)
    await assert.rejects(db.as(s.guest, () => db.query('select session_token_hash from public.participants where check_id = $1', [s.check.id])), /permission denied/)
  })

  it('hides a check after 3 days and deletes it when the next check is created', async () => {
    const s = await setup(db)
    await db.query("update public.checks set created_at = now() - interval '3 days 1 minute' where id = $1", [s.check.id])
    await assert.rejects(db.rpc(s.guest, 'get_check', { p_public_id: s.check.public_id }), (error: { code?: string }) => error.code === 'P0002')
    await assert.rejects(join(await db.newUser(), s.check.public_id), /Check not found/)
    await assert.rejects(db.rpc(await db.newUser(), 'claim_check_owner', { p_public_id: s.check.public_id, p_owner_token: s.ownerToken }), /Invalid owner link/)
    const fresh = await setup(db)
    assert.equal((await db.query('select id from public.checks where id = $1', [s.check.id])).rows.length, 0)
    assert.equal((await db.query('select id from public.checks where id = $1', [fresh.check.id])).rows.length, 1)
  })

  // Every table that belongs to a check, with how its rows find their check.
  const leftovers = async (checkId: string) => (await db.query<{ n: number }>(`
    select (select count(*) from public.participants where check_id = $1)
      + (select count(*) from public.participant_devices where check_id = $1)
      + (select count(*) from public.items where check_id = $1)
      + (select count(*) from public.item_units u join public.items i on i.id = u.item_id where i.check_id = $1)
      + (select count(*) from public.item_shares s join public.participants p on p.id = s.participant_id where p.check_id = $1)
      + (select count(*) from public.payments where check_id = $1) as n`, [checkId])).rows[0].n
  async function filled() {
    const s = await setup(db)
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.owner, 'set_unit_custom_shares', { p_item_unit: s.unitIds[1], p_allocations: { [s.ownerParticipant]: 5_000, [s.guestParticipant]: 15_000 } })
    await db.rpc(s.guest, 'mark_paid', { p_check_id: s.check.id, p_paid: true })
    await db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    assert.ok(Number(await leftovers(s.check.id)) > 0)
    return s
  }

  it('leaves nothing of a check that its creator deleted', async () => {
    const s = await filled()
    await db.rpc(s.owner, 'delete_check', { p_check_id: s.check.id })
    assert.equal(Number(await leftovers(s.check.id)), 0)
  })

  it('leaves nothing of an expired check', async () => {
    const s = await filled()
    await db.query("update public.checks set created_at = now() - interval '4 days' where id = $1", [s.check.id])
    await setup(db)
    assert.equal(Number(await leftovers(s.check.id)), 0)
  })

  it('deletes anonymous accounts unused for 10 days; using one renews it', async () => {
    const idle = await db.newUser(), renewed = await db.newUser(), active = await db.newUser()
    await db.query("update auth.users set created_at = now() - interval '30 days' where id in ($1, $2, $3)", [idle, renewed, active])
    await db.rpc(renewed, 'touch_account', {})
    await db.rpc(idle, 'touch_account', {})
    await db.query("update public.account_activity set seen_at = now() - interval '11 days' where user_id in ($1, $2)", [idle, renewed])
    await db.rpc(renewed, 'touch_account', {})
    // Created long ago and never touched: its own new check renews it before the cleanup runs.
    const check = await db.rpc<Created>(active, 'create_check', { p_title: 'Обед', p_service_percent: 0, p_owner_name: 'Jasur', p_owner_token: token() })
    await setup(db)
    const alive = async (id: string) => (await db.query('select id from auth.users where id = $1', [id])).rows.length === 1
    assert.equal(await alive(idle), false)
    assert.equal(await alive(renewed), true)
    assert.equal(await alive(active), true)
    assert.equal((await db.rpc<{ me: string }>(active, 'get_check', { p_public_id: check.public_id })).me, check.participant_id)
  })

  it('keeps a participant in the check when their account is deleted', async () => {
    const s = await setup(db)
    await db.query('delete from auth.users where id = $1', [s.guest])
    const snapshot = await db.rpc<{ participants: { id: string }[] }>(s.owner, 'get_check', { p_public_id: s.check.public_id })
    assert.deepEqual(snapshot.participants.map(p => p.id), [s.ownerParticipant, s.guestParticipant])
    assert.equal((await db.query('select 1 from public.participant_devices where user_id = $1', [s.guest])).rows.length, 0)
  })
})

describe('check snapshot and broadcasts', () => {
  let db: Db
  before(async () => { db = await createDb() })
  const messages = async () => (await db.query<{ topic: string; payload: { table: string; by: string } }>('select topic, payload from realtime.messages order by id')).rows
  const clearMessages = () => db.exec('truncate realtime.messages')

  it('returns the whole check to members only', async () => {
    const s = await setup(db)
    await db.rpc(s.owner, 'set_unit_custom_shares', { p_item_unit: s.unitIds[0], p_allocations: { [s.ownerParticipant]: 5_000, [s.guestParticipant]: 15_000 } })
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[1], p_enabled: true })
    type Snapshot = { me: string; is_owner: boolean; participants: { id: string; name: string; status: string }[]; items: { quantity: number; units: { shares: { participant_id: string; amount: number; mode: string }[] }[] }[]; comments: unknown[] }
    const forGuest = await db.rpc<Snapshot>(s.guest, 'get_check', { p_public_id: s.check.public_id })
    assert.equal(forGuest.me, s.guestParticipant)
    assert.equal(forGuest.is_owner, false)
    assert.deepEqual(forGuest.participants.map(p => p.name), ['Jasur', 'Aziz'])
    assert.equal(forGuest.items[0].units.length, 2)
    assert.deepEqual(forGuest.items[0].units[0].shares, [{ participant_id: s.ownerParticipant, amount: 5_000, mode: 'custom' }, { participant_id: s.guestParticipant, amount: 15_000, mode: 'custom' }])
    assert.deepEqual(forGuest.items[0].units[1].shares, [{ participant_id: s.guestParticipant, amount: 20_000, mode: 'equal' }])
    // Still there, empty, for the site published before the chat was removed.
    assert.deepEqual(forGuest.comments, [])
    assert.equal((await db.rpc<Snapshot>(s.owner, 'get_check', { p_public_id: s.check.public_id })).is_owner, true)
    const stranger = await db.newUser()
    await assert.rejects(db.rpc(stranger, 'get_check', { p_public_id: s.check.public_id }), (error: { code?: string }) => error.code === 'P0002')
    await assert.rejects(db.rpc(stranger, 'get_check', { p_public_id: 'missing' }), (error: { code?: string }) => error.code === 'P0002')
  })

  it('previews a check for anyone with its link, without the details', async () => {
    const s = await setup(db)
    const stranger = await db.newUser()
    const preview = await db.rpc<Record<string, unknown>>(stranger, 'check_preview', { p_public_id: s.check.public_id })
    assert.deepEqual(preview, { title: 'Ужин', service_percent: 10, participants: ['Jasur', 'Aziz'], items: 1, food_total: 40_000 })
    assert.equal(await db.rpc(stranger, 'check_preview', { p_public_id: 'missing' }), null)
    await db.query("update public.checks set created_at = now() - interval '3 days 1 minute' where id = $1", [s.check.id])
    assert.equal(await db.rpc(stranger, 'check_preview', { p_public_id: s.check.public_id }), null)
  })

  it('broadcasts one change per transaction on the check topic', async () => {
    const s = await setup(db)
    await clearMessages()
    await db.rpc(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Чай', p_quantity: 5, p_unit_price: 5_000 })
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.owner, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    const sent = await messages()
    assert.equal(sent.length, 3)
    assert.ok(sent.every(m => m.topic === `check:${s.check.public_id}`))
    assert.deepEqual(sent.map(m => m.payload.by), [s.owner, s.guest, s.owner])
  })

  it('lets members read and track presence on their check channel but not broadcast', async () => {
    const s = await setup(db)
    const topic = `check:${s.check.public_id}`
    const onChannel = <T>(userId: string, fn: () => Promise<T>) => db.as(userId, async () => {
      await db.query("select set_config('realtime.topic', $1, false)", [topic])
      return fn()
    })
    const send = (userId: string, extension: string) => onChannel(userId, () =>
      db.query("insert into realtime.messages(topic, extension, event, payload, private) values ($1, $2, 'changed', '{}', true)", [topic, extension]))
    const visible = async (userId: string) => (await onChannel(userId, () => db.query('select 1 from realtime.messages where topic = $1', [topic]))).rows.length
    await clearMessages()
    await db.rpc(s.owner, 'add_item', { p_check_id: s.check.id, p_name: 'Чай', p_quantity: 1, p_unit_price: 5_000 })
    assert.equal(await visible(s.guest), 1)
    assert.equal(await visible(await db.newUser()), 0)
    await send(s.guest, 'presence')
    await assert.rejects(send(s.guest, 'broadcast'), /row-level security/)
    await assert.rejects(send(await db.newUser(), 'presence'), /row-level security/)
  })

  it('announces deletions of items, participants and the check itself', async () => {
    const s = await setup(db)
    await clearMessages()
    await db.rpc(s.owner, 'delete_item', { p_check_id: s.check.id, p_item_id: s.itemId })
    await db.rpc(s.owner, 'remove_participant', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    await db.rpc(s.owner, 'delete_check', { p_check_id: s.check.id })
    assert.deepEqual((await messages()).map(m => m.payload.table), ['items', 'participants', 'checks'])
  })
})

describe('guest names', () => {
  it('gives guests without a name unique letters with distinct first letters', async () => {
    const db = await createDb()
    const owner = await db.newUser()
    const check = await db.rpc<Created>(owner, 'create_check', { p_title: 'Ужин', p_service_percent: 0, p_owner_name: 'Jasur', p_owner_token: token() })
    for (let i = 0; i < 8; i++) await db.rpc<Created>(await db.newUser(), 'join_check', { p_public_id: check.public_id, p_name: '', p_session_token: token() })
    const { rows } = await db.query<{ name: string }>('select name from public.participants where check_id = $1', [check.id])
    const names = rows.map(row => row.name)
    assert.equal(names.length, 9)
    assert.equal(new Set(names.map(name => name.toUpperCase())).size, 9)
    assert.equal(new Set(names.map(name => name[0].toUpperCase())).size, 9)
    for (const name of names.filter(name => name !== 'Jasur')) assert.match(name, /^[A-Z]{3}$/)
  })
})
