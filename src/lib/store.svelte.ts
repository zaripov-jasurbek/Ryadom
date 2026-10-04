import { assignedSubtotal, calculateTotals, ownerIdOf, type Bill, type BillItem, type CommentMessage, type Participant } from './calculations'
import { errorMessage } from './errors'
import * as local from './local'
import { addRemoteComment, addRemoteItem, updateRemoteCheck, updateRemoteItem, shareRemoteItemEqually, markRemotePayment, claimRemoteCheckOwner, confirmRemotePayment, createRemoteCheck, deleteRemoteCheck, deleteRemoteComment, deleteRemoteItem, ensureAnonymousSession, isRemoteCheckGone, joinRemoteCheck, loadRemoteCheck, removeRemoteParticipant, resetRemoteCustomShares, setRemoteCustomShares, submitRemotePayment, subscribeToRemoteCheck, toggleRemoteUnit, type PresenceUser, type RemoteBill, type RemoteSubscription } from './remote'
import { checkPath, homePath, ownerPath, readOwnerToken, routeCheckId } from './routes'
import { isSupabaseConfigured, preloadSupabase } from './supabase'

export type Mode = 'home' | 'create' | 'join' | 'check'
const billsKey = 'billsplit:v1'
const personKey = (billId: string) => `billsplit:person:${billId}`
const nameKey = 'billsplit:name'

function readStorage(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function writeStorage(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }
  catch (error) { console.warn('localStorage unavailable', error) }
}

export const totalFood = (bill: Bill) => bill.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
export const grandTotal = (bill: Bill) => Math.round(totalFood(bill) * (1 + bill.servicePercent / 100))

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
  toast = $state('')
  activeTab = $state<'order' | 'summary'>('order')
  pendingUnits = $state<Record<string, true>>({})
  // Overlays live here so Escape can close whichever one is open.
  addItemOpen = $state(false)
  scanOpen = $state(false)
  qrOpen = $state(false)
  paymentFor = $state<string | null>(null)
  editingUnit = $state('')
  editingItem = $state<BillItem | null>(null)
  checkEditOpen = $state(false)
  itemFilter = $state<'all' | 'mine' | 'open'>('all')
  /** The name typed last time, so the next check does not ask for it again. */
  savedName = $state(readStorage(nameKey) ?? '')

  totals = $derived(this.bill ? calculateTotals(this.bill) : [])
  billTotal = $derived(this.bill ? grandTotal(this.bill) : 0)
  unassignedTotal = $derived(this.bill ? totalFood(this.bill) - assignedSubtotal(this.bill) : 0)
  /** The creator paid the restaurant, so their own share counts as settled. */
  ownerId = $derived(this.bill ? ownerIdOf(this.bill) : undefined)
  paidAll = $derived(this.totals.reduce((sum, person) => sum + (person.id === this.ownerId ? person.due : person.paid), 0))
  allConfirmed = $derived(Boolean(this.bill && this.unassignedTotal === 0 && this.bill.items.length && this.totals.every(person => person.id === this.ownerId || person.status === 'paid' || person.due === 0)))
  currentParticipant = $derived(this.bill?.participants.find(person => person.id === this.selectedPerson))
  currentTotal = $derived(this.totals.find(person => person.id === this.selectedPerson))
  participantIndex = $derived(new Map(this.bill?.participants.map((person, index) => [person.id, index]) ?? []))

  private remote: RemoteSubscription | null = null
  private refreshSeq = 0
  private reclaimed = new Set<string>()
  private toastTimer: ReturnType<typeof setTimeout> | undefined

  personIndex = (id: string) => this.participantIndex.get(id) ?? 0
  personName = (id: string) => this.bill?.participants[this.participantIndex.get(id) ?? -1]?.name ?? 'Участник'
  dueOf = (id: string) => this.totals.find(person => person.id === id)?.due ?? 0
  personOf = (billId: string) => readStorage(personKey(billId))
  publicLink = () => this.bill ? `${location.origin}${checkPath(this.bill.id)}` : ''

  init() {
    try { this.bills = JSON.parse(readStorage(billsKey) ?? '[]') as Bill[] } catch { this.bills = [] }
    const onPop = () => this.restoreRoute()
    this.restoreRoute()
    window.addEventListener('popstate', onPop)
    return () => { window.removeEventListener('popstate', onPop); this.disconnect() }
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

  closeOverlays() { this.addItemOpen = false; this.scanOpen = false; this.qrOpen = false; this.paymentFor = null; this.editingUnit = ''; this.editingItem = null; this.checkEditOpen = false }

  private rememberName(name: string) { this.savedName = name; writeStorage(nameKey, name) }

  // ---- navigation ----

  private restoreRoute() {
    const id = routeCheckId(location.pathname)
    this.closeOverlays()
    if (!id) { this.disconnect(); this.bill = null; this.mode = 'home'; return }
    const { token, legacy } = readOwnerToken(location.search, location.hash)
    this.token = token
    if (legacy) history.replaceState(history.state, '', ownerPath(id, token))
    const found = this.bills.find(entry => entry.id === id)
    if (found) {
      if (!this.token) this.token = found.ownerToken
      this.show(found, Boolean(this.token && this.token === found.ownerToken))
    } else if (isSupabaseConfigured) { this.disconnect(); this.bill = null; this.joinPublicId = id; this.mode = 'join'; preloadSupabase() }
    else { this.mode = 'home'; this.notify('Эта ссылка создана на другом устройстве. Подключите Supabase для общего доступа.') }
  }

  private show(bill: Bill, owner: boolean) {
    this.bill = bill; this.isOwner = owner; this.mode = 'check'; this.activeTab = 'order'; this.itemFilter = 'all'
    this.selectedPerson = readStorage(personKey(bill.id))
    if (bill.dbId) void this.connect(bill)
    else this.disconnect()
  }

  goHome() { this.disconnect(); this.closeOverlays(); this.mode = 'home'; history.pushState({}, '', homePath()) }
  beginCreate() { this.mode = 'create'; preloadSupabase() }

  openCheck(id: string) {
    const found = this.bills.find(entry => entry.id === id)
    if (!found) return
    this.token = found.ownerToken
    history.pushState({}, '', ownerPath(id, found.ownerToken))
    this.show(found, Boolean(found.ownerToken))
  }

  private save() {
    const bill = this.bill
    if (!bill) return
    this.bills = [bill, ...this.bills.filter(entry => entry.id !== bill.id)]
    writeStorage(billsKey, JSON.stringify(this.bills))
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
    this.bills = this.bills.filter(entry => entry.id !== id)
    writeStorage(billsKey, JSON.stringify(this.bills)); writeStorage(personKey(id), null)
  }

  // ---- realtime ----

  private presence(activity: string): PresenceUser {
    return { participantId: this.selectedPerson, name: this.selectedPerson ? this.personName(this.selectedPerson) : 'Гость', activity }
  }

  private disconnect() { this.remote?.close(); this.remote = null; this.onlineUsers = [] }

  private async connect(bill: Bill) {
    try {
      const userId = await ensureAnonymousSession()
      this.disconnect()
      if (this.bill?.id !== bill.id) return
      this.remote = subscribeToRemoteCheck(bill.id, userId, () => void this.refresh(), users => this.onlineUsers = users, this.presence('Просматривает чек'))
      void this.refresh()
    } catch (error) { this.fail(error, 'Не удалось подключиться к общему чеку') }
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
    if (!this.bill?.dbId) return
    const id = this.bill.id, seq = ++this.refreshSeq
    const stale = () => seq !== this.refreshSeq || this.bill?.id !== id
    try {
      const result = await loadRemoteCheck(id)
      if (!stale()) this.applyRemote(result)
    } catch (error) {
      if (stale()) return
      if (!isRemoteCheckGone(error)) { console.error('Remote refresh failed', error); return }
      if (await this.reclaimOwnership(id)) return
      if (!stale()) this.forget('Чек удалён или вас убрали из участников')
    }
  }

  /**
   * A lost Supabase session (expired or cleared) looks exactly like being removed from the check.
   * Before forgetting the check — and its owner secret with it — the secret re-attaches this device.
   * Tried once per check per visit, so a check that is really gone cannot loop.
   */
  private async reclaimOwnership(id: string) {
    const token = this.bills.find(entry => entry.id === id)?.ownerToken || this.token
    if (!token || this.reclaimed.has(id)) return false
    this.reclaimed.add(id)
    try { await claimRemoteCheckOwner(id, token) } catch { return false }
    // The realtime channel was refused for the unknown session, so subscribe again; connect() reloads the check.
    if (this.bill?.id === id) await this.connect(this.bill)
    return true
  }

  // ---- create and join ----

  async createBill(title: string, ownerName: string, servicePercent: number, paymentDetails: string) {
    const ownerToken = crypto.randomUUID()
    let bill: Bill
    this.rememberName(ownerName)
    if (isSupabaseConfigured) {
      this.busy = true
      try {
        const created = await createRemoteCheck(title, servicePercent, ownerName, ownerToken, paymentDetails)
        bill = { id: created.public_id, dbId: created.id, title, servicePercent, paymentDetails: paymentDetails || undefined, ownerId: created.participant_id, participants: [{ id: created.participant_id, name: ownerName, paid: 0, status: 'unpaid' }], items: [], createdAt: new Date().toISOString(), ownerToken }
      } catch (error) { this.fail(error, 'Не удалось создать чек'); return } finally { this.busy = false }
    } else {
      const ownerId = crypto.randomUUID()
      bill = { id: crypto.randomUUID(), title, servicePercent, paymentDetails: paymentDetails || undefined, ownerId, participants: [{ id: ownerId, name: ownerName, paid: 0, status: 'unpaid' }], items: [], createdAt: new Date().toISOString(), ownerToken }
    }
    this.bill = bill; this.isOwner = true; this.token = ownerToken; this.mode = 'check'; this.activeTab = 'order'
    this.selectedPerson = bill.participants[0].id; writeStorage(personKey(bill.id), this.selectedPerson)
    history.pushState({}, '', ownerPath(bill.id, ownerToken))
    this.save()
    if (bill.dbId) await this.connect(bill)
  }

  /** Returns an error message for the form, or '' on success. */
  async joinSharedCheck(name: string) {
    if (!this.joinPublicId) return ''
    this.busy = true
    this.rememberName(name)
    try {
      if (this.token) await claimRemoteCheckOwner(this.joinPublicId, this.token)
      await joinRemoteCheck(this.joinPublicId, name, crypto.randomUUID())
      const loaded = await loadRemoteCheck(this.joinPublicId)
      this.applyRemote(loaded); this.mode = 'check'; this.activeTab = 'order'
      history.replaceState({}, '', ownerPath(loaded.id, this.token))
      await this.connect(loaded)
      return ''
    } catch (error) {
      console.error(error)
      return errorMessage(error, 'Не удалось открыть чек')
    } finally { this.busy = false }
  }

  // ---- bill changes ----

  /** Runs a change against Supabase (then reloads) or against the local demo bill. */
  private async mutate(fallback: string, remote: (dbId: string) => Promise<unknown>, change: (bill: Bill) => Bill, success?: string) {
    const bill = this.bill
    if (!bill) return false
    try {
      if (bill.dbId) {
        this.busy = true
        await remote(bill.dbId)
        await this.refresh()
      } else { this.bill = change(bill); this.save() }
      if (success) this.notify(success)
      return true
    } catch (error) { this.fail(error, fallback); return false }
    finally { this.busy = false }
  }

  choosePerson(id: string) {
    if (!this.bill) return
    this.selectedPerson = id; writeStorage(personKey(this.bill.id), id)
    this.remote?.setPresence(this.presence('Просматривает чек'))
  }

  addItem(name: string, quantity: number, unitPrice: number) {
    return this.mutate('Не удалось добавить позицию', dbId => addRemoteItem(dbId, name, quantity, unitPrice), bill => local.addItem(bill, name, quantity, unitPrice))
  }

  /**
   * Adds scanned items in receipt order. Returns how many were added, so after a failure
   * the caller can keep the rest for another try.
   */
  async addItems(items: { name: string; quantity: number; unitPrice: number }[]) {
    const bill = this.bill
    if (!bill || !items.length) return 0
    if (!bill.dbId) {
      this.bill = items.reduce((next, entry) => local.addItem(next, entry.name, entry.quantity, entry.unitPrice), bill)
      this.save()
      return items.length
    }
    this.busy = true
    let added = 0
    try {
      for (const entry of items) { await addRemoteItem(bill.dbId, entry.name, entry.quantity, entry.unitPrice); added++ }
    } catch (error) { this.fail(error, `Добавлено ${added} из ${items.length} позиций`) }
    finally { await this.refresh(); this.busy = false }
    return added
  }

  updateItem(item: BillItem, name: string, quantity: number, unitPrice: number) {
    return this.mutate('Не удалось сохранить позицию', dbId => updateRemoteItem(dbId, item.id, name, quantity, unitPrice), bill => local.updateItem(bill, item.id, name, quantity, unitPrice), 'Позиция обновлена')
  }

  updateCheck(title: string, servicePercent: number, paymentDetails: string) {
    return this.mutate('Не удалось сохранить чек', dbId => updateRemoteCheck(dbId, title, servicePercent, paymentDetails), bill => local.updateCheck(bill, title, servicePercent, paymentDetails), 'Чек обновлён')
  }

  shareItemEqually(item: BillItem) {
    return this.mutate('Не удалось разделить позицию', dbId => shareRemoteItemEqually(dbId, item.id), bill => local.shareItemEqually(bill, item.id), `«${item.name}» делится на всех`)
  }

  markPayment(personId: string, paid: boolean) {
    const due = this.dueOf(personId)
    return this.mutate('Не удалось обновить оплату', dbId => markRemotePayment(dbId, personId, paid), bill => local.markPayment(bill, personId, paid, due), paid ? 'Оплата отмечена' : 'Отметка об оплате снята')
  }

  removeItem(item: BillItem) {
    return this.mutate('Не удалось удалить позицию', dbId => deleteRemoteItem(dbId, item.id), bill => local.removeItem(bill, item.id))
  }

  async toggleUnit(item: BillItem, unit: number) {
    const bill = this.bill, me = this.selectedPerson
    if (!bill || !me) return
    if (!bill.dbId) { this.bill = local.toggleUnit(bill, item.id, unit, me); this.save(); return }
    const unitId = item.unitIds?.[unit]
    if (!unitId || this.pendingUnits[unitId]) return
    const enabled = !(item.unitSelections[String(unit)] ?? []).includes(me)
    // Show the tap right away; the reload after the RPC replaces it with the server's amounts, or reverts it.
    this.refreshSeq++
    this.bill = { ...bill, items: bill.items.map(entry => entry.id === item.id ? local.withSelection(entry, unit, me, enabled) : entry) }
    this.pendingUnits = { ...this.pendingUnits, [unitId]: true }
    this.remote?.setPresence(this.presence(`${enabled ? 'Выбирает' : 'Убирает'} ${item.name}`))
    try { await toggleRemoteUnit(unitId, enabled) }
    catch (error) { this.fail(error, 'Не удалось обновить позицию') }
    finally { const { [unitId]: _, ...rest } = this.pendingUnits; this.pendingUnits = rest }
    await this.refresh()
  }

  saveCustomShares(item: BillItem, unit: number, amounts: Record<string, number>) {
    return this.mutate('Не удалось сохранить доли', () => setRemoteCustomShares(item.unitIds?.[unit] ?? '', amounts), bill => local.setCustomShares(bill, item.id, unit, amounts))
  }

  resetCustomShares(item: BillItem, unit: number) {
    return this.mutate('Не удалось сбросить доли', () => resetRemoteCustomShares(item.unitIds?.[unit] ?? ''), bill => local.resetCustomShares(bill, item.id, unit))
  }

  submitPayment(personId: string, amount: number, proofUrl: string | null) {
    const due = this.dueOf(personId)
    return this.mutate('Не удалось отправить оплату', dbId => submitRemotePayment(dbId, amount, proofUrl), bill => local.submitPayment(bill, personId, amount, proofUrl, due), 'Оплата отправлена')
  }

  approve(personId: string) {
    const due = this.dueOf(personId)
    return this.mutate('Не удалось подтвердить оплату', dbId => confirmRemotePayment(dbId, personId), bill => local.confirmPayment(bill, personId, due), 'Оплата подтверждена')
  }

  addComment(body: string) {
    const me = this.selectedPerson
    if (!me) return Promise.resolve(false)
    return this.mutate('Не удалось отправить комментарий', dbId => addRemoteComment(dbId, null, body), bill => local.addComment(bill, me, body))
  }

  deleteComment(comment: CommentMessage) {
    return this.mutate('Не удалось удалить комментарий', () => deleteRemoteComment(comment.id), bill => local.deleteComment(bill, comment.id))
  }

  async removeParticipant(person: Participant) {
    const removed = await this.mutate('Не удалось удалить участника', dbId => removeRemoteParticipant(dbId, person.id), bill => local.removeParticipant(bill, person.id))
    if (removed && this.selectedPerson === person.id && this.bill) { this.selectedPerson = null; writeStorage(personKey(this.bill.id), null) }
  }

  async removeBill() {
    const bill = this.bill
    if (!bill) return
    if (bill.dbId) {
      try { await deleteRemoteCheck(bill.dbId) } catch (error) { this.fail(error, 'Не удалось удалить чек'); return }
    }
    this.forget('Чек удалён')
  }

  async copy(text: string, success: string) {
    try { await navigator.clipboard.writeText(text); this.notify(success) }
    catch { this.notify('Не удалось скопировать — разрешите доступ к буферу обмена') }
  }
}

export const app = new AppStore()
