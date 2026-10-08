<script lang="ts">
  import { formatAmount, isUnitAssigned, sharedAllInfo, type BillItem, type Participant } from '../lib/calculations'
  import { initial, portionCount } from '../lib/format'
  import { app } from '../lib/store.svelte'
  import { haptic } from '../lib/haptics'

  let { item }: { item: BillItem } = $props()
  const units = $derived(Array.from({ length: item.quantity }, (_, unit) => unit))
  const everyone = $derived(app.bill!.participants)
  // "On everyone" counts the guests still expected, so it works before they join and keeps their parts for them.
  const share = $derived(sharedAllInfo(item, app.bill!))
  const parts = $derived(share.parts)
  const sharedAll = $derived(Boolean(item.sharedAll))
  const stepper = $derived(item.quantity > 1)
  const me = $derived(app.selectedPerson)

  // Servings split by hand in older checks keep their amounts; nobody can tap them any more.
  const isCustom = (unit: number) => item.unitModes?.[String(unit)] === 'custom'
  function consumers(unit: number) {
    const key = String(unit), custom = isCustom(unit) ? item.unitCustomAmounts?.[key] : undefined
    return everyone.filter(person => custom ? (custom[person.id] ?? 0) > 0 : item.unitSelections[key]?.includes(person.id))
  }
  const has = (unit: number, id: string) => consumers(unit).some(person => person.id === id)
  const tappable = (unit: number) => !isCustom(unit)

  // Each person's servings: a shared one counts as a part, so "Бек 4½" when one of five is split in two.
  const counts = $derived(everyone.map(person => ({ person, count: units.reduce((sum, unit) => { const list = consumers(unit); return list.some(entry => entry.id === person.id) ? sum + 1 / list.length : sum }, 0) })).filter(entry => entry.count > 0))
  const mine = $derived(counts.find(entry => entry.person.id === me)?.count ?? 0)
  const free = $derived(units.filter(unit => tappable(unit) && !consumers(unit).length))
  // A serving nobody has marked yet: the line gets a pulsing dot, like an unread chat.
  const open = $derived(units.some(unit => !isUnitAssigned(item, unit)))
  // "−" first gives back a serving this person had alone, the last one first.
  const giveBack = $derived(me ? units.filter(unit => tappable(unit) && has(unit, me)).sort((a, b) => consumers(a).length - consumers(b).length || b - a)[0] : undefined)
  // Servings eaten by the same people form one group: one stack of avatars shows who shares with whom.
  // Servings the viewer has alone are left to the stepper and the "Я" toggle.
  type Group = { key: string; people: Participant[]; units: number[] }
  const groups = $derived.by(() => {
    const byPeople = new Map<string, Group>()
    for (const unit of units) {
      const people = consumers(unit)
      if (!people.length || (people.length === 1 && people[0].id === me)) continue
      const key = people.map(person => person.id).join(',')
      const group = byPeople.get(key)
      if (group) group.units.push(unit)
      else byPeople.set(key, { key, people, units: [unit] })
    }
    return [...byPeople.values()]
  })
  const maxFaces = 4
  const withMe = (group: Group) => Boolean(me) && group.people.some(person => person.id === me)
  // "⅓" when a serving is split, "× 2" when there are several such servings.
  function groupLabel(group: Group) {
    const share = group.people.length > 1 ? portionCount(1 / group.people.length) : ''
    const times = group.units.length > 1 ? `× ${group.units.length}` : ''
    return [share, times].filter(Boolean).join(' ')
  }
  const groupNames = (group: Group) => group.people.map(person => person.id === me ? 'вы' : person.name).join(', ')
  // A tap on a group the viewer is in gives back one of its servings; on anyone else's, joins one of them.
  const groupUnit = (group: Group) => group.units.filter(tappable).at(withMe(group) ? -1 : 0)
  const tapGroup = (group: Group) => tap(`group:${group.key}`, groupUnit(group))

  // Which control was just tapped: only that one answers with motion, not everything already marked on load.
  let tapped = $state('')
  let tapTimer: ReturnType<typeof setTimeout> | undefined
  function tap(control: string, unit: number | undefined) {
    if (unit === undefined) return
    haptic.selection()
    tapped = control
    clearTimeout(tapTimer); tapTimer = setTimeout(() => tapped = '', 320)
    void app.toggleUnit(item, unit)
  }

  // The creator's item actions live in one "⋯" menu.
  let menuOpen = $state(false)
  let menu: HTMLDivElement | undefined = $state()
  function fromMenu(action: () => void) { menuOpen = false; action() }
  async function remove() {
    if (await app.confirm({ title: `Удалить «${item.name}»?`, body: 'Отметки на этой позиции пропадут.', action: 'Удалить', danger: true })) void app.removeItem(item)
  }
  async function toggleEveryone() {
    haptic.selection()
    if (sharedAll) { void app.unshareItem(item); return }
    const marked = units.some(unit => isUnitAssigned(item, unit))
    if (marked && !await app.confirm({ title: `Разделить «${item.name}» на всех?`, body: `Поровну на ${parts}. Текущие отметки сбросятся.`, action: 'Разделить' })) return
    void app.shareItemEqually(item)
  }
</script>

<svelte:window onclick={(e) => { if (menuOpen && !menu?.contains(e.target as Node)) menuOpen = false }} onkeydown={(e) => { if (e.key === 'Escape') menuOpen = false }} />

{#snippet faces(group: Group)}
  <span class="faces" aria-hidden="true">
    {#each group.people.slice(0, group.people.length > maxFaces ? maxFaces - 1 : maxFaces) as person (person.id)}<b class="tone-{app.tone(person.id)}">{app.avatar(person)}</b>{/each}
    {#if group.people.length > maxFaces}<b class="more">+{group.people.length - maxFaces + 1}</b>{/if}
  </span>
{/snippet}

<div class="bill-row" class:mine={mine > 0} class:open data-item={item.id}>
  <div class="bill-line">
    <b class="bill-name">{#if open}<i class="unread-dot" role="img" title="Не всё отмечено" aria-label="Не всё отмечено"></i>{/if}{item.name}</b>
    <span class="bill-qty">{item.quantity}</span>
    <span class="bill-price">{formatAmount(item.unitPrice)}</span>
    {#if app.isOwner}
      <div class="item-menu" bind:this={menu}>
        <button class="icon-button small" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Действия с позицией «${item.name}»`} title="Действия" onclick={() => menuOpen = !menuOpen}>⋯</button>
        {#if menuOpen}
          <div class="menu-popover" role="menu">
            <button role="menuitem" onclick={() => fromMenu(() => app.editingItem = item)}>✎ Изменить</button>
            <button role="menuitem" class="danger" onclick={() => fromMenu(() => void remove())}>🗑 Удалить</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="bill-controls">
    {#if sharedAll}
      <span class="train-note">На всех · по {formatAmount(share.perPerson)}</span>
    {:else}
      <!-- One stack of avatars per group of servings; the groups wrap to a new line instead of scrolling sideways. -->
      <div class="train" role="group" aria-label="Кто отметил">
        {#each groups as group (group.key)}
          {@const label = groupLabel(group)}
          {@const names = groupNames(group)}
          {#if stepper && me}
            <button type="button" class="car group" class:with-me={withMe(group)} class:pop={tapped === `group:${group.key}`} aria-label={label ? `${names} · ${label}` : names} title={withMe(group) ? 'Не делить эту порцию' : `Поделить порцию: ${names}`} disabled={groupUnit(group) === undefined} onclick={() => tapGroup(group)}>{@render faces(group)}{#if label}<span class="group-share">{label}</span>{/if}</button>
          {:else}
            <span class="car group" class:with-me={withMe(group)} role="img" aria-label={label ? `${names} · ${label}` : names} title={names}>{@render faces(group)}{#if label}<span class="group-share">{label}</span>{/if}</span>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="bill-actions">
      {#if me && !sharedAll}
        {#if stepper}
          <div class="portion-stepper" role="group" aria-label={`Ваши порции: ${item.name}`}>
            <button type="button" aria-label="Убрать одну порцию" disabled={giveBack === undefined} onclick={() => tap('stepper', giveBack)}>−</button>
            <span aria-live="polite">{#key mine}<b class:bump={tapped === 'stepper'}>{portionCount(mine)}</b>{/key}</span>
            <button type="button" aria-label="Взять ещё порцию" title={free.length ? '' : 'Свободных порций нет'} disabled={!free.length} onclick={() => tap('stepper', free[0])}>+</button>
          </div>
        {:else if tappable(0)}
          <button class="mine-toggle" class:active={mine > 0} class:pop={tapped === 'mine'} aria-pressed={mine > 0} title="Моё" onclick={() => tap('mine', 0)}>{mine > 0 ? '✓ Я' : 'Я'}</button>
        {/if}
      {/if}
      <!-- Only the creator splits among everyone; then nobody can mark the item until they switch it off. -->
      {#if app.isOwner && (sharedAll || parts > 1)}
        <button class="mine-toggle everyone" class:active={sharedAll} aria-pressed={sharedAll} title="На всех" disabled={app.busy} onclick={toggleEveryone}>{sharedAll ? '✓ Все' : 'Все'}</button>
      {/if}
    </div>
  </div>
</div>
