<script lang="ts">
  import { untrack } from 'svelte'
  import { formatUzs, isUnitAssigned, type BillItem } from '../lib/calculations'
  import { plural } from '../lib/format'
  import { filledRows, rowsTotal, toItems, validRow, type ItemRow } from '../lib/rows'
  import { app } from '../lib/store.svelte'
  import ItemTable from './ItemTable.svelte'
  import Modal from './Modal.svelte'

  /** Without an item the modal adds new ones, several at once like the create page; with one it edits it. */
  let { item = null }: { item?: BillItem | null } = $props()
  // The form edits a copy taken when it opens; refreshes from other devices do not reset what is typed.
  const editing = untrack(() => item)

  let seq = 0
  const newRow = (): ItemRow => ({ id: seq++, name: '', quantity: 1, price: null })
  let rows = $state<ItemRow[]>(editing ? [{ id: seq++, name: editing.name, quantity: editing.quantity, price: editing.unitPrice }] : [newRow()])
  let table: ItemTable | undefined = $state()

  const filled = $derived(filledRows(rows))
  const ready = $derived(filled.length > 0 && filled.every(validRow))
  const total = $derived(rowsTotal(filled))
  const row = $derived(rows[0])
  const changed = $derived(!editing || row.name.trim() !== editing.name || row.quantity !== editing.quantity || row.price !== editing.unitPrice)

  // What the server will do to the marks, so the creator is not surprised.
  const warnings = $derived.by(() => {
    if (!editing || !ready) return []
    const qty = row.quantity!
    const list: string[] = []
    const units = Array.from({ length: editing.quantity }, (_, unit) => unit)
    if (units.some(unit => unit >= qty && isUnitAssigned(editing, unit))) list.push('Отметки на убранных порциях пропадут.')
    if (row.price !== editing.unitPrice && units.some(unit => unit < qty && editing.unitModes?.[String(unit)] === 'custom')) list.push('Доли, распределённые вручную, станут поровну.')
    return list
  })

  function close() { if (editing) app.editingItem = null; else app.addItemOpen = false }

  async function submit() {
    if (!ready || app.busy) { table?.touchAll(); return }
    if (!changed) { close(); return }
    if (editing) { if (await app.updateItem(editing, row.name.trim(), row.quantity!, row.price!)) close(); return }
    const items = toItems(filled)
    const added = await app.addItems(items)
    if (added === items.length) { app.notify(`Добавлено ${plural(added, 'позиция', 'позиции', 'позиций')}`); close(); return }
    // Keep what was not added so the owner can retry without typing again.
    const addedIds = new Set(filled.slice(0, added).map(entry => entry.id))
    rows = rows.filter(entry => !addedIds.has(entry.id))
  }
</script>

<Modal labelledby="add-item-title" onclose={close} onsubmit={() => void submit()}>
  <div class="eyebrow">{editing ? 'Изменить позицию' : 'Новые позиции'}</div>
  <h2 id="add-item-title">{editing ? 'Исправим позицию' : 'Что было на столе?'}</h2>
  <ItemTable bind:this={table} bind:rows {newRow} fixed={Boolean(editing)} />
  <div class="modal-total">{editing ? 'Сумма позиции' : 'Сумма'} <b>{formatUzs(total)}</b></div>
  {#each warnings as warning (warning)}<p class="modal-warning">{warning}</p>{/each}
  <button class="primary-button wide" disabled={app.busy}>{#if editing}Сохранить <span aria-hidden="true">✓</span>{:else}{app.busy ? 'Добавляем…' : filled.length ? `Добавить ${plural(filled.length, 'позицию', 'позиции', 'позиций')}` : 'Добавить'} <span aria-hidden="true">＋</span>{/if}</button>
</Modal>
