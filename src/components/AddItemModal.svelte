<script lang="ts">
  import { untrack } from 'svelte'
  import { formatUzs, isUnitAssigned, type BillItem } from '../lib/calculations'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  /** Without an item the modal adds a new one; with one it edits it. */
  let { item = null }: { item?: BillItem | null } = $props()
  // The form edits a copy taken when it opens; refreshes from other devices do not reset what is typed.
  const editing = untrack(() => item)

  let name = $state(editing?.name ?? '')
  let quantity = $state<number | null>(editing?.quantity ?? 1)
  let price = $state<number | null>(editing?.unitPrice ?? null)
  // Same limits as add_item on the server.
  const qty = $derived(Math.floor(Number(quantity) || 0))
  const valid = $derived(Boolean(name.trim()) && qty >= 1 && qty <= 99 && typeof price === 'number' && price >= 1)
  const unitPrice = $derived(Math.floor(price ?? 0))
  const changed = $derived(!editing || name.trim() !== editing.name || qty !== editing.quantity || unitPrice !== editing.unitPrice)

  // What the server will do to the marks, so the creator is not surprised.
  const warnings = $derived.by(() => {
    if (!editing || !valid) return []
    const list: string[] = []
    const units = Array.from({ length: editing.quantity }, (_, unit) => unit)
    if (units.some(unit => unit >= qty && isUnitAssigned(editing, unit))) list.push('Отметки на убранных порциях пропадут.')
    if (unitPrice !== editing.unitPrice && units.some(unit => unit < qty && editing.unitModes?.[String(unit)] === 'custom')) list.push('Доли, распределённые вручную, станут поровну.')
    return list
  })

  function close() { if (editing) app.editingItem = null; else app.addItemOpen = false }

  async function submit() {
    if (!valid || app.busy) return
    if (!changed) { close(); return }
    const saved = editing ? await app.updateItem(editing, name.trim(), qty, unitPrice) : await app.addItem(name.trim(), qty, unitPrice)
    if (saved) close()
  }
</script>

<Modal labelledby="add-item-title" onclose={close} onsubmit={() => void submit()}>
  <div class="eyebrow">{editing ? 'Изменить позицию' : 'Новая позиция'}</div>
  <h2 id="add-item-title">{editing ? 'Исправим позицию' : 'Что было на столе?'}</h2>
  <!-- svelte-ignore a11y_autofocus -->
  <label class="field">Название<input bind:value={name} placeholder="Например, Пицца пепперони" maxlength="48" autofocus /></label>
  <div class="modal-fields">
    <label class="field">Количество
      <span class="stepper">
        <button type="button" aria-label="Меньше" disabled={qty <= 1} onclick={() => quantity = Math.max(1, qty - 1)}>−</button>
        <input type="number" bind:value={quantity} min="1" max="99" step="1" inputmode="numeric" aria-invalid={qty < 1 || qty > 99} />
        <button type="button" aria-label="Больше" disabled={qty >= 99} onclick={() => quantity = Math.min(99, qty + 1)}>+</button>
      </span>
    </label>
    <label class="field">Цена за штуку<span class="suffix-input"><input type="number" bind:value={price} min="1" step="1" inputmode="numeric" placeholder="0" /><span>сум</span></span></label>
  </div>
  <div class="modal-total">Сумма позиции <b>{formatUzs(Math.max(0, qty * unitPrice))}</b></div>
  {#each warnings as warning (warning)}<p class="modal-warning">{warning}</p>{/each}
  <button class="primary-button wide" disabled={app.busy || !valid}>{#if editing}Сохранить <span aria-hidden="true">✓</span>{:else}Добавить позицию <span aria-hidden="true">＋</span>{/if}</button>
</Modal>
