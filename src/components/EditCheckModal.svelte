<script lang="ts">
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  const bill = app.bill!
  let title = $state(bill.title)
  let fee = $state<number | null>(bill.servicePercent)
  let paymentDetails = $state(bill.paymentDetails ?? '')
  // Same checks as CreatePage and update_check on the server.
  const feeValid = $derived(typeof fee === 'number' && Number.isFinite(fee) && fee >= 0 && fee <= 100)
  const ready = $derived(Boolean(title.trim()) && feeValid)

  async function submit() {
    if (!ready || app.busy) return
    const percent = Math.round(fee! * 100) / 100
    const details = paymentDetails.trim()
    if (title.trim() === bill.title && percent === bill.servicePercent && details === (bill.paymentDetails ?? '')) { app.checkEditOpen = false; return }
    if (await app.updateCheck(title.trim(), percent, details)) app.checkEditOpen = false
  }
</script>

<Modal labelledby="edit-check-title" onclose={() => app.checkEditOpen = false} onsubmit={() => void submit()}>
  <div class="eyebrow">Настройки чека</div>
  <h2 id="edit-check-title">Изменить чек</h2>
  <label class="field">Название<input bind:value={title} maxlength={limits.titleLength} required /></label>
  <label class="field"><span>Обслуживание <span class="label-hint">{feeValid ? 'делится пропорционально' : 'от 0 до 100%'}</span></span>
    <span class="suffix-input"><input type="number" bind:value={fee} min="0" max="100" step="0.01" inputmode="decimal" aria-invalid={!feeValid} /><span>%</span></span>
  </label>
  <div class="chip-row" role="group" aria-label="Быстрый выбор процента">
    {#each [0, 10, 12, 15] as preset (preset)}<button type="button" class="chip" class:active={fee === preset} onclick={() => fee = preset}>{preset}%</button>{/each}
  </div>
  {#if feeValid && fee! > bill.servicePercent && bill.participants.some(person => person.status === 'paid' || person.status === 'proof_submitted')}
    <p class="modal-warning">Итоги вырастут — подтверждённые оплаты, которых теперь не хватает, откроются снова.</p>
  {/if}
  <label class="field"><span>Карта или телефон для перевода <span class="label-hint">по желанию</span></span><input bind:value={paymentDetails} placeholder="8600 1234 5678 9012" maxlength={limits.paymentDetailsLength} autocomplete="off" /></label>
  <p class="field-note">Гости увидят его в итогах и скопируют в одно касание. Срок действия карты и коды из SMS не нужны никогда.</p>
  <button class="primary-button wide" disabled={app.busy || !ready}>Сохранить <span aria-hidden="true">✓</span></button>
</Modal>
