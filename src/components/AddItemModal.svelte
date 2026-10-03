<script lang="ts">
  import { formatUzs } from '../lib/calculations'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  let name = $state('')
  let quantity = $state<number | null>(1)
  let price = $state<number | null>(null)
  // Same limits as add_item on the server.
  const qty = $derived(Math.floor(Number(quantity) || 0))
  const valid = $derived(Boolean(name.trim()) && qty >= 1 && qty <= 99 && typeof price === 'number' && price >= 1)

  async function submit() {
    if (!valid || app.busy) return
    if (await app.addItem(name.trim(), qty, Math.floor(price!))) app.addItemOpen = false
  }
</script>

<Modal labelledby="add-item-title" onclose={() => app.addItemOpen = false} onsubmit={() => void submit()}>
  <div class="eyebrow">Новая позиция</div>
  <h2 id="add-item-title">Что было на столе?</h2>
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
  <div class="modal-total">Сумма позиции <b>{formatUzs(Math.max(0, qty * Math.floor(price ?? 0)))}</b></div>
  <button class="primary-button wide" disabled={app.busy || !valid}>Добавить позицию <span aria-hidden="true">＋</span></button>
</Modal>
