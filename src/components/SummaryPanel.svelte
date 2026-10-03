<script lang="ts">
  import { formatUzs } from '../lib/calculations'
  import { downloadImage, downloadText, summaryText } from '../lib/export'
  import { initial, statusLabels } from '../lib/format'
  import { app } from '../lib/store.svelte'

  const bill = $derived(app.bill!)
  const paidPercent = $derived(app.billTotal ? Math.min(100, app.paidAll / app.billTotal * 100) : 0)
  const text = () => summaryText(bill.title, app.billTotal, app.totals)
</script>

<div class="summary-section" role="tabpanel" id="panel-summary" aria-labelledby="tab-summary">
  <div class="panel summary-card">
    <div class="summary-title"><div><span class="eyebrow">Кто сколько должен</span><h2>Итоги</h2></div><div class="summary-grand"><small>Общий счёт</small><b>{formatUzs(app.billTotal)}</b></div></div>
    {#each app.totals as person (person.id)}
      <div class="summary-person" class:is-me={app.selectedPerson === person.id}>
        <span class="person-avatar tone-{app.personIndex(person.id) % 5}">{initial(person.name)}</span>
        <div class="summary-person-name">
          <b>{person.name}{app.selectedPerson === person.id ? ' (вы)' : ''}</b>
          <small>Блюда {formatUzs(person.subtotal)}{bill.servicePercent ? ` · сервис ${formatUzs(person.service)}` : ''}</small>
        </div>
        <div class="summary-person-total">
          <b>{formatUzs(person.due)}</b>
          <span class="status-badge status-{person.status}">{statusLabels[person.status]}</span>
          {#if person.paid > 0 && person.remaining > 0}<small>осталось {formatUzs(person.remaining)}</small>{/if}
        </div>
        {#if app.isOwner && person.status === 'proof_submitted'}
          <div class="summary-actions">
            <a class="ghost-button" href={bill.participants[app.personIndex(person.id)]?.proofUrl} target="_blank" rel="noreferrer noopener">Открыть подтверждение ↗</a>
            <button class="accent-button" disabled={person.paid < person.due || app.busy} title={person.paid < person.due ? 'Внесена не вся сумма' : 'Подтвердить оплату'} onclick={() => void app.approve(person.id)}>Подтвердить оплату</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="panel progress-card">
    <div class="section-row small"><span class="eyebrow">Уже оплачено</span><b>{formatUzs(app.paidAll)} <small class="muted">из {formatUzs(app.billTotal)}</small></b></div>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(paidPercent)}><i style={`width:${paidPercent}%`}></i></div>
  </div>

  {#if app.currentParticipant}
    <button class="primary-button wide" onclick={() => app.paymentFor = app.currentParticipant!.id}>{app.currentParticipant.status === 'unpaid' ? 'Отметить оплату' : 'Изменить оплату'} <span aria-hidden="true">↗</span></button>
  {/if}

  <div class="panel export-card" class:all-paid={app.allConfirmed}>
    <div class="export-text">
      {#if app.allConfirmed}<span class="done-mark" aria-hidden="true">✓</span>{/if}
      <div><b>{app.allConfirmed ? 'Все оплаты подтверждены' : 'Поделиться итогом'}</b><small class="muted">{app.allConfirmed ? 'Можно сохранить итог встречи.' : 'Отправьте сводку в чат друзьям.'}</small></div>
    </div>
    <div class="chip-row">
      <button class="chip" onclick={() => app.copy(text(), 'Итог скопирован')}>Копировать</button>
      <button class="chip" onclick={() => downloadImage(bill.title, app.billTotal, app.totals)}>Картинка</button>
      <button class="chip" onclick={() => window.print()}>PDF</button>
      <button class="chip" onclick={() => downloadText(bill.title, text())}>Текст</button>
    </div>
  </div>
</div>
