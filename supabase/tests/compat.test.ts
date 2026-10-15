import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDb, type Db } from './harness.ts'

/**
 * Migrations reach the database on every merge, the site only with a release, and phones keep the old site in the
 * service worker's cache a while longer. So after all migrations, every RPC a client calls must still be there,
 * taking the same argument names, with defaults for the ones that client may leave out.
 * The current client is always checked; the published one when CI passes its types in RELEASED_TYPES.
 */
type Rpc = { name: string; args: { name: string; optional: boolean }[] }

/** The Functions block of src/lib/database.types.ts: one RPC per line, its arguments named p_…. */
export function rpcsFromTypes(source: string): Rpc[] {
  const rpcs: Rpc[] = []
  for (const line of source.split('\n')) {
    const match = /^\s+(\w+): \{ Args: (.*?); Returns:/.exec(line)
    if (!match) continue
    const args = [...match[2].matchAll(/(?:\{ |; )(p_\w+)(\??):/g)].map(([, name, optional]) => ({ name, optional: optional === '?' }))
    rpcs.push({ name: match[1], args })
  }
  return rpcs
}

type Proc = { args: string[]; defaults: number }

async function proceduresByName(db: Db) {
  const rows = (await db.query<{ name: string; args: string[] | null; defaults: number }>(`
    select p.proname as name, coalesce(p.proargnames[1:p.pronargs], '{}') as args, p.pronargdefaults as defaults
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows
  const byName = new Map<string, Proc[]>()
  for (const row of rows) byName.set(row.name, [...byName.get(row.name) ?? [], { args: row.args ?? [], defaults: Number(row.defaults) }])
  return byName
}

/** What is wrong for this client, or nothing. */
function problems(rpcs: Rpc[], byName: Map<string, Proc[]>) {
  const found: string[] = []
  for (const rpc of rpcs) {
    const procs = byName.get(rpc.name) ?? []
    if (!procs.length) { found.push(`${rpc.name}: function is gone`); continue }
    // PostgREST picks a function by name and argument names; two candidates make a call ambiguous.
    if (procs.length > 1) { found.push(`${rpc.name}: ${procs.length} overloads`); continue }
    const [proc] = procs
    const withDefault = new Set(proc.args.slice(proc.args.length - proc.defaults))
    for (const arg of rpc.args) {
      if (!proc.args.includes(arg.name)) found.push(`${rpc.name}: no argument ${arg.name}`)
      else if (arg.optional && !withDefault.has(arg.name)) found.push(`${rpc.name}: ${arg.name} may be left out but has no default`)
    }
    const sent = new Set(rpc.args.map(arg => arg.name))
    for (const name of proc.args) if (!sent.has(name) && !withDefault.has(name)) found.push(`${rpc.name}: new argument ${name} needs a default`)
  }
  return found
}

describe('compatibility of the migrations with clients', () => {
  let db: Db
  before(async () => { db = await createDb() })

  it('reads the RPC list from the types file', () => {
    const rpcs = rpcsFromTypes(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'lib', 'database.types.ts'), 'utf8'))
    const addItems = rpcs.find(rpc => rpc.name === 'add_items')
    assert.deepEqual(addItems?.args.map(arg => arg.name), ['p_check_id', 'p_items', 'p_request_id'])
    assert.deepEqual(rpcs.find(rpc => rpc.name === 'create_check')?.args.filter(arg => arg.optional).map(arg => arg.name), ['p_expected_guests', 'p_request_id'])
    assert.deepEqual(rpcs.find(rpc => rpc.name === 'touch_account')?.args, [])
  })

  it('serves every RPC the current client calls', async () => {
    const rpcs = rpcsFromTypes(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'lib', 'database.types.ts'), 'utf8'))
    assert.ok(rpcs.length > 10)
    assert.deepEqual(problems(rpcs, await proceduresByName(db)), [])
  })

  const released = process.env.RELEASED_TYPES
  it('still serves every RPC the published site calls', { skip: released ? false : 'RELEASED_TYPES is not set' }, async () => {
    const rpcs = rpcsFromTypes(readFileSync(released!, 'utf8'))
    assert.ok(rpcs.length > 10)
    assert.deepEqual(problems(rpcs, await proceduresByName(db)), [], 'a migration breaks the published site: keep the old function until the next release')
  })
})
