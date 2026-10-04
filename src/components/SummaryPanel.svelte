<script lang="ts">
  import { formatUzs, personItems, type ParticipantTotal } from '../lib/calculations'
  import { downloadImage, downloadText, summaryText } from '../lib/export'
  import { initial, plural, statusLabels } from '../lib/format'
  import { app } from '../lib/store.svelte'
  import PaymentDetails from './PaymentDetails.svelte'

  const bill = $derived(app.bill!)
  const paidPercent = $derived(app.billTotal ? Math.min(100, app.paidAll / app.billTotal * 100) : 0)
  const ownerName = $derived(app.ownerId ? app.personName(app.ownerId) : '')
  const text = () => summaryText(bill.title, app.billTotal, app.totals, app.ownerId)

  function unconfirm(person: ParticipantTotal) {
    if (window.confirm(`Отменить подтверждение оплаты у ${person.name}?`)) void app.unconfirm(person.id)
  }
</script>

<div class="summary-section" role="tabpanel" id="panel-summary" aria-labelledby="tab-summary">
  <div class="panel summary-card">
    <div class="summary-title"><div><span class="eyebrow">Кто сколько должен</span><h2>Итоги</h2></div><div class="summary-grand"><small>Общий счёт</small><b>{formatUzs(app.billTotal)}</b></div></div>
    {#each app.totals as person (person.id)}
      {@const lines = personItems(bill, person.id)}
      {@const payer = person.id === app.ownerId}
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
          {#if !payer && person.paid > 0 && person.remaining > 0}<small>осталось {formatUzs(person.remaining)}</small>{/if}
        </div>
        {#if lines.length}
          <details class="person-items" open={app.selectedPerson === person.id}>
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

  {#if bill.paymentDetails}
    <div class="panel pay-card"><PaymentDetails details={bill.paymentDetails} owner={app.isOwner ? '' : ownerName} /></div>
  {:else if app.isOwner}
    <button class="notice info" onclick={() => app.checkEditOpen = true}><span aria-hidden="true">💳</span><div><b>Куда гостям переводить?</b><small>Добавьте номер карты или телефона — гости скопируют его в одно касание.</small></div><span class="notice-action">Добавить →</span></button>
  {/if}

  <div class="panel progress-card">
    <div class="section-row small"><span class="eyebrow">Уже оплачено</span><b>{formatUzs(app.paidAll)} <small class="muted">из {formatUzs(app.billTotal)}</small></b></div>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(paidPercent)}><i style={`width:${paidPercent}%`}></i></div>
  </div>

  {#if app.currentParticipant && app.currentParticipant.id !== app.ownerId && app.currentParticipant.status !== 'paid'}
    <button class="primary-button wide" onclick={() => app.paymentFor = app.currentParticipant!.id}>{app.currentParticipant.status === 'unpaid' ? 'Отметить оплату' : 'Изменить оплату'} <span aria-hidden="true">↗</span></button>
  {/if}

  <div class="panel export-card" class:all-paid={app.allConfirmed}>
    <div class="export-text">
      {#if app.allConfirmed}<span class="done-mark" aria-hidden="true">✓</span>{/if}
      <div><b>{app.allConfirmed ? 'Все оплаты подтверждены' : 'Поделиться итогом'}</b><small class="muted">{app.allConfirmed ? 'Можно сохранить итог встречи.' : 'Отправьте сводку в чат друзьям.'}</small></div>
    </div>
    <div class="chip-row">
      <button class="chip" onclick={() => app.copy(text(), 'Итог скопирован')}>Копировать</button>
      <button class="chip" onclick={() => downloadImage(bill.title, app.billTotal, app.totals, app.ownerId)}>Картинка</button>
      <button class="chip" onclick={() => window.print()}>PDF</button>
      <button class="chip" onclick={() => downloadText(bill.title, text())}>Текст</button>
    </div>
  </div>
</div>
