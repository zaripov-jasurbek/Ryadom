<script lang="ts">
  import { formatUzs, serviceFee } from '../lib/calculations'
  import { plural } from '../lib/format'
  import { pickPhoto } from '../lib/photo'
  import { filledRows, rowsTotal, toItems, validRow } from '../lib/rows'
  import { app } from '../lib/store.svelte'
  import ItemTable from './ItemTable.svelte'

  const filled = $derived(filledRows(app.draft))
  const ready = $derived(filled.length > 0 && filled.every(validRow))
  const food = $derived(rowsTotal(filled))
  // An empty field is no service; the database keeps two decimals between 0 and 100.
  const percent = $derived(app.draftService ?? 0)
  const serviceValid = $derived(Number.isFinite(percent) && percent >= 0 && percent <= 100)
  // Weighed goods are rounded to whole sums, so each row may be off by one.
  const totalOff = $derived(app.draftTotal !== null && filled.length > 0 && Math.abs(food - app.draftTotal) > filled.length)
  let table: ItemTable | undefined = $state()

  async function scan() {
    const file = await pickPhoto()
    if (file && app.mode === 'create') app.scanPhoto(file)
  }

  function submit() {
    if (!ready || !serviceValid || app.busy) { table?.touchAll(); return }
    void app.createBill(Math.round(percent * 100) / 100, toItems(filled))
  }
</script>

<main class="form-page create-page">
  <button class="back-link" onclick={() => app.goHome()}>← Назад</button>
  <form class="panel bill draft" onsubmit={(e) => { e.preventDefault(); submit() }}>
    <div class="draft-top">
      <h1>Новый чек</h1>
      <button type="button" class="soft-button" onclick={scan}>{filled.length ? '📷 Ещё фото' : '📷 Скан'}</button>
    </div>
    <ItemTable bind:this={table} bind:rows={app.draft} newRow={app.newDraftRow} />

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
