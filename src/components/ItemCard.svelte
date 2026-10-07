<script lang="ts">
  import { formatUzs, isUnitAssigned, sharedAllInfo, type BillItem } from '../lib/calculations'
  import { initial, itemIcon } from '../lib/format'
  import { app } from '../lib/store.svelte'
  import CustomShareEditor from './CustomShareEditor.svelte'
  import { haptic } from '../lib/haptics'

  let { item }: { item: BillItem } = $props()
  const units = $derived(Array.from({ length: item.quantity }, (_, unit) => unit))
  const everyone = $derived(app.bill!.participants)
  // "On everyone" counts the guests still expected, so it works before they join and keeps their parts for them.
  const parts = $derived(sharedAllInfo(item, app.bill!).parts)
  const sharedAll = $derived(Boolean(item.sharedAll))

  // The creator's item actions live in one "⋯" menu instead of a row of icons.
  let menuOpen = $state(false)
  let menu: HTMLDivElement | undefined = $state()
  const canShareAll = $derived(parts > 1 && !sharedAll)
  function fromMenu(action: () => void) { menuOpen = false; action() }

  // Several servings are marked with a stepper; the per-serving rows open for sharing one serving or custom splits.
  // A single serving is one line: name, who has it and the button, so a long receipt stays short to scroll.
  let expanded = $state(false)
  const stepper = $derived(item.quantity > 1)
  const showUnits = $derived(stepper && !sharedAll && (expanded || app.editingUnit.startsWith(`${item.id}:`)))
  const isCustom = (unit: number) => item.unitModes?.[String(unit)] === 'custom'
  const me = $derived(app.selectedPerson)
  const myUnits = $derived(me ? units.filter(unit => consumers(unit).some(person => person.id === me)) : [])
  const free = $derived(units.filter(unit => !isCustom(unit) && !item.unitSelections[String(unit)]?.length))
  // "+" takes a free serving; "−" first gives back a serving this person had alone, the last one first.
  const nextFree = $derived(free[0])
  const giveBack = $derived(myUnits.filter(unit => !isCustom(unit)).sort((a, b) => consumers(a).length - consumers(b).length || b - a)[0])
  const tally = $derived(everyone.map(person => ({ person, count: units.filter(unit => consumers(unit).some(entry => entry.id === person.id)).length })).filter(entry => entry.count))

  // Which control was just tapped: only that one answers with motion, not everything already marked on load.
  let tapped = $state('')
  let tapTimer: ReturnType<typeof setTimeout> | undefined
  function tap(control: string, unit: number) {
    haptic.selection()
    tapped = control
    clearTimeout(tapTimer); tapTimer = setTimeout(() => tapped = '', 320)
    void app.toggleUnit(item, unit)
  }

  function toggleUnits() {
    haptic.selection()
    if (!showUnits) { expanded = true; return }
    expanded = false
    if (app.editingUnit.startsWith(`${item.id}:`)) app.editingUnit = ''
  }

  function consumers(unit: number) {
    const key = String(unit), custom = item.unitModes?.[key] === 'custom' ? item.unitCustomAmounts?.[key] : undefined
    return app.bill!.participants.filter(person => custom ? (custom[person.id] ?? 0) > 0 : item.unitSelections[key]?.includes(person.id))
  }
  const isMine = (unit: number) => Boolean(me && consumers(unit).some(person => person.id === me))
  async function remove() {
    if (await app.confirm({ title: `Удалить «${item.name}»?`, body: 'Отметки и доли на этой позиции пропадут.', action: 'Удалить', danger: true })) void app.removeItem(item)
  }
  async function shareWithEveryone() {
    const marked = units.some(unit => isUnitAssigned(item, unit))
    if (marked && !await app.confirm({ title: `Разделить «${item.name}» на всех?`, body: `Поровну на ${parts}. Текущие отметки сбросятся.`, action: 'Разделить' })) return
    void app.shareItemEqually(item)
  }
  function toggleEditor(key: string) {
    const id = `${item.id}:${key}`
    app.editingUnit = app.editingUnit === id ? '' : id
  }
</script>

<svelte:window onclick={(e) => { if (menuOpen && !menu?.contains(e.target as Node)) menuOpen = false }} onkeydown={(e) => { if (e.key === 'Escape') menuOpen = false }} />

{#snippet people(unit: number)}
  {@const key = String(unit)}
  {@const list = consumers(unit)}
  <div class="unit-consumers">
    {#each list as person (person.id)}
      <span class="consumer-pill"><span class="person-avatar mini tone-{app.personIndex(person.id) % 5}">{initial(person.name)}</span>{person.name}{isCustom(unit) ? ` · ${formatUzs(item.unitCustomAmounts?.[key]?.[person.id] ?? 0)}` : ''}</span>
    {:else}
      <!-- On a one-line card an empty place says it already; repeated on every row it is only noise. -->
      {#if stepper}<span class="unit-empty">Пока никто не отметил</span>{/if}
    {/each}
    {#if !isCustom(unit) && list.length > 1 && !sharedAll}<span class="unit-note">по {item.unitPrice % list.length ? '~' : ''}{formatUzs(Math.round(item.unitPrice / list.length))}</span>{/if}
  </div>
{/snippet}

<!-- For the creator the label is the switch, like «Моё»: a tap ends "split among everyone". -->
{#snippet everyoneNote()}
  {#if app.isOwner}
    <button class="mine-toggle active" aria-pressed="true" title="Отключить" disabled={app.busy} onclick={() => { haptic.selection(); void app.unshareItem(item) }}>✓ На всех</button>
  {:else}
    <span class="consumer-pill everyone-pill">На всех</span>
  {/if}
{/snippet}

{#snippet mineButton(unit: number)}
  {@const mine = isMine(unit)}
  {@const pending = Boolean(item.unitIds?.[unit] && app.pendingUnits[item.unitIds[unit]])}
  {#if isCustom(unit)}
    <span class="unit-note">Доли вручную</span>
  {:else if me}
    <button class="mine-toggle" class:active={mine} class:pop={tapped === `unit:${unit}`} aria-pressed={mine} aria-busy={pending} disabled={pending} onclick={() => tap(`unit:${unit}`, unit)}>{mine ? '✓ Моё' : 'Это моё'}</button>
  {/if}
{/snippet}

<article class="panel item-card" class:single={!stepper} class:owner={app.isOwner} class:unit-mine={stepper ? myUnits.length > 0 : isMine(0)}>
  <div class="item-head">
    <div class="item-icon" aria-hidden="true">{itemIcon(item.name)}</div>
    <div class="item-title">
      <b>{item.name}</b>
      <span class="muted">{formatUzs(item.unitPrice)}{item.quantity > 1 ? ` × ${item.quantity} = ${formatUzs(item.unitPrice * item.quantity)}` : ''}</span>
    </div>
    {#if !stepper && sharedAll}<div class="item-action">{@render everyoneNote()}</div>
    {:else if !stepper}{@render people(0)}<div class="item-action">{@render mineButton(0)}</div>{/if}
    {#if app.isOwner}
      <div class="item-menu" bind:this={menu}>
        <button class="icon-button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Действия с позицией «${item.name}»`} title="Действия" onclick={() => menuOpen = !menuOpen}>⋯</button>
        {#if menuOpen}
          <div class="menu-popover" role="menu">
            <button role="menuitem" onclick={() => fromMenu(() => app.editingItem = item)}>✎ Изменить</button>
            {#if canShareAll}<button role="menuitem" disabled={app.busy} onclick={() => fromMenu(() => void shareWithEveryone())}>÷ Поровну на всех · {parts}</button>{/if}
            {#if !stepper && !sharedAll}<button role="menuitem" onclick={() => fromMenu(() => toggleEditor('0'))}>⚖ Доли вручную</button>{/if}
            <button role="menuitem" class="danger" onclick={() => fromMenu(() => void remove())}>🗑 Удалить</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {#if !stepper && !sharedAll && app.editingUnit === `${item.id}:0`}<CustomShareEditor {item} unit={0} />{/if}
  <!-- Split among everyone: nothing to mark or split by hand until the creator switches it off. -->
  {#if stepper && sharedAll}
    <div class="portion-summary">{@render everyoneNote()}</div>
  {:else if stepper}
    <div class="portion-summary">
      <div class="unit-consumers">
        {#each tally as { person, count } (person.id)}
          <span class="consumer-pill"><span class="person-avatar mini tone-{app.personIndex(person.id) % 5}">{initial(person.name)}</span>{person.name}{count > 1 ? ` ×${count}` : ''}</span>
        {/each}
        {#if free.length === item.quantity}<span class="unit-empty">Пока никто не отметил</span>
        {:else if free.length}<span class="unit-note">свободно {free.length}</span>{/if}
      </div>
      {#if me}
        <div class="portion-stepper" role="group" aria-label={`Ваши порции: ${item.name}`}>
          <button type="button" aria-label="Убрать одну порцию" disabled={giveBack === undefined} onclick={() => tap('stepper', giveBack!)}>−</button>
          <span aria-live="polite">{#key myUnits.length}<b class:bump={tapped === 'stepper'}>{myUnits.length}</b>{/key} из {item.quantity}</span>
          <button type="button" aria-label="Взять ещё порцию" title={nextFree === undefined ? 'Свободных порций нет' : ''} disabled={nextFree === undefined} onclick={() => tap('stepper', nextFree!)}>+</button>
        </div>
      {/if}
    </div>
    <button type="button" class="ghost-button units-toggle" aria-expanded={showUnits} onclick={toggleUnits}>{showUnits ? 'Свернуть порции ▴' : 'По порциям ▾'}</button>
  {/if}
  {#if showUnits}
  <div class="unit-list">
    {#each units as unit (unit)}
      {@const key = String(unit)}
      <div class="unit-row" class:unit-mine={isMine(unit)}>
        <span class="unit-label">№{unit + 1}</span>
        {@render people(unit)}
        <div class="unit-actions">
          {@render mineButton(unit)}
          {#if app.isOwner}<button class="ghost-button" aria-expanded={app.editingUnit === `${item.id}:${key}`} onclick={() => toggleEditor(key)}>Доли</button>{/if}
        </div>
      </div>
      {#if app.editingUnit === `${item.id}:${key}`}<CustomShareEditor {item} {unit} />{/if}
    {/each}
  </div>
  {/if}
  {#if app.isOwner && canShareAll && !units.some(unit => isUnitAssigned(item, unit))}
    <button class="ghost-button share-all" disabled={app.busy} onclick={shareWithEveryone}>÷ Поровну на всех · {parts}</button>
  {/if}
</article>
