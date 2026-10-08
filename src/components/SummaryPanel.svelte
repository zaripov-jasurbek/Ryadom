<script lang="ts">
  import { formatUzs, type ParticipantTotal } from '../lib/calculations'
  import { app } from '../lib/store.svelte'

  // You first, then the rest in the order they joined.
  const people = $derived([...app.totals].sort((a, b) => Number(b.id === app.selectedPerson) - Number(a.id === app.selectedPerson)))

  // Two ticks per debtor: grey, then the first green when the guest says they paid, both green once the creator confirms.
  const mine = $derived(app.isOwner ? undefined : app.currentTotal)
  const marked = (person: ParticipantTotal) => person.status === 'proof_submitted'
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

<!-- Who owes what, right under the check's total. Each debtor has two grey ticks: the guest turns the first green, the creator both. -->
<div class="bill-people" aria-label="Кто сколько должен">
  {#each people as person (person.id)}
    {@const payer = person.id === app.ownerId}
    {@const own = Boolean(mine && person.id === mine.id && mine.due > 0)}
    {@const reviewable = app.isOwner && !payer && (person.due > 0 || person.status === 'paid')}
    {@const first = marked(person) || person.status === 'paid'}
    {@const both = person.status === 'paid'}
    {@const label = both ? 'Оплата подтверждена' : first ? 'Оплатил, ждёт подтверждения' : 'Не оплачено'}
    <div class="summary-person" class:is-me={app.selectedPerson === person.id}>
      <div class="summary-person-main">
        <span class="person-avatar tone-{app.tone(person.id)}">{app.avatar(person)}</span>
        <span class="summary-person-name"><b>{app.label(person)}</b></span>
        <span class="summary-person-total">
          <b>{formatUzs(person.due)}</b>
          {#if own || reviewable}
            <button type="button" class="pay-marks" class:first class:both disabled={app.busy || (own && both)} aria-label={own && !first ? 'Я оплатил' : label} onclick={() => own ? toggleMine() : review(person)}><span>✓</span><span>✓</span></button>
          {:else if !payer && (person.due > 0 || both)}
            <span class="pay-marks" class:first class:both aria-label={label}><span>✓</span><span>✓</span></span>
          {/if}
        </span>
      </div>
    </div>
  {/each}
</div>
