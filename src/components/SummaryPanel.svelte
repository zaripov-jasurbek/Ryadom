<script lang="ts">
  import { formatUzs, type ParticipantTotal } from '../lib/calculations'
  import { app } from '../lib/store.svelte'

  // You first, then the rest in the order they joined.
  const people = $derived([...app.totals].sort((a, b) => Number(b.id === app.selectedPerson) - Number(a.id === app.selectedPerson)))

  // The amount a guest says they sent is the payment itself: the whole part by default, or whatever they type.
  const mine = $derived(app.isOwner ? undefined : app.currentTotal)
  let typed = $state<number | null>(null)
  const amount = $derived(Math.max(0, Math.floor(typed ?? (mine?.paid || mine?.due || 0))))
  const unchanged = $derived(Boolean(mine && mine.status !== 'unpaid' && amount === mine.paid))
  async function pay(event: SubmitEvent) {
    event.preventDefault()
    if (!mine || app.busy || unchanged) return
    if (await app.submitPayment(amount)) typed = null
  }

  // Telegram-like marks: ✓ the guest says they paid, ✓✓ the creator confirmed it.
  const mark = (person: ParticipantTotal) => person.status === 'paid' ? '✓✓' : person.status === 'proof_submitted' || person.status === 'partially_paid' ? '✓' : ''
  async function review(person: ParticipantTotal) {
    if (person.status === 'proof_submitted') void app.approve(person.id)
    else if (person.status === 'paid' && await app.confirm({ title: `Снять подтверждение у ${app.label(person)}?`, action: 'Снять' })) void app.unconfirm(person.id)
  }
</script>

{#snippet row(person: ParticipantTotal)}
  {@const payer = person.id === app.ownerId}
  <span class="person-avatar tone-{app.tone(person.id)}">{app.avatar(person)}</span>
  <span class="summary-person-name">
    <b>{app.label(person)}</b>
    {#if payer}<small>платил по счёту</small>
    {:else if person.status === 'partially_paid'}<small>перевёл {formatUzs(person.paid)} из {formatUzs(person.due)}</small>
    {:else if person.overpaid}<small>переплатил {formatUzs(person.overpaid)}</small>{/if}
  </span>
  <span class="summary-person-total">
    <b>{formatUzs(person.due)}</b>
    {#if !payer && mark(person)}<span class="pay-mark" class:double={person.status === 'paid'} class:part={person.status === 'partially_paid'} aria-label={person.status === 'paid' ? 'Оплата подтверждена' : 'Перевёл'}>{mark(person)}</span>{/if}
  </span>
  {#if app.isOwner && person.status === 'proof_submitted'}<span class="confirm-hint">Подтвердить</span>{/if}
{/snippet}

<!-- Who owes what, right under the check's total. -->
<div class="bill-people" aria-label="Кто сколько должен">
  {#each people as person (person.id)}
    {@const reviewable = app.isOwner && person.id !== app.ownerId && (person.status === 'proof_submitted' || person.status === 'paid')}
    <div class="summary-person" class:is-me={app.selectedPerson === person.id}>
      <!-- The creator confirms a payment by tapping the person, and taps again to take it back. -->
      {#if reviewable}
        <button type="button" class="summary-person-main" disabled={app.busy} onclick={() => review(person)}>{@render row(person)}</button>
      {:else}
        <div class="summary-person-main">{@render row(person)}</div>
      {/if}
      {#if mine && person.id === mine.id && mine.due > 0}
        <form class="pay-inline" onsubmit={pay}>
          <span class="suffix-input"><input type="number" min="0" step="1" inputmode="numeric" aria-label="Сколько вы перевели" value={amount} oninput={(e) => typed = e.currentTarget.value === '' ? 0 : Number(e.currentTarget.value)} /><span>сум</span></span>
          <button class="accent-button" disabled={app.busy || unchanged}>{unchanged ? '✓ Перевёл' : 'Перевёл'}</button>
        </form>
      {/if}
    </div>
  {/each}
</div>
