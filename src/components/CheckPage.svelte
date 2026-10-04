<script lang="ts">
  import { formatUzs, hasUnassignedUnit, itemShares, type Participant } from '../lib/calculations'
  import { createdDate, expiryDate, initial, plural } from '../lib/format'
  import { checkLifetimeDays, expiresAt } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import ItemCard from './ItemCard.svelte'
  import SummaryPanel from './SummaryPanel.svelte'
  import Comments from './Comments.svelte'
  import Amount from './Amount.svelte'

  const bill = $derived(app.bill!)
  const mine = $derived(new Set(app.selectedPerson ? bill.items.filter(item => itemShares(item, bill.participants)[app.selectedPerson!] > 0).map(item => item.id) : []))
  const open = $derived(new Set(bill.items.filter(hasUnassignedUnit).map(item => item.id)))
  const shown = $derived(app.itemFilter === 'mine' ? bill.items.filter(item => mine.has(item.id)) : app.itemFilter === 'open' ? bill.items.filter(item => open.has(item.id)) : bill.items)
  const expires = $derived(expiresAt(bill.createdAt))
  // The last day gets the warning color.
  const expiresSoon = $derived(expires.getTime() - Date.now() < 86_400_000)
  // After a partial payment the bar says what is left; once confirmed, that the person is done.
  const sticky = $derived.by(() => {
    const me = app.currentTotal
    if (!me) return null
    if (me.id === app.ownerId || !me.due) return { label: 'Ваша часть', amount: me.due }
    if (me.status === 'paid') return { label: 'Оплата', text: '✓ Рассчитались' }
    if (me.paid > 0 && me.remaining > 0) return { label: 'Осталось отдать', amount: me.remaining }
    return { label: 'Ваша часть', amount: me.due }
  })
  // Payments the creator still has to look at, shown on the summary tab.
  const toConfirm = $derived(app.isOwner ? app.totals.filter(person => person.id !== app.ownerId && person.status === 'proof_submitted').length : 0)
  // The creator alone at the table has one thing to do next: invite people. Later a small button is enough.
  const inviteFirst = $derived(app.isOwner && bill.participants.length === 1)
  // Long receipts get filters; a filter picked from the warning stays visible on a short one too.
  const showFilters = $derived(bill.items.length > 3 || app.itemFilter !== 'all')

  async function removeParticipant(person: Participant) {
    if (await app.confirm({ title: `Убрать ${person.name} из чека?`, body: 'Отметки, оплата и комментарии участника будут удалены.', action: 'Убрать', danger: true })) void app.removeParticipant(person)
  }
  async function removeBill() {
    if (await app.confirm({ title: `Удалить чек «${bill.title}»?`, body: 'Чек исчезнет у всех участников. Отменить это нельзя.', action: 'Удалить чек', danger: true })) void app.removeBill()
  }
  function showUnassigned() {
    app.activeTab = 'order'; app.itemFilter = 'open'
    document.getElementById('panel-order')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function switchTab() {
    app.activeTab = app.activeTab === 'order' ? 'summary' : 'order'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
</script>

<main class="check-page">
  <header class="check-header">
    <button class="back-link" onclick={() => app.goHome()}>← Все чеки</button>
    <div class="title-row">
      <h1>{bill.title}</h1>
      {#if app.isOwner}<button class="icon-button" aria-label="Изменить название и обслуживание" title="Изменить чек" onclick={() => app.checkEditOpen = true}>✎</button>{/if}
    </div>
    <p class="muted">{[app.billTotal ? formatUzs(app.billTotal) : '', bill.servicePercent ? `обслуживание ${bill.servicePercent}%` : '', `создан ${createdDate.format(new Date(bill.createdAt))}`].filter(Boolean).join(' · ')}</p>
    <div class="check-meta">
      <span class="expiry-pill" class:soon={expiresSoon} title={`Чеки хранятся ${plural(checkLifetimeDays, 'день', 'дня', 'дней')}. Итог можно сохранить картинкой или PDF в «Итогах и оплате».`}>⏳ Удалится {expiryDate.format(expires)}</span>
      {#if !inviteFirst}
        <div class="invite-actions">
          <button class="soft-button" onclick={() => app.invite()}>Пригласить</button>
          <button class="icon-button" aria-label="Показать QR-код" title="QR-код для тех, кто рядом" onclick={() => app.qrOpen = true}>▦</button>
        </div>
      {/if}
    </div>
  </header>

  {#if inviteFirst}
    <div class="panel share-banner">
      <div class="share-symbol" aria-hidden="true">🔗</div>
      <div class="share-text"><b>Пригласите остальных за стол</b><span>Отправьте ссылку или покажите QR-код — гости сами присоединятся по имени.</span></div>
      <div class="share-actions">
        <button class="soft-button" onclick={() => app.invite()}>Отправить ссылку</button>
        <button class="soft-button" onclick={() => app.qrOpen = true}><span aria-hidden="true">▦</span> QR-код</button>
      </div>
    </div>
  {/if}

  <section class="people-strip" aria-label="Участники">
    <div class="section-row small"><span class="eyebrow">За столом · {bill.participants.length}</span><span class="online-count"><i></i>{app.onlineUsers.length || 1} онлайн</span></div>
    <div class="people-row">
      {#each bill.participants as person, i (person.id)}
        <span class="person-entry">
          <!-- Everyone is who they joined as; the names just show who is at the table. -->
          <span class="person-chip" class:active={app.selectedPerson === person.id}><span class="person-avatar tone-{i % 5}">{initial(person.name)}</span>{person.name}{app.selectedPerson === person.id ? ' · вы' : ''}</span>
          {#if app.isOwner && i > 0}<button class="remove-person" aria-label={`Убрать ${person.name} из чека`} title="Убрать из чека" onclick={() => removeParticipant(person)}>×</button>{/if}
        </span>
      {/each}
    </div>
    {#if app.onlineUsers.length > 1}<div class="presence-feed">{#each app.onlineUsers.slice(0, 4) as user, i (user.participantId ?? i)}<span><i></i>{user.name} · {user.activity}</span>{/each}</div>{/if}
  </section>

  {#if !bill.items.length}
    <section class="panel empty-items">
      <div class="empty-illustration" aria-hidden="true">🍽️</div>
      <h2>Стол пока пустой</h2>
      <p>{app.isOwner ? 'Добавьте позиции из чека — друзья сами отметят, что заказывали.' : 'Создатель чека ещё не добавил позиции.'}</p>
      {#if app.isOwner}
        <div class="empty-actions">
          <button class="primary-button" onclick={() => app.scanOpen = true}>📷 Сканировать чек</button>
          <button class="soft-button" onclick={() => app.addItemOpen = true}>＋ Добавить вручную</button>
        </div>
      {/if}
    </section>
  {:else}
    <div class="segmented" role="tablist">
      <button role="tab" id="tab-order" aria-controls="panel-order" aria-selected={app.activeTab === 'order'} class:active={app.activeTab === 'order'} onclick={() => app.activeTab = 'order'}>Позиции <span class="count">{bill.items.length}</span></button>
      <button role="tab" id="tab-summary" aria-controls="panel-summary" aria-selected={app.activeTab === 'summary'} class:active={app.activeTab === 'summary'} onclick={() => app.activeTab = 'summary'}>Итоги и оплата{#if toConfirm}<span class="count" title="Ждут вашего подтверждения">{toConfirm}</span>{/if}</button>
    </div>

    {#if app.unassignedTotal > 0}
      <button class="notice warning unassigned-notice" onclick={showUnassigned}><span aria-hidden="true">◌</span><div><b>{formatUzs(app.unassignedTotal)} ещё не распределено</b><small>{app.activeTab === 'order' ? 'Отметьте, кто ел оставшиеся позиции, чтобы итог сошёлся с чеком.' : 'Отметьте, кто ел оставшиеся позиции, чтобы итог сошёлся с чеком.'}</small></div><span class="notice-action">Показать →</span></button>
    {/if}

    {#if app.activeTab === 'order'}
      <div class="items-section" role="tabpanel" id="panel-order" aria-labelledby="tab-order">
        <div class="section-row">
          <div><h2>Что вы заказали?</h2><p class="muted">Нажмите «Это моё» — сумма посчитается сама</p></div>
          {#if app.isOwner}
            <div class="item-tools">
              <button class="soft-button" aria-label="Сканировать чек" title="Сканировать чек" onclick={() => app.scanOpen = true}>📷<span class="tool-label"> Скан</span></button>
              <button class="soft-button" onclick={() => app.addItemOpen = true}>＋ Позиция</button>
            </div>
          {/if}
        </div>
        {#if showFilters}
          <div class="chip-row item-filter" role="group" aria-label="Какие позиции показать">
            <button class="chip" class:active={app.itemFilter === 'all'} aria-pressed={app.itemFilter === 'all'} onclick={() => app.itemFilter = 'all'}>Все <span class="chip-count">{bill.items.length}</span></button>
            {#if app.selectedPerson}<button class="chip" class:active={app.itemFilter === 'mine'} aria-pressed={app.itemFilter === 'mine'} onclick={() => app.itemFilter = 'mine'}>Мои <span class="chip-count">{mine.size}</span></button>{/if}
            <button class="chip" class:active={app.itemFilter === 'open'} aria-pressed={app.itemFilter === 'open'} onclick={() => app.itemFilter = 'open'}>Не распределено <span class="chip-count">{open.size}</span></button>
          </div>
        {/if}
        <div class="item-list">
          {#each shown as item (item.id)}<ItemCard {item} />{:else}
            <div class="filter-empty">
              <p>{app.itemFilter === 'open' ? '✓ Все позиции распределены' : 'Вы пока ничего не отметили'}</p>
              <button class="ghost-button" onclick={() => app.itemFilter = 'all'}>Показать все позиции</button>
            </div>
          {/each}
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
      <div><small>{sticky?.label}</small><b>{#if sticky?.text}{sticky.text}{:else}<Amount value={sticky?.amount ?? 0} />{/if}</b></div>
      <button class="accent-button" onclick={switchTab}>{app.activeTab === 'order' ? 'Итоги и оплата →' : '← К позициям'}</button>
    </div>
  {/if}
  <footer class="check-footer">Сделано с заботой о дружбе <span>♡</span></footer>
</main>
