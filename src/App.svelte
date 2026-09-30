<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { isSupabaseConfigured } from './lib/supabase'
  import { addRemoteItem, deleteRemoteItem, addRemoteComment, announceRemoteChange, claimRemoteCheckOwner, confirmRemotePayment, createRemoteCheck, deleteRemoteCheck, deleteRemoteComment, ensureAnonymousSession, isRemoteCheckGone, joinRemoteCheck, loadRemoteCheck, removeRemoteParticipant, resetRemoteCustomShares, setRemoteCustomShares, submitRemotePayment, subscribeToRemoteCheck, toggleRemoteUnit, updateRemoteActivity } from './lib/remote'
  import { assignedSubtotal, calculateTotals, formatUzs, splitInteger, type Bill, type BillItem, type CommentMessage, type Participant, type PaymentStatus } from './lib/calculations'
  import './app.css'

  let bills = $state<Bill[]>([])
  let bill = $state<Bill | null>(null)
  let mode = $state<'home' | 'create' | 'join' | 'check'>('home')
  let joinPublicId = $state('')
  let editingUnit = $state('')
  let customAmounts = $state<Record<string, number>>({})
  let joinName = $state('')
  let busy = $state(false)
  let onlineUsers = $state<{ name: string; activity: string }[]>([])
  let remoteUnsubscribe: (() => void) | null = null
  let errorMessage = $state('')
  let title = $state('')
  let ownerName = $state('')
  let fee = $state(10)
  let itemName = $state('')
  let itemQty = $state(1)
  let itemPrice = $state<number | null>(null)
  let selectedPerson = $state<string | null>(null)
  let showAddItem = $state(false)
  let showPayment = $state<string | null>(null)
  let paidInput = $state(0)
  let proofInput = $state('')
  let commentText = $state('')
  let toast = $state('')
  let isOwner = $state(false)
  let token = $state('')
  let activeTab = $state<'order' | 'summary'>('order')

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  const checkPath = (id: string) => `${basePath}/check/${id}`
  const homePath = () => basePath ? `${basePath}/` : '/'
  const totalFood = (value: Bill) => value.items.reduce((n, item) => n + item.quantity * item.unitPrice, 0)
  const grandTotal = (value: Bill) => Math.round(totalFood(value) * (1 + value.servicePercent / 100))
  const unassignedTotal = $derived(bill ? totalFood(bill) - assignedSubtotal(bill) : 0)
  const totals = $derived(bill ? calculateTotals(bill) : [])
  const paidAll = $derived(totals.reduce((n, person) => n + person.paid, 0))
  const allConfirmed = $derived(Boolean(bill && unassignedTotal === 0 && bill.participants.length && bill.participants.every(p => p.status === 'paid')))
  const currentParticipant = $derived(bill?.participants.find(p => p.id === selectedPerson))
  const currentTotal = $derived(totals.find(person => person.id === selectedPerson))
  const customTotal = $derived(bill ? bill.participants.reduce((sum, person) => sum + Math.max(0, Math.floor(Number(customAmounts[person.id] ?? 0))), 0) : 0)

  type Theme = 'system' | 'light' | 'dark'
  const themes: { value: Theme; icon: string; label: string }[] = [{ value: 'light', icon: '☀', label: 'Светлая тема' }, { value: 'system', icon: '◐', label: 'Как в системе' }, { value: 'dark', icon: '☾', label: 'Тёмная тема' }]
  let theme = $state<Theme>('system')
  function setTheme(next: Theme) {
    theme = next
    try { if (next === 'system') localStorage.removeItem('billsplit:theme'); else localStorage.setItem('billsplit:theme', next) } catch { /* theme still applies for this visit */ }
    if (next === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = next
    const bar = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => { meta.content = next === 'system' ? meta.dataset.default ?? bar : bar })
  }

  const statusLabels: Record<PaymentStatus, string> = { unpaid: 'Не оплачено', partially_paid: 'Частично', proof_submitted: 'На проверке', paid: 'Оплачено' }
  function plural(n: number, one: string, few: string, many: string) {
    const m10 = n % 10, m100 = n % 100
    return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`
  }
  const itemIcons: [RegExp, string][] = [[/пицц|pizza/, '🍕'], [/бургер|burger/, '🍔'], [/салат|salad/, '🥗'], [/хлеб|лепёш|лепеш|non|bread/, '🥖'], [/торт|десерт|cake|dessert/, '🍰'], [/кофе|coffee|латте|капуч/, '☕'], [/чай|tea/, '🍵'], [/пиво|beer/, '🍺'], [/вино|wine/, '🍷'], [/кола|cola|лимонад|сок|вода|drink|juice/, '🥤'], [/суп|шурп|soup/, '🍲'], [/плов|рис|plov/, '🍛'], [/шашлык|кебаб|мясо|стейк|kebab|steak/, '🍢'], [/паст|спагет|pasta/, '🍝'], [/суши|ролл|sushi/, '🍣']]
  const itemIcon = (name: string) => itemIcons.find(([pattern]) => pattern.test(name.toLowerCase()))?.[1] ?? '🍽️'
  const personIndex = (id: string) => Math.max(0, bill?.participants.findIndex(person => person.id === id) ?? 0)
  const personName = (id: string) => bill?.participants.find(person => person.id === id)?.name ?? 'Участник'
  const initial = (name: string) => name.slice(0, 1).toUpperCase()
  function unitConsumers(item: BillItem, unit: number) {
    const key = String(unit), custom = item.unitModes?.[key] === 'custom' ? item.unitCustomAmounts?.[key] : undefined
    return bill!.participants.filter(person => custom ? (custom[person.id] ?? 0) > 0 : item.unitSelections[key]?.includes(person.id))
  }
  function closeOverlays(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    showAddItem = false; showPayment = null; editingUnit = ''
  }
  function goHome() { mode = 'home'; history.pushState({}, '', homePath()) }

  function restoreRoute() {
    const id=location.pathname.split('/').filter(Boolean).at(-1)
    if (!id || id==='check') { remoteUnsubscribe?.(); remoteUnsubscribe=null; bill=null; mode='home'; return }
    const query=new URLSearchParams(location.search)
    token=query.get('p') ?? ''
    const found=bills.find(entry=>entry.id===id)
    if (found) {
      bill=found; mode='check'; selectedPerson=localStorage.getItem('billsplit:person:'+id); activeTab='order'
      isOwner=Boolean(token && token===found.ownerToken)
      if(found.dbId) { if(!token && found.ownerToken) token=found.ownerToken; isOwner=Boolean(token && token===found.ownerToken); void connectRemote(found,isOwner) }
    } else if (isSupabaseConfigured) { joinPublicId=id; mode='join' }
    else { mode='home'; notify('Эта ссылка создана на другом устройстве. Подключите Supabase для общего доступа.') }
  }

  onMount(() => {
    try { bills=JSON.parse(localStorage.getItem('billsplit:v1') ?? '[]') as Bill[] } catch { bills=[] }
    try { const stored=localStorage.getItem('billsplit:theme'); if (stored==='light' || stored==='dark') setTheme(stored) } catch { /* system theme */ }
    restoreRoute()
    window.addEventListener('popstate',restoreRoute)
    return ()=>window.removeEventListener('popstate',restoreRoute)
  })

  onDestroy(() => remoteUnsubscribe?.())
  // Each screen starts at the top instead of inheriting the previous screen's scroll position.
  $effect(() => { void mode; window.scrollTo(0, 0) })

  function invalidatePayments(value: Bill): Bill { return { ...value, participants: value.participants.map(person => ({ ...person, status: person.paid > 0 ? 'partially_paid' : 'unpaid', proofUrl: undefined })) } }
  function save() { if (bill) { bills = [bill, ...bills.filter(x => x.id !== bill!.id)]; localStorage.setItem('billsplit:v1', JSON.stringify(bills)) } }
  async function connectRemote(value: Bill, _owner = false) {
    if (!value.dbId) return
    try {
      await ensureAnonymousSession()
      remoteUnsubscribe?.()
      remoteUnsubscribe = subscribeToRemoteCheck(value.dbId, value.id, () => { void refreshRemote() }, users => onlineUsers = users, { name: value.participants.find(p => p.id === selectedPerson)?.name ?? 'Гость', activity: 'Просматривает чек' })
      void refreshRemote()
    } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось подключить realtime') }
  }
  async function refreshRemote() {
    if (!bill?.dbId) return
    try { const result = await loadRemoteCheck(bill.id); result.ownerToken = bill.ownerToken; bill = result; isOwner = isOwner || Boolean(token && token === result.ownerToken); save() }
    catch (error) {
      if (isRemoteCheckGone(error)) forgetBill('Чек удалён или вас убрали из участников')
      else console.error('Remote refresh failed', error)
    }
  }
  function forgetBill(message: string) {
    if (!bill) return
    const id = bill.id
    remoteUnsubscribe?.(); remoteUnsubscribe = null; onlineUsers = []
    bills = bills.filter(b => b.id !== id); localStorage.setItem('billsplit:v1', JSON.stringify(bills)); localStorage.removeItem(`billsplit:person:${id}`)
    history.pushState({}, '', homePath()); bill = null; mode = 'home'; notify(message)
  }
  async function joinSharedCheck() {
    if (!joinPublicId || !joinName.trim()) return
    busy = true; errorMessage = ''
    try {
      await ensureAnonymousSession()
      if (token) await claimRemoteCheckOwner(joinPublicId, token)
      const sessionToken = crypto.randomUUID()
      const result = await joinRemoteCheck(joinPublicId, joinName.trim(), sessionToken)
      const loaded = await loadRemoteCheck(joinPublicId)
      loaded.ownerToken = token; bill = loaded; isOwner = Boolean(token); selectedPerson = result.participant_id; localStorage.setItem(`billsplit:person:${loaded.id}`, result.participant_id); mode = 'check'; activeTab = 'order'; history.replaceState({}, '', `${checkPath(loaded.id)}${token ? `?p=${token}` : ''}`); save(); await connectRemote(loaded, isOwner)
    } catch (error) { errorMessage = error instanceof Error ? error.message : 'Не удалось открыть чек' } finally { busy = false }
  }
  function notify(message: string) { toast = message; setTimeout(() => toast = '', 2500) }
  function beginCreate() { mode = 'create' }
  async function createBill() {
    if (!title.trim() || !ownerName.trim()) return
    const ownerToken = crypto.randomUUID()
    if (isSupabaseConfigured) {
      busy = true
      try {
        const remote = await createRemoteCheck(title.trim(), fee, ownerName.trim(), ownerToken)
        const owner: Participant = { id: remote.participant_id, name: ownerName.trim(), paid: 0, status: 'unpaid' }
        bill = { id: remote.public_id, dbId: remote.id, title: title.trim(), servicePercent: fee, participants: [owner], items: [], createdAt: new Date().toISOString(), ownerToken }
        isOwner = true; token = ownerToken; selectedPerson = owner.id; mode = 'check'; history.pushState({}, '', `${checkPath(bill.id)}?p=${ownerToken}`); save(); await connectRemote(bill, true); return
      } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось создать чек в Supabase'); return } finally { busy = false }
    }
    const owner: Participant = { id: crypto.randomUUID(), name: ownerName.trim(), paid: 0, status: 'unpaid' }
    bill = { id: crypto.randomUUID(), title: title.trim(), servicePercent: fee, participants: [owner], items: [], createdAt: new Date().toISOString(), ownerToken }
    isOwner = true; token = ownerToken; selectedPerson = owner.id; mode = 'check'; history.pushState({}, '', `${checkPath(bill.id)}?p=${ownerToken}`); save()
  }
  async function addItem() {
    if (!bill || !itemName.trim() || !itemPrice || itemPrice <= 0 || itemQty < 1) return
    if (bill.dbId) {
      busy = true
      try { await addRemoteItem(bill.dbId, itemName.trim(), Math.floor(itemQty), Math.floor(itemPrice), selectedPerson ?? ''); await refreshRemote(); itemName = ''; itemPrice = null; itemQty = 1; showAddItem = false }
      catch (error) { notify(error instanceof Error ? error.message : 'Не удалось добавить позицию') } finally { busy = false }
      return
    }
    const item: BillItem = { id: crypto.randomUUID(), name: itemName.trim(), quantity: Math.floor(itemQty), unitPrice: Math.floor(itemPrice), unitSelections: {} }
    bill = invalidatePayments({ ...bill, items: [...bill.items, item] }); save(); itemName = ''; itemPrice = null; itemQty = 1; showAddItem = false
  }
  async function removeItem(item: BillItem) {
    if (!bill || !isOwner || !window.confirm(`Удалить позицию «${item.name}»?`)) return
    if (bill.dbId) {
      try { await deleteRemoteItem(bill.dbId, item.id); await refreshRemote() }
      catch (error) { notify(error instanceof Error ? error.message : 'Не удалось удалить позицию') }
      return
    }
    bill = invalidatePayments({ ...bill, items: bill.items.filter(entry => entry.id !== item.id), comments: bill.comments?.filter(comment => comment.itemId !== item.id) })
    save()
  }
  function choosePerson(id: string) { selectedPerson = id; localStorage.setItem(`billsplit:person:${bill?.id}`, id) }
  async function toggleUnit(item: BillItem, unit: number) {
    if (!bill || !selectedPerson) return
    if (bill.dbId) { const unitId = item.unitIds?.[unit]; if (!unitId) return; const enabled = !(item.unitSelections[String(unit)] ?? []).includes(selectedPerson); void updateRemoteActivity(`${enabled ? 'Выбирает' : 'Убирает'} ${item.name}`); try { await toggleRemoteUnit(unitId, enabled); await refreshRemote() } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось обновить позицию') }; return }
    const unitKey = String(unit)
    const current = item.unitSelections[unitKey] ?? []
    const next = { ...item, unitSelections: { ...item.unitSelections, [unitKey]: current.includes(selectedPerson) ? current.filter(id => id !== selectedPerson) : [...current, selectedPerson] } }
    bill = invalidatePayments({ ...bill, items: bill.items.map(i => i.id === item.id ? next : i) }); save()
  }
  function publicLink() { return `${location.origin}${checkPath(bill!.id)}` }
  function openCustomUnit(item: BillItem, unit: number) {
    const key=String(unit); editingUnit=`${item.id}:${key}`
    const prior=item.unitCustomAmounts?.[key]
    if (prior) customAmounts={...prior}
    else {
      const consumers=item.unitSelections[key] ?? []
      const weights=bill!.participants.map(person => consumers.length ? (consumers.includes(person.id) ? 1 : 0) : 1)
      const shares=splitInteger(item.unitPrice,weights)
      customAmounts=Object.fromEntries(bill!.participants.map((person,index)=>[person.id,shares[index]]))
    }
  }
  async function saveCustomUnit(item: BillItem, unit: number) {
    const key=String(unit), total=bill!.participants.reduce((sum,person)=>sum+Math.max(0,Math.floor(Number(customAmounts[person.id]??0))),0)
    if (total !== item.unitPrice) { notify(`Доли должны составить ${formatUzs(item.unitPrice)}`); return }
    const amounts=Object.fromEntries(bill!.participants.map(person=>[person.id,Math.max(0,Math.floor(Number(customAmounts[person.id]??0)))]))
    if (bill!.dbId) { try { await setRemoteCustomShares(item.unitIds?.[unit] ?? '',amounts); await refreshRemote(); editingUnit=''; return } catch(error) { notify(error instanceof Error ? error.message : 'Не удалось сохранить доли'); return } }
    const selections={...item.unitSelections,[key]:bill!.participants.filter(person=>amounts[person.id]>0).map(person=>person.id)}
    const next={...item,unitSelections:selections,unitModes:{...item.unitModes,[key]:'custom' as const},unitCustomAmounts:{...item.unitCustomAmounts,[key]:amounts}}
    bill=invalidatePayments({...bill!,items:bill!.items.map(entry=>entry.id===item.id?next:entry)}); save(); editingUnit=''
  }
  // Mirrors resplit_unit_equally: a custom unit becomes an equal split among everyone with a non-zero share.
  function withoutCustomSplit(item: BillItem, key: string, removedId?: string): BillItem {
    const amounts=item.unitCustomAmounts?.[key] ?? {}
    const unitModes={...item.unitModes}, unitCustomAmounts={...item.unitCustomAmounts}
    delete unitModes[key]; delete unitCustomAmounts[key]
    return {...item,unitModes,unitCustomAmounts,unitSelections:{...item.unitSelections,[key]:Object.keys(amounts).filter(id=>id!==removedId && amounts[id]>0)}}
  }
  async function resetCustomUnit(item: BillItem, unit: number) {
    if (!bill || !isOwner || !window.confirm('Сбросить ручное распределение? Позиция снова разделится поровну.')) return
    if (bill.dbId) { try { await resetRemoteCustomShares(item.unitIds?.[unit] ?? ''); await refreshRemote(); editingUnit='' } catch(error) { notify(error instanceof Error ? error.message : 'Не удалось сбросить доли') }; return }
    const next=withoutCustomSplit(item,String(unit))
    bill=invalidatePayments({...bill,items:bill.items.map(entry=>entry.id===item.id?next:entry)}); save(); editingUnit=''
  }
  async function copy(text: string) { await navigator.clipboard.writeText(text); notify(bill?.dbId ? 'Ссылка скопирована — гости могут открыть чек' : 'Демо-ссылка скопирована · доступна только в этом браузере') }
  function openCheck(id: string, owner = false) {
    const found = bills.find(b => b.id === id); if (!found) return
    bill = found; isOwner = owner && Boolean(found.ownerToken); token = isOwner ? found.ownerToken : ''; selectedPerson = localStorage.getItem(`billsplit:person:${id}`); mode = 'check'; history.pushState({}, '', `${checkPath(id)}${isOwner ? `?p=${found.ownerToken}` : ''}`); if (found.dbId) void connectRemote(found, isOwner)
  }
  async function submitPayment(personId: string) {
    if (!bill) return
    const personDue = calculateTotals(bill).find(t => t.id === personId)?.due ?? 0
    if (Number(paidInput) >= personDue && !proofInput.trim()) { notify('Добавьте ссылку на подтверждение полной оплаты'); return }
    if (bill.dbId) { try { await submitRemotePayment(bill.dbId, Math.floor(Number(paidInput)), proofInput.trim() || null); await refreshRemote(); showPayment = null; return } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось отправить оплату'); return } }
    bill = { ...bill, participants: bill.participants.map(p => p.id !== personId ? p : { ...p, paid: Math.min(calculateTotals(bill!).find(t => t.id === personId)?.due ?? 0, Math.max(0, Math.floor(Number(paidInput)))), proofUrl: proofInput.trim() || undefined, status: proofInput.trim() ? 'proof_submitted' : (paidInput > 0 ? 'partially_paid' : 'unpaid') }) }
    save(); showPayment = null; notify('Оплата обновлена')
  }
  async function approve(personId: string) {
    if (!bill || !isOwner) return
    if (bill.dbId) { try { await confirmRemotePayment(bill.dbId, personId); await refreshRemote(); return } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось подтвердить оплату'); return } }
    const personTotal = totals.find(t => t.id === personId)
    bill = { ...bill, participants: bill.participants.map(p => p.id === personId ? { ...p, paid: personTotal?.due ?? p.paid, status: 'paid' } : p) }; save(); notify('Оплата подтверждена')
  }
  async function addComment() {
    if (!bill || !selectedPerson || !commentText.trim()) return
    const body=commentText.trim()
    if (bill.dbId) { try { await addRemoteComment(bill.dbId,null,body); commentText=''; await refreshRemote() } catch(error) { notify(error instanceof Error ? error.message : 'Не удалось отправить комментарий') }; return }
    const comment={id:crypto.randomUUID(),participantId:selectedPerson,body,createdAt:new Date().toISOString()}
    bill={...bill,comments:[...(bill.comments ?? []),comment]}; commentText=''; save()
  }
  function summaryText() {
    if (!bill) return ''
    return [`${bill.title}`, `Всего: ${formatUzs(grandTotal(bill))}`, '', ...totals.map(person => `${person.name}: ${formatUzs(person.due)} · оплачено ${formatUzs(person.paid)} · осталось ${formatUzs(person.remaining)}`)].join('\n')
  }
  function exportSummary() {
    if (!bill) return
    const file = new Blob([summaryText()], { type: 'text/plain;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(file); link.download = `${bill.title}.txt`; link.click(); URL.revokeObjectURL(link.href)
  }
  async function copySummary() { await navigator.clipboard.writeText(summaryText()); notify('Итог скопирован') }
  function exportPdf() { window.print() }
  function exportImage() {
    if (!bill) return
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 340 + totals.length * 78
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#f6f5f1'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle = '#313a2b'; ctx.fillRect(56,56,888,canvas.height-112)
    ctx.fillStyle = '#d7ef73'; ctx.font = '700 20px Arial'; ctx.fillText('РЯДОМ  ·  ОБЩИЙ ЧЕК', 96,112)
    ctx.fillStyle = '#fffefa'; ctx.font = '48px Georgia'; ctx.fillText(bill.title.slice(0,36),96,180)
    ctx.fillStyle = '#bdc5ac'; ctx.font = '18px Arial'; ctx.fillText(`ОБЩИЙ ИТОГ  ${formatUzs(grandTotal(bill))}`,96,226)
    totals.forEach((person,index) => { const y=292+index*78; ctx.fillStyle='#eef0e5'; ctx.font='600 21px Arial'; ctx.fillText(person.name,96,y); ctx.fillStyle='#ffffff'; ctx.textAlign='right'; ctx.fillText(formatUzs(person.due),902,y); ctx.textAlign='left'; ctx.fillStyle='#bfc7b1'; ctx.font='15px Arial'; ctx.fillText(`оплачено ${formatUzs(person.paid)} · осталось ${formatUzs(person.remaining)}`,96,y+26) })
    canvas.toBlob(blob => { if (!blob) return; const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`${bill!.title}.png`; link.click(); URL.revokeObjectURL(link.href) },'image/png')
  }
  async function removeBill() {
    if (!bill || !isOwner || !window.confirm(`Удалить чек «${bill.title}» для всех участников? Это действие нельзя отменить.`)) return
    if (bill.dbId) { try { await deleteRemoteCheck(bill.dbId); await announceRemoteChange() } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось удалить чек'); return } }
    forgetBill('Чек удалён')
  }
  async function removeParticipant(person: Participant) {
    if (!bill || !isOwner || person.id === bill.participants[0]?.id || !window.confirm(`Убрать ${person.name} из чека? Отметки, оплата и комментарии участника будут удалены.`)) return
    if (bill.dbId) {
      try { await removeRemoteParticipant(bill.dbId, person.id); await announceRemoteChange(); await refreshRemote() }
      catch (error) { notify(error instanceof Error ? error.message : 'Не удалось удалить участника') }
      return
    }
    const items = bill.items.map(item => {
      let next: BillItem = { ...item, unitSelections: Object.fromEntries(Object.entries(item.unitSelections).map(([key, ids]) => [key, ids.filter(id => id !== person.id)])) }
      // A custom split no longer adds up without this person, so the unit falls back to an equal split among the rest.
      for (const [key, amounts] of Object.entries(item.unitCustomAmounts ?? {})) {
        if (item.unitModes?.[key] === 'custom' && amounts[person.id] > 0) next = withoutCustomSplit(next, key, person.id)
      }
      return next
    })
    bill = invalidatePayments({ ...bill, participants: bill.participants.filter(p => p.id !== person.id), items, comments: bill.comments?.filter(comment => comment.participantId !== person.id) })
    if (selectedPerson === person.id) { selectedPerson = null; localStorage.removeItem(`billsplit:person:${bill.id}`) }
    save()
  }
  async function deleteComment(comment: CommentMessage) {
    if (!bill || comment.participantId !== selectedPerson || !window.confirm('Удалить комментарий?')) return
    if (bill.dbId) {
      try { await deleteRemoteComment(comment.id); await announceRemoteChange(); await refreshRemote() }
      catch (error) { notify(error instanceof Error ? error.message : 'Не удалось удалить комментарий') }
      return
    }
    bill = { ...bill, comments: bill.comments?.filter(entry => entry.id !== comment.id) }; save()
  }
</script>

<svelte:head>
  <title>{bill && mode === 'check' ? `${bill.title} · Рядом` : 'Рядом — разделите счёт легко'}</title>
  <meta name="description" content="Удобно разделите ресторанный счёт с друзьями" />
</svelte:head>

<svelte:window onkeydown={closeOverlays} />

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href={homePath()} onclick={(e) => { e.preventDefault(); goHome() }}><span class="brand-mark">р</span>рядом</a>
    <div class="top-actions">
      <span class="sync-pill" class:sync-live={bill?.dbId && mode === 'check'}><i></i>{bill?.dbId && mode === 'check' ? 'Онлайн' : 'На устройстве'}</span>
      <div class="theme-switch" role="radiogroup" aria-label="Тема оформления">
        {#each themes as option}
          <button role="radio" aria-checked={theme === option.value} aria-label={option.label} title={option.label} class:active={theme === option.value} onclick={() => setTheme(option.value)}>{option.icon}</button>
        {/each}
      </div>
    </div>
  </header>

  {#if mode === 'home'}
    <main class="home-page">
      <section class="hero">
        <div class="hero-copy">
          <div class="eyebrow"><span class="accent-star">✳</span> Друзья. Ужин. Без сложных подсчётов.</div>
          <h1>Счёт на всех.<br /><span>Дружба цела.</span></h1>
          <p>Создайте чек, поделитесь ссылкой — и пусть каждый отметит своё. Остальное мы посчитаем.</p>
          <button class="primary-button" onclick={beginCreate}>Создать новый чек <span aria-hidden="true">↗</span></button>
          <div class="hero-note"><span class="note-avatars" aria-hidden="true"><b>J</b><b>A</b><b>B</b></span>Понятно каждому за пару секунд</div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="receipt-card">
            <div class="receipt-top"><span>РАЗДЕЛЯЕМ ВМЕСТЕ</span><span>✳</span></div>
            <div class="receipt-title">Вечер<br />с друзьями</div>
            <div class="receipt-row"><span>Пицца маргарита</span><b>84 000</b></div>
            <div class="receipt-row"><span>Лимонад × 3</span><b>45 000</b></div>
            <div class="receipt-row"><span>Хлеб на всех</span><b>20 000</b></div>
            <div class="receipt-line"></div>
            <div class="receipt-total"><span>Итого</span><b>149 000 <small>сум</small></b></div>
            <div class="receipt-footer"><span class="mini-dots"><i></i><i></i><i></i></span> уже делят 4 человека</div>
          </div>
          <div class="floating-tag tag-split">🥖 хлеб на всех <b>÷ 4</b></div>
          <div class="floating-tag tag-done">✓ Всё сходится!</div>
        </div>
      </section>

      {#if bills.length}
        <section class="recent">
          <div class="section-row"><h2>Ваши чеки</h2><span class="muted">{plural(bills.length, 'чек', 'чека', 'чеков')}</span></div>
          <div class="saved-list">
            {#each bills as saved}
              <button class="saved-card" onclick={() => openCheck(saved.id, true)}>
                <span class="saved-icon" aria-hidden="true">🧾</span>
                <span class="saved-text"><b>{saved.title}</b><small>{plural(saved.participants.length, 'участник', 'участника', 'участников')} · {plural(saved.items.length, 'позиция', 'позиции', 'позиций')}</small></span>
                <span class="saved-total">{formatUzs(grandTotal(saved))}</span>
                <span class="saved-arrow" aria-hidden="true">→</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      <section class="how-section">
        <div class="section-heading"><div class="eyebrow">Всё просто</div><h2>Четыре шага — и можно заказывать десерт</h2></div>
        <div class="steps-grid">
          <article><span class="step-no">01</span><div class="step-icon">🧾</div><h3>Создайте чек</h3><p>Добавьте позиции и стоимость — это займёт минуту.</p></article>
          <article><span class="step-no">02</span><div class="step-icon">🔗</div><h3>Поделитесь ссылкой</h3><p>Отправьте друзьям. Регистрация никому не нужна.</p></article>
          <article><span class="step-no">03</span><div class="step-icon">✅</div><h3>Каждый отмечает своё</h3><p>Гости выбирают блюда, которые заказали или делили.</p></article>
          <article><span class="step-no">04</span><div class="step-icon">💸</div><h3>Оплатите спокойно</h3><p>Видно, кто сколько должен и что уже оплачено.</p></article>
        </div>
      </section>

      <section class="bottom-cta">
        <div><div class="eyebrow">Хороший вечер начинается здесь</div><h2>Первый чек — за вами</h2></div>
        <button class="primary-button" onclick={beginCreate}>Создать чек <span aria-hidden="true">↗</span></button>
      </section>
    </main>

  {:else if mode === 'create'}
    <main class="form-page">
      <button class="back-link" onclick={() => mode = 'home'}>← Назад</button>
      <form class="panel form-card" onsubmit={(e) => { e.preventDefault(); void createBill() }}>
        <div class="eyebrow">Новый чек</div>
        <h1>Начнём с названия</h1>
        <p class="lead">Ресторан, повод или просто «Ужин в пятницу».</p>
        <label class="field">Как назовём чек?<input bind:value={title} placeholder="Например, Ужин у Тимура" maxlength="60" required /></label>
        <label class="field">Ваше имя<input bind:value={ownerName} placeholder="Как к вам обращаться?" maxlength="32" autocomplete="given-name" required /></label>
        <label class="field"><span>Обслуживание <span class="label-hint">если есть в счёте</span></span>
          <span class="suffix-input"><input type="number" bind:value={fee} min="0" max="100" inputmode="decimal" /><span>%</span></span>
        </label>
        <div class="chip-row" role="group" aria-label="Быстрый выбор процента">
          {#each [0, 10, 12, 15] as preset}<button type="button" class="chip" class:active={fee === preset} onclick={() => fee = preset}>{preset}%</button>{/each}
        </div>
        <button class="primary-button wide" disabled={busy || !title.trim() || !ownerName.trim()}>{busy ? 'Создаём…' : 'Создать чек'} <span aria-hidden="true">↗</span></button>
        <div class="privacy-note">🔒 Без регистрации. Чек доступен только по ссылке.</div>
      </form>
    </main>

  {:else if mode === 'join'}
    <main class="form-page">
      <button class="back-link" onclick={goHome}>← На главную</button>
      <form class="panel form-card" onsubmit={(e) => { e.preventDefault(); void joinSharedCheck() }}>
        <div class="eyebrow">Приглашение в чек</div>
        <h1>{token ? 'Войти как создатель' : 'Кто за этим столом?'}</h1>
        <p class="lead">{token ? 'Подтвердим секретную ссылку владельца. Введите своё имя, чтобы восстановить участника.' : 'Введите имя, под которым вас увидят друзья.'}</p>
        <label class="field">{token ? 'Ваше имя в чеке' : 'Ваше имя'}<input bind:value={joinName} placeholder="Например, Aziz" maxlength="48" autocomplete="given-name" required /></label>
        {#if errorMessage}<div class="form-error" role="alert">{errorMessage}</div>{/if}
        <button class="primary-button wide" disabled={busy || !joinName.trim()}>{busy ? 'Подключаемся…' : token ? 'Открыть чек' : 'Присоединиться'} <span aria-hidden="true">↗</span></button>
        <div class="privacy-note">🔒 Вход без пароля и регистрации.</div>
      </form>
    </main>

  {:else if bill}
    <main class="check-page">
      <div class="check-header">
        <div>
          <button class="back-link" onclick={goHome}>← Все чеки</button>
          <div class="eyebrow check-kicker">Совместный чек <span class="live-dot" class:offline={!bill.dbId}></span> {bill.dbId ? 'обновляется в реальном времени' : 'хранится на этом устройстве'}</div>
          <h1>{bill.title}</h1>
          <p class="muted">Создан {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(bill.createdAt))} · {plural(bill.participants.length, 'участник', 'участника', 'участников')} · {formatUzs(grandTotal(bill))}</p>
        </div>
      </div>

      <div class="panel share-banner">
        <div class="share-symbol" aria-hidden="true">🔗</div>
        <div class="share-text"><b>{bill.dbId ? 'Пригласите остальных за стол' : 'Демо-режим'}</b><span>{bill.dbId ? 'Отправьте ссылку — гости сами присоединятся по имени.' : 'Чек хранится только в этом браузере.'}</span></div>
        <button class="soft-button" onclick={() => copy(publicLink())}>Скопировать ссылку</button>
      </div>

      <section class="people-strip" aria-label="Участники">
        <div class="section-row small"><span class="eyebrow">За столом</span>{#if bill.dbId}<span class="online-count"><i></i>{onlineUsers.length || 1} онлайн</span>{/if}</div>
        <div class="people-row">
          {#each bill.participants as person, i}
            <span class="person-entry">
              <button class="person-chip" class:active={selectedPerson === person.id} aria-pressed={selectedPerson === person.id} disabled={Boolean(bill.dbId && selectedPerson !== person.id)} onclick={() => choosePerson(person.id)}>
                <span class="person-avatar tone-{i % 5}">{initial(person.name)}</span>{person.name}{selectedPerson === person.id ? ' · вы' : ''}
              </button>
              {#if isOwner && i > 0}<button class="remove-person" aria-label={`Убрать ${person.name} из чека`} title="Убрать из чека" onclick={() => void removeParticipant(person)}>×</button>{/if}
            </span>
          {/each}
        </div>
        {#if onlineUsers.length > 1}<div class="presence-feed">{#each onlineUsers.slice(0, 4) as user}<span><i></i>{user.name} · {user.activity}</span>{/each}</div>{/if}
        {#if !selectedPerson}<p class="hint">Нажмите на своё имя, чтобы отмечать блюда.</p>{/if}
      </section>

      {#if !bill.items.length}
        <section class="panel empty-items">
          <div class="empty-illustration" aria-hidden="true">🍽️</div>
          <h2>Стол пока пустой</h2>
          <p>{isOwner ? 'Добавьте позиции из чека — друзья сами отметят, что заказывали.' : 'Создатель чека ещё не добавил позиции.'}</p>
          {#if isOwner}<button class="primary-button" onclick={() => showAddItem = true}>＋ Добавить первую позицию</button>{/if}
        </section>
      {:else}
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected={activeTab === 'order'} class:active={activeTab === 'order'} onclick={() => activeTab = 'order'}>Позиции <span class="count">{bill.items.length}</span></button>
          <button role="tab" aria-selected={activeTab === 'summary'} class:active={activeTab === 'summary'} onclick={() => activeTab = 'summary'}>Итоги и оплата</button>
        </div>

        {#if unassignedTotal > 0}
          <div class="notice warning"><span aria-hidden="true">◌</span><div><b>{formatUzs(unassignedTotal)} ещё не распределено</b><small>{activeTab === 'order' ? 'Отметьте, кто ел оставшиеся позиции, чтобы итог сошёлся с чеком.' : 'Распределите все позиции, прежде чем закрывать чек.'}</small></div></div>
        {/if}

        {#if activeTab === 'order'}
          <section class="items-section">
            <div class="section-row">
              <div><h2>Что вы заказали?</h2><p class="muted">Нажмите «Это моё» — сумма посчитается сама</p></div>
              {#if isOwner}<button class="soft-button" onclick={() => showAddItem = true}>＋ Позиция</button>{/if}
            </div>
            <div class="item-list">
              {#each bill.items as item}
                <article class="panel item-card">
                  <div class="item-head">
                    <div class="item-icon" aria-hidden="true">{itemIcon(item.name)}</div>
                    <div class="item-title">
                      <b>{item.name}</b>
                      <span class="muted">{formatUzs(item.unitPrice)}{item.quantity > 1 ? ` × ${item.quantity} = ${formatUzs(item.unitPrice * item.quantity)}` : ''}</span>
                    </div>
                    {#if isOwner}<button class="icon-button danger" aria-label={`Удалить позицию «${item.name}»`} title="Удалить позицию" onclick={() => void removeItem(item)}>🗑</button>{/if}
                  </div>
                  <div class="unit-list">
                    {#each Array.from({ length: item.quantity }, (_, unit) => unit) as unit}
                      {@const key = String(unit)}
                      {@const custom = item.unitModes?.[key] === 'custom'}
                      {@const consumers = unitConsumers(item, unit)}
                      {@const mine = Boolean(selectedPerson && consumers.some(person => person.id === selectedPerson))}
                      <div class="unit-row" class:unit-mine={mine}>
                        {#if item.quantity > 1}<span class="unit-label">№{unit + 1}</span>{/if}
                        <div class="unit-consumers">
                          {#each consumers as person}
                            <span class="consumer-pill"><span class="person-avatar mini tone-{personIndex(person.id) % 5}">{initial(person.name)}</span>{person.name}{custom ? ` · ${formatUzs(item.unitCustomAmounts?.[key]?.[person.id] ?? 0)}` : ''}</span>
                          {:else}
                            <span class="unit-empty">Пока никто не отметил</span>
                          {/each}
                          {#if !custom && consumers.length > 1}<span class="unit-note">по {item.unitPrice % consumers.length ? '~' : ''}{formatUzs(Math.round(item.unitPrice / consumers.length))}</span>{/if}
                        </div>
                        <div class="unit-actions">
                          {#if custom}
                            <span class="unit-note">Доли вручную</span>
                          {:else if selectedPerson}
                            <button class="mine-toggle" class:active={mine} aria-pressed={mine} onclick={() => toggleUnit(item, unit)}>{mine ? '✓ Моё' : 'Это моё'}</button>
                          {/if}
                          {#if isOwner}<button class="ghost-button" onclick={() => editingUnit === `${item.id}:${key}` ? editingUnit = '' : openCustomUnit(item, unit)}>Доли</button>{/if}
                        </div>
                      </div>
                      {#if editingUnit === `${item.id}:${key}`}
                        <div class="custom-share-editor">
                          <div class="editor-head"><b>Распределить {formatUzs(item.unitPrice)}</b><span class="muted">Введите сумму для каждого</span></div>
                          {#each bill.participants as person}
                            <label class="editor-row"><span>{person.name}</span><span class="suffix-input compact"><input type="number" min="0" step="1" inputmode="numeric" bind:value={customAmounts[person.id]} /><span>сум</span></span></label>
                          {/each}
                          <div class="editor-status" class:ok={customTotal === item.unitPrice}>
                            {customTotal === item.unitPrice ? '✓ Сумма сходится' : customTotal < item.unitPrice ? `Осталось распределить ${formatUzs(item.unitPrice - customTotal)}` : `Лишние ${formatUzs(customTotal - item.unitPrice)}`}
                          </div>
                          <div class="editor-actions">
                            <button type="button" class="ghost-button" onclick={() => customAmounts = Object.fromEntries(bill!.participants.map(person => [person.id, 0]))}>Очистить</button>
                            {#if custom}<button type="button" class="ghost-button danger" onclick={() => void resetCustomUnit(item, unit)}>Сбросить разделение</button>{/if}
                            <span class="spacer"></span>
                            <button type="button" class="soft-button" onclick={() => editingUnit = ''}>Отмена</button>
                            <button type="button" class="accent-button" disabled={customTotal !== item.unitPrice} onclick={() => void saveCustomUnit(item, unit)}>Сохранить</button>
                          </div>
                        </div>
                      {/if}
                    {/each}
                  </div>
                </article>
              {/each}
            </div>
            {#if isOwner}<button class="add-more" onclick={() => showAddItem = true}>＋ Добавить ещё позицию</button>{/if}
          </section>
        {:else}
          <section class="summary-section">
            <div class="panel summary-card">
              <div class="summary-title"><div><span class="eyebrow">Кто сколько должен</span><h2>Итоги</h2></div><div class="summary-grand"><small>Общий счёт</small><b>{formatUzs(grandTotal(bill))}</b></div></div>
              {#each totals as person}
                <div class="summary-person" class:is-me={selectedPerson === person.id}>
                  <span class="person-avatar tone-{personIndex(person.id) % 5}">{initial(person.name)}</span>
                  <div class="summary-person-name">
                    <b>{person.name}{selectedPerson === person.id ? ' (вы)' : ''}</b>
                    <small>Блюда {formatUzs(person.subtotal)}{bill.servicePercent ? ` · сервис ${formatUzs(person.service)}` : ''}</small>
                  </div>
                  <div class="summary-person-total">
                    <b>{formatUzs(person.due)}</b>
                    <span class="status-badge status-{person.status}">{statusLabels[person.status]}</span>
                    {#if person.paid > 0 && person.remaining > 0}<small>осталось {formatUzs(person.remaining)}</small>{/if}
                  </div>
                  {#if isOwner && person.status === 'proof_submitted'}
                    <div class="summary-actions">
                      <a class="ghost-button" href={bill.participants.find(p => p.id === person.id)?.proofUrl} target="_blank" rel="noreferrer">Открыть подтверждение ↗</a>
                      <button class="accent-button" disabled={person.paid < person.due} title={person.paid < person.due ? 'Внесена не вся сумма' : 'Подтвердить оплату'} onclick={() => approve(person.id)}>Подтвердить оплату</button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>

            <div class="panel progress-card">
              <div class="section-row small"><span class="eyebrow">Уже оплачено</span><b>{formatUzs(paidAll)} <small class="muted">из {formatUzs(grandTotal(bill))}</small></b></div>
              <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(grandTotal(bill) ? paidAll / grandTotal(bill) * 100 : 0)}><i style={`width:${Math.min(100, grandTotal(bill) ? paidAll / grandTotal(bill) * 100 : 0)}%`}></i></div>
            </div>

            {#if currentParticipant}
              <button class="primary-button wide" onclick={() => { showPayment = currentParticipant.id; paidInput = currentParticipant.paid; proofInput = currentParticipant.proofUrl ?? '' }}>{currentParticipant.status === 'unpaid' ? 'Отметить оплату' : 'Изменить оплату'} <span aria-hidden="true">↗</span></button>
            {/if}

            <div class="panel export-card" class:all-paid={allConfirmed}>
              <div class="export-text">
                {#if allConfirmed}<span class="done-mark" aria-hidden="true">✓</span>{/if}
                <div><b>{allConfirmed ? 'Все оплаты подтверждены' : 'Поделиться итогом'}</b><small class="muted">{allConfirmed ? 'Можно сохранить итог встречи.' : 'Отправьте сводку в чат друзьям.'}</small></div>
              </div>
              <div class="chip-row">
                <button class="chip" onclick={copySummary}>Копировать</button>
                <button class="chip" onclick={exportImage}>Картинка</button>
                <button class="chip" onclick={exportPdf}>PDF</button>
                <button class="chip" onclick={exportSummary}>Текст</button>
              </div>
            </div>
          </section>
        {/if}
      {/if}

      <section class="panel comments-card">
        <div class="section-row"><div><div class="eyebrow">Комментарии</div><h2>Общий разговор</h2></div><span class="muted">{(bill.comments ?? []).length || ''}</span></div>
        <div class="comment-list">
          {#each (bill.comments ?? []) as comment}
            <article class:own={comment.participantId === selectedPerson}>
              <span class="person-avatar tone-{personIndex(comment.participantId) % 5}">{initial(personName(comment.participantId))}</span>
              <div class="comment-body">
                <div class="comment-meta"><b>{personName(comment.participantId)}</b><time datetime={comment.createdAt}>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(comment.createdAt))}</time></div>
                <p>{comment.body}</p>
              </div>
              {#if selectedPerson && comment.participantId === selectedPerson}<button class="icon-button small danger" aria-label="Удалить комментарий" title="Удалить комментарий" onclick={() => void deleteComment(comment)}>×</button>{/if}
            </article>
          {:else}
            <p class="no-comments">Комментариев пока нет — напишите первым.</p>
          {/each}
        </div>
        <form class="comment-form" onsubmit={(e) => { e.preventDefault(); void addComment() }}>
          <textarea bind:value={commentText} maxlength="1000" rows="1" placeholder={selectedPerson ? 'Напишите сообщение… (Enter — отправить)' : 'Выберите себя, чтобы писать'} disabled={!selectedPerson} onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void addComment() } }}></textarea>
          <button class="accent-button" disabled={!commentText.trim() || !selectedPerson} aria-label="Отправить">↑</button>
        </form>
      </section>

      {#if isOwner}
        <section class="danger-zone">
          <div><b>Удалить чек</b><small class="muted">Чек исчезнет у всех участников. Отменить нельзя.</small></div>
          <button class="danger-button" onclick={() => void removeBill()}>Удалить чек</button>
        </section>
      {/if}

      {#if bill.items.length && currentParticipant}
        <div class="sticky-total">
          <div><small>Ваш итог</small><b>{formatUzs(currentTotal?.due ?? 0)}</b></div>
          <button class="accent-button" onclick={() => { activeTab = activeTab === 'order' ? 'summary' : 'order'; window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{activeTab === 'order' ? 'Итоги и оплата →' : '← К позициям'}</button>
        </div>
      {/if}
      <footer class="check-footer">Сделано с заботой о дружбе <span>♡</span></footer>
    </main>
  {/if}

  {#if showAddItem}
    <div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showAddItem = false }}>
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-item-title"><form class="modal-form" onsubmit={(e) => { e.preventDefault(); void addItem() }}>
        <button type="button" class="modal-close" aria-label="Закрыть" onclick={() => showAddItem = false}>×</button>
        <div class="eyebrow">Новая позиция</div>
        <h2 id="add-item-title">Что было на столе?</h2>
        <!-- svelte-ignore a11y_autofocus -->
        <label class="field">Название<input bind:value={itemName} placeholder="Например, Пицца пепперони" maxlength="48" autofocus /></label>
        <div class="modal-fields">
          <label class="field">Количество
            <span class="stepper">
              <button type="button" aria-label="Меньше" disabled={itemQty <= 1} onclick={() => itemQty = Math.max(1, itemQty - 1)}>−</button>
              <input type="number" bind:value={itemQty} min="1" max="99" step="1" inputmode="numeric" />
              <button type="button" aria-label="Больше" disabled={itemQty >= 99} onclick={() => itemQty = Math.min(99, itemQty + 1)}>+</button>
            </span>
          </label>
          <label class="field">Цена за штуку<span class="suffix-input"><input type="number" bind:value={itemPrice} min="1" step="1" inputmode="numeric" placeholder="0" /><span>сум</span></span></label>
        </div>
        <div class="modal-total">Сумма позиции <b>{formatUzs(Math.max(0, itemQty * (itemPrice ?? 0)))}</b></div>
        <button class="primary-button wide" disabled={busy || !itemName.trim() || !itemPrice || itemPrice <= 0}>Добавить позицию <span aria-hidden="true">＋</span></button>
      </form></div>
    </div>
  {/if}

  {#if showPayment && bill}
    {@const due = totals.find(t => t.id === showPayment)?.due ?? 0}
    <div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showPayment = null }}>
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="payment-title"><form class="modal-form" onsubmit={(e) => { e.preventDefault(); void submitPayment(showPayment!) }}>
        <button type="button" class="modal-close" aria-label="Закрыть" onclick={() => showPayment = null}>×</button>
        <div class="eyebrow">Ваш платёж</div>
        <h2 id="payment-title">Сколько уже оплатили?</h2>
        <p class="lead">К оплате <b>{formatUzs(due)}</b>. Создатель чека подтвердит оплату вручную.</p>
        <label class="field">Сумма
          <span class="suffix-input"><input type="number" bind:value={paidInput} min="0" max={due} step="1000" inputmode="numeric" /><span>сум</span></span>
        </label>
        <div class="chip-row"><button type="button" class="chip" class:active={Number(paidInput) === due} onclick={() => paidInput = due}>Вся сумма</button><button type="button" class="chip" onclick={() => paidInput = 0}>Сбросить</button></div>
        <label class="field"><span>Ссылка на чек или подтверждение <span class="label-hint">{Number(paidInput) >= due ? 'обязательно' : 'по желанию'}</span></span><input type="url" bind:value={proofInput} required={Number(paidInput) >= due} placeholder="https://…" /></label>
        <button class="primary-button wide">Отправить создателю <span aria-hidden="true">↗</span></button>
      </form></div>
    </div>
  {/if}

  {#if toast}<div class="toast" role="status" aria-live="polite">{toast}</div>{/if}
</div>
