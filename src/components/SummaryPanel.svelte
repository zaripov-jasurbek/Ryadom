<script lang="ts">
  import { flushSync } from 'svelte'
  import { formatUzs, personItems, type ParticipantTotal } from '../lib/calculations'
  import { saveImage, saveText, summaryText } from '../lib/export'
  import { expiryDate, initial, plural, statusLabels } from '../lib/format'
  import { expiresAt } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import PaymentDetails from './PaymentDetails.svelte'
  import Amount from './Amount.svelte'

  const bill = $derived(app.bill!)
  const percent = (part: number, whole: number) => whole ? Math.min(100, part / whole * 100) : 0
  const paidPercent = $derived(percent(app.paidAll, app.billTotal))
  const ownerName = $derived(app.ownerId ? app.personName(app.ownerId) : '')
  const text = () => summaryText(bill, app.billTotal, app.totals, app.ownerId)
  // What this person came to the summary for: their own amount and how to pay it, before everyone else's.
  const mine = $derived(app.isOwner ? undefined : app.currentTotal)
  const myNote = $derived.by(() => {
    if (!mine) return ''
    if (!mine.due) return 'Отметьте свои блюда в «Позициях».'
    if (mine.status === 'paid') return 'Оплата подтверждена.'
    if (mine.status === 'proof_submitted') return `Ждём подтверждения${ownerName ? ` от ${ownerName}` : ''}.`
    if (mine.paid > 0) return `Отдали ${formatUzs(mine.paid)} · осталось ${formatUzs(mine.remaining)}.`
    return `Переведите${ownerName ? ` ${ownerName}` : ' создателю'} или отдайте наличными.`
  })
  const others = $derived(app.totals.filter(person => person.id !== app.ownerId))
  const owed = $derived(others.reduce((sum, person) => sum + person.remaining, 0))
  const toConfirm = $derived(others.filter(person => person.status === 'proof_submitted').length)
  // You first, then the rest in the order they joined.
  const people = $derived([...app.totals].sort((a, b) => Number(b.id === app.selectedPerson) - Number(a.id === app.selectedPerson)))
  // The PDF is the printed page, so every breakdown opens for it.
  let printing = $state(false)

  async function unconfirm(person: ParticipantTotal) {
    if (await app.confirm({ title: `Отменить подтверждение у ${person.name}?`, body: 'Оплата вернётся на проверку.', action: 'Отменить подтверждение' })) void app.unconfirm(person.id)
  }
</script>

<svelte:window onbeforeprint={() => flushSync(() => printing = true)} onafterprint={() => printing = false} />

<div class="summary-section" role="tabpanel" id="panel-pay" aria-labelledby="tab-pay">
  {#if mine}
    <div class="panel my-pay-card" class:settled={mine.status === 'paid'}>
      <div class="my-pay-head">
        <div><span class="eyebrow">Ваша часть</span><b class="my-pay-amount"><Amount value={mine.due} /></b></div>
        {#if mine.due}<span class="status-badge status-{mine.status}">{statusLabels[mine.status]}</span>{/if}
      </div>
      <p class="my-pay-note">{myNote}</p>
      {#if bill.paymentDetails && mine.remaining > 0}<PaymentDetails details={bill.paymentDetails} owner={ownerName} />{/if}
      <!-- Almost everyone pays the whole amount at once, so that is one tap; a part payment is the exception. -->
      {#if mine.due && mine.status !== 'paid' && mine.status !== 'proof_submitted'}
        <button class="primary-button" disabled={app.busy} onclick={() => void app.submitPayment(mine.due)}>{mine.paid ? 'Остаток отдан' : 'Оплата сделана'} · {formatUzs(mine.remaining)} <span aria-hidden="true">✓</span></button>
        <button class="ghost-button pay-part" onclick={() => app.paymentFor = mine.id}>{mine.paid ? 'Изменить отданную сумму' : 'Отдали только часть?'}</button>
      {:else if mine.status === 'proof_submitted'}
        <button class="ghost-button pay-part" onclick={() => app.paymentFor = mine.id}>Изменить сумму</button>
      {/if}
    </div>
  {/if}

  <!-- One block for the whole table: how much is paid overall, then each person with their own progress. -->
  <div class="panel summary-card">
    <div class="summary-title">
      <div>
        <span class="eyebrow">Оплаты</span>
        <h2>{#if !app.isOwner}Кто сколько должен{:else if owed}Вам должны <Amount value={owed} />{:else}{app.allConfirmed ? '✓ Все рассчитались' : 'Пока никто не должен'}{/if}</h2>
      </div>
      <div class="summary-grand"><small>Общий счёт</small><b><Amount value={app.billTotal} /></b></div>
    </div>
    <div class="progress-track" role="progressbar" aria-label="Весь стол оплатил" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(paidPercent)}><i style={`width:${paidPercent}%`}></i></div>
    <p class="summary-paid">Оплачено {formatUzs(app.paidAll)} из {formatUzs(app.billTotal)}{#if toConfirm}<span class="status-badge status-proof_submitted">{plural(toConfirm, 'ждёт', 'ждут', 'ждут')} проверки</span>{/if}</p>

    {#each people as person (person.id)}
      {@const lines = personItems(bill, person.id)}
      {@const payer = person.id === app.ownerId}
      {@const done = payer ? 100 : percent(person.paid, person.due)}
      <div class="summary-person" class:is-me={app.selectedPerson === person.id}>
        <span class="person-avatar tone-{app.personIndex(person.id) % 5}">{initial(person.name)}</span>
        <div class="summary-person-name">
          <b>{person.name}{app.selectedPerson === person.id ? ' (вы)' : ''}</b>
          <small>Блюда {formatUzs(person.subtotal)}{bill.servicePercent ? ` · сервис ${formatUzs(person.service)}` : ''}</small>
        </div>
        <div class="summary-person-total">
          <b>{formatUzs(person.due)}</b>
          {#if payer}<span class="status-badge status-payer">Платил по счёту</span>
          {:else}<span class="status-badge status-{person.status}">{statusLabels[person.status]}</span>{/if}
        </div>
        {#if person.due > 0}
          <div class="person-progress">
            <div class="progress-track slim" class:done={payer || person.status === 'paid'} role="progressbar" aria-label={`${person.name}: оплачено`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(done)}><i style={`width:${done}%`}></i></div>
            <small>{payer ? '' : person.remaining ? `оплачено ${formatUzs(person.paid)} · осталось ${formatUzs(person.remaining)}` : `оплачено ${formatUzs(person.paid)}`}</small>
          </div>
        {/if}
        {#if lines.length}
          <details class="person-items" open={printing || (!app.isOwner && app.selectedPerson === person.id)}>
            <summary>Из чего сумма · {plural(lines.length, 'позиция', 'позиции', 'позиций')}</summary>
            <ul>
              {#each lines as line (line.id)}<li><span>{line.name}{line.units > 1 ? ` × ${line.units}` : ''}{line.shared ? ' · доля' : ''}</span><b>{formatUzs(line.amount)}</b></li>{/each}
              {#if person.service}<li class="service-line"><span>Обслуживание {bill.servicePercent}%</span><b>{formatUzs(person.service)}</b></li>{/if}
            </ul>
          </details>
        {/if}
        {#if app.isOwner && !payer && person.due > 0 && (person.status === 'paid' || person.status === 'proof_submitted')}
          <div class="summary-actions">
            {#if person.status === 'paid'}
              <button class="ghost-button" disabled={app.busy} onclick={() => unconfirm(person)}>Отменить подтверждение</button>
            {:else}
              <button class="accent-button" disabled={app.busy} onclick={() => void app.approve(person.id)}>Подтвердить оплату</button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if app.isOwner && bill.paymentDetails}
    <div class="panel pay-card owner-pay"><PaymentDetails details={bill.paymentDetails} /><button class="ghost-button" onclick={() => app.payDetailsOpen = true}>Изменить</button></div>
  {:else if app.isOwner}
    <button class="notice info" onclick={() => app.payDetailsOpen = true}><span aria-hidden="true">💳</span><div><b>Куда гостям переводить?</b><small>Номер карты или телефона для гостей</small></div><span class="notice-action">Добавить →</span></button>
  {/if}

  <div class="panel export-card" class:all-paid={app.allConfirmed}>
    <div class="export-text">
      {#if app.allConfirmed}<span class="done-mark" aria-hidden="true">✓</span>{/if}
      <div><b>{app.allConfirmed ? 'Все оплаты подтверждены' : 'Итог'}</b><small class="muted">Чек удалится {expiryDate.format(expiresAt(bill.createdAt))}</small></div>
    </div>
    <div class="chip-row">
      <button class="chip" onclick={() => app.copy(text(), 'Итог скопирован')}>Копировать</button>
      <button class="chip" onclick={() => saveImage(bill, app.billTotal, app.totals, app.ownerId)}>Картинка</button>
      <button class="chip" onclick={() => window.print()}>PDF</button>
      <button class="chip" onclick={() => saveText(bill.title, text())}>Текст</button>
    </div>
  </div>
</div>
