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
  return db.as(userId, async () => (await db.query('select id from public.checks where id = $1', [checkId])).rows.length === 1)
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

  it('runs the payment flow: submit, confirm, reset after an item change', async () => {
    const s = await setup(db)
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await assert.rejects(db.rpc(s.owner, 'confirm_payment', { p_check_id: s.check.id, p_participant_id: s.guestParticipant }), /No submitted proof/)
    await db.rpc(s.guest, 'submit_payment', { p_check_id: s.check.id, p_amount: 22_000, p_proof_url: 'https://pay.example/1' })
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
    // 10 000 + 10 000 + 5 000 + 10% = 27 500 is more than the 22 000 paid: the payment reopens.
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[1], p_enabled: true })
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: teaUnit, p_enabled: true })
    assert.equal(await status(), 'partially_paid')
    const { rows } = await db.query<{ proof_url: string | null }>('select proof_url from public.payments where participant_id = $1', [s.guestParticipant])
    assert.equal(rows[0].proof_url, null)
  })

  it('keeps a submitted proof that still covers the total', async () => {
    const s = await setup(db)
    await db.rpc(s.guest, 'toggle_unit_share', { p_item_unit: s.unitIds[0], p_enabled: true })
    await db.rpc(s.guest, 'submit_payment', { p_check_id: s.check.id, p_amount: 22_000, p_proof_url: 'https://pay.example/1' })
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
    await db.rpc(s.guest, 'add_comment', { p_check_id: s.check.id, p_item_id: null, p_body: 'Привет' })
    await assert.rejects(db.rpc(s.guest, 'delete_check', { p_check_id: s.check.id }), /Owner access required/)
    await db.rpc(s.owner, 'delete_check', { p_check_id: s.check.id })
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.participants where check_id = $1', [s.check.id])
    assert.equal(rows[0].n, 0)
  })

  it('lets only the author delete a comment', async () => {
    const s = await setup(db)
    const commentId = await db.rpc<string>(s.guest, 'add_comment', { p_check_id: s.check.id, p_item_id: null, p_body: 'Привет' })
    await assert.rejects(db.rpc(s.owner, 'delete_comment', { p_comment_id: commentId }), /Only the author/)
    await db.rpc(s.guest, 'delete_comment', { p_comment_id: commentId })
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
    await db.rpc(s.guest, 'add_comment', { p_check_id: s.check.id, p_item_id: null, p_body: 'Привет' })
    type Snapshot = { me: string; is_owner: boolean; participants: { id: string; name: string; status: string }[]; items: { quantity: number; units: { shares: { participant_id: string; amount: number; mode: string }[] }[] }[]; comments: { body: string }[] }
    const forGuest = await db.rpc<Snapshot>(s.guest, 'get_check', { p_public_id: s.check.public_id })
    assert.equal(forGuest.me, s.guestParticipant)
    assert.equal(forGuest.is_owner, false)
    assert.deepEqual(forGuest.participants.map(p => p.name), ['Jasur', 'Aziz'])
    assert.equal(forGuest.items[0].units.length, 2)
    assert.deepEqual(forGuest.items[0].units[0].shares, [{ participant_id: s.ownerParticipant, amount: 5_000, mode: 'custom' }, { participant_id: s.guestParticipant, amount: 15_000, mode: 'custom' }])
    assert.deepEqual(forGuest.items[0].units[1].shares, [{ participant_id: s.guestParticipant, amount: 20_000, mode: 'equal' }])
    assert.equal(forGuest.comments[0].body, 'Привет')
    assert.equal((await db.rpc<Snapshot>(s.owner, 'get_check', { p_public_id: s.check.public_id })).is_owner, true)
    const stranger = await db.newUser()
    await assert.rejects(db.rpc(stranger, 'get_check', { p_public_id: s.check.public_id }), (error: { code?: string }) => error.code === 'P0002')
    await assert.rejects(db.rpc(stranger, 'get_check', { p_public_id: 'missing' }), (error: { code?: string }) => error.code === 'P0002')
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

  it('announces deletions of comments, participants and the check itself', async () => {
    const s = await setup(db)
    const commentId = await db.rpc<string>(s.guest, 'add_comment', { p_check_id: s.check.id, p_item_id: null, p_body: 'Привет' })
    await clearMessages()
    await db.rpc(s.guest, 'delete_comment', { p_comment_id: commentId })
    await db.rpc(s.owner, 'delete_item', { p_check_id: s.check.id, p_item_id: s.itemId })
    await db.rpc(s.owner, 'remove_participant', { p_check_id: s.check.id, p_participant_id: s.guestParticipant })
    await db.rpc(s.owner, 'delete_check', { p_check_id: s.check.id })
    assert.deepEqual((await messages()).map(m => m.payload.table), ['comments', 'items', 'participants', 'checks'])
  })
})
