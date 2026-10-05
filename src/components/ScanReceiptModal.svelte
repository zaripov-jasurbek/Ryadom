<script lang="ts">
  import { onDestroy } from 'svelte'
  import { formatUzs } from '../lib/calculations'
  import { recognizeReceipt } from '../lib/ocr'
  import { parseReceipt, scanLimits } from '../lib/receipt'
  import { plural } from '../lib/format'
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  type Row = { id: number; include: boolean; name: string; quantity: number | null; price: number | null }

  let step = $state<'pick' | 'reading' | 'review'>('pick')
  let status = $state('')
  let progress = $state(0)
  let error = $state('')
  let preview = $state('')
  let rawText = $state('')
  let receiptTotal = $state<number | null>(null)
  // The service charge printed on the receipt; offered when it differs from the one set for the check.
  let receiptService = $state<number | null>(null)
  const serviceMismatch = $derived(receiptService !== null && receiptService <= 30 && app.bill !== null && receiptService !== app.bill.servicePercent)
  function applyService() {
    const bill = app.bill
    if (bill && receiptService !== null) void app.updateCheck(bill.title, receiptService, bill.paymentDetails ?? '')
  }
  let rows = $state<Row[]>([])
  let nextId = 0
  let camera: HTMLInputElement, gallery: HTMLInputElement
  let controller: AbortController | null = null

  const valid = (row: Row) => Boolean(row.name.trim()) && Number.isInteger(row.quantity) && row.quantity! >= 1 && row.quantity! <= scanLimits.maxQuantity && Number.isInteger(row.price) && row.price! >= 1 && row.price! <= limits.maxUnitPrice
  const chosen = $derived(rows.filter(row => row.include))
  const ready = $derived(chosen.length > 0 && chosen.every(valid))
  const chosenTotal = $derived(chosen.reduce((sum, row) => sum + (valid(row) ? row.quantity! * row.price! : 0), 0))
  // Weighed goods are rounded to whole sums, so each row may be off by one.
  const totalOff = $derived(receiptTotal !== null && Math.abs(chosenTotal - receiptTotal) > chosen.length)

  function setPreview(file: File | null) {
    if (preview) URL.revokeObjectURL(preview)
    preview = file ? URL.createObjectURL(file) : ''
  }

  async function read(file: File) {
    controller?.abort()
    const current = controller = new AbortController()
    setPreview(file); error = ''; status = 'Подготавливаем фото'; progress = 0; step = 'reading'
    try {
      const text = await recognizeReceipt(file, (stage, value) => { if (controller === current) { status = stage; progress = value } }, current.signal)
      if (controller !== current) return
      const result = parseReceipt(text)
      rawText = text; receiptTotal = result.total; receiptService = result.servicePercent
      rows = result.items.map(entry => ({ id: nextId++, include: !entry.unsure, name: entry.name, quantity: entry.quantity, price: entry.unitPrice }))
      step = 'review'
    } catch (failure) {
      if (current.signal.aborted) return
      console.error(failure)
      error = 'Не получилось распознать. Снимите ближе и при хорошем свете.'
      step = 'pick'
    }
  }

  function picked(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) void read(file)
  }

  function addRow() { rows = [...rows, { id: nextId++, include: true, name: '', quantity: 1, price: null }] }
  function removeRow(row: Row) { rows = rows.filter(entry => entry.id !== row.id) }
  function restart() { controller?.abort(); controller = null; setPreview(null); rows = []; rawText = ''; receiptTotal = null; receiptService = null; error = ''; step = 'pick' }

  async function submit() {
    if (step !== 'review' || !ready || app.busy) return
    const items = chosen.map(row => ({ name: row.name.trim(), quantity: row.quantity!, unitPrice: row.price! }))
    const added = await app.addItems(items)
    if (added === items.length) { app.notify(`Добавлено ${plural(added, 'позиция', 'позиции', 'позиций')}`); app.scanOpen = false; return }
    // Keep what was not added so the owner can retry without scanning again.
    const addedIds = new Set(chosen.slice(0, added).map(row => row.id))
    rows = rows.filter(row => !addedIds.has(row.id))
  }

  onDestroy(() => { controller?.abort(); setPreview(null) })
</script>

<!-- Outside the dialog, so its focus trap never lands on them. -->
<input class="visually-hidden" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" bind:this={camera} onchange={picked} />
<input class="visually-hidden" type="file" accept="image/*" tabindex="-1" aria-hidden="true" bind:this={gallery} onchange={picked} />

<Modal labelledby="scan-title" onclose={() => app.scanOpen = false} onsubmit={() => void submit()}>
  <div class="eyebrow">Скан чека</div>
  <h2 id="scan-title">{step === 'review' ? 'Проверьте позиции' : 'Сфотографируйте чек'}</h2>

  {#if step === 'pick'}
    <p class="lead">Снимите чек целиком, вместе с ценами.</p>
    {#if error}<div class="form-error" role="alert">{error}</div>{/if}
    <div class="scan-actions">
      <button type="button" class="primary-button wide" onclick={() => camera.click()}>📷 Сфотографировать</button>
      <button type="button" class="soft-button wide" onclick={() => gallery.click()}>Выбрать из галереи</button>
    </div>
    <div class="privacy-note">🔒 Фото остаётся на телефоне</div>
  {:else if step === 'reading'}
    <div class="scan-reading" role="status" aria-live="polite">
      {#if preview}<img class="scan-preview" src={preview} alt="Фото чека" />{/if}
      <div class="scan-progress"><i style:width="{Math.round(progress * 100)}%"></i></div>
      <span>{status}… {Math.round(progress * 100)}%</span>
    </div>
    <button type="button" class="soft-button wide" onclick={restart}>Отменить</button>
  {:else}
    {#if rows.length}
      <p class="lead">Исправьте ошибки и снимите галочку с лишнего.</p>
    {:else}
      <div class="notice warning"><span aria-hidden="true">◌</span><div><b>Позиции не найдены</b><small>Переснимите чек ровнее или добавьте строки вручную.</small></div></div>
    {/if}
    <div class="scan-rows">
      {#each rows as row, i (row.id)}
        <div class="scan-row" class:off={!row.include} class:invalid={row.include && !valid(row)}>
          <input type="checkbox" bind:checked={row.include} aria-label={`Добавить позицию ${i + 1}`} />
          <input class="scan-name" bind:value={row.name} maxlength={scanLimits.nameLength} placeholder="Название" aria-label="Название" />
          <span class="scan-qty"><input type="number" bind:value={row.quantity} min="1" max={scanLimits.maxQuantity} step="1" inputmode="numeric" aria-label="Количество" /><span>шт</span></span>
          <span class="scan-price"><input type="number" bind:value={row.price} min="1" max={limits.maxUnitPrice} step="1" inputmode="numeric" placeholder="0" aria-label="Цена за штуку" /><span>сум</span></span>
          <button type="button" class="icon-button small danger" aria-label="Убрать строку" onclick={() => removeRow(row)}>×</button>
        </div>
      {/each}
    </div>
    <button type="button" class="add-more" onclick={addRow}>＋ Добавить строку</button>
    <div class="modal-total">
      <span>Выбрано {plural(chosen.length, 'позиция', 'позиции', 'позиций')}{#if receiptTotal}<small class:off-total={totalOff}>{` · в чеке ${formatUzs(receiptTotal)}`}</small>{/if}</span>
      <b>{formatUzs(chosenTotal)}</b>
    </div>
    {#if serviceMismatch}
      <div class="notice info scan-service"><span aria-hidden="true">%</span><div><b>В чеке обслуживание {receiptService}%</b><small>Сейчас в расчёте {app.bill?.servicePercent}%.</small></div><button type="button" class="chip" disabled={app.busy} onclick={applyService}>Поставить {receiptService}%</button></div>
    {/if}
    {#if rawText}
      <details class="scan-raw"><summary>Распознанный текст</summary><pre>{rawText}</pre></details>
    {/if}
    <button class="primary-button wide" disabled={app.busy || !ready}>{app.busy ? 'Добавляем…' : `Добавить ${plural(chosen.length, 'позицию', 'позиции', 'позиций')}`} <span aria-hidden="true">＋</span></button>
    <button type="button" class="ghost-button" onclick={restart}>Переснять</button>
  {/if}
</Modal>
