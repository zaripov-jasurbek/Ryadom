import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migrationsDir = join(import.meta.dirname, '..', 'migrations')

// The minimum of Supabase's platform schema that the migrations depend on.
const platformStubs = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema extensions;
  create extension pgcrypto with schema extensions;
  grant usage on schema extensions to anon, authenticated;
  create schema realtime;
  create table realtime.messages (id bigint generated always as identity primary key, topic text not null, event text, payload jsonb, private boolean);
  create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
  create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$
    insert into realtime.messages(topic, event, payload, private) values (topic, event, payload, private)
  $$;
  alter table realtime.messages enable row level security;
  grant usage on schema realtime to authenticated;
  create publication supabase_realtime;
`

export type Db = PGlite & {
  /** Runs the callback as an anonymous-auth user, the way PostgREST does for a client request. */
  as: <T>(userId: string, fn: () => Promise<T>) => Promise<T>
  rpc: <T = unknown>(userId: string, fn: string, args: Record<string, unknown>) => Promise<T>
  newUser: () => Promise<string>
  /** Applies the migrations that createDb({ before }) held back. */
  migrateRest: () => Promise<void>
}

/** `before` stops at that migration version so tests can seed data with an older schema. */
export async function createDb(options: { before?: string } = {}): Promise<Db> {
  const pg = await PGlite.create({ extensions: { pgcrypto } })
  await pg.exec(platformStubs)
  await pg.exec('set search_path = public, extensions')
  const files = readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort()
  const apply = async (list: string[]) => {
    for (const file of list) {
      try { await pg.exec(readFileSync(join(migrationsDir, file), 'utf8')) }
      catch (error) { throw new Error(`${file}: ${(error as Error).message}`) }
    }
  }
  const held = options.before ? files.filter(file => file >= options.before!) : []
  await apply(files.filter(file => !held.includes(file)))
  const db = pg as unknown as Db
  db.migrateRest = () => apply(held.splice(0))
  db.as = async (userId, fn) => {
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false)`)
    try { return await fn() } finally { await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`) }
  }
  db.rpc = (userId, fn, args) => db.as(userId, async () => {
    const names = Object.keys(args)
    const result = await pg.query<{ result: unknown }>(`select public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) as result`, Object.values(args).map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value))
    return result.rows[0]?.result as never
  })
  db.newUser = async () => {
    const id = randomUUID()
    await pg.query('insert into auth.users(id) values ($1)', [id])
    return id
  }
  return db
}

export const token = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
