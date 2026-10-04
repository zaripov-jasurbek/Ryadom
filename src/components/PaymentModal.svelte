<script lang="ts">
  import { formatUzs } from '../lib/calculations'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'
  import PaymentDetails from './PaymentDetails.svelte'

  let { personId }: { personId: string } = $props()
  const person = app.bill?.participants.find(entry => entry.id === personId)
  const due = $derived(app.dueOf(personId))
  let paid = $state<number | null>(person?.paid ?? 0)
  let proof = $state(person?.proofUrl ?? '')
  const amount = $derived(Math.max(0, Math.floor(Number(paid) || 0)))
  const full = $derived(amount >= due)

  async function submit() {
    if (app.busy) return
    if (await app.submitPayment(personId, amount, proof.trim() || null)) app.paymentFor = null
  }
</script>

<Modal labelledby="payment-title" onclose={() => app.paymentFor = null} onsubmit={() => void submit()}>
  <div class="eyebrow">Ваш платёж</div>
  <h2 id="payment-title">Сколько уже оплатили?</h2>
  <p class="lead">К оплате <b>{formatUzs(due)}</b>. {full ? 'Создатель чека увидит, что вы оплатили всё, и подтвердит.' : 'Можно отметить и частичную оплату.'}</p>
  {#if app.bill?.paymentDetails}<PaymentDetails details={app.bill.paymentDetails} owner={app.ownerId ? app.personName(app.ownerId) : ''} />{/if}
  <label class="field">Сумма
    <span class="suffix-input"><input type="number" bind:value={paid} min="0" max={due} step="1" inputmode="numeric" /><span>сум</span></span>
  </label>
  <div class="chip-row"><button type="button" class="chip" class:active={amount === due} onclick={() => paid = due}>Вся сумма</button><button type="button" class="chip" onclick={() => paid = 0}>Сбросить</button></div>
  <label class="field"><span>Ссылка на чек перевода <span class="label-hint">по желанию</span></span><input type="url" bind:value={proof} placeholder="https://…" /></label>
  <button class="primary-button wide" disabled={app.busy}>Отправить создателю <span aria-hidden="true">↗</span></button>
</Modal>
