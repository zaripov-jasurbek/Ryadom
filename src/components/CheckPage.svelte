<script lang="ts">
  import { formatAmount, formatUzs, serviceFee } from '../lib/calculations'
  import { expiryDate, paymentCopyValue } from '../lib/format'
  import { expiresAt } from '../lib/limits'
  import { app, totalFood } from '../lib/store.svelte'
  import { saveImage } from '../lib/export'
  import ItemCard from './ItemCard.svelte'
  import SummaryPanel from './SummaryPanel.svelte'
  import Icon from './Icon.svelte'

  const bill = $derived(app.bill!)
  // A long receipt gets a search box: a guest looks for their two dishes among twenty.
  let query = $state('')
  const searchable = $derived(bill.items.length > 8)
  const needle = $derived(searchable ? query.trim().toLowerCase() : '')
  const shown = $derived(needle ? bill.items.filter(item => item.name.toLowerCase().includes(needle)) : bill.items)
  const food = $derived(totalFood(bill))
  // On the last day the top bar says when the check goes.
  const expiresSoon = $derived(expiresAt(bill.createdAt).getTime() - Date.now() < 86_400_000)

  // Avatars under the name: a green ring for whoever has the check open right now.
  const online = $derived(new Set([app.selectedPerson, ...app.onlineUsers.map(user => user.participantId)].filter(Boolean)))
  const faces = $derived(bill.participants.slice(0, 6))

  // The card number is never shown: a floating button copies it. Guests have it while they still owe something,
  // the creator to paste it into a chat; a creator with no card yet gets a button to add one.
  const me = $derived(app.isOwner ? undefined : app.currentTotal)
  const cardDock = $derived(Boolean(bill.paymentDetails && bill.items.length && (app.isOwner || (me && me.remaining > 0))))
  const addCard = $derived(app.isOwner && bill.items.length > 0 && !bill.paymentDetails)
  // Your name sits next to the card button: the name others see, changed in a small sheet.
  const myName = $derived(app.selectedPerson ? app.personName(app.selectedPerson) : '')
</script>

<main class="check-page" class:with-dock={Boolean(myName) || cardDock || addCard}>
  <header class="check-bar">
    <button class="icon-button" aria-label="Все чеки" title="Все чеки" onclick={() => app.goHome()}><Icon name="back" /></button>
    <div class="check-bar-title">
      <h1>{bill.title}</h1>
      <div class="check-bar-meta">
        <button class="face-stack" aria-label={`За столом: ${bill.participants.map(person => app.label(person)).join(', ')}`} title="Кто за столом" onclick={() => app.peopleOpen = true}>
          {#each faces as person (person.id)}<span class="person-avatar mini tone-{app.tone(person.id)}" class:online={online.has(person.id)}>{app.avatar(person)}</span>{/each}
          {#if bill.participants.length > faces.length}<span class="face-more">+{bill.participants.length - faces.length}</span>{/if}
        </button>
        {#if expiresSoon}<small class="soon">⏳ Удалится {expiryDate.format(expiresAt(bill.createdAt))}</small>
        {:else if app.billTotal}<small>{formatUzs(app.billTotal)}</small>{/if}
      </div>
    </div>
    <button class="icon-button" aria-label="Пригласить" title="Пригласить" aria-haspopup="dialog" onclick={() => app.qrOpen = true}>
      <Icon name="invite" />
    </button>
    {#if app.isOwner}<button class="icon-button" aria-label="Настройки чека" title="Настройки чека" onclick={() => app.checkEditOpen = true}><Icon name="edit" /></button>{/if}
  </header>

  {#if !bill.items.length}
    <section class="panel empty-items">
      <div class="empty-illustration" aria-hidden="true">🍽️</div>
      <h2>Стол пока пустой</h2>
      <p>{app.isOwner ? 'Отсканируйте чек или добавьте позиции вручную.' : 'Позиции скоро появятся.'}</p>
      {#if app.isOwner}
        <div class="empty-actions">
          <button class="primary-button" onclick={() => app.scanOpen = true}><Icon name="camera" /> Сканировать чек</button>
          <button class="soft-button" onclick={() => app.addItemOpen = true}><Icon name="plus" /> Добавить вручную</button>
        </div>
      {/if}
    </section>
  {:else}
    {#if app.isOwner}
      <div class="bill-tools">
        <button class="ghost-button" onclick={() => app.addItemOpen = true}><Icon name="plus" /> Позиция</button>
        <button class="ghost-button" onclick={() => app.scanOpen = true}><Icon name="camera" /> Скан</button>
      </div>
    {/if}
    <!-- The check itself, as printed: name, quantity, price per serving; under each line who had it. -->
    <section class="panel bill" class:owner={app.isOwner} aria-label="Чек">
      {#if searchable}
        <input class="item-search" type="search" bind:value={query} placeholder="Найти блюдо" aria-label="Найти блюдо" enterkeyhint="search" />
      {/if}
      <div class="bill-line bill-head" aria-hidden="true"><span>Название</span><span class="bill-qty">Кол-во</span><span class="bill-price">Цена</span>{#if app.isOwner}<span></span>{/if}</div>
      {#each shown as item (item.id)}<ItemCard {item} />{:else}
        <p class="filter-empty">Ничего не нашлось по «{query.trim()}»</p>
      {/each}
      <dl class="bill-sum">
        {#if bill.servicePercent}
          <div><dt>Блюда</dt><dd>{formatAmount(food)}</dd></div>
          <div><dt>Обслуживание {bill.servicePercent}%</dt><dd>{formatAmount(serviceFee(food, bill.servicePercent))}</dd></div>
        {/if}
        <div class="bill-total"><dt>Итого</dt><dd>{formatUzs(app.billTotal)}</dd></div>
      </dl>
      <SummaryPanel />
    </section>

    <div class="panel export-card" class:all-paid={app.allConfirmed}>
      <div class="export-text">
        {#if app.allConfirmed}<span class="done-mark" aria-hidden="true">✓</span>{/if}
        <b>{app.allConfirmed ? 'Все рассчитались' : 'Поделиться итогом'}</b>
      </div>
      <button class="chip" onclick={() => saveImage(bill, app.billTotal, app.totals, app.ownerId)}>Картинка</button>
    </div>
  {/if}

  <div class="dock">
    <!-- Pulses with a pencil until it is tapped once, so people see the name is theirs and can be changed. -->
    {#if myName}<button class="dock-name" class:hint={!app.nameHintSeen} aria-label={`Ваше имя: ${myName}. Изменить`} title="Изменить имя" onclick={() => app.openNameSheet()}><span class="person-avatar mini tone-{app.tone(app.selectedPerson!)}" aria-hidden="true">{myName.slice(0, 1).toUpperCase()}</span><span class="dock-name-text">{myName}</span><span class="dock-name-edit" aria-hidden="true"><Icon name="edit" /></span></button>{/if}
    {#if cardDock}
      <button class="card-dock" onclick={() => app.copy(paymentCopyValue(bill.paymentDetails!), 'Номер скопирован')}><Icon name="card" /><span>Скопировать карту{me ? ` · ${formatAmount(me.remaining)}` : ''}</span></button>
    {:else if addCard}
      <button class="card-dock" onclick={() => app.payDetailsOpen = true}><Icon name="card" /><span>Добавить карту</span></button>
    {/if}
  </div>
</main>
