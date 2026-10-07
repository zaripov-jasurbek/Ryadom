import { assignedSubtotal, calculateTotals, ownerIdOf, serviceFee, withSelection, type Bill, type BillItem, type Participant } from './calculations'
import { errorMessage } from './errors'
import { addRemoteItem, addRemoteItems, updateRemoteCheck, updateRemoteItem, shareRemoteItemEqually, unshareRemoteItem, claimRemoteCheckOwner, confirmRemotePayment, createRemoteCheck, deleteRemoteCheck, deleteRemoteItem, ensureAnonymousSession, isRemoteCheckGone, joinRemoteCheck, loadRemoteCheck, previewRemoteCheck, removeRemoteParticipant, resetRemoteCustomShares, setRemoteCustomShares, submitRemotePayment, subscribeToRemoteCheck, toggleRemoteUnit, unconfirmRemotePayment, type PresenceUser, type RemoteBill, type RemoteSubscription } from './remote'
import { checkPath, homePath, readOwnerToken, routeCheckId } from './routes'
import { preloadSupabase } from './supabase'
import { expiresAt } from './limits'
import { shareOr } from './share'

export type Mode = 'home' | 'create' | 'join' | 'check'
export type ConfirmRequest = { title: string; body?: string; action: string; danger?: boolean; resolve: (answer: boolean) => void }
const billsKey = 'billsplit:v1'
const personKey = (billId: string) => `billsplit:person:${billId}`
/** A guest's join token: this browser gets its participant back after losing its Supabase session. */
const guestKey = (billId: string) => `billsplit:guest:${billId}`
const nameKey = 'billsplit:name'

/** The check page's bottom menu: items and payment; its third button invites people. */
export type CheckTab = 'order' | 'pay'

function parseBills(raw: string | null): Bill[] | null {
  if (raw === null) return null
  try { return JSON.parse(raw) as Bill[] } catch { return null }
}

function readStorage(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function writeStorage(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }
  catch (error) { console.warn('localStorage unavailable', error) }
}

export const totalFood = (bill: Bill) => bill.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
export const grandTotal = (bill: Bill) => totalFood(bill) + serviceFee(totalFood(bill), bill.servicePercent)

class AppStore {
  bills = $state<Bill[]>([])
  bill = $state<Bill | null>(null)
  mode = $state<Mode>('home')
  joinPublicId = $state('')
  /** Owner secret from the #p= link; proves ownership when the check is opened on a new device. */
  token = $state('')
  selectedPerson = $state<string | null>(null)
  isOwner = $state(false)
  onlineUsers = $state<PresenceUser[]>([])
  busy = $state(false)
  /** False while the device has no network: taps would fail, so the page says so up front. */
  online = $state(typeof navigator === 'undefined' || navigator.onLine)
  toast = $state('')
  activeTab = $state<CheckTab>('order')
  pendingUnits = $state<Record<string, true>>({})
  // Overlays live here so Escape can close whichever one is open.
  addItemOpen = $state(false)
  scanOpen = $state(false)
  qrOpen = $state(false)
  paymentFor = $state<string | null>(null)
  editingUnit = $state('')
  editingItem = $state<BillItem | null>(null)
  checkEditOpen = $state(false)
  /** The sheet with everyone at the table, opened from the avatars under the check's name. */
  peopleOpen = $state(false)
  /** The creator's sheet for the card or phone guests transfer to. */
  payDetailsOpen = $state(false)
  /** The open confirmation sheet; it replaces window.confirm, which looks foreign on phones. */
  confirmRequest = $state<ConfirmRequest | null>(null)
  itemFilter = $state<'all' | 'mine' | 'open'>('all')
  /** The name typed last time, so the next check does not ask for it again. */
  savedName = $state(readStorage(nameKey) ?? '')

  totals = $derived(this.bill ? calculateTotals(this.bill) : [])
  billTotal = $derived(this.bill ? grandTotal(this.bill) : 0)
  unassignedTotal = $derived(this.bill ? totalFood(this.bill) - assignedSubtotal(this.bill) : 0)
  /** The creator paid the restaurant, so their own share counts as settled. */
  ownerId = $derived(this.bill ? ownerIdOf(this.bill) : undefined)
  paidAll = $derived(this.totals.reduce((sum, person) => sum + (person.id === this.ownerId ? person.due : person.paid), 0))
  allConfirmed = $derived(Boolean(this.bill && this.unassignedTotal <= 0 && this.bill.items.length && this.totals.every(person => person.id === this.ownerId || person.status === 'paid' || person.due === 0)))
  currentParticipant = $derived(this.bill?.participants.find(person => person.id === this.selectedPerson))
  currentTotal = $derived(this.totals.find(person => person.id === this.selectedPerson))
  participantIndex = $derived(new Map(this.bill?.participants.map((person, index) => [person.id, index]) ?? []))

  private remote: RemoteSubscription | null = null
  private refreshSeq = 0
  private reclaimed = new Set<string>()
  /** The anonymous account the open check was connected with; a different one means the session was lost. */
  private sessionUser = ''
  private toastTimer: ReturnType<typeof setTimeout> | undefined

  personIndex = (id: string) => this.participantIndex.get(id) ?? 0
  personName = (id: string) => this.bill?.participants[this.participantIndex.get(id) ?? -1]?.name ?? 'Участник'
  dueOf = (id: string) => this.totals.find(person => person.id === id)?.due ?? 0
  personOf = (billId: string) => readStorage(personKey(billId))
  publicLink = () => this.bill ? `${location.origin}${checkPath(this.bill.id)}` : ''

  init() {
    this.bills = parseBills(readStorage(billsKey)) ?? []
    // The server deletes checks a few days after they were made; the list forgets them too, along with
    // checks from the old on-device demo mode, which have no server copy.
    for (const saved of this.bills.filter(entry => !entry.dbId || expiresAt(entry.createdAt).getTime() <= Date.now())) this.forgetBill(saved.id)
    const onPop = () => this.restoreRoute()
    // Another tab saved or removed a check.
    const onStorage = (event: StorageEvent) => { if (event.key === billsKey) this.bills = parseBills(event.newValue) ?? [] }
    // Changes made while offline or while iOS kept the tab frozen in the background were never broadcast to
    // this page, so the check reloads when the network comes back and when the page is shown again.
    const onOnline = () => { this.online = true; void this.refresh() }
    const onOffline = () => { this.online = false }
    const onVisible = () => { if (document.visibilityState === 'visible') void this.refresh() }
    this.restoreRoute()
    window.addEventListener('popstate', onPop)
    window.addEventListener('storage', onStorage)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('popstate', onPop); window.removeEventListener('storage', onStorage)
      window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      this.disconnect()
    }
  }

  notify(message: string) {
    clearTimeout(this.toastTimer)
    this.toast = message
    this.toastTimer = setTimeout(() => this.toast = '', 2500)
  }

  private fail(error: unknown, fallback: string) {
    console.error(error)
    this.notify(errorMessage(error, fallback))
  }

  /** Asks in an in-app sheet; resolves false when it is dismissed or replaced by another question. */
  confirm(request: Omit<ConfirmRequest, 'resolve'>) {
    this.answerConfirm(false)
    return new Promise<boolean>(resolve => { this.confirmRequest = { ...request, resolve } })
  }

  answerConfirm(answer: boolean) {
    const request = this.confirmRequest
    this.confirmRequest = null
    request?.resolve(answer)
  }

  closeOverlays() { this.answerConfirm(false); this.addItemOpen = false; this.scanOpen = false; this.qrOpen = false; this.paymentFor = null; this.editingUnit = ''; this.editingItem = null; this.checkEditOpen = false; this.peopleOpen = false; this.payDetailsOpen = false }

  private rememberName(name: string) { this.savedName = name; writeStorage(nameKey, name) }

  // ---- navigation ----

  private restoreRoute() {
    const id = routeCheckId(location.pathname)
    this.closeOverlays()
    if (!id) { this.disconnect(); this.bill = null; this.mode = 'home'; return }
    const { token } = readOwnerToken(location.search, location.hash)
    this.token = token
    // An owner link from an earlier version: keep the secret in memory, not in the address bar where it gets copied.
    if (token) history.replaceState(history.state, '', checkPath(id))
    const found = this.bills.find(entry => entry.id === id)
    if (found) {
      if (!this.token) this.token = found.ownerToken
      this.show(found, Boolean(this.token && this.token === found.ownerToken))
    } else { this.disconnect(); this.bill = null; this.joinPublicId = id; this.mode = 'join'; preloadSupabase() }
  }

  private show(bill: Bill, owner: boolean) {
    this.bill = bill; this.isOwner = owner; this.mode = 'check'; this.activeTab = 'order'; this.itemFilter = 'all'
    this.selectedPerson = readStorage(personKey(bill.id))
    void this.connect(bill)
  }

  goHome() { this.disconnect(); this.closeOverlays(); this.mode = 'home'; history.pushState({}, '', homePath()) }
  beginCreate() { this.mode = 'create'; preloadSupabase() }

  openCheck(id: string) {
    const found = this.bills.find(entry => entry.id === id)
    if (!found) return
    this.token = found.ownerToken
    history.pushState({}, '', checkPath(id))
    this.show(found, Boolean(found.ownerToken))
  }

  /** Changes the saved list as it is stored now, so checks saved by another tab are not overwritten. */
  private updateBills(change: (bills: Bill[]) => Bill[]) {
    this.bills = change(parseBills(readStorage(billsKey)) ?? this.bills)
    writeStorage(billsKey, JSON.stringify(this.bills))
  }

  private save() {
    const bill = this.bill
    if (bill) this.updateBills(bills => [bill, ...bills.filter(entry => entry.id !== bill.id)])
  }

  private forget(message: string) {
    const id = this.bill?.id
    if (!id) return
    this.disconnect()
    this.forgetBill(id)
    history.pushState({}, '', homePath()); this.bill = null; this.mode = 'home'; this.notify(message)
  }

  /** Removes a check from this device's list only; it stays available to everyone else by its link. */
  forgetBill(id: string) {
    this.updateBills(bills => bills.filter(entry => entry.id !== id))
    writeStorage(personKey(id), null); writeStorage(guestKey(id), null)
  }

  // ---- realtime ----

  private presence(activity: string): PresenceUser {
    return { participantId: this.selectedPerson, name: this.selectedPerson ? this.personName(this.selectedPerson) : 'Гость', activity }
  }

  private disconnect() { this.remote?.close(); this.remote = null; this.onlineUsers = [] }

  private async connect(bill: Bill) {
    try {
      const userId = this.sessionUser = await ensureAnonymousSession()
      this.disconnect()
      if (this.bill?.id !== bill.id) return
      this.remote = subscribeToRemoteCheck(bill.id, userId, () => void this.refresh(), users => this.onlineUsers = users, this.presence('Просматривает чек'))
      void this.refresh()
    } catch (error) { this.fail(error, 'Не удалось загрузить чек — проверьте интернет') }
  }

  private applyRemote(result: RemoteBill) {
    result.ownerToken = this.bills.find(entry => entry.id === result.id)?.ownerToken || this.token
    this.bill = result; this.isOwner = result.isOwner
    if (this.selectedPerson !== result.me) {
      this.selectedPerson = result.me; writeStorage(personKey(result.id), result.me)
      this.remote?.setPresence(this.presence('Просматривает чек'))
    }
    this.save()
  }

  /** Reloads the open remote check; out-of-order responses and responses for a check that was left are dropped. */
  async refresh() {
    if (!this.bill) return
    const id = this.bill.id, seq = ++this.refreshSeq
    const stale = () => seq !== this.refreshSeq || this.bill?.id !== id
    try {
      const result = await loadRemoteCheck(id)
      if (!stale()) this.applyRemote(result)
    } catch (error) {
      if (stale()) return
      if (!isRemoteCheckGone(error)) { console.error('Remote refresh failed', error); return }
      if (await this.reclaim(id)) return
      if (!stale()) this.forget('Чек удалён или вас убрали из участников')
    }
  }

  /**
   * A lost Supabase session (expired or cleared) looks exactly like being removed from the check.
   * Before forgetting the check, the owner secret or the guest's saved join token re-attaches this browser.
   * A guest still on the same account was really removed, so they are not brought back.
   * Tried once per check per visit, so a check that is really gone cannot loop.
   */
  private async reclaim(id: string) {
    const ownerToken = this.bills.find(entry => entry.id === id)?.ownerToken || this.token
    const guestToken = readStorage(guestKey(id))
    if (this.reclaimed.has(id) || (!ownerToken && !guestToken)) return false
    if (!ownerToken && await ensureAnonymousSession().catch(() => '') === this.sessionUser) return false
    this.reclaimed.add(id)
    try {
      if (ownerToken) await claimRemoteCheckOwner(id, ownerToken)
      else await joinRemoteCheck(id, this.savedName || 'Гость', guestToken!)
    } catch { return false }
    // The realtime channel was refused for the unknown session, so subscribe again; connect() reloads the check.
    if (this.bill?.id === id) await this.connect(this.bill)
    return true
  }

  // ---- create and join ----

  async createBill(title: string, ownerName: string, servicePercent: number, paymentDetails: string, expectedGuests: number | null = null) {
    const ownerToken = crypto.randomUUID()
    let bill: Bill
    this.rememberName(ownerName)
    this.busy = true
    try {
      const created = await createRemoteCheck(title, servicePercent, ownerName, ownerToken, paymentDetails, expectedGuests)
      bill = { id: created.public_id, dbId: created.id, title, servicePercent, paymentDetails: paymentDetails || undefined, expectedGuests: expectedGuests ?? undefined, ownerId: created.participant_id, participants: [{ id: created.participant_id, name: ownerName, paid: 0, status: 'unpaid' }], items: [], createdAt: new Date().toISOString(), ownerToken }
    } catch (error) { this.fail(error, 'Не удалось создать чек'); return } finally { this.busy = false }
    this.bill = bill; this.isOwner = true; this.token = ownerToken; this.mode = 'check'; this.activeTab = 'order'
    this.selectedPerson = bill.participants[0].id; writeStorage(personKey(bill.id), this.selectedPerson)
    history.pushState({}, '', checkPath(bill.id))
    this.save()
    await this.connect(bill)
  }

  /** What the invitation shows before joining: null when the check is gone, undefined when it could not be loaded. */
  async previewJoin() {
    try { return await previewRemoteCheck(this.joinPublicId) }
    catch (error) { console.warn('Check preview failed', error); return undefined }
  }

  /** Returns an error message for the form, or '' on success. */
  async joinSharedCheck(name: string) {
    if (!this.joinPublicId) return ''
    this.busy = true
    this.rememberName(name)
    try {
      let sessionToken: string = crypto.randomUUID()
      if (this.token) await claimRemoteCheckOwner(this.joinPublicId, this.token)
      else { sessionToken = readStorage(guestKey(this.joinPublicId)) ?? sessionToken; writeStorage(guestKey(this.joinPublicId), sessionToken) }
      await joinRemoteCheck(this.joinPublicId, name, sessionToken)
      const loaded = await loadRemoteCheck(this.joinPublicId)
      this.applyRemote(loaded); this.mode = 'check'; this.activeTab = 'order'
      history.replaceState({}, '', checkPath(loaded.id))
      await this.connect(loaded)
      return ''
    } catch (error) {
      console.error(error)
      return errorMessage(error, 'Не удалось открыть чек')
    } finally { this.busy = false }
  }

  // ---- bill changes ----

  /** Runs a change on the server, then reloads the check. */
  private async mutate(fallback: string, remote: (dbId: string) => Promise<unknown>, success?: string) {
    const bill = this.bill
    if (!bill) return false
    try {
      this.busy = true
      await remote(bill.dbId)
      await this.refresh()
      if (success) this.notify(success)
      return true
    } catch (error) { this.fail(error, fallback); return false }
    finally { this.busy = false }
  }

  addItem(name: string, quantity: number, unitPrice: number) {
    return this.mutate('Не удалось добавить позицию', dbId => addRemoteItem(dbId, name, quantity, unitPrice))
  }

  /**
   * Adds scanned items in receipt order. Returns how many were added, so after a failure
   * the caller can keep the rest for another try.
   */
  async addItems(items: { name: string; quantity: number; unitPrice: number }[]) {
    const bill = this.bill
    if (!bill || !items.length) return 0
    this.busy = true
    let added = 0
    try {
      try {
        await addRemoteItems(bill.dbId, items)
        added = items.length
      } catch (error) {
        // A server without add_items yet (PGRST202: no such function) gets the rows one by one, as before.
        if ((error as { code?: string } | null)?.code !== 'PGRST202') throw error
        for (const entry of items) { await addRemoteItem(bill.dbId, entry.name, entry.quantity, entry.unitPrice); added++ }
      }
    } catch (error) { this.fail(error, added ? `Добавлено ${added} из ${items.length} позиций` : 'Не удалось добавить позиции') }
    finally { await this.refresh(); this.busy = false }
    return added
  }

  updateItem(item: BillItem, name: string, quantity: number, unitPrice: number) {
    return this.mutate('Не удалось сохранить позицию', dbId => updateRemoteItem(dbId, item.id, name, quantity, unitPrice), 'Позиция обновлена')
  }

  /** expectedGuests: undefined keeps the number, null clears it. */
  updateCheck(title: string, servicePercent: number, paymentDetails: string, expectedGuests?: number | null) {
    return this.mutate('Не удалось сохранить чек', dbId => updateRemoteCheck(dbId, title, servicePercent, paymentDetails, expectedGuests), 'Чек обновлён')
  }

  shareItemEqually(item: BillItem) {
    return this.mutate('Не удалось разделить позицию', dbId => shareRemoteItemEqually(dbId, item.id), `«${item.name}» делится на всех`)
  }

  unshareItem(item: BillItem) {
    return this.mutate('Не удалось изменить позицию', dbId => unshareRemoteItem(dbId, item.id), `«${item.name}» больше не на всех`)
  }

  unconfirm(personId: string) {
    return this.mutate('Не удалось отменить подтверждение', dbId => unconfirmRemotePayment(dbId, personId), 'Подтверждение отменено')
  }

  removeItem(item: BillItem) {
    return this.mutate('Не удалось удалить позицию', dbId => deleteRemoteItem(dbId, item.id))
  }

  async toggleUnit(item: BillItem, unit: number) {
    const bill = this.bill, me = this.selectedPerson
    // An item split among everyone is the creator's until they end it; the server refuses the tap too.
    if (!bill || !me || item.sharedAll) return
    const unitId = item.unitIds?.[unit]
    if (!unitId || this.pendingUnits[unitId]) return
    const enabled = !(item.unitSelections[String(unit)] ?? []).includes(me)
    // Show the tap right away; the reload after the RPC replaces it with the server's amounts, or reverts it.
    this.refreshSeq++
    this.bill = { ...bill, items: bill.items.map(entry => entry.id === item.id ? withSelection(entry, unit, me, enabled) : entry) }
    this.pendingUnits = { ...this.pendingUnits, [unitId]: true }
    this.remote?.setPresence(this.presence(`${enabled ? 'Выбирает' : 'Убирает'} ${item.name}`))
    try { await toggleRemoteUnit(unitId, enabled) }
    catch (error) { this.fail(error, 'Не удалось обновить позицию') }
    finally { const { [unitId]: _, ...rest } = this.pendingUnits; this.pendingUnits = rest }
    await this.refresh()
  }

  saveCustomShares(item: BillItem, unit: number, amounts: Record<string, number>) {
    return this.mutate('Не удалось сохранить доли', () => setRemoteCustomShares(item.unitIds?.[unit] ?? '', amounts))
  }

  resetCustomShares(item: BillItem, unit: number) {
    return this.mutate('Не удалось сбросить доли', () => resetRemoteCustomShares(item.unitIds?.[unit] ?? ''))
  }

  submitPayment(amount: number) {
    return this.mutate('Не удалось отправить оплату', dbId => submitRemotePayment(dbId, amount), 'Оплата отправлена')
  }

  approve(personId: string) {
    return this.mutate('Не удалось подтвердить оплату', dbId => confirmRemotePayment(dbId, personId), 'Оплата подтверждена')
  }

  async removeParticipant(person: Participant) {
    const removed = await this.mutate('Не удалось удалить участника', dbId => removeRemoteParticipant(dbId, person.id))
    if (removed && this.selectedPerson === person.id && this.bill) { this.selectedPerson = null; writeStorage(personKey(this.bill.id), null) }
  }

  async removeBill() {
    const bill = this.bill
    if (!bill) return
    try { await deleteRemoteCheck(bill.dbId) } catch (error) { this.fail(error, 'Не удалось удалить чек'); return }
    this.forget('Чек удалён')
  }

  /** The invitation for a messenger: a phone opens its share sheet, a computer copies the link. */
  invite() {
    const bill = this.bill
    if (!bill) return
    const url = this.publicLink()
    void shareOr({ title: bill.title, text: 'Открой чек и отметь своё', url }, () => void this.copy(url, 'Ссылка скопирована'))
  }

  async copy(text: string, success: string) {
    try { await navigator.clipboard.writeText(text); this.notify(success) }
    catch { this.notify('Не удалось скопировать — разрешите доступ к буферу обмена') }
  }
}

export const app = new AppStore()
