import { assignedSubtotal, calculateTotals, ownerIdOf, serviceFee, withSelection, type Bill, type BillItem, type Participant } from './calculations'
import { errorMessage, errorText } from './errors'
import { addRemoteItem, addRemoteItems, updateRemoteCheck, updateRemoteItem, shareRemoteItemEqually, unshareRemoteItem, claimRemoteCheckOwner, confirmRemotePayment, createRemoteCheck, deleteRemoteCheck, deleteRemoteItem, ensureAnonymousSession, isRemoteCheckGone, joinRemoteCheck, loadRemoteCheck, previewRemoteCheck, removeRemoteParticipant, renameRemoteParticipant, markRemotePaid, subscribeToRemoteCheck, toggleRemoteUnit, unconfirmRemotePayment, type PresenceUser, type RemoteBill, type RemoteSubscription } from './remote'
import { checkPath, homePath, readOwnerToken, routeCheckId } from './routes'
import { preloadSupabase } from './supabase'
import { expiresAt } from './limits'
import { cleanName, defaultTitle, initial, randomName } from './format'
import { shareOr } from './share'
import { pickerHasCamera, pickPhoto } from './photo'
import type { ItemRow } from './rows'
import { RepeatIds } from './requests'
import { billsKey, forgetDevice, guestToken, loadBills, parseBills, saveGuestToken, saveName, savePerson, savedName as readSavedName, savedPerson, updateBills } from './saved'
import { UiState } from './ui.svelte'

export type Mode = 'home' | 'create' | 'join' | 'check'
/** A line of the check being made: what was typed or scanned, checked only when the check is created. */
export type DraftRow = ItemRow
export type { ConfirmRequest } from './ui.svelte'
/** join_check errors raised before it adds anyone. */
const refusedJoin = /Name taken|Invalid participant name|Guest limit reached|Participant limit reached/

export const totalFood = (bill: Bill) => bill.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
export const grandTotal = (bill: Bill) => totalFood(bill) + serviceFee(totalFood(bill), bill.servicePercent)

class AppStore extends UiState {
  bills = $state<Bill[]>([])
  bill = $state<Bill | null>(null)
  mode = $state<Mode>('home')
  joinPublicId = $state('')
  /** Owner secret from the #p= link; proves ownership when the check is opened on a new device. */
  token = $state('')
  selectedPerson = $state<string | null>(null)
  isOwner = $state(false)
  onlineUsers = $state<PresenceUser[]>([])
  /**
   * Requests on their way to the server, by what they change: only the buttons for the same thing wait,
   * so a slow item upload does not block the payment ticks. Keys: 'create', 'join', 'items', 'check', 'name',
   * 'delete', `item:<id>`, `person:<id>` and `pay:<participant id>`.
   */
  pendingActions = $state<Record<string, true>>({})
  /** False while the device has no network: taps would fail, so the page says so up front. */
  online = $state(typeof navigator === 'undefined' || navigator.onLine)
  pendingUnits = $state<Record<string, true>>({})
  /** The check being made on the create page, before it exists on the server. */
  draft = $state<DraftRow[]>([])
  /** What the scanned receipt says the dishes add up to, to compare with the table. */
  draftTotal = $state<number | null>(null)
  draftService = $state<number | null>(null)
  /** The name typed last time, so the next check does not ask for it again. */
  savedName = $state(readSavedName())

  totals = $derived(this.bill ? calculateTotals(this.bill) : [])
  billTotal = $derived(this.bill ? grandTotal(this.bill) : 0)
  unassignedTotal = $derived(this.bill ? totalFood(this.bill) - assignedSubtotal(this.bill) : 0)
  /** The creator paid the restaurant, so their own share counts as settled. */
  ownerId = $derived(this.bill ? ownerIdOf(this.bill) : undefined)
  allConfirmed = $derived(Boolean(this.bill && this.unassignedTotal <= 0 && this.bill.items.length && this.totals.every(person => person.id === this.ownerId || person.mark === 'confirmed' || person.due === 0)))
  currentTotal = $derived(this.totals.find(person => person.id === this.selectedPerson))
  participantIndex = $derived(new Map(this.bill?.participants.map((person, index) => [person.id, index]) ?? []))

  private remote: RemoteSubscription | null = null
  /** Ids that let the server recognise a repeated creation or addition (see requests.ts). */
  private requests = new RepeatIds()
  /**
   * The secret, name and title of the check being created, kept until it is made, so a repeat gets the same check.
   * The title is kept too: it names the meal by the hour, and a repeat at 11:00 must not turn «Завтрак» into «Обед».
   */
  private creating: { ownerToken: string; ownerName: string; title: string } | null = null
  private refreshSeq = 0
  /** The state each serving should end in, by the viewer's last tap on it, while its request is on the way. */
  private wantedUnits = new Map<string, boolean>()
  private reclaimed = new Set<string>()
  /** The anonymous account the open check was connected with; a different one means the session was lost. */
  private sessionUser = ''

  isPending = (key: string) => Boolean(this.pendingActions[key])

  /** Runs one request under its key; a second tap on the same thing while it runs is ignored. */
  private async track<T>(key: string, run: () => Promise<T>): Promise<T | undefined> {
    if (this.pendingActions[key]) return undefined
    this.pendingActions = { ...this.pendingActions, [key]: true }
    try { return await run() }
    finally { const { [key]: _, ...rest } = this.pendingActions; this.pendingActions = rest }
  }

  personIndex = (id: string) => this.participantIndex.get(id) ?? 0
  /** Avatar colour: one of ten, in the order people joined, so the first ten at a table never share one. */
  tone = (id: string) => this.personIndex(id) % 10
  isMe = (id: string) => id === this.selectedPerson
  /** You see yourself as «Я»; everyone else by name. */
  label = (person: { id: string; name: string }) => this.isMe(person.id) ? 'Я' : person.name
  avatar = (person: { id: string; name: string }) => this.isMe(person.id) ? 'Я' : initial(person.name)
  personName = (id: string) => this.bill?.participants[this.participantIndex.get(id) ?? -1]?.name ?? 'Участник'
  personOf = (billId: string) => savedPerson(billId)
  publicLink = () => this.bill ? `${location.origin}${checkPath(this.bill.id)}` : ''

  init() {
    this.bills = loadBills() ?? []
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

  private fail(error: unknown, fallback: string) {
    console.error(error)
    this.notify(errorMessage(error, fallback))
  }

  private rememberName(name: string) { this.savedName = name; saveName(name) }

  // ---- navigation ----

  private restoreRoute() {
    const id = routeCheckId(location.pathname, undefined, location.search)
    this.closeOverlays()
    if (!id) { this.disconnect(); this.bill = null; this.mode = 'home'; return }
    const { token } = readOwnerToken(location.search, location.hash)
    this.token = token
    // An owner link from an earlier version keeps its secret in memory, not in the address bar where it gets copied;
    // an old /check/<id> address becomes the ?c= form, so a link copied from the address bar gets a messenger preview.
    if (token || location.pathname + location.search !== checkPath(id)) history.replaceState(history.state, '', checkPath(id))
    const found = this.bills.find(entry => entry.id === id)
    if (found) {
      if (!this.token) this.token = found.ownerToken
      this.show(found, Boolean(this.token && this.token === found.ownerToken))
    } else { this.disconnect(); this.bill = null; this.joinPublicId = id; this.mode = 'join'; preloadSupabase() }
  }

  private show(bill: Bill, owner: boolean) {
    this.bill = bill; this.isOwner = owner; this.mode = 'check'
    this.selectedPerson = savedPerson(bill.id)
    void this.connect(bill)
  }

  goHome() { this.disconnect(); this.closeOverlays(); this.mode = 'home'; history.pushState({}, '', homePath()) }
  beginCreate() {
    this.mode = 'create'; this.draft = [this.newDraftRow()]; this.draftTotal = null; this.draftService = null
    // A new check from the start: an unfinished earlier try is not repeated into it.
    this.creating = null; this.requests.done('create')
    preloadSupabase()
  }

  openCheck(id: string) {
    const found = this.bills.find(entry => entry.id === id)
    if (!found) return
    this.token = found.ownerToken
    history.pushState({}, '', checkPath(id))
    this.show(found, Boolean(found.ownerToken))
  }

  /** Changes the saved list as it is stored now, so checks saved by another tab are not overwritten. */
  private updateBills(change: (bills: Bill[]) => Bill[]) {
    this.bills = updateBills(this.bills, change)
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
    forgetDevice(id)
  }

  // ---- realtime ----

  private presence(activity: string): PresenceUser {
    return { participantId: this.selectedPerson, name: this.selectedPerson ? this.personName(this.selectedPerson) : 'Гость', activity }
  }

  // Someone on the channel who is not in the check yet has just joined: their own broadcast may still be on its way,
  // or may have been missed, so the check reloads right away instead of waiting for it.
  private onPresence(users: PresenceUser[]) {
    this.onlineUsers = users
    if (users.some(user => user.participantId && !this.participantIndex.has(user.participantId))) void this.refresh()
  }

  private disconnect() { this.remote?.close(); this.remote = null; this.onlineUsers = [] }

  private async connect(bill: Bill) {
    try {
      const userId = this.sessionUser = await ensureAnonymousSession()
      this.disconnect()
      if (this.bill?.id !== bill.id) return
      this.remote = subscribeToRemoteCheck(bill.id, userId, () => void this.refresh(), users => this.onPresence(users), this.presence('Просматривает чек'))
      void this.refresh()
    } catch (error) { this.fail(error, 'Не удалось загрузить чек — проверьте интернет') }
  }

  private applyRemote(result: RemoteBill) {
    result.ownerToken = this.bills.find(entry => entry.id === result.id)?.ownerToken || this.token
    this.bill = result; this.isOwner = result.isOwner
    if (this.selectedPerson !== result.me) {
      this.selectedPerson = result.me; savePerson(result.id, result.me)
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
      // While a tap is still being sent the server lags behind the screen; the reload after it catches up.
      if (!stale() && !this.wantedUnits.size) this.applyRemote(result)
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
    const guest = guestToken(id)
    if (this.reclaimed.has(id) || (!ownerToken && !guest)) return false
    if (!ownerToken && await ensureAnonymousSession().catch(() => '') === this.sessionUser) return false
    this.reclaimed.add(id)
    try {
      if (ownerToken) await claimRemoteCheckOwner(id, ownerToken)
      else await joinRemoteCheck(id, this.savedName || 'Гость', guest!)
    } catch { return false }
    // The realtime channel was refused for the unknown session, so subscribe again; connect() reloads the check.
    if (this.bill?.id === id) await this.connect(this.bill)
    return true
  }

  // ---- create and join ----

  /**
   * The check typed or scanned on the create page, with nothing asked besides; then the invitation opens.
   * Returns an error for the page to show next to its button, or '' once the check is made.
   */
  async createBill(servicePercent: number, items: { name: string; quantity: number; unitPrice: number }[]): Promise<string> {
    if (this.isPending('create')) return ''
    // A name typed in an earlier check, or letters nobody has to make up; the title is the meal and the date.
    this.creating ??= { ownerToken: crypto.randomUUID(), ownerName: this.savedName || randomName(), title: defaultTitle() }
    const { ownerToken, ownerName, title } = this.creating
    let bill: Bill | undefined, failure = ''
    await this.track('create', async () => {
      try {
        const created = await createRemoteCheck(title, servicePercent, ownerName, ownerToken, '', null, this.requests.take('create', [ownerToken, servicePercent]))
        bill = { id: created.public_id, dbId: created.id, title, servicePercent, ownerId: created.participant_id, participants: [{ id: created.participant_id, name: ownerName, mark: 'none', markedFor: 0 }], items: [], createdAt: new Date().toISOString(), ownerToken }
      } catch (error) { console.error(error); failure = errorMessage(error, 'Не удалось создать чек'); return }
      // The items go in before the check opens. If they fail, the page keeps them, and the same button tries again:
      // the server returns the check it already made and adds the items once.
      try { await this.sendItems(bill.dbId, items) } catch (error) {
        console.error(error); bill = undefined
        failure = errorMessage(error, 'Не удалось добавить позиции — нажмите ещё раз')
      }
    })
    if (!bill) return failure
    this.requests.done('create'); this.creating = null
    this.bill = bill; this.isOwner = true; this.token = ownerToken; this.mode = 'check'
    this.selectedPerson = bill.participants[0].id; savePerson(bill.id, this.selectedPerson)
    history.pushState({}, '', checkPath(bill.id))
    this.save()
    this.draft = []; this.draftTotal = null; this.draftService = null
    await this.connect(bill)
    this.qrOpen = true
    return ''
  }

  // ---- the check being made ----

  private draftSeq = 0
  newDraftRow = (): DraftRow => ({ id: this.draftSeq++, name: '', quantity: 1, price: null })

  /**
   * A photo for the check being made, from a tap: the system picker where it offers the camera too (iPhone, computers),
   * otherwise (Android) the scanner opens on its own "Сфотографировать" and "Выбрать из галереи" buttons.
   */
  scanForDraft() {
    if (!pickerHasCamera(navigator.userAgent)) { this.scanOpen = true; return }
    void pickPhoto().then(file => { if (file && this.mode === 'create') this.scanPhoto(file) })
  }

  /** Scanned rows replace the empty ones; what was typed by hand stays. */
  fillDraft(items: { name: string; quantity: number; unitPrice: number; unsure?: boolean }[], total: number | null, servicePercent: number | null) {
    const typed = this.draft.filter(row => row.name.trim() || row.price)
    this.draft = [...typed, ...items.map(item => ({ id: this.draftSeq++, name: item.name, quantity: item.quantity, price: item.unitPrice, suspect: Boolean(item.unsure) })), this.newDraftRow()]
    // A further photo adds to the rows already there (the next part of a long receipt, or another receipt), so its total adds up too.
    this.draftTotal = typed.length && this.draftTotal !== null ? this.draftTotal + (total ?? 0) : total
    if (servicePercent !== null && servicePercent <= 30) this.draftService = servicePercent
  }

  /**
   * A browser that was in this check before (the creator's secret or a guest's join token) goes straight back in;
   * anyone new first says who they are.
   */
  needsName() { return Boolean(this.joinPublicId) && !this.token && !guestToken(this.joinPublicId) }

  /**
   * A join that failed without the server refusing it (a lost answer, a dropped network) keeps its token, and the
   * server may already have made the guest. The next try then goes in by that token, so the join page must not
   * hold it back over a name or a place that may be this guest's own.
   */
  hasJoinToken() { return Boolean(this.joinPublicId) && !this.token && Boolean(guestToken(this.joinPublicId)) }

  /** The check's name, who is there and how many are expected, for the join page; null if it is gone. */
  previewCheck() { return previewRemoteCheck(this.joinPublicId) }

  /**
   * Joins the check from its link. A new guest gives a name, which the server refuses if someone at the table
   * already has it; a returning browser is matched by its token and keeps its name.
   * Returns an error message for the page, or '' on success.
   */
  async joinSharedCheck(typedName?: string) {
    if (!this.joinPublicId) return ''
    const name = typedName === undefined ? this.savedName : cleanName(typedName)
    if (this.isPending('join')) return ''
    this.pendingActions = { ...this.pendingActions, join: true }
    try {
      let sessionToken: string = crypto.randomUUID()
      if (this.token) await claimRemoteCheckOwner(this.joinPublicId, this.token)
      // Saved before the request: if the answer is lost on the way, the next try finds the guest it made.
      else { sessionToken = guestToken(this.joinPublicId) ?? sessionToken; saveGuestToken(this.joinPublicId, sessionToken) }
      // Also before the request: if the answer is lost, the retry joins silently by token, and under this name.
      if (typedName !== undefined) this.rememberName(name)
      await joinRemoteCheck(this.joinPublicId, name, sessionToken)
      const loaded = await loadRemoteCheck(this.joinPublicId)
      this.applyRemote(loaded); this.mode = 'check'
      history.replaceState({}, '', checkPath(loaded.id))
      await this.connect(loaded)
      return ''
    } catch (error) {
      console.error(error)
      // The server made nobody: the token goes, so the next try asks for a name again instead of joining silently.
      if (!this.token && refusedJoin.test(errorText(error))) saveGuestToken(this.joinPublicId, null)
      return errorMessage(error, 'Не удалось открыть чек')
    } finally { const { join: _, ...rest } = this.pendingActions; this.pendingActions = rest }
  }

  // ---- bill changes ----

  /** Runs a change on the server, then reloads the check. */
  private async mutate(key: string, fallback: string, remote: (dbId: string) => Promise<unknown>, success?: string) {
    const bill = this.bill
    if (!bill || this.isPending(key)) return false
    try {
      await this.track(key, async () => {
        await remote(bill.dbId)
        await this.refresh()
      })
      if (success) this.notify(success)
      return true
    } catch (error) { this.fail(error, fallback); return false }
  }

  addItem(name: string, quantity: number, unitPrice: number) {
    const key = `item:${this.bill?.dbId}`
    return this.mutate('items', 'Не удалось добавить позицию', dbId => addRemoteItem(dbId, name, quantity, unitPrice, this.requests.take(key, [name, quantity, unitPrice])))
      .then(added => { if (added) this.requests.done(key); return added })
  }

  /** Adds rows in one request, all or none; a repeat of the same rows after a lost answer does not add them twice. */
  private async sendItems(dbId: string, items: { name: string; quantity: number; unitPrice: number }[]) {
    if (!items.length) return
    const key = `items:${dbId}`
    await addRemoteItems(dbId, items, this.requests.take(key, items))
    this.requests.done(key)
  }

  /**
   * Adds scanned or typed items in receipt order. Returns how many were added (all or none), so after a failure
   * the caller can keep them for another try.
   */
  async addItems(items: { name: string; quantity: number; unitPrice: number }[]) {
    const bill = this.bill
    if (!bill || !items.length || this.isPending('items')) return 0
    this.pendingActions = { ...this.pendingActions, items: true }
    let added = 0
    try {
      await this.sendItems(bill.dbId, items)
      added = items.length
    } catch (error) { this.fail(error, 'Не удалось добавить позиции') }
    finally { await this.refresh(); const { items: _, ...rest } = this.pendingActions; this.pendingActions = rest }
    return added
  }

  updateItem(item: BillItem, name: string, quantity: number, unitPrice: number) {
    return this.mutate(`item:${item.id}`, 'Не удалось сохранить позицию', dbId => updateRemoteItem(dbId, item.id, name, quantity, unitPrice), 'Позиция обновлена')
  }

  /** expectedGuests: undefined keeps the number, null clears it. */
  updateCheck(title: string, servicePercent: number, paymentDetails: string, expectedGuests?: number | null) {
    return this.mutate('check', 'Не удалось сохранить чек', dbId => updateRemoteCheck(dbId, title, servicePercent, paymentDetails, expectedGuests), 'Чек обновлён')
  }

  shareItemEqually(item: BillItem) {
    return this.mutate(`item:${item.id}`, 'Не удалось разделить позицию', dbId => shareRemoteItemEqually(dbId, item.id), `«${item.name}» делится на всех`)
  }

  unshareItem(item: BillItem) {
    return this.mutate(`item:${item.id}`, 'Не удалось изменить позицию', dbId => unshareRemoteItem(dbId, item.id), `«${item.name}» больше не на всех`)
  }

  unconfirm(personId: string) {
    return this.mutate(`pay:${personId}`, 'Не удалось отменить подтверждение', dbId => unconfirmRemotePayment(dbId, personId), 'Подтверждение отменено')
  }

  removeItem(item: BillItem) {
    return this.mutate(`item:${item.id}`, 'Не удалось удалить позицию', dbId => deleteRemoteItem(dbId, item.id))
  }

  async toggleUnit(item: BillItem, unit: number) {
    const bill = this.bill, me = this.selectedPerson
    // An item split among everyone is the creator's until they end it; the server refuses the tap too.
    if (!bill || !me || item.sharedAll) return
    const unitId = item.unitIds?.[unit]
    if (!unitId) return
    const current = bill.items.find(entry => entry.id === item.id) ?? item
    const enabled = !(current.unitSelections[String(unit)] ?? []).includes(me)
    // Show the tap right away; the reload after the RPC replaces it with the server's amounts, or reverts it.
    this.refreshSeq++
    this.bill = { ...bill, items: bill.items.map(entry => entry.id === item.id ? withSelection(entry, unit, me, enabled) : entry) }
    this.remote?.setPresence(this.presence(`${enabled ? 'Выбирает' : 'Убирает'} ${item.name}`))
    // A tap while the last one is still on its way is not lost: the running request sends the newest wish after it.
    this.wantedUnits.set(unitId, enabled)
    if (this.pendingUnits[unitId]) return
    this.pendingUnits = { ...this.pendingUnits, [unitId]: true }
    try {
      for (let sent: boolean | undefined; sent !== this.wantedUnits.get(unitId);) {
        sent = this.wantedUnits.get(unitId)!
        await toggleRemoteUnit(unitId, sent)
      }
    }
    catch (error) { this.fail(error, 'Не удалось обновить позицию') }
    finally { this.wantedUnits.delete(unitId); const { [unitId]: _, ...rest } = this.pendingUnits; this.pendingUnits = rest }
    await this.refresh()
  }

  /** Your own «Я оплатил»; the creator then confirms with «Рассчитался». */
  markPaid(paid: boolean) {
    return this.mutate(`pay:${this.selectedPerson}`, 'Не удалось отметить оплату', dbId => markRemotePaid(dbId, paid), paid ? 'Отмечено: оплатил' : 'Отметка снята')
  }

  /** Your own name in the check; it is kept for the next checks too. */
  async rename(typed: string) {
    const name = cleanName(typed)
    if (!await this.mutate('name', 'Не удалось сменить имя', dbId => renameRemoteParticipant(dbId, name))) return false
    this.rememberName(name)
    this.remote?.setPresence(this.presence('Просматривает чек'))
    return true
  }

  approve(personId: string) {
    return this.mutate(`pay:${personId}`, 'Не удалось подтвердить оплату', dbId => confirmRemotePayment(dbId, personId), 'Оплата подтверждена')
  }

  async removeParticipant(person: Participant) {
    const removed = await this.mutate(`person:${person.id}`, 'Не удалось удалить участника', dbId => removeRemoteParticipant(dbId, person.id))
    if (removed && this.selectedPerson === person.id && this.bill) { this.selectedPerson = null; savePerson(this.bill.id, null) }
  }

  async removeBill() {
    const bill = this.bill
    if (!bill) return
    try { if (!await this.track('delete', async () => { await deleteRemoteCheck(bill.dbId); return true })) return }
    catch (error) { this.fail(error, 'Не удалось удалить чек'); return }
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
