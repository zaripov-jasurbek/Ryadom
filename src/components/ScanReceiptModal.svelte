<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { formatUzs } from '../lib/calculations'
  import { recognizeReceipt, stopReceiptEngine, suggestArea, type Area } from '../lib/ocr'
  import { bestReading, settled } from '../lib/receipt'
  import { plural } from '../lib/format'
  import { blankRow, filledRows, rowsTotal, toItems, validRow, type ItemRow } from '../lib/rows'
  import ItemTable from './ItemTable.svelte'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'
  import { haptic } from '../lib/haptics'

  /** `suspect` rows are framed in yellow: the receipt's total adds up without them, so they are likely misread. */
  type Row = ItemRow
  type Point = Area[number]

  let step = $state<'pick' | 'area' | 'reading' | 'review'>('pick')
  let status = $state('')
  let progress = $state(0)
  let error = $state('')
  let preview = $state('')
  // Each photo is a shot: a part of a long receipt, or one of several receipts. Reading a shot again
  // replaces only its own rows; the totals printed on the shots add up.
  let shot = $state(0)
  let adding = $state(false)
  let shots = $state<{ text: string; total: number | null }[]>([])
  const shotOf = new Map<number, number>()
  const readShots = $derived(shots.filter(Boolean))
  const rawText = $derived(readShots.map(entry => entry.text).join('\n\n'))
  const totals = $derived(readShots.map(entry => entry.total).filter(total => total !== null))
  const receiptTotal = $derived(totals.length ? totals.reduce((sum, total) => sum + total, 0) : null)
  // A later photo: the next shot here, or a scan into a table that already has rows (the create page reopens the scanner for each).
  const following = $derived(shot > 0 || (app.mode === 'create' && filledRows(app.draft).length > 0))
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
  // The photo fills the room the card has left, whole, so no corner is ever scrolled away.
  let stageWidth = $state(0), stageHeight = $state(0)
  const stagePad = 12
  const frameWidth = $derived(Math.max(0, Math.min(stageWidth - stagePad * 2, (stageHeight - stagePad * 2) * size.width / size.height)))
  const frameHeight = $derived(frameWidth * size.height / size.width)
  // Handles 0–3 are the corners, 4–7 the middles of the sides from corner i to corner i + 1.
  let dragging = $state<number | null>(null)
  let start = { at: { x: 0, y: 0 }, area: [] as Point[] }
  // The top and bottom sides beckon until the first touch: cutting the header and the footer off is the usual job.
  let touched = $state(false)
  const handleNames = ['Левый верхний угол', 'Правый верхний угол', 'Правый нижний угол', 'Левый нижний угол', 'Верхний край', 'Правый край', 'Нижний край', 'Левый край']
  const handles = $derived([
    ...area.map(corner => ({ ...corner, angle: 0 })),
    ...area.map((from, i) => {
      const to = area[(i + 1) % 4]
      return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, angle: Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI }
    }),
  ])
  const shape = $derived(area.map(corner => `${corner.x},${corner.y}`).join(' '))
  // The loupe shows the handle under the finger at this zoom.
  const zoom = 2.5, loupe = 120

  async function choose(file: File) {
    controller?.abort(); controller = null
    setPreview(file); photo = file; error = ''; touched = false
    try {
      const suggested = await suggestArea(file)
      if (photo !== file) return
      if (adding) { shot++; adding = false }
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

  const copy = (corners: Area) => corners.map(corner => ({ ...corner }))

  /** Moves a handle by (dx, dy) from where the corners were: a corner freely, a side straight across with both its corners. */
  function move(from: Point[], handle: number, dx: number, dy: number) {
    if (handle < 4) { area[handle] = clamp({ x: from[handle].x + dx, y: from[handle].y + dy }); return }
    const side = handle - 4, ends = [side, (side + 1) % 4]
    const vertical = side % 2 === 0, limit = vertical ? size.height : size.width
    // Both corners stop together at the photo's edge, so the side keeps its slant.
    let by = vertical ? dy : dx
    for (const i of ends) { const at = vertical ? from[i].y : from[i].x; by = Math.min(limit - at, Math.max(-at, by)) }
    for (const i of ends) area[i] = vertical ? { x: from[i].x, y: from[i].y + by } : { x: from[i].x + by, y: from[i].y }
  }

  function grab(event: PointerEvent, handle: number) {
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    // The handle keeps its distance from the finger instead of jumping under it.
    start = { at: photoPoint(event), area: copy(area) }
    dragging = handle; touched = true
    haptic.selection()
  }
  function drag(event: PointerEvent, handle: number) {
    if (dragging !== handle) return
    const at = photoPoint(event)
    move(start.area, handle, at.x - start.at.x, at.y - start.at.y)
  }
  function release() { dragging = null }
  /** Arrow keys move a focused handle by 1% of the photo, with Shift by 5%. */
  function nudge(event: KeyboardEvent, handle: number) {
    const by = (event.shiftKey ? .05 : .01) * Math.max(size.width, size.height)
    const moves: Record<string, [number, number]> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] }
    const shift = moves[event.key]
    if (!shift) return
    event.preventDefault(); touched = true
    move(copy(area), handle, shift[0], shift[1])
  }

  /** A frame that crosses itself, lies flipped over or covers almost nothing cannot be read. */
  function frameProblem(corners: Area) {
    const turns = corners.map((corner, i) => {
      const next = corners[(i + 1) % 4], after = corners[(i + 2) % 4]
      return (next.x - corner.x) * (after.y - next.y) - (next.y - corner.y) * (after.x - next.x)
    })
    // The corners go clockwise from the top left; turning the other way all along is a frame flipped over, read upside down or mirrored.
    if (!turns.every(turn => turn > 0)) return 'Углы рамки перепутаны: потяните их на свои места.'
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
      shots[shot] = { text, total: result.total }
      if (result.servicePercent !== null) receiptService = result.servicePercent
      const found = result.items.map(entry => ({ id: nextId++, suspect: Boolean(entry.unsure), name: entry.name, quantity: entry.quantity, price: entry.unitPrice }))
      for (const row of found) shotOf.set(row.id, shot)
      rows = [...rows.filter(row => shotOf.get(row.id) !== shot && !blankRow(row)), ...found, newRow()]
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

  /** To the camera for this shot again, or (`more`) for the next one; the rows read so far stay. */
  function newPhoto(more: boolean) { controller?.abort(); controller = null; adding = more; error = ''; step = 'pick' }
  function back() { adding = false; error = ''; step = 'review' }
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

{#snippet outline()}
  <svg viewBox="0 0 {size.width} {size.height}" preserveAspectRatio="none" aria-hidden="true">
    <path class="scan-area-shade" fill-rule="evenodd" d="M0 0H{size.width}V{size.height}H0Z M{shape.replaceAll(' ', 'L')}Z" />
    <polygon class="scan-area-edge" points={shape} />
  </svg>
{/snippet}

<Modal labelledby="scan-title" onclose={close} onsubmit={() => void submit()} fill={step === 'area'}>
  <div class="eyebrow">Скан чека</div>
  <h2 id="scan-title">{step === 'review' ? 'Проверьте позиции' : step === 'area' ? 'Обрежьте чек' : 'Сфотографируйте чек'}</h2>

  {#if step === 'pick'}
    <p class="lead">{adding ? 'Следующую часть чека или другой чек.' : 'Снимите чек вместе с ценами. Длинный — по частям.'}</p>
    {#if error}<div class="form-error" role="alert">{error}</div>{/if}
    <div class="scan-actions">
      <button type="button" class="primary-button wide" onclick={() => camera.click()}>📷 Сфотографировать</button>
      <button type="button" class="soft-button wide" onclick={() => gallery.click()}>Выбрать из галереи</button>
    </div>
    {#if filledRows(rows).length}<button type="button" class="ghost-button" onclick={back}>← К позициям</button>{/if}
    <div class="privacy-note">🔒 Фото остаётся на телефоне</div>
  {:else if step === 'area'}
    <!-- Glows in step with the handles until the first touch, so it is read before the frame is pulled. -->
    <p class="lead scan-lead" class:beckon={!touched}>{#if following}Вырежьте <b>блюда, которых нет на прошлом фото</b>.{:else}Вырежьте всё <b>от первого блюда до итога</b>.{/if}</p>
    {#if error}<div class="form-error" role="alert">{error}</div>{/if}
    <div class="scan-stage" bind:clientWidth={stageWidth} bind:clientHeight={stageHeight} style:padding="{stagePad}px">
      <div class="scan-area" bind:this={frame} style:width="{frameWidth}px" style:height="{frameHeight}px">
        <img src={preview} alt="Фото чека" draggable="false" />
        {@render outline()}
        <!-- Sides first, so a corner wins where their handles overlap on a small frame. -->
        {#each [4, 5, 6, 7, 0, 1, 2, 3] as i (i)}
          {@const handle = handles[i]}
          <button type="button" class={i < 4 ? 'scan-corner' : 'scan-side'} class:active={dragging === i} class:beckon={!touched && (i === 4 || i === 6)}
            style:left="{handle.x / size.width * 100}%" style:top="{handle.y / size.height * 100}%" style:--angle="{handle.angle}deg"
            aria-label={`${handleNames[i]} рамки, двигайте стрелками`} onpointerdown={event => grab(event, i)} onpointermove={event => drag(event, i)}
            onpointerup={release} onpointercancel={release} onkeydown={event => nudge(event, i)}></button>
        {/each}
      </div>
      {#if dragging !== null}
        {@const x = handles[dragging].x / size.width * frameWidth}
        {@const y = handles[dragging].y / size.height * frameHeight}
        <!-- The finger hides the handle, and the hand comes from below: the loupe sits in a top corner, away from the finger. -->
        <div class="scan-loupe" class:left={x >= frameWidth / 2} aria-hidden="true" style:width="{loupe}px" style:height="{loupe}px">
          <div style:width="{frameWidth * zoom}px" style:height="{frameHeight * zoom}px" style:left="{loupe / 2 - x * zoom}px" style:top="{loupe / 2 - y * zoom}px">
            <img src={preview} alt="" draggable="false" />
            {@render outline()}
          </div>
        </div>
      {/if}
    </div>
    <button type="button" class="primary-button wide" onclick={() => void read()}>Распознать</button>
    <button type="button" class="ghost-button" onclick={() => newPhoto(false)}>Другое фото</button>
  {:else if step === 'reading'}
    <div class="scan-reading" role="status" aria-live="polite">
      {#if preview}<img class="scan-preview" src={preview} alt="Фото чека" />{/if}
      <div class="scan-progress"><i style:width="{Math.round(progress * 100)}%"></i></div>
      <span>{status}… {Math.round(progress * 100)}%</span>
    </div>
    <button type="button" class="soft-button wide" onclick={reframe}>Отменить</button>
  {:else}
    {#if rows.length > 1}
      <p class="lead">Исправьте ошибки и уберите лишнее крестиком.{#if hasSuspects}{' '}Строки в жёлтой рамке, скорее всего, распознаны с ошибкой.{/if}</p>
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
      <span>Выбрано {plural(chosen.length, 'позиция', 'позиции', 'позиций')}{#if receiptTotal}<small class:off-total={totalOff}>{` · ${totals.length > 1 ? 'в чеках' : 'в чеке'} ${formatUzs(receiptTotal)}`}</small>{/if}</span>
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
      <button type="button" class="ghost-button" onclick={() => newPhoto(true)}>📷 Ещё фото</button>
      <button type="button" class="ghost-button" onclick={reframe}>Изменить рамку</button>
      <button type="button" class="ghost-button" onclick={() => newPhoto(false)}>Переснять</button>
    </div>
  {/if}
</Modal>
