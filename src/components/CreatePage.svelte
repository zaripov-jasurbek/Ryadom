<script lang="ts">
  import { tick } from 'svelte'
  import { formatUzs, serviceFee } from '../lib/calculations'
  import { plural } from '../lib/format'
  import { limits } from '../lib/limits'
  import { pickPhoto } from '../lib/photo'
  import { scanLimits } from '../lib/receipt'
  import { app, type DraftRow } from '../lib/store.svelte'

  // Same limits as add_item on the server.
  const blank = (row: DraftRow) => !row.name.trim() && !row.price
  const valid = (row: DraftRow) => Boolean(row.name.trim()) && Number.isInteger(row.quantity) && row.quantity! >= 1 && row.quantity! <= scanLimits.maxQuantity && Number.isInteger(row.price) && row.price! >= 1 && row.price! <= limits.maxUnitPrice
  const filled = $derived(app.draft.filter(row => !blank(row)))
  const ready = $derived(filled.length > 0 && filled.every(valid))
  const food = $derived(filled.reduce((sum, row) => sum + (valid(row) ? row.quantity! * row.price! : 0), 0))
  // An empty field is no service; the database keeps two decimals between 0 and 100.
  const percent = $derived(app.draftService ?? 0)
  const serviceValid = $derived(Number.isFinite(percent) && percent >= 0 && percent <= 100)
  // Weighed goods are rounded to whole sums, so each row may be off by one.
  const totalOff = $derived(app.draftTotal !== null && filled.length > 0 && Math.abs(food - app.draftTotal) > filled.length)
  // A row is checked once it is left, not while it is being typed.
  let touched = $state(new Set<number>())

  let table: HTMLDivElement | undefined = $state()
  // Typing in the last line opens the next one, like a list in notes.
  function typed(row: DraftRow) {
    if (row === app.draft.at(-1) && !blank(row)) app.draft.push(app.newDraftRow())
  }
  async function addRow() {
    if (!app.draft.length || !blank(app.draft.at(-1)!)) app.draft.push(app.newDraftRow())
    await tick()
    table?.querySelector<HTMLInputElement>('.draft-row:last-of-type .draft-name')?.focus()
  }
  function removeRow(row: DraftRow) {
    app.draft = app.draft.filter(entry => entry.id !== row.id)
    if (!app.draft.length) app.draft = [app.newDraftRow()]
  }
  // Enter in a price moves to the next line's name instead of submitting half a check.
  async function next(event: KeyboardEvent, index: number) {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (index === app.draft.length - 1) await addRow()
    else table?.querySelectorAll<HTMLInputElement>('.draft-name')[index + 1]?.focus()
  }

  async function scan() {
    const file = await pickPhoto()
    if (file && app.mode === 'create') app.scanPhoto(file)
  }

  function submit() {
    if (!ready || !serviceValid || app.busy) { touched = new Set(app.draft.map(row => row.id)); return }
    void app.createBill(Math.round(percent * 100) / 100, filled.map(row => ({ name: row.name.trim(), quantity: row.quantity!, unitPrice: row.price! })))
  }
</script>

<main class="form-page create-page">
  <button class="back-link" onclick={() => app.goHome()}>← Назад</button>
  <form class="panel bill draft" onsubmit={(e) => { e.preventDefault(); submit() }}>
    <div class="draft-top">
      <h1>Новый чек</h1>
      <button type="button" class="soft-button" onclick={scan}>📷 Скан</button>
    </div>
    <div class="bill-line bill-head draft-line" aria-hidden="true"><span>Название</span><span class="bill-qty">Кол-во</span><span class="bill-price">Цена</span><span></span></div>
    <div class="draft-rows" bind:this={table}>
      {#each app.draft as row, i (row.id)}
        <div class="bill-line draft-line draft-row" class:invalid={touched.has(row.id) && !blank(row) && !valid(row)} onfocusout={() => { touched.add(row.id); touched = new Set(touched) }}>
          <input class="draft-name" bind:value={row.name} oninput={() => typed(row)} maxlength={scanLimits.nameLength} placeholder={i === 0 ? 'Плов' : ''} aria-label={`Название, строка ${i + 1}`} enterkeyhint="next" />
          <input class="draft-qty" type="number" bind:value={row.quantity} oninput={() => typed(row)} min="1" max={scanLimits.maxQuantity} step="1" inputmode="numeric" aria-label={`Количество, строка ${i + 1}`} enterkeyhint="next" />
          <input class="draft-price" type="number" bind:value={row.price} oninput={() => typed(row)} onkeydown={(e) => next(e, i)} min="1" max={limits.maxUnitPrice} step="1" inputmode="numeric" placeholder={i === 0 ? '45000' : ''} aria-label={`Цена за штуку, строка ${i + 1}`} enterkeyhint="next" />
          {#if blank(row) && i === app.draft.length - 1}<span></span>
          {:else}<button type="button" class="icon-button small" aria-label={`Убрать строку ${i + 1}`} onclick={() => removeRow(row)}>×</button>{/if}
        </div>
      {/each}
    </div>
    <button type="button" class="add-more" onclick={addRow}>＋ Строка</button>

    <dl class="bill-sum">
      <div><dt>Блюда</dt><dd>{formatUzs(food)}</dd></div>
      <div class="draft-service">
        <dt><label for="draft-service">Обслуживание</label></dt>
        <dd><span class="suffix-input"><input id="draft-service" type="number" bind:value={app.draftService} min="0" max="100" step="0.01" inputmode="decimal" placeholder="0" aria-invalid={!serviceValid} /><span>%</span></span></dd>
      </div>
      <div class="bill-total"><dt>Итого</dt><dd>{formatUzs(food + (serviceValid ? serviceFee(food, percent) : 0))}</dd></div>
    </dl>
    {#if totalOff && app.draftTotal !== null}
      <p class="scan-diff" role="status">В чеке {formatUzs(app.draftTotal)}: {food < app.draftTotal ? `не хватает ${formatUzs(app.draftTotal - food)}` : `лишние ${formatUzs(food - app.draftTotal)}`}.</p>
    {/if}

    <button class="primary-button wide" disabled={app.busy}>{app.busy ? 'Создаём…' : filled.length ? `Готово · ${plural(filled.length, 'позиция', 'позиции', 'позиций')}` : 'Готово'} <span aria-hidden="true">↗</span></button>
  </form>
</main>
