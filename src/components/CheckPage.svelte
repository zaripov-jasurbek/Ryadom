<script lang="ts">
  import { formatAmount, formatUzs, hasUnassignedUnit, itemShares } from '../lib/calculations'
  import { expiryDate, initial } from '../lib/format'
  import { expiresAt } from '../lib/limits'
  import { app, type CheckTab } from '../lib/store.svelte'
  import ItemCard from './ItemCard.svelte'
  import SummaryPanel from './SummaryPanel.svelte'
  import Comments from './Comments.svelte'
  import ThemeToggle from './ThemeToggle.svelte'

  const bill = $derived(app.bill!)
  const mine = $derived(new Set(app.selectedPerson ? bill.items.filter(item => itemShares(item, bill.participants)[app.selectedPerson!] > 0).map(item => item.id) : []))
  const open = $derived(new Set(bill.items.filter(hasUnassignedUnit).map(item => item.id)))
  // A long receipt gets a search box: a guest looks for their two dishes among twenty.
  let query = $state('')
  const searchable = $derived(bill.items.length > 8)
  const needle = $derived(searchable ? query.trim().toLowerCase() : '')
  const filtered = $derived(app.itemFilter === 'mine' ? bill.items.filter(item => mine.has(item.id)) : app.itemFilter === 'open' ? bill.items.filter(item => open.has(item.id)) : bill.items)
  const shown = $derived(needle ? filtered.filter(item => item.name.toLowerCase().includes(needle)) : filtered)
  // On the last day the top bar says when the check goes; until then the date is in the payment tab's export card.
  const expiresSoon = $derived(expiresAt(bill.createdAt).getTime() - Date.now() < 86_400_000)
  // Payments the creator still has to look at: a badge on the payment tab.
  const toConfirm = $derived(app.isOwner ? app.totals.filter(person => person.id !== app.ownerId && person.status === 'proof_submitted').length : 0)
  // Long receipts get filters; a filter picked from the warning stays visible on a short one too.
  const showFilters = $derived(bill.items.length > 3 || app.itemFilter !== 'all')

  // Avatars under the name: a green ring for whoever has the check open right now.
  const online = $derived(new Set([app.selectedPerson, ...app.onlineUsers.map(user => user.participantId)].filter(Boolean)))
  const faces = $derived(bill.participants.slice(0, 6))

  // The payment tab is labelled with what this guest still owes, so the amount is always in sight.
  const me = $derived(app.isOwner ? undefined : app.currentTotal)
  const payLabel = $derived(!me || !me.due ? 'Оплата' : me.status === 'paid' ? '✓ Оплачено' : formatAmount(me.remaining))
  // The next step for a guest who has marked something and not paid yet.
  const payNudge = $derived(Boolean(me && me.due && (me.status === 'unpaid' || me.status === 'partially_paid')))

  const tabs: { id: CheckTab; label: string }[] = [{ id: 'order', label: 'Позиции' }, { id: 'pay', label: 'Оплата' }, { id: 'chat', label: 'Чат' }]

  function select(tab: CheckTab) {
    if (app.activeTab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    app.activeTab = tab
    window.scrollTo(0, 0)
  }
  function showUnassigned() {
    app.itemFilter = 'open'; query = ''
    select('order')
  }
</script>

{#snippet icon(name: CheckTab | 'invite')}
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    {#if name === 'order'}<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" />
    {:else if name === 'pay'}<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v2.5" /><path d="M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5z" /><circle cx="16" cy="13.5" r="1" />
    {:else if name === 'chat'}<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z" />
    {:else}<circle cx="10" cy="8" r="3.4" /><path d="M3.5 19.5c.7-3.4 3.2-5.3 6.5-5.3 1.6 0 3 .4 4.1 1.2" /><path d="M18 14v6M15 17h6" />{/if}
  </svg>
{/snippet}

<main class="check-page">
  <header class="check-bar">
    <button class="icon-button" aria-label="Все чеки" title="Все чеки" onclick={() => app.goHome()}>←</button>
    <div class="check-bar-title">
      <h1>{bill.title}</h1>
      <div class="check-bar-meta">
        <button class="face-stack" aria-label={`За столом: ${bill.participants.map(person => person.name).join(', ')}`} title="Кто за столом" onclick={() => app.peopleOpen = true}>
          {#each faces as person, i (person.id)}<span class="person-avatar mini tone-{i % 5}" class:online={online.has(person.id)}>{initial(person.name)}</span>{/each}
          {#if bill.participants.length > faces.length}<span class="face-more">+{bill.participants.length - faces.length}</span>{/if}
        </button>
        {#if expiresSoon}<small class="soon">⏳ Удалится {expiryDate.format(expiresAt(bill.createdAt))}</small>
        {:else if app.billTotal}<small>{formatUzs(app.billTotal)}</small>{/if}
      </div>
    </div>
    <ThemeToggle />
    {#if app.isOwner}<button class="icon-button" aria-label="Настройки чека" title="Настройки чека" onclick={() => app.checkEditOpen = true}>✎</button>{/if}
  </header>

  {#if app.unassignedTotal > 0 && app.activeTab !== 'chat'}
    <button class="notice warning unassigned-notice" onclick={showUnassigned}><span aria-hidden="true">◌</span><div>{#if app.isOwner}<b>{formatUzs(app.unassignedTotal)} ещё не распределено</b><small>Отметьте, кто это ел</small>{:else}<b>{formatUzs(app.unassignedTotal)} ещё никто не отметил</b><small>Проверьте, нет ли вашего</small>{/if}</div>{#if app.activeTab !== 'order' || app.itemFilter !== 'open'}<span class="notice-action">Показать →</span>{/if}</button>
  {/if}

  {#if app.activeTab === 'order'}
    <div class="items-section" role="tabpanel" id="panel-order" aria-labelledby="tab-order">
      {#if !bill.items.length}
        <section class="panel empty-items">
          <div class="empty-illustration" aria-hidden="true">🍽️</div>
          <h2>Стол пока пустой</h2>
          <p>{app.isOwner ? 'Отсканируйте чек или добавьте позиции вручную.' : 'Позиции скоро появятся.'}</p>
          {#if app.isOwner}
            <div class="empty-actions">
              <button class="primary-button" onclick={() => app.scanOpen = true}>📷 Сканировать чек</button>
              <button class="soft-button" onclick={() => app.addItemOpen = true}>＋ Добавить вручную</button>
            </div>
          {/if}
        </section>
      {:else}
        <div class="section-row">
          <h2>Что вы заказали?</h2>
          {#if app.isOwner}
            <div class="item-tools">
              <button class="soft-button" aria-label="Сканировать чек" title="Сканировать чек" onclick={() => app.scanOpen = true}>📷<span class="tool-label"> Скан</span></button>
              <button class="soft-button" onclick={() => app.addItemOpen = true}>＋ Позиция</button>
            </div>
          {/if}
        </div>
        {#if searchable}
          <input class="item-search" type="search" bind:value={query} placeholder="Найти блюдо" aria-label="Найти блюдо" enterkeyhint="search" />
        {/if}
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
              <p>{needle && filtered.length ? `Ничего не нашлось по «${query.trim()}»` : app.itemFilter === 'open' ? '✓ Все позиции распределены' : 'Вы пока ничего не отметили'}</p>
              <button class="ghost-button" onclick={() => { app.itemFilter = 'all'; query = '' }}>Показать все позиции</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if app.activeTab === 'pay'}
    <SummaryPanel />
  {:else}
    <Comments />
  {/if}

  <nav class="tab-bar" aria-label="Разделы чека">
    <div class="tab-list" role="tablist">
    {#each tabs as tab (tab.id)}
      {@const badge = tab.id === 'pay' ? toConfirm : tab.id === 'chat' ? app.unreadComments : 0}
      <button role="tab" id="tab-{tab.id}" aria-controls="panel-{tab.id}" aria-selected={app.activeTab === tab.id} class:active={app.activeTab === tab.id} onclick={() => select(tab.id)}>
        <span class="tab-icon">{@render icon(tab.id)}{#if badge}<span class="tab-badge" aria-label={tab.id === 'pay' ? `Ждут подтверждения: ${badge}` : `Новых сообщений: ${badge}`}>{badge > 9 ? '9+' : badge}</span>{:else if tab.id === 'pay' && payNudge && app.activeTab !== 'pay'}<span class="tab-dot" aria-hidden="true"></span>{/if}</span>
        <span class="tab-label">{tab.id === 'pay' ? payLabel : tab.label}</span>
      </button>
    {/each}
    </div>
    <!-- Not a tab: inviting is a moment, so it opens the link and QR code over whatever is on screen. -->
    <button class="tab-action" aria-haspopup="dialog" onclick={() => app.qrOpen = true}>
      <span class="tab-icon">{@render icon('invite')}</span>
      <span class="tab-label">Пригласить</span>
    </button>
  </nav>
</main>
