<script lang="ts">
  import { tick } from 'svelte'
  import { limits } from '../lib/limits'
  import { scanLimits } from '../lib/receipt'
  import { blankRow, rowProblem, validRow, type ItemRow } from '../lib/rows'
  import Icon from './Icon.svelte'

  /**
   * The table of items as on the create page. `fixed` edits the given rows only (one item being changed).
   * Doubtful scanned rows (`suspect`) get a yellow frame until they are corrected or removed with ×.
   */
  let { rows = $bindable(), newRow, fixed = false }: { rows: ItemRow[]; newRow: () => ItemRow; fixed?: boolean } = $props()

  // A row is checked once it is left, not while it is being typed.
  let touched = $state(new Set<number>())
  /** Shows every mistake at once, when the form is sent with them, and puts the cursor in the first one (or the first name, with nothing typed). */
  export function touchAll() {
    touched = new Set(rows.map(row => row.id))
    const index = Math.max(0, rows.findIndex(row => !blankRow(row) && !validRow(row)))
    const problem = rows[index] ? rowProblem(rows[index]) ?? 'name' : 'name'
    const field = table?.querySelectorAll('.draft-row')[index]?.querySelector<HTMLElement>({ name: '.draft-name', quantity: '.draft-qty', price: '.draft-price' }[problem])
    field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    field?.focus({ preventScroll: true })
  }

  let table: HTMLDivElement | undefined = $state()
  // Typing in the last line opens the next one, like a list in notes.
  function typed(row: ItemRow) {
    row.suspect = false
    if (!fixed && row === rows.at(-1) && !blankRow(row)) rows.push(newRow())
  }
  async function addRow() {
    if (!rows.length || !blankRow(rows.at(-1)!)) rows.push(newRow())
    await tick()
    table?.querySelector<HTMLElement>('.draft-row:last-of-type .draft-name')?.focus()
  }
  function removeRow(row: ItemRow) {
    rows = rows.filter(entry => entry.id !== row.id)
    if (!rows.length) rows = [newRow()]
  }
  // A long name wraps onto more lines, as on the printed check; it stays one line of text, so a line break
  // pasted into it becomes a space and Enter moves on to the quantity.
  function fit(field: HTMLTextAreaElement) {
    field.style.height = 'auto'
    if (field.scrollHeight) field.style.height = `${field.scrollHeight}px`
  }
  const refit = () => table?.querySelectorAll<HTMLTextAreaElement>('textarea.draft-name').forEach(fit)
  function named(event: Event & { currentTarget: HTMLTextAreaElement }, row: ItemRow) {
    row.name = event.currentTarget.value.replace(/\s*\n+\s*/g, ' ')
    typed(row)
  }
  function nameKey(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    event.currentTarget.parentElement?.querySelector<HTMLInputElement>('.draft-qty')?.focus()
  }
  // Enter in a price moves to the next line's name instead of submitting half a check.
  async function next(event: KeyboardEvent, index: number) {
    if (fixed || event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (index === rows.length - 1) await addRow()
    else table?.querySelectorAll<HTMLElement>('.draft-name')[index + 1]?.focus()
  }
</script>

<svelte:window onresize={refit} />

<div class="item-table">
  <div class="bill-line bill-head draft-line" aria-hidden="true"><span>Название</span><span class="bill-qty">Кол-во</span><span class="bill-price">За шт.</span><span></span></div>
  <div class="draft-rows" bind:this={table}>
    {#each rows as row, i (row.id)}
      <div class="bill-line draft-line draft-row" class:suspect={row.suspect} class:invalid={touched.has(row.id) && !blankRow(row) && !validRow(row)} onfocusout={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; touched.add(row.id); touched = new Set(touched) }}>
        <textarea class="draft-name" rows="1" value={row.name} oninput={(e) => named(e, row)} onkeydown={nameKey} {@attach field => { void row.name; fit(field) }} maxlength={scanLimits.nameLength} placeholder={i === 0 ? 'Плов' : ''} aria-label={`Название, строка ${i + 1}`} enterkeyhint="next"></textarea>
        <input class="draft-qty" type="number" bind:value={row.quantity} oninput={() => typed(row)} min="1" max={scanLimits.maxQuantity} step="1" inputmode="numeric" aria-label={`Количество, строка ${i + 1}`} enterkeyhint="next" />
        <input class="draft-price" type="number" bind:value={row.price} oninput={() => typed(row)} onkeydown={(e) => next(e, i)} min="1" max={limits.maxUnitPrice} step="1" inputmode="numeric" placeholder={i === 0 ? '45000' : ''} aria-label={`Цена за штуку, строка ${i + 1}`} enterkeyhint={fixed ? 'done' : 'next'} />
        {#if fixed || (blankRow(row) && i === rows.length - 1)}<span></span>
        {:else}<button type="button" class="icon-button small" aria-label={`Убрать строку ${i + 1}`} onclick={() => removeRow(row)}><Icon name="close" /></button>{/if}
      </div>
    {/each}
  </div>
  {#if !fixed}<button type="button" class="add-more" onclick={addRow}><Icon name="plus" /> Строка</button>{/if}
</div>
