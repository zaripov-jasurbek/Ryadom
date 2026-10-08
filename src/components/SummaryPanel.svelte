<script lang="ts">
  import { formatUzs, type ParticipantTotal } from '../lib/calculations'
  import { app } from '../lib/store.svelte'

  // You first, then the rest in the order they joined.
  const people = $derived([...app.totals].sort((a, b) => Number(b.id === app.selectedPerson) - Number(a.id === app.selectedPerson)))

  // Telegram-like marks: ✓ the guest says they paid, ✓✓ the creator confirmed it. No amounts, no partial payments.
  const mine = $derived(app.isOwner ? undefined : app.currentTotal)
  const marked = (person: ParticipantTotal) => person.status === 'proof_submitted'
  const mark = (person: ParticipantTotal) => person.status === 'paid' ? '✓✓' : marked(person) ? '✓' : ''
  function toggleMine() {
    if (!mine || app.busy || mine.status === 'paid') return
    void app.markPaid(!marked(mine))
  }
  // The creator confirms after the guest's ✓ or without it (cash handed over), and can take ✓✓ back.
  async function review(person: ParticipantTotal) {
    if (marked(person)) void app.approve(person.id)
    else if (person.status === 'paid') { if (await app.confirm({ title: `Снять подтверждение у ${app.label(person)}?`, action: 'Снять' })) void app.unconfirm(person.id) }
    else if (await app.confirm({ title: `${app.label(person)} оплатил?`, action: 'Подтвердить' })) void app.approve(person.id)
  }
</script>

{#snippet row(person: ParticipantTotal)}
  {@const payer = person.id === app.ownerId}
  <span class="person-avatar tone-{app.tone(person.id)}">{app.avatar(person)}</span>
  <span class="summary-person-name">
    <b>{app.label(person)}</b>
    {#if payer}<small>платил по счёту</small>
    {:else if mine && person.id === mine.id && mine.due > 0 && !mark(person)}<small>отметьте, когда оплатите</small>
    {:else if person.overpaid}<small>переплатил {formatUzs(person.overpaid)}</small>{/if}
  </span>
  <span class="summary-person-total">
    <b>{formatUzs(person.due)}</b>
    {#if mine && person.id === mine.id && mine.due > 0}
      <button type="button" class="pay-check" class:on={mark(person)} class:double={person.status === 'paid'} disabled={app.busy || person.status === 'paid'} aria-pressed={Boolean(mark(person))} aria-label={person.status === 'paid' ? 'Оплата подтверждена' : 'Я оплатил'} onclick={toggleMine}>{mark(person)}</button>
    {:else if !payer && mark(person)}<span class="pay-mark" class:double={person.status === 'paid'} aria-label={person.status === 'paid' ? 'Оплата подтверждена' : 'Оплатил'}>{mark(person)}</span>{/if}
  </span>
  {#if app.isOwner && marked(person)}<span class="confirm-hint">Подтвердить</span>{/if}
{/snippet}

<!-- Who owes what, right under the check's total. -->
<div class="bill-people" aria-label="Кто сколько должен">
  {#each people as person (person.id)}
    {@const reviewable = app.isOwner && person.id !== app.ownerId && (person.due > 0 || person.status === 'paid')}
    <div class="summary-person" class:is-me={app.selectedPerson === person.id}>
      <!-- The creator confirms a payment by tapping the person, and taps again to take it back. -->
      {#if reviewable}
        <button type="button" class="summary-person-main" disabled={app.busy} onclick={() => review(person)}>{@render row(person)}</button>
      {:else}
        <div class="summary-person-main">{@render row(person)}</div>
      {/if}
    </div>
  {/each}
</div>
