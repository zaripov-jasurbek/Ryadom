<script lang="ts">
  import { formatUzs, type ParticipantTotal } from '../lib/calculations'
  import { app } from '../lib/store.svelte'
  import { detailItems } from '../lib/export'

  // You first, then the rest in the order they joined.
  const people = $derived([...app.totals].sort((a, b) => Number(b.id === app.selectedPerson) - Number(a.id === app.selectedPerson)))

  // What each amount is made of opens under the name, one person or several at a time.
  let opened = $state(new Set<string>())
  function toggleDetails(id: string) {
    const next = new Set(opened)
    if (!next.delete(id)) next.add(id)
    opened = next
  }

  // Two ticks per debtor: grey, then the first green when the guest says they paid, both green once the creator confirms.
  const mine = $derived(app.isOwner ? undefined : app.currentTotal)
  const marked = (person: ParticipantTotal) => person.mark === 'marked'
    function toggleMine() {
    if (!mine || app.isPending(`pay:${mine.id}`) || mine.mark === 'confirmed') return
    void app.markPaid(!marked(mine))
  }
  // The creator confirms after the guest's ✓ or without it (cash handed over), and can take ✓✓ back.
  async function review(person: ParticipantTotal) {
    if (marked(person)) void app.approve(person.id)
    else if (person.mark === 'confirmed') { if (await app.confirm({ title: `Снять подтверждение у ${app.label(person)}?`, action: 'Снять' })) void app.unconfirm(person.id) }
    else if (await app.confirm({ title: `${app.label(person)} оплатил?`, action: 'Подтвердить' })) void app.approve(person.id)
  }
</script>

<!-- Who owes what, right under the check's total. Each debtor has two grey ticks: the guest turns the first green, the creator both. -->
<div class="bill-people" aria-label="Кто сколько должен">
  {#each people as person (person.id)}
    {@const payer = person.id === app.ownerId}
    {@const own = Boolean(mine && person.id === mine.id && mine.due > 0)}
    {@const reviewable = app.isOwner && !payer && (person.due > 0 || person.mark === 'confirmed')}
    {@const first = marked(person) || person.mark === 'confirmed'}
    {@const both = person.mark === 'confirmed'}
    {@const open = opened.has(person.id)}
    <!-- Worked out only for an opened row: with 50 people and 100 dishes, all of them on every update was slow. -->
    {@const lines = open ? detailItems(app.bill!, person) : []}
    {@const hasDetails = person.subtotal > 0 || person.service > 0}
    {@const label = both ? 'Оплата подтверждена' : first ? 'Оплатил, ждёт подтверждения' : 'Не оплачено'}
    <div class="summary-person" class:is-me={app.selectedPerson === person.id}>
      <div class="summary-person-main">
        <span class="person-avatar tone-{app.tone(person.id)}">{app.avatar(person)}</span>
        <span class="summary-person-name">
          <b>{app.label(person)}</b>
          {#if hasDetails}<button type="button" class="details-toggle" aria-expanded={open} aria-controls={`details-${person.id}`} onclick={() => toggleDetails(person.id)}>Детали <span class="details-caret" aria-hidden="true">▾</span></button>{/if}
        </span>
        <span class="summary-person-total">
          <b>{formatUzs(person.due)}</b>
          {#if own || reviewable}
            <button type="button" class="pay-marks" class:first class:both disabled={app.isPending(`pay:${person.id}`) || (own && both)} aria-label={own && !first ? 'Я оплатил' : label} onclick={() => own ? toggleMine() : review(person)}><span>✓</span><span>✓</span></button>
          {:else if !payer && (person.due > 0 || both)}
            <span class="pay-marks" class:first class:both aria-label={label}><span>✓</span><span>✓</span></span>
          {/if}
        </span>
      </div>
      {#if open && lines.length}
        <ul class="person-details" id={`details-${person.id}`}>
          {#each lines as line, i (i)}<li><span>{line.label}</span><b>{formatUzs(line.amount)}</b></li>{/each}
        </ul>
      {/if}
    </div>
  {/each}
</div>
