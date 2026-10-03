<script lang="ts">
  import { formatUzs, type Participant } from '../lib/calculations'
  import { createdDate, initial, plural } from '../lib/format'
  import { app } from '../lib/store.svelte'
  import ItemCard from './ItemCard.svelte'
  import SummaryPanel from './SummaryPanel.svelte'
  import Comments from './Comments.svelte'

  const bill = $derived(app.bill!)

  function copyLink() {
    void app.copy(app.publicLink(), bill.dbId ? 'Ссылка скопирована — гости могут открыть чек' : 'Демо-ссылка скопирована · доступна только в этом браузере')
  }
  function removeParticipant(person: Participant) {
    if (window.confirm(`Убрать ${person.name} из чека? Отметки, оплата и комментарии участника будут удалены.`)) void app.removeParticipant(person)
  }
  function removeBill() {
    if (window.confirm(`Удалить чек «${bill.title}» для всех участников? Это действие нельзя отменить.`)) void app.removeBill()
  }
  function switchTab() {
    app.activeTab = app.activeTab === 'order' ? 'summary' : 'order'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
</script>

<main class="check-page">
  <div class="check-header">
    <div>
      <button class="back-link" onclick={() => app.goHome()}>← Все чеки</button>
      <div class="eyebrow check-kicker">Совместный чек <span class="live-dot" class:offline={!bill.dbId}></span> {bill.dbId ? 'обновляется в реальном времени' : 'хранится на этом устройстве'}</div>
      <h1>{bill.title}</h1>
      <p class="muted">Создан {createdDate.format(new Date(bill.createdAt))} · {plural(bill.participants.length, 'участник', 'участника', 'участников')} · {formatUzs(app.billTotal)}</p>
    </div>
  </div>

  <div class="panel share-banner">
    <div class="share-symbol" aria-hidden="true">🔗</div>
    <div class="share-text"><b>{bill.dbId ? 'Пригласите остальных за стол' : 'Демо-режим'}</b><span>{bill.dbId ? 'Отправьте ссылку — гости сами присоединятся по имени.' : 'Чек хранится только в этом браузере.'}</span></div>
    <button class="soft-button" onclick={copyLink}>Скопировать ссылку</button>
  </div>

  <section class="people-strip" aria-label="Участники">
    <div class="section-row small"><span class="eyebrow">За столом</span>{#if bill.dbId}<span class="online-count"><i></i>{app.onlineUsers.length || 1} онлайн</span>{/if}</div>
    <div class="people-row">
      {#each bill.participants as person, i (person.id)}
        <span class="person-entry">
          <button class="person-chip" class:active={app.selectedPerson === person.id} aria-pressed={app.selectedPerson === person.id} disabled={Boolean(bill.dbId && app.selectedPerson !== person.id)} onclick={() => app.choosePerson(person.id)}>
            <span class="person-avatar tone-{i % 5}">{initial(person.name)}</span>{person.name}{app.selectedPerson === person.id ? ' · вы' : ''}
          </button>
          {#if app.isOwner && i > 0}<button class="remove-person" aria-label={`Убрать ${person.name} из чека`} title="Убрать из чека" onclick={() => removeParticipant(person)}>×</button>{/if}
        </span>
      {/each}
    </div>
    {#if app.onlineUsers.length > 1}<div class="presence-feed">{#each app.onlineUsers.slice(0, 4) as user, i (user.participantId ?? i)}<span><i></i>{user.name} · {user.activity}</span>{/each}</div>{/if}
    {#if !app.selectedPerson}<p class="hint">Нажмите на своё имя, чтобы отмечать блюда.</p>{/if}
  </section>

  {#if !bill.items.length}
    <section class="panel empty-items">
      <div class="empty-illustration" aria-hidden="true">🍽️</div>
      <h2>Стол пока пустой</h2>
      <p>{app.isOwner ? 'Добавьте позиции из чека — друзья сами отметят, что заказывали.' : 'Создатель чека ещё не добавил позиции.'}</p>
      {#if app.isOwner}<button class="primary-button" onclick={() => app.addItemOpen = true}>＋ Добавить первую позицию</button>{/if}
    </section>
  {:else}
    <div class="segmented" role="tablist">
      <button role="tab" id="tab-order" aria-controls="panel-order" aria-selected={app.activeTab === 'order'} class:active={app.activeTab === 'order'} onclick={() => app.activeTab = 'order'}>Позиции <span class="count">{bill.items.length}</span></button>
      <button role="tab" id="tab-summary" aria-controls="panel-summary" aria-selected={app.activeTab === 'summary'} class:active={app.activeTab === 'summary'} onclick={() => app.activeTab = 'summary'}>Итоги и оплата</button>
    </div>

    {#if app.unassignedTotal > 0}
      <div class="notice warning"><span aria-hidden="true">◌</span><div><b>{formatUzs(app.unassignedTotal)} ещё не распределено</b><small>{app.activeTab === 'order' ? 'Отметьте, кто ел оставшиеся позиции, чтобы итог сошёлся с чеком.' : 'Распределите все позиции, прежде чем закрывать чек.'}</small></div></div>
    {/if}

    {#if app.activeTab === 'order'}
      <div class="items-section" role="tabpanel" id="panel-order" aria-labelledby="tab-order">
        <div class="section-row">
          <div><h2>Что вы заказали?</h2><p class="muted">Нажмите «Это моё» — сумма посчитается сама</p></div>
          {#if app.isOwner}<button class="soft-button" onclick={() => app.addItemOpen = true}>＋ Позиция</button>{/if}
        </div>
        <div class="item-list">
          {#each bill.items as item (item.id)}<ItemCard {item} />{/each}
        </div>
        {#if app.isOwner}<button class="add-more" onclick={() => app.addItemOpen = true}>＋ Добавить ещё позицию</button>{/if}
      </div>
    {:else}
      <SummaryPanel />
    {/if}
  {/if}

  <Comments />

  {#if app.isOwner}
    <section class="danger-zone">
      <div><b>Удалить чек</b><small class="muted">Чек исчезнет у всех участников. Отменить нельзя.</small></div>
      <button class="danger-button" onclick={removeBill}>Удалить чек</button>
    </section>
  {/if}

  {#if bill.items.length && app.currentParticipant}
    <div class="sticky-total">
      <div><small>Ваш итог</small><b>{formatUzs(app.currentTotal?.due ?? 0)}</b></div>
      <button class="accent-button" onclick={switchTab}>{app.activeTab === 'order' ? 'Итоги и оплата →' : '← К позициям'}</button>
    </div>
  {/if}
  <footer class="check-footer">Сделано с заботой о дружбе <span>♡</span></footer>
</main>
