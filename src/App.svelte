<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { isSupabaseConfigured } from './lib/supabase'
  import { addRemoteItem, deleteRemoteItem, addRemoteComment, claimRemoteCheckOwner, confirmRemotePayment, createRemoteCheck, deleteRemoteCheck, ensureAnonymousSession, joinRemoteCheck, loadRemoteCheck, setRemoteCustomShares, submitRemotePayment, subscribeToRemoteCheck, toggleRemoteUnit, updateRemoteActivity } from './lib/remote'
  import { assignedSubtotal, calculateTotals, formatUzs, splitInteger, type Bill, type BillItem, type Participant } from './lib/calculations'
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
  let itemPrice = $state(0)
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
    restoreRoute()
    window.addEventListener('popstate',restoreRoute)
    return ()=>window.removeEventListener('popstate',restoreRoute)
  })

  onDestroy(() => remoteUnsubscribe?.())

  function invalidatePayments(value: Bill): Bill { return { ...value, participants: value.participants.map(person => ({ ...person, status: person.paid > 0 ? 'partially_paid' : 'unpaid', proofUrl: undefined })) } }
  function save() { if (bill) { bills = [bill, ...bills.filter(x => x.id !== bill!.id)]; localStorage.setItem('billsplit:v1', JSON.stringify(bills)) } }
  async function connectRemote(value: Bill, _owner = false) {
    if (!value.dbId) return
    try {
      await ensureAnonymousSession()
      remoteUnsubscribe?.()
      remoteUnsubscribe = subscribeToRemoteCheck(value.dbId, value.id, () => { void refreshRemote() }, users => onlineUsers = users, { name: value.participants.find(p => p.id === selectedPerson)?.name ?? 'Гость', activity: 'Просматривает чек' })
    } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось подключить realtime') }
  }
  async function refreshRemote() {
    if (!bill?.dbId) return
    try { const result = await loadRemoteCheck(bill.id); result.ownerToken = bill.ownerToken; bill = result; isOwner = isOwner || Boolean(token && token === result.ownerToken); save() }
    catch (error) { console.error('Remote refresh failed', error) }
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
    if (!bill || !itemName.trim() || itemPrice <= 0 || itemQty < 1) return
    if (bill.dbId) {
      busy = true
      try { await addRemoteItem(bill.dbId, itemName.trim(), Math.floor(itemQty), Math.floor(itemPrice), selectedPerson ?? ''); await refreshRemote(); itemName = ''; itemPrice = 0; itemQty = 1; showAddItem = false }
      catch (error) { notify(error instanceof Error ? error.message : 'Не удалось добавить позицию') } finally { busy = false }
      return
    }
    const item: BillItem = { id: crypto.randomUUID(), name: itemName.trim(), quantity: Math.floor(itemQty), unitPrice: Math.floor(itemPrice), unitSelections: {} }
    bill = invalidatePayments({ ...bill, items: [...bill.items, item] }); save(); itemName = ''; itemPrice = 0; itemQty = 1; showAddItem = false
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
    if (!bill || !isOwner) return
    if (bill.dbId) { try { await deleteRemoteCheck(bill.dbId) } catch (error) { notify(error instanceof Error ? error.message : 'Не удалось удалить чек'); return } }
    remoteUnsubscribe?.(); remoteUnsubscribe = null; bills = bills.filter(b => b.id !== bill!.id); localStorage.setItem('billsplit:v1', JSON.stringify(bills)); history.pushState({}, '', homePath()); bill = null; mode = 'home'; notify('Чек удалён из активных данных')
  }
</script>

<svelte:head>
  <title>Рядом — разделите счёт легко</title>
  <meta name="description" content="Удобно разделите ресторанный счёт с друзьями" />
  <meta name="theme-color" content="#f6f5f1" />
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" onclick={(e) => { e.preventDefault(); mode = 'home'; history.pushState({}, '', homePath()) }}><span class="brand-mark">р</span> рядом</a>
    <div class="top-actions"><span class="sync-pill"><i></i>{bill?.dbId ? 'Синхронизация' : 'Локальный режим'}</span><button class="avatar" aria-label="Профиль">{selectedPerson ? bill?.participants.find(p => p.id === selectedPerson)?.name.slice(0,1).toUpperCase() : '•'}</button></div>
  </header>

  {#if mode === 'home'}
    <main class="home-page">
      <section class="hero">
        <div class="hero-copy"><div class="eyebrow"><span>✳</span> ДРУЗЬЯ. УЖИН. БЕЗ СЛОЖНЫХ ПОДСЧЁТОВ.</div><h1>Счёт на всех.<br /><span>Дружба цела.</span></h1><p>Создайте чек, поделитесь ссылкой и пусть каждый отметит своё. Остальное мы посчитаем.</p><button class="primary-button" onclick={beginCreate}>Создать новый чек <span>↗</span></button><div class="hero-note"><span class="note-avatars"><b>J</b><b>A</b><b>B</b></span><span>Понятно каждому за пару секунд</span></div></div>
        <div class="hero-art"><div class="art-glow"></div><div class="receipt-card"><div class="receipt-top"><span>РАЗДЕЛЯЕМ ВМЕСТЕ</span><span>✳</span></div><div class="receipt-title">Вечер<br />с друзьями</div><div class="receipt-row"><span>Пицца маргарита</span><b>84 000</b></div><div class="receipt-row"><span>Лимонад × 3</span><b>45 000</b></div><div class="receipt-row"><span>Хлеб на всех</span><b>20 000</b></div><div class="receipt-line"></div><div class="receipt-total"><span>Итого</span><b>149 000 <small>сум</small></b></div><div class="receipt-footer"><span class="mini-dots"><i></i><i></i><i></i></span> уже делят 4 человека</div></div><div class="floating-tag tag-split"><span>🥖</span> хлеб на всех <b>÷ 4</b></div><div class="floating-tag tag-done">✓ Всё сходится!</div><div class="art-spark">✳</div></div>
      </section>
      <section class="how-section"><div class="section-heading"><div class="eyebrow">ВСЁ ПРОСТО</div><h2>Четыре шага.<br />И можно заказывать десерт.</h2></div><div class="steps-grid"><article><span class="step-no">01</span><div class="step-icon lilac">▤</div><h3>Создайте чек</h3><p>Добавьте позиции и стоимость — это займёт минуту.</p></article><article><span class="step-no">02</span><div class="step-icon peach">↗</div><h3>Поделитесь ссылкой</h3><p>Отправьте друзьям. Регистрация никому не нужна.</p></article><article><span class="step-no">03</span><div class="step-icon mint">✓</div><h3>Каждый отмечает своё</h3><p>Гости выбирают блюда, которые заказали или делили.</p></article><article><span class="step-no">04</span><div class="step-icon yellow">♡</div><h3>Оплатите спокойно</h3><p>Видно, кто сколько должен и что уже оплачено.</p></article></div></section>
      <section class="bottom-cta"><div><div class="eyebrow">ХОРОШИЙ ВЕЧЕР НАЧИНАЕТСЯ ЗДЕСЬ</div><h2>Первый чек — за вами</h2></div><button class="primary-button" onclick={beginCreate}>Создать чек <span>↗</span></button></section>
      {#if bills.length}<section class="recent"><div class="recent-head"><h2>Ваши чеки</h2><span>{bills.length} активных</span></div>{#each bills as saved}<button class="saved-card" onclick={() => openCheck(saved.id, true)}><span class="saved-icon">▤</span><span><b>{saved.title}</b><small>{saved.participants.length} участников · {saved.items.length} позиций</small></span><span class="saved-total">{formatUzs(grandTotal(saved))}</span><span>↗</span></button>{/each}</section>{/if}
    </main>
  {:else if mode === 'create'}
    <main class="form-page"><button class="back-link" onclick={() => mode = 'home'}>← Назад</button><div class="create-card"><div class="eyebrow">НОВЫЙ ЧЕК · ШАГ 1 ИЗ 1</div><h1>Начнём с названия</h1><p>Добавьте ресторан, повод или просто «Ужин в пятницу».</p><label>Как назовём чек?<input bind:value={title} placeholder="Например, Ужин у Тимура" maxlength="60" /></label><label>Ваше имя<input bind:value={ownerName} placeholder="Как к вам обращаться?" maxlength="32" /></label><label>Обслуживание <span class="label-hint">если есть</span><div class="fee-input"><input type="number" bind:value={fee} min="0" max="100" /><span>%</span><span class="fee-caption">Можно изменить позже</span></div></label><button class="primary-button wide" onclick={createBill} disabled={!title.trim() || !ownerName.trim()}>Создать чек <span>↗</span></button><div class="privacy-note">🔒 Без регистрации. Чек доступен только по ссылке.</div></div></main>
  {:else if mode === 'join'}
    <main class="form-page"><button class="back-link" onclick={() => { mode = 'home'; history.pushState({}, '', homePath()) }}>← На главную</button><form class="create-card" onsubmit={(e) => { e.preventDefault(); void joinSharedCheck() }}><div class="eyebrow">ПРИГЛАШЕНИЕ В ЧЕК</div><h1>{token ? 'Войти как создатель' : 'Кто за этим столом?'}</h1><p>{token ? 'Подтвердим секретную ссылку владельца. Введите своё имя, чтобы восстановить участника.' : 'Введите имя, под которым вас увидят друзья.'}</p><label>{token ? 'Ваше имя в чеке' : 'Ваше имя'}<input bind:value={joinName} placeholder="Например, Aziz" maxlength="48" required /></label>{#if errorMessage}<div class="form-error">{errorMessage}</div>{/if}<button class="primary-button wide" disabled={busy || !joinName.trim()}>{busy ? 'Подключаемся…' : token ? 'Открыть чек' : 'Присоединиться'} <span>↗</span></button><div class="privacy-note">🔒 Вход без пароля. Для общего доступа используется Supabase.</div></form></main>
  {:else if bill}
    <main class="check-page">
      <div class="check-header"><div><button class="back-link" onclick={() => { mode = 'home'; history.pushState({}, '', homePath()) }}>← Все чеки</button><div class="bill-kicker">СОВМЕСТНЫЙ ЧЕК <span class="live-dot"></span> {bill.dbId ? 'SUPABASE REALTIME' : 'НА ЭТОМ УСТРОЙСТВЕ'}</div><h1>{bill.title}</h1><p>Создан {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(bill.createdAt))} · {bill.participants.length} {bill.participants.length === 1 ? 'участник' : 'участника'}</p></div><button class="icon-button" onclick={() => copy(publicLink())} aria-label="Поделиться">↗</button></div>
      <div class="share-banner"><div class="share-symbol">↗</div><div><b>{bill.dbId ? 'Пригласите остальных за стол' : 'Поделитесь демо-ссылкой'}</b><span>{bill.dbId ? 'Добавьте участника, чтобы создать для него личную ссылку.' : 'Пока чек хранится только в этом браузере'}</span></div><button onclick={() => copy(publicLink())}>{bill.dbId ? 'Скопировать общую ссылку' : 'Скопировать демо-ссылку'}</button></div>
      {#if onlineUsers.length}<div class="presence-feed">{#each onlineUsers.slice(0,4) as user}<span><i></i>{user.name} · {user.activity}</span>{/each}</div>{/if}
      <div class="people-strip"><div class="people-heading"><span>ЗА СТОЛОМ</span><span class="online-count"><i></i>{onlineUsers.length || 1} онлайн</span></div><div class="people-row">{#each bill.participants as person, i}<button class:person-active={selectedPerson === person.id} class="person-chip" disabled={Boolean(bill.dbId && selectedPerson !== person.id)} onclick={() => choosePerson(person.id)}><span class="person-avatar tone-{i % 5}">{person.name.slice(0,1).toUpperCase()}</span><span>{person.name}{isOwner && person.id === bill?.participants[0]?.id ? ' · вы' : ''}</span>{selectedPerson === person.id ? '✓' : ''}</button>{/each}<small class="join-hint">Поделитесь общей ссылкой — гости сами присоединятся по имени.</small></div></div>
      {#if !bill.items.length}<section class="empty-items"><div class="empty-illustration">🍽️</div><h2>Стол пока пустой</h2><p>Добавьте позиции из чека — друзья сами отметят, что заказывали.</p>{#if isOwner}<button class="primary-button" onclick={() => showAddItem = true}>＋ Добавить первую позицию</button>{/if}</section>{:else}
      <div class="tab-row"><button class:tab-active={activeTab === 'order'} onclick={() => activeTab = 'order'}>Позиции <span>{bill.items.length}</span></button><button class:tab-active={activeTab === 'summary'} onclick={() => activeTab = 'summary'}>Итоги</button></div>
      {#if activeTab === 'order'}<section class="items-section">{#if unassignedTotal > 0}<div class="unassigned-banner"><span>◌</span><div><b>{formatUzs(unassignedTotal)} ещё не распределено</b><small>Выберите, кто делил оставшиеся позиции, чтобы итог сошёлся с чеком.</small></div></div>{/if}<div class="items-title"><div><h2>Что вы заказали?</h2><p>Отметьте своё — сумму рассчитаем автоматически</p></div>{#if isOwner}<button class="small-add" onclick={() => showAddItem = true}>＋ Позиция</button>{/if}</div><div class="item-list">{#each bill.items as item}<article class="item-card"><div class="item-icon">{item.name.toLowerCase().includes('cola') || item.name.toLowerCase().includes('drink') ? '🥤' : item.name.toLowerCase().includes('bread') ? '🥖' : item.name.toLowerCase().includes('cake') ? '🍰' : item.name.toLowerCase().includes('salad') ? '🥗' : item.name.toLowerCase().includes('burger') ? '🍔' : item.name.toLowerCase().includes('pizza') ? '🍕' : '🍽️'}</div><div class="item-main"><div class="item-name">{item.name}<span class="qty-tag">× {item.quantity}</span></div><div class="item-price">{formatUzs(item.unitPrice)} <span>/ шт.</span></div><div class="unit-list">{#each Array.from({ length: item.quantity }, (_, unit) => unit) as unit}<div class="unit-group"><div class="unit-row"><span class="unit-label">{item.name} {unit + 1}</span><div class="unit-people">{#each bill.participants as person}<button class:unit-selected={item.unitSelections[String(unit)]?.includes(person.id)} disabled={!selectedPerson || selectedPerson !== person.id || item.unitModes?.[String(unit)] === 'custom'} onclick={() => toggleUnit(item, unit)}>{person.name}{item.unitSelections[String(unit)]?.includes(person.id) ? ' ✓' : ''}{item.unitModes?.[String(unit)] === 'custom' ? ' ' + formatUzs(item.unitCustomAmounts?.[String(unit)]?.[person.id] ?? 0) : ''}</button>{/each}{#if isOwner}<button class="custom-toggle" onclick={() => openCustomUnit(item,unit)}>Распределить сумму</button>{/if}</div></div>{#if editingUnit === `${item.id}:${unit}`}<div class="custom-share-editor">{#each bill.participants as person}<label><span>{person.name}</span><input type="number" min="0" step="1" bind:value={customAmounts[person.id]} /></label>{/each}<div class="custom-share-total"><span>{formatUzs(bill.participants.reduce((sum,person)=>sum+Math.max(0,Math.floor(Number(customAmounts[person.id]??0))),0))} / {formatUzs(item.unitPrice)}</span><button disabled={bill.participants.reduce((sum,person)=>sum+Math.max(0,Math.floor(Number(customAmounts[person.id]??0))),0)!==item.unitPrice} onclick={() => void saveCustomUnit(item,unit)}>Сохранить доли</button></div></div>{/if}</div>{/each}</div></div>{#if isOwner}<button class="delete-item-button" onclick={() => void removeItem(item)}>Удалить позицию</button>{/if}</article>{/each}</div>{#if isOwner}<button class="text-button" onclick={() => showAddItem = true}>＋ Добавить ещё позицию</button>{/if}</section>
      {:else}<section class="summary-section">{#if unassignedTotal > 0}<div class="unassigned-banner"><span>◌</span><div><b>{formatUzs(unassignedTotal)} ещё не распределено</b><small>Распределите все экземпляры, прежде чем закрывать чек.</small></div></div>{/if}<div class="summary-card"><div class="summary-title"><div><span>ВАШ ИТОГ</span><h2>Счёт становится понятнее</h2></div><span class="summary-icon">✳</span></div>{#each totals as person}<div class="summary-person"><span class="person-avatar tone-0">{person.name.slice(0,1).toUpperCase()}</span><div class="summary-person-name"><b>{person.name} {selectedPerson === person.id ? '(вы)' : ''}</b><small>Доля {bill.servicePercent}% обслуживания</small></div><div class="summary-person-total"><b>{formatUzs(person.due)}</b><small>Оплачено {formatUzs(person.paid)} · осталось {formatUzs(person.remaining)}</small></div>{#if isOwner && person.status === 'proof_submitted'}<a class="proof-link" href={bill.participants.find(p => p.id === person.id)?.proofUrl} target="_blank" rel="noreferrer">Открыть подтверждение</a><button class="approve-button" disabled={person.paid < person.due} title={person.paid < person.due ? 'Внесена не вся сумма' : 'Подтвердить оплату'} onclick={() => approve(person.id)}>Подтвердить оплату</button>{/if}</div>{/each}<div class="summary-footer"><span>Общий счёт</span><b>{formatUzs(grandTotal(bill))}</b></div></div><div class="progress-card"><div><span>УЖЕ ОПЛАЧЕНО</span><b>{formatUzs(paidAll)} <small>/ {formatUzs(grandTotal(bill))}</small></b></div><div class="progress-track"><i style={`width:${Math.min(100, grandTotal(bill) ? paidAll / grandTotal(bill) * 100 : 0)}%`}></i></div></div>{#if currentParticipant}<button class="primary-button wide" onclick={() => { showPayment = currentParticipant.id; paidInput = currentParticipant.paid; proofInput = currentParticipant.proofUrl ?? '' }}>Указать оплату <span>↗</span></button>{/if}{#if allConfirmed}<div class="all-paid"><span>✓</span><div><b>Все оплаты подтверждены</b><p>Можно сохранить итог встречи.</p></div><button onclick={exportPdf}>Сохранить как PDF</button><button onclick={exportImage}>Сохранить изображение</button><button onclick={exportSummary}>Скачать текст</button><button onclick={copySummary}>Копировать сводку</button></div>{/if}{#if isOwner && allConfirmed}<button class="text-button danger" onclick={removeBill}>Удалить чек</button>{/if}</section>{/if}
      {/if}
      <section class="comments-card"><div class="comments-head"><div><div class="eyebrow">КОММЕНТАРИИ К ЧЕКУ</div><h2>Общий разговор</h2></div><span>💬</span></div><div class="comment-list">{#each (bill.comments ?? []) as comment}<article><span class="person-avatar tone-1">{bill.participants.find(person=>person.id===comment.participantId)?.name.slice(0,1).toUpperCase() ?? '?'}</span><div><b>{bill.participants.find(person=>person.id===comment.participantId)?.name ?? 'Участник'} · {new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(comment.createdAt))}</b><p>{comment.body}</p></div></article>{/each}{#if !(bill.comments ?? []).length}<p class="no-comments">Комментариев пока нет.</p>{/if}</div><form class="comment-form" onsubmit={(e)=>{e.preventDefault();void addComment()}}><textarea bind:value={commentText} maxlength="1000" placeholder="Напишите сообщение…" required></textarea><button disabled={!commentText.trim() || !selectedPerson}>Отправить ↗</button></form></section>
      {#if activeTab === 'order' && currentParticipant}<div class="sticky-total"><div><small>ВАШ ИТОГ</small><b>{formatUzs(currentTotal?.due ?? 0)}</b></div><button onclick={() => activeTab = 'summary'}>Оплата и итоги ↗</button></div>{/if}
      <footer class="check-footer">Сделано с заботой о дружбе <span>♡</span></footer>
    </main>
  {/if}
  {#if showAddItem}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showAddItem = false }}><form class="modal-card" onsubmit={(e) => { e.preventDefault(); addItem() }}><button type="button" class="modal-close" onclick={() => showAddItem = false}>×</button><div class="eyebrow">НОВАЯ ПОЗИЦИЯ</div><h2>Что было на столе?</h2><label>Название<input bind:value={itemName} placeholder="Например, Пицца пепперони" maxlength="48" /></label><div class="modal-fields"><label>Количество<input type="number" bind:value={itemQty} min="1" max="99" step="1" /></label><label>Цена за штуку<input type="number" bind:value={itemPrice} min="1" step="1" placeholder="0" /></label></div><div class="modal-total">Сумма позиции <b>{formatUzs(Math.max(0, itemQty * itemPrice))}</b></div><button class="primary-button wide" disabled={!itemName.trim() || itemPrice <= 0}>Добавить позицию <span>＋</span></button></form></div>{/if}
  {#if showPayment && bill}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) showPayment = null }}><form class="modal-card" onsubmit={(e) => { e.preventDefault(); submitPayment(showPayment!) }}><button type="button" class="modal-close" onclick={() => showPayment = null}>×</button><div class="eyebrow">ВАШ ПЛАТЁЖ</div><h2>Сколько уже оплатили?</h2><p>Владелец чека подтвердит оплату вручную.</p><label>Сумма в сумах<input type="number" bind:value={paidInput} min="0" max={totals.find(t => t.id === showPayment)?.due ?? 0} step="1000" /></label><label>Ссылка на чек или подтверждение <span class="label-hint">обязательно для полной оплаты</span><input type="url" bind:value={proofInput} required={Number(paidInput) >= (totals.find(t => t.id === showPayment)?.due ?? Infinity)} placeholder="https://…" /></label><button class="primary-button wide">Отправить владельцу <span>↗</span></button></form></div>{/if}
  {#if toast}<div class="toast">✓ {toast}</div>{/if}
</div>

