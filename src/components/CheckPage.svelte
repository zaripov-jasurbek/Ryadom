<script lang="ts">
  import { formatAmount, formatUzs, serviceFee } from '../lib/calculations'
  import { expiryDate, initial, paymentCopyValue } from '../lib/format'
  import { expiresAt } from '../lib/limits'
  import { app, totalFood } from '../lib/store.svelte'
  import ItemCard from './ItemCard.svelte'
  import SummaryPanel from './SummaryPanel.svelte'
  import ThemeToggle from './ThemeToggle.svelte'

  const bill = $derived(app.bill!)
  // A long receipt gets a search box: a guest looks for their two dishes among twenty.
  let query = $state('')
  const searchable = $derived(bill.items.length > 8)
  const needle = $derived(searchable ? query.trim().toLowerCase() : '')
  const shown = $derived(needle ? bill.items.filter(item => item.name.toLowerCase().includes(needle)) : bill.items)
  const food = $derived(totalFood(bill))
  // On the last day the top bar says when the check goes; until then the date is in the export card.
  const expiresSoon = $derived(expiresAt(bill.createdAt).getTime() - Date.now() < 86_400_000)

  // Avatars under the name: a green ring for whoever has the check open right now.
  const online = $derived(new Set([app.selectedPerson, ...app.onlineUsers.map(user => user.participantId)].filter(Boolean)))
  const faces = $derived(bill.participants.slice(0, 6))

  // The card number is not shown to guests: a button that copies it stays at hand while they still owe something.
  const me = $derived(app.isOwner ? undefined : app.currentTotal)
  const cardDock = $derived(Boolean(bill.paymentDetails && me && me.remaining > 0))

  function showUnassigned() {
    query = ''
    requestAnimationFrame(() => document.querySelector('.bill-row.open')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
</script>

<main class="check-page" class:with-dock={cardDock}>
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
    <button class="icon-button" aria-label="Пригласить" title="Пригласить" aria-haspopup="dialog" onclick={() => app.qrOpen = true}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.4" /><path d="M3.5 19.5c.7-3.4 3.2-5.3 6.5-5.3 1.6 0 3 .4 4.1 1.2" /><path d="M18 14v6M15 17h6" /></svg>
    </button>
    {#if app.isOwner}<button class="icon-button" aria-label="Настройки чека" title="Настройки чека" onclick={() => app.checkEditOpen = true}>✎</button>{/if}
  </header>

  {#if app.unassignedTotal > 0}
    <button class="notice warning unassigned-notice" onclick={showUnassigned}><span aria-hidden="true">◌</span><div>{#if app.isOwner}<b>{formatUzs(app.unassignedTotal)} ещё не распределено</b><small>Отметьте, кто это ел</small>{:else}<b>{formatUzs(app.unassignedTotal)} ещё никто не отметил</b><small>Проверьте, нет ли вашего</small>{/if}</div><span class="notice-action">Показать →</span></button>
  {/if}

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
    <!-- The check itself, as printed: name, quantity, price per serving; under each line who had it. -->
    <section class="panel bill" class:owner={app.isOwner} aria-label="Чек">
      {#if searchable}
        <input class="item-search" type="search" bind:value={query} placeholder="Найти блюдо" aria-label="Найти блюдо" enterkeyhint="search" />
      {/if}
      <div class="bill-line bill-head" aria-hidden="true"><span>Название</span><span class="bill-qty">Кол-во</span><span class="bill-price">Цена</span>{#if app.isOwner}<span></span>{/if}</div>
      {#each shown as item (item.id)}<ItemCard {item} />{:else}
        <p class="filter-empty">Ничего не нашлось по «{query.trim()}»</p>
      {/each}
      {#if app.isOwner}
        <div class="bill-tools">
          <button class="soft-button" onclick={() => app.addItemOpen = true}>＋ Позиция</button>
          <button class="soft-button" onclick={() => app.scanOpen = true}>📷 Скан</button>
        </div>
      {/if}
      <dl class="bill-sum">
        {#if bill.servicePercent}
          <div><dt>Блюда</dt><dd>{formatAmount(food)}</dd></div>
          <div><dt>Обслуживание {bill.servicePercent}%</dt><dd>{formatAmount(serviceFee(food, bill.servicePercent))}</dd></div>
        {/if}
        <div class="bill-total"><dt>Итого</dt><dd>{formatUzs(app.billTotal)}</dd></div>
      </dl>
    </section>

    <SummaryPanel />
  {/if}

  {#if cardDock}
    <button class="card-dock" onclick={() => app.copy(paymentCopyValue(bill.paymentDetails!), 'Номер скопирован')}><span aria-hidden="true">💳</span> Скопировать карту{me ? ` · ${formatAmount(me.remaining)}` : ''}</button>
  {/if}
</main>
