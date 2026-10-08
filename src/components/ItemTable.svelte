<script lang="ts">
  import { tick } from 'svelte'
  import { limits } from '../lib/limits'
  import { scanLimits } from '../lib/receipt'
  import { blankRow, validRow, type ItemRow } from '../lib/rows'

  /**
   * The table of items as on the create page. `fixed` edits the given rows only (one item being changed);
   * `selectable` adds a tick per row for the scanner, where doubtful rows start unticked.
   */
  let { rows = $bindable(), newRow, fixed = false, selectable = false }: { rows: ItemRow[]; newRow: () => ItemRow; fixed?: boolean; selectable?: boolean } = $props()

  // A row is checked once it is left, not while it is being typed.
  let touched = $state(new Set<number>())
  /** Shows every mistake at once, when the form is sent with them. */
  export function touchAll() { touched = new Set(rows.map(row => row.id)) }

  let table: HTMLDivElement | undefined = $state()
  // Typing in the last line opens the next one, like a list in notes.
  function typed(row: ItemRow) {
    if (!fixed && row === rows.at(-1) && !blankRow(row)) rows.push(newRow())
  }
  async function addRow() {
    if (!rows.length || !blankRow(rows.at(-1)!)) rows.push(newRow())
    await tick()
    table?.querySelector<HTMLInputElement>('.draft-row:last-of-type .draft-name')?.focus()
  }
  function removeRow(row: ItemRow) {
    rows = rows.filter(entry => entry.id !== row.id)
    if (!rows.length) rows = [newRow()]
  }
  // Enter in a price moves to the next line's name instead of submitting half a check.
  async function next(event: KeyboardEvent, index: number) {
    if (fixed || event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (index === rows.length - 1) await addRow()
    else table?.querySelectorAll<HTMLInputElement>('.draft-name')[index + 1]?.focus()
  }
</script>

<div class="item-table" class:selectable>
  <div class="bill-line bill-head draft-line" aria-hidden="true">{#if selectable}<span></span>{/if}<span>Название</span><span class="bill-qty">Кол-во</span><span class="bill-price">Цена</span><span></span></div>
  <div class="draft-rows" bind:this={table}>
    {#each rows as row, i (row.id)}
      <div class="bill-line draft-line draft-row" class:off={row.include === false} class:suspect={row.suspect} class:invalid={touched.has(row.id) && !blankRow(row) && row.include !== false && !validRow(row)} onfocusout={() => { touched.add(row.id); touched = new Set(touched) }}>
        {#if selectable}<input class="draft-check" type="checkbox" checked={row.include !== false} onchange={(e) => row.include = e.currentTarget.checked} aria-label={`Добавить строку ${i + 1}`} />{/if}
        <input class="draft-name" bind:value={row.name} oninput={() => typed(row)} maxlength={scanLimits.nameLength} placeholder={i === 0 ? 'Плов' : ''} aria-label={`Название, строка ${i + 1}`} enterkeyhint="next" />
        <input class="draft-qty" type="number" bind:value={row.quantity} oninput={() => typed(row)} min="1" max={scanLimits.maxQuantity} step="1" inputmode="numeric" aria-label={`Количество, строка ${i + 1}`} enterkeyhint="next" />
        <input class="draft-price" type="number" bind:value={row.price} oninput={() => typed(row)} onkeydown={(e) => next(e, i)} min="1" max={limits.maxUnitPrice} step="1" inputmode="numeric" placeholder={i === 0 ? '45000' : ''} aria-label={`Цена за штуку, строка ${i + 1}`} enterkeyhint={fixed ? 'done' : 'next'} />
        {#if fixed || (blankRow(row) && i === rows.length - 1)}<span></span>
        {:else}<button type="button" class="icon-button small" aria-label={`Убрать строку ${i + 1}`} onclick={() => removeRow(row)}>×</button>{/if}
      </div>
    {/each}
  </div>
  {#if !fixed}<button type="button" class="add-more" onclick={addRow}>＋ Строка</button>{/if}
</div>
