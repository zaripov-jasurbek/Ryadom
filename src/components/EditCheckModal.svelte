<script lang="ts">
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'
  import GuestsStepper from './GuestsStepper.svelte'

  const bill = app.bill!
  let title = $state(bill.title)
  let fee = $state<number | null>(bill.servicePercent)
  let paymentDetails = $state(bill.paymentDetails ?? '')
  // Never fewer than the people already in the check; older checks without a number start from them.
  const present = bill.participants.length
  let guests = $state(Math.max(bill.expectedGuests ?? present, present))
  const sharedItems = bill.items.some(item => item.sharedAll)
  // Same checks as CreatePage and update_check on the server.
  const feeValid = $derived(typeof fee === 'number' && Number.isFinite(fee) && fee >= 0 && fee <= 100)
  const ready = $derived(Boolean(title.trim()) && feeValid)

  async function submit() {
    if (!ready || app.busy) return
    const percent = Math.round(fee! * 100) / 100
    const details = paymentDetails.trim()
    const guestsChanged = guests !== Math.max(bill.expectedGuests ?? present, present)
    if (title.trim() === bill.title && percent === bill.servicePercent && details === (bill.paymentDetails ?? '') && !guestsChanged) { app.checkEditOpen = false; return }
    if (await app.updateCheck(title.trim(), percent, details, guestsChanged ? guests : undefined)) app.checkEditOpen = false
  }
  // Rare and final, so it lives here rather than at the bottom of every check page.
  async function removeBill() {
    app.checkEditOpen = false
    if (await app.confirm({ title: `Удалить чек «${bill.title}»?`, body: 'Чек удалится у всех. Это не отменить.', action: 'Удалить чек', danger: true })) void app.removeBill()
  }
</script>

<Modal labelledby="edit-check-title" onclose={() => app.checkEditOpen = false} onsubmit={() => void submit()}>
  <h2 id="edit-check-title">Настройки чека</h2>
  <label class="field">Название<input bind:value={title} maxlength={limits.titleLength} required /></label>
  <GuestsStepper bind:value={guests} min={present} />
  {#if sharedItems && guests !== Math.max(bill.expectedGuests ?? present, present)}
    <p class="modal-warning">Позиции «на всех» пересчитаются на {guests}.</p>
  {/if}
  <label class="field"><span>Обслуживание <span class="label-hint">{feeValid ? '' : 'от 0 до 100%'}</span></span>
    <span class="suffix-input"><input type="number" bind:value={fee} min="0" max="100" step="0.01" inputmode="decimal" aria-invalid={!feeValid} /><span>%</span></span>
  </label>
  <div class="chip-row" role="group" aria-label="Быстрый выбор процента">
    {#each [0, 10, 12, 15] as preset (preset)}<button type="button" class="chip" class:active={fee === preset} onclick={() => fee = preset}>{preset ? `${preset}%` : 'Нет'}</button>{/each}
  </div>
  {#if feeValid && fee! > bill.servicePercent && bill.participants.some(person => person.status === 'paid' || person.status === 'proof_submitted')}
    <p class="modal-warning">Суммы вырастут — часть оплат придётся подтвердить заново.</p>
  {/if}
  <label class="field"><span>Карта или телефон для перевода <span class="label-hint">по желанию</span></span><input bind:value={paymentDetails} placeholder="8600 1234 5678 9012" maxlength={limits.paymentDetailsLength} autocomplete="off" /></label>
  <p class="field-note">Только номер: срок действия и коды из SMS не нужны.</p>
  <button class="primary-button wide" disabled={app.busy || !ready}>Сохранить <span aria-hidden="true">✓</span></button>
  <button type="button" class="ghost-button danger" onclick={removeBill}>Удалить чек</button>
</Modal>
