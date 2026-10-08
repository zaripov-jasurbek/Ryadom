<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { formatUzs } from '../lib/calculations'
  import { recognizeReceipt, stopReceiptEngine, suggestArea, type Area } from '../lib/ocr'
  import { bestReading, settled } from '../lib/receipt'
  import { plural } from '../lib/format'
  import { filledRows, rowsTotal, toItems, validRow, type ItemRow } from '../lib/rows'
  import ItemTable from './ItemTable.svelte'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'
  import { haptic } from '../lib/haptics'

  /** `suspect` rows are framed in yellow: the receipt's total adds up without them, so they are likely misread. */
  type Row = ItemRow

  let step = $state<'pick' | 'area' | 'reading' | 'review'>('pick')
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
  let photoZoomed = $state(false)
  let nextId = 0
  let camera: HTMLInputElement, gallery: HTMLInputElement
  let controller: AbortController | null = null

  const newRow = (): Row => ({ id: nextId++, name: '', quantity: 1, price: null })
  let table: ItemTable | undefined = $state()
  const chosen = $derived(filledRows(rows))
  const ready = $derived(chosen.length > 0 && chosen.every(validRow))
  const chosenTotal = $derived(rowsTotal(chosen))
  // Weighed goods are rounded to whole sums, so each row may be off by one.
  const totalOff = $derived(receiptTotal !== null && Math.abs(chosenTotal - receiptTotal) > chosen.length)
  const hasSuspects = $derived(rows.some(row => row.suspect))

  function setPreview(file: File | null) {
    if (preview) URL.revokeObjectURL(preview)
    preview = file ? URL.createObjectURL(file) : ''
  }

  // The photo and the part of it to read: the owner frames the dishes, so headers, footers and the table around stay out.
  let photo: File | null = null
  let size = $state({ width: 1, height: 1 })
  let area = $state<Area>([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])
  let frame = $state<HTMLDivElement>()
  let frameWidth = $state(0)
  let dragging = $state<number | null>(null)
  let grip = { x: 0, y: 0 }
  const cornerNames = ['Левый верхний угол', 'Правый верхний угол', 'Правый нижний угол', 'Левый нижний угол']
  const shape = $derived(area.map(corner => `${corner.x},${corner.y}`).join(' '))
  // The loupe shows the corner under the finger at this zoom.
  const zoom = 2.5, loupe = 96

  async function choose(file: File) {
    controller?.abort(); controller = null
    setPreview(file); photo = file; error = ''
    try {
      const suggested = await suggestArea(file)
      if (photo !== file) return
      size = { width: suggested.width, height: suggested.height }
      area = suggested.area
      step = 'area'
    } catch (failure) {
      console.error(failure)
      error = 'Не получилось открыть фото. Попробуйте другое.'
      haptic.error()
      step = 'pick'
    }
  }

  function photoPoint(event: PointerEvent) {
    const rect = frame!.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width * size.width, y: (event.clientY - rect.top) / rect.height * size.height }
  }
  const clamp = (point: { x: number; y: number }) => ({ x: Math.min(size.width, Math.max(0, point.x)), y: Math.min(size.height, Math.max(0, point.y)) })

  function grab(event: PointerEvent, corner: number) {
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    // The corner keeps its distance from the finger instead of jumping under it.
    const at = photoPoint(event)
    grip = { x: area[corner].x - at.x, y: area[corner].y - at.y }
    dragging = corner
    haptic.selection()
  }
  function drag(event: PointerEvent, corner: number) {
    if (dragging !== corner) return
    const at = photoPoint(event)
    area[corner] = clamp({ x: at.x + grip.x, y: at.y + grip.y })
  }
  function release() { dragging = null }
  /** Arrow keys move a focused corner by 1% of the photo, with Shift by 5%. */
  function nudge(event: KeyboardEvent, corner: number) {
    const by = (event.shiftKey ? .05 : .01) * Math.max(size.width, size.height)
    const moves: Record<string, [number, number]> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    area[corner] = clamp({ x: area[corner].x + move[0], y: area[corner].y + move[1] })
  }

  /** A frame that crosses itself or covers almost nothing cannot be drawn flat. */
  function frameProblem(corners: Area) {
    const turns = corners.map((corner, i) => {
      const next = corners[(i + 1) % 4], after = corners[(i + 2) % 4]
      return (next.x - corner.x) * (after.y - next.y) - (next.y - corner.y) * (after.x - next.x)
    })
    if (!turns.every(turn => turn > 0) && !turns.every(turn => turn < 0)) return 'Углы рамки перепутаны: потяните их на свои места.'
    const surface = Math.abs(corners.reduce((sum, corner, i) => sum + corner.x * corners[(i + 1) % 4].y - corners[(i + 1) % 4].x * corner.y, 0)) / 2
    if (surface < size.width * size.height * .01) return 'Рамка слишком маленькая: растяните её на список блюд.'
    return ''
  }

  async function read() {
    const file = photo
    if (!file) return
    const problem = frameProblem(area)
    if (problem) { error = problem; haptic.error(); return }
    controller?.abort()
    const current = controller = new AbortController()
    error = ''; status = 'Подготавливаем фото'; progress = 0; step = 'reading'
    try {
      const readings = await recognizeReceipt(file, $state.snapshot(area) as Area, (stage, value) => { if (controller === current) { status = stage; progress = value } }, current.signal, settled)
      if (controller !== current) return
      const { text, result } = bestReading(readings)
      // On the create page the rows go straight into its table, which is where they are checked;
      // rows the total adds up without are framed in yellow there too.
      if (app.mode === 'create') {
        const found = result.items
        app.fillDraft(found, result.total, result.servicePercent)
        app.notify(found.length ? `Распознано ${plural(found.length, 'позиция', 'позиции', 'позиций')} — сверьте с чеком` : 'Позиции не найдены — впишите их в таблицу')
        found.length ? haptic.success() : haptic.error()
        close()
        return
      }
      rawText = text; receiptTotal = result.total; receiptService = result.servicePercent
      rows = [...result.items.map(entry => ({ id: nextId++, suspect: Boolean(entry.unsure), name: entry.name, quantity: entry.quantity, price: entry.unitPrice })), newRow()]
      photoZoomed = false
      step = 'review'
      haptic.success()
    } catch (failure) {
      if (current.signal.aborted) return
      console.error(failure)
      error = 'Не получилось распознать. Снимите ближе и при хорошем свете.'
      haptic.error()
      step = 'area'
    }
  }

  function picked(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) void choose(file)
  }

  function restart() { controller?.abort(); controller = null; setPreview(null); photo = null; rows = []; rawText = ''; receiptTotal = null; receiptService = null; error = ''; step = 'pick' }
  /** Back to the frame on the same photo, to read another part or the same part framed better. */
  function reframe() { controller?.abort(); controller = null; error = ''; step = 'area' }

  async function submit() {
    if (step !== 'review' || app.busy) return
    if (!ready) { table?.touchAll(); return }
    const items = toItems(chosen)
    const added = await app.addItems(items)
    if (added === items.length) { haptic.success(); app.notify(`Добавлено ${plural(added, 'позиция', 'позиции', 'позиций')}`); close(); return }
    // Keep what was not added so the owner can retry without scanning again.
    const addedIds = new Set(chosen.slice(0, added).map(row => row.id))
    rows = rows.filter(row => !addedIds.has(row.id))
  }

  // Opened with a photo already chosen (the create page asks for it first): start at the frame.
  onMount(() => {
    const file = app.scanFile
    app.scanFile = null
    if (file) void choose(file)
  })
  onDestroy(() => { controller?.abort(); stopReceiptEngine(); setPreview(null) })
  function close() { app.scanOpen = false; app.scanFile = null }
</script>

<!-- Outside the dialog, so its focus trap never lands on them. -->
<input class="visually-hidden" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" bind:this={camera} onchange={picked} />
<input class="visually-hidden" type="file" accept="image/*" tabindex="-1" aria-hidden="true" bind:this={gallery} onchange={picked} />

<Modal labelledby="scan-title" onclose={close} onsubmit={() => void submit()}>
  <div class="eyebrow">Скан чека</div>
  <h2 id="scan-title">{step === 'review' ? 'Проверьте позиции' : step === 'area' ? 'Выделите позиции' : 'Сфотографируйте чек'}</h2>

  {#if step === 'pick'}
    <p class="lead">Снимите чек целиком, вместе с ценами.</p>
    {#if error}<div class="form-error" role="alert">{error}</div>{/if}
    <div class="scan-actions">
      <button type="button" class="primary-button wide" onclick={() => camera.click()}>📷 Сфотографировать</button>
      <button type="button" class="soft-button wide" onclick={() => gallery.click()}>Выбрать из галереи</button>
    </div>
    <div class="privacy-note">🔒 Фото остаётся на телефоне</div>
  {:else if step === 'area'}
    <p class="lead">Потяните углы рамки так, чтобы в ней остался <b>только список блюд и итог</b>. Название заведения, дату и всё, что ниже итога, оставьте снаружи.</p>
    {#if error}<div class="form-error" role="alert">{error}</div>{/if}
    <!-- Sized to the photo's proportions and the screen's height, so the whole receipt fits and the corners stay reachable. -->
    <div class="scan-area" bind:this={frame} bind:clientWidth={frameWidth} style:width="min(100%, calc(60vh * {size.width / size.height}))" style:aspect-ratio="{size.width} / {size.height}">
      <img src={preview} alt="Фото чека" draggable="false" />
      <svg viewBox="0 0 {size.width} {size.height}" preserveAspectRatio="none" aria-hidden="true">
        <path class="scan-area-shade" fill-rule="evenodd" d="M0 0H{size.width}V{size.height}H0Z M{shape.replaceAll(' ', 'L')}Z" />
        <polygon class="scan-area-edge" points={shape} />
      </svg>
      {#each area as corner, i (i)}
        <button type="button" class="scan-corner" class:active={dragging === i} style:left="{corner.x / size.width * 100}%" style:top="{corner.y / size.height * 100}%"
          aria-label={`${cornerNames[i]} рамки, двигайте стрелками`} onpointerdown={event => grab(event, i)} onpointermove={event => drag(event, i)}
          onpointerup={release} onpointercancel={release} onkeydown={event => nudge(event, i)}></button>
      {/each}
      {#if dragging !== null}
        {@const corner = area[dragging]}
        {@const x = corner.x / size.width * frameWidth}
        {@const y = corner.y / size.width * frameWidth}
        <!-- The finger hides the corner, so the loupe shows it magnified above, or below near the top edge. -->
        <div class="scan-loupe" aria-hidden="true" style:left="{x}px" style:top="{y < loupe + 40 ? y + 70 : y - 70}px"
          style:background-image="url({preview})" style:background-size="{frameWidth * zoom}px auto"
          style:background-position="{loupe / 2 - x * zoom}px {loupe / 2 - y * zoom}px"></div>
      {/if}
    </div>
    <button type="button" class="primary-button wide" onclick={() => void read()}>Распознать</button>
    <button type="button" class="ghost-button" onclick={restart}>Другое фото</button>
  {:else if step === 'reading'}
    <div class="scan-reading" role="status" aria-live="polite">
      {#if preview}<img class="scan-preview" src={preview} alt="Фото чека" />{/if}
      <div class="scan-progress"><i style:width="{Math.round(progress * 100)}%"></i></div>
      <span>{status}… {Math.round(progress * 100)}%</span>
    </div>
    <button type="button" class="soft-button wide" onclick={reframe}>Отменить</button>
  {:else}
    {#if rows.length > 1}
      <p class="lead">Исправьте ошибки и уберите лишнее крестиком.{#if hasSuspects} Строки в жёлтой рамке, скорее всего, распознаны с ошибкой.{/if}</p>
    {:else}
      <div class="notice warning"><span aria-hidden="true">◌</span><div><b>Позиции не найдены</b><small>Переснимите чек ровнее или добавьте строки вручную.</small></div></div>
    {/if}
    {#if preview}
      <!-- The photo next to the rows, to check them against; a tap shows it at full width to read small print. -->
      <details class="scan-photo">
        <summary>Фото чека</summary>
        <div class="scan-photo-frame" class:zoomed={photoZoomed}>
          <button type="button" aria-label={photoZoomed ? 'Уменьшить фото' : 'Увеличить фото'} onclick={() => photoZoomed = !photoZoomed}><img src={preview} alt="Фото чека" /></button>
        </div>
      </details>
    {/if}
    <ItemTable bind:this={table} bind:rows {newRow} />
    <div class="modal-total">
      <span>Выбрано {plural(chosen.length, 'позиция', 'позиции', 'позиций')}{#if receiptTotal}<small class:off-total={totalOff}>{` · в чеке ${formatUzs(receiptTotal)}`}</small>{/if}</span>
      <b>{formatUzs(chosenTotal)}</b>
    </div>
    {#if totalOff && receiptTotal !== null}
      <p class="scan-diff" role="status">{chosenTotal < receiptTotal ? `Не хватает ${formatUzs(receiptTotal - chosenTotal)} до суммы чека` : `На ${formatUzs(chosenTotal - receiptTotal)} больше суммы чека`}: сверьте цены и количество с фото.</p>
    {/if}
    {#if serviceMismatch}
      <div class="notice info scan-service"><span aria-hidden="true">%</span><div><b>В чеке обслуживание {receiptService}%</b><small>Сейчас в расчёте {app.bill?.servicePercent}%.</small></div><button type="button" class="chip" disabled={app.busy} onclick={applyService}>Поставить {receiptService}%</button></div>
    {/if}
    {#if rawText}
      <details class="scan-raw"><summary>Распознанный текст</summary><pre>{rawText}</pre></details>
    {/if}
    <button class="primary-button wide" disabled={app.busy}>{app.busy ? 'Добавляем…' : `Добавить ${plural(chosen.length, 'позицию', 'позиции', 'позиций')}`} <span aria-hidden="true">＋</span></button>
    <div class="scan-again">
      <button type="button" class="ghost-button" onclick={reframe}>Изменить рамку</button>
      <button type="button" class="ghost-button" onclick={restart}>Переснять</button>
    </div>
  {/if}
</Modal>
