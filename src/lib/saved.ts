import type { Bill, Participant } from './calculations.ts'
import { markOf } from './snapshot.ts'

/**
 * What this browser keeps about checks in localStorage: the list of saved checks, who you are in each,
 * a guest's join token, and the name typed last time. Every read and write survives storage being off
 * (private mode, blocked site data): reads give null, writes are dropped with a warning.
 */

export const billsKey = 'billsplit:v1'
const personKey = (billId: string) => `billsplit:person:${billId}`
/** A guest's join token: this browser gets its participant back after losing its Supabase session. */
const guestKey = (billId: string) => `billsplit:guest:${billId}`
const nameKey = 'billsplit:name'
const nameHintKey = 'billsplit:name-hint-seen'

function readStorage(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function writeStorage(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }
  catch (error) { console.warn('localStorage unavailable', error) }
}

/** A participant as checks saved before payments became checkmarks keep them: the server's status and amount. */
type SavedParticipant = Participant | (Omit<Participant, 'mark' | 'markedFor'> & { status?: string; paid?: number })
const savedParticipant = (person: SavedParticipant): Participant =>
  'mark' in person ? person : { id: person.id, name: person.name, mark: markOf(person.status), markedFor: Number(person.paid ?? 0) }

/** The saved list as stored (e.g. a storage event's new value); null when there is none or it is unreadable. */
export function parseBills(raw: string | null): Bill[] | null {
  if (raw === null) return null
  try {
    const bills = JSON.parse(raw) as (Omit<Bill, 'participants'> & { participants: SavedParticipant[] })[]
    return bills.map(bill => ({ ...bill, participants: bill.participants.map(savedParticipant) }))
  } catch { return null }
}

export const loadBills = () => parseBills(readStorage(billsKey))

/**
 * Changes the saved list as it is stored now, so checks saved by another tab are not overwritten;
 * `fallback` is used when nothing readable is stored. Returns the list it wrote.
 */
export function updateBills(fallback: Bill[], change: (bills: Bill[]) => Bill[]): Bill[] {
  const bills = change(loadBills() ?? fallback)
  writeStorage(billsKey, JSON.stringify(bills))
  return bills
}

/** Your participant id in a check on this browser. */
export const savedPerson = (billId: string) => readStorage(personKey(billId))
export const savePerson = (billId: string, personId: string | null) => writeStorage(personKey(billId), personId)

export const guestToken = (billId: string) => readStorage(guestKey(billId))
export const saveGuestToken = (billId: string, token: string | null) => writeStorage(guestKey(billId), token)

/** Forgets who this browser was in a check; the check itself is removed from the list separately. */
export function forgetDevice(billId: string) { savePerson(billId, null); saveGuestToken(billId, null) }

export const savedName = () => readStorage(nameKey) ?? ''
export const saveName = (name: string) => writeStorage(nameKey, name)

export const nameHintSeen = () => readStorage(nameHintKey) === '1'
export const markNameHintSeen = () => writeStorage(nameHintKey, '1')
