<script lang="ts">
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  // Only the card: opened from the payment tab, where the rest of the check's settings would be in the way.
  const bill = app.bill!
  let details = $state(bill.paymentDetails ?? '')

  async function submit() {
    if (app.busy) return
    const value = details.trim()
    if (value === (bill.paymentDetails ?? '')) { app.payDetailsOpen = false; return }
    if (await app.updateCheck(bill.title, bill.servicePercent, value)) app.payDetailsOpen = false
  }
</script>

<Modal labelledby="pay-details-title" onclose={() => app.payDetailsOpen = false} onsubmit={() => void submit()}>
  <div class="eyebrow">Оплата</div>
  <h2 id="pay-details-title">Куда гостям переводить?</h2>
  <!-- svelte-ignore a11y_autofocus -->
  <label class="field">Карта или телефон<input bind:value={details} placeholder="8600 1234 5678 9012" maxlength={limits.paymentDetailsLength} autocomplete="off" inputmode="text" autofocus /></label>
  <p class="field-note">Только номер: срок действия и коды из SMS не нужны.</p>
  <button class="primary-button wide" disabled={app.busy}>Сохранить <span aria-hidden="true">✓</span></button>
</Modal>
