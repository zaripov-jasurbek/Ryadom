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

  // A payment is a status under the name: the guest says «Я оплатил», the creator confirms with «Рассчитался».
  const mine = $derived(app.isOwner ? undefined : app.currentTotal)
  const ownerName = $derived(app.totals.find(person => person.id === app.ownerId)?.name ?? 'Создатель')
  function toggleMine() {
    if (!mine || app.isPending(`pay:${mine.id}`) || mine.mark === 'confirmed') return
    void app.markPaid(mine.mark !== 'marked')
  }
  // The creator confirms after the guest's mark or without it (cash handed over), and can take it back.
  async function review(person: ParticipantTotal) {
    const name = app.label(person)
    if (person.mark === 'marked') void app.approve(person.id)
    else if (person.mark === 'confirmed') { if (await app.confirm({ title: `${name}: снять «Рассчитался»?`, action: 'Снять' })) void app.unconfirm(person.id) }
    else if (await app.confirm({ title: `${name}: отметить «Рассчитался»?`, action: 'Отметить' })) void app.approve(person.id)
  }
  // What the status says, by who is looking: the guest themself, the creator, or anyone else.
  function status(person: ParticipantTotal, own: boolean) {
    if (own) return person.mark === 'confirmed' ? `${ownerName}: подтверждено ✓` : person.mark === 'marked' ? '✓ Оплатил' : 'Я оплатил'
    if (app.isOwner) return person.mark === 'confirmed' ? 'Рассчитался ✓' : person.mark === 'marked' ? 'Оплатил · Подтвердить' : 'Не оплатил'
    return person.mark === 'confirmed' ? 'Рассчитался ✓' : person.mark === 'marked' ? 'Оплатил' : 'Не оплатил'
  }
  function hint(person: ParticipantTotal, own: boolean) {
    if (own) return person.mark === 'marked' ? 'Оплатил, ждёт подтверждения. Нажмите, чтобы отменить' : 'Отметить, что я оплатил'
    return person.mark === 'confirmed' ? 'Рассчитался. Нажмите, чтобы снять' : person.mark === 'marked' ? 'Гость оплатил. Нажмите, чтобы подтвердить' : 'Не оплатил. Нажмите, чтобы отметить «Рассчитался»'
  }
</script>

<!-- Who owes what, right under the check's total. Under each debtor's name, their payment status: a button for whoever can change it. -->
<div class="bill-people" aria-label="Кто сколько должен">
  {#each people as person (person.id)}
    {@const payer = person.id === app.ownerId}
    {@const own = Boolean(mine && person.id === mine.id && mine.due > 0)}
    {@const reviewable = app.isOwner && !payer && (person.due > 0 || person.mark === 'confirmed')}
    {@const showStatus = !payer && (person.due > 0 || person.mark === 'confirmed')}
    {@const open = opened.has(person.id)}
    <!-- Worked out only for an opened row: with 50 people and 100 dishes, all of them on every update was slow. -->
    {@const lines = open ? detailItems(app.bill!, person) : []}
    {@const hasDetails = person.subtotal > 0 || person.service > 0}
    <div class="summary-person" class:is-me={app.selectedPerson === person.id}>
      <div class="summary-person-main">
        <span class="person-avatar tone-{app.tone(person.id)}">{app.avatar(person)}</span>
        <span class="summary-person-name">
          <b>{app.label(person)}</b>
          {#if showStatus || hasDetails}
            <span class="summary-person-meta">
              {#if (own || reviewable) && !(own && person.mark === 'confirmed')}
                <button type="button" class="pay-status is-{person.mark}" class:is-action={own && person.mark === 'none'} disabled={app.isPending(`pay:${person.id}`)} aria-label={hint(person, own)} onclick={() => own ? toggleMine() : review(person)}>{status(person, own)}</button>
              {:else if showStatus}
                <span class="pay-status is-{person.mark}">{status(person, own)}</span>
              {/if}
              {#if hasDetails}<button type="button" class="details-toggle" aria-expanded={open} aria-controls={`details-${person.id}`} onclick={() => toggleDetails(person.id)}>Детали <span class="details-caret" aria-hidden="true">▾</span></button>{/if}
            </span>
          {/if}
        </span>
        <span class="summary-person-total"><b>{formatUzs(person.due)}</b></span>
      </div>
      {#if open && lines.length}
        <ul class="person-details" id={`details-${person.id}`}>
          {#each lines as line, i (i)}<li><span>{line.label}</span><b>{formatUzs(line.amount)}</b></li>{/each}
        </ul>
      {/if}
    </div>
  {/each}
</div>
