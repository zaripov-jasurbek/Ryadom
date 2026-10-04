<script lang="ts">
  import { formatUzs, isUnitAssigned, type BillItem } from '../lib/calculations'
  import { initial, itemIcon } from '../lib/format'
  import { app } from '../lib/store.svelte'
  import CustomShareEditor from './CustomShareEditor.svelte'

  let { item }: { item: BillItem } = $props()
  const units = $derived(Array.from({ length: item.quantity }, (_, unit) => unit))
  const everyone = $derived(app.bill!.participants)
  const sharedByAll = $derived(units.every(unit => item.unitModes?.[String(unit)] !== 'custom' && everyone.every(person => item.unitSelections[String(unit)]?.includes(person.id))))

  // The creator's item actions live in one "⋯" menu instead of a row of icons.
  let menuOpen = $state(false)
  let menu: HTMLDivElement | undefined = $state()
  const canShareAll = $derived(everyone.length > 1 && !sharedByAll)
  function fromMenu(action: () => void) { menuOpen = false; action() }

  // Several servings are marked with a stepper; the per-serving rows open for sharing one serving or custom splits.
  let expanded = $state(false)
  const stepper = $derived(item.quantity > 1)
  const showUnits = $derived(!stepper || expanded || app.editingUnit.startsWith(`${item.id}:`))
  const isCustom = (unit: number) => item.unitModes?.[String(unit)] === 'custom'
  const me = $derived(app.selectedPerson)
  const myUnits = $derived(me ? units.filter(unit => consumers(unit).some(person => person.id === me)) : [])
  const free = $derived(units.filter(unit => !isCustom(unit) && !item.unitSelections[String(unit)]?.length))
  // "+" takes a free serving; "−" first gives back a serving this person had alone, the last one first.
  const nextFree = $derived(free[0])
  const giveBack = $derived(myUnits.filter(unit => !isCustom(unit)).sort((a, b) => consumers(a).length - consumers(b).length || b - a)[0])
  const tally = $derived(everyone.map(person => ({ person, count: units.filter(unit => consumers(unit).some(entry => entry.id === person.id)).length })).filter(entry => entry.count))

  function toggleUnits() {
    if (!showUnits) { expanded = true; return }
    expanded = false
    if (app.editingUnit.startsWith(`${item.id}:`)) app.editingUnit = ''
  }

  function consumers(unit: number) {
    const key = String(unit), custom = item.unitModes?.[key] === 'custom' ? item.unitCustomAmounts?.[key] : undefined
    return app.bill!.participants.filter(person => custom ? (custom[person.id] ?? 0) > 0 : item.unitSelections[key]?.includes(person.id))
  }
  async function remove() {
    if (await app.confirm({ title: `Удалить «${item.name}»?`, body: 'Отметки и доли на этой позиции пропадут.', action: 'Удалить', danger: true })) void app.removeItem(item)
  }
  async function shareWithEveryone() {
    const marked = units.some(unit => isUnitAssigned(item, unit))
    if (marked && !await app.confirm({ title: `Разделить «${item.name}» на всех?`, body: `Каждая порция поделится поровну между ${everyone.length} участниками. Текущие отметки на позиции заменятся.`, action: 'Разделить' })) return
    void app.shareItemEqually(item)
  }
  function toggleEditor(key: string) {
    const id = `${item.id}:${key}`
    app.editingUnit = app.editingUnit === id ? '' : id
  }
</script>

<svelte:window onclick={(e) => { if (menuOpen && !menu?.contains(e.target as Node)) menuOpen = false }} onkeydown={(e) => { if (e.key === 'Escape') menuOpen = false }} />

<article class="panel item-card">
  <div class="item-head">
    <div class="item-icon" aria-hidden="true">{itemIcon(item.name)}</div>
    <div class="item-title">
      <b>{item.name}</b>
      <span class="muted">{formatUzs(item.unitPrice)}{item.quantity > 1 ? ` × ${item.quantity} = ${formatUzs(item.unitPrice * item.quantity)}` : ''}</span>
    </div>
    {#if app.isOwner}
      <div class="item-menu" bind:this={menu}>
        <button class="icon-button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Действия с позицией «${item.name}»`} title="Действия" onclick={() => menuOpen = !menuOpen}>⋯</button>
        {#if menuOpen}
          <div class="menu-popover" role="menu">
            <button role="menuitem" onclick={() => fromMenu(() => app.editingItem = item)}>✎ Изменить</button>
            {#if canShareAll}<button role="menuitem" disabled={app.busy} onclick={() => fromMenu(() => void shareWithEveryone())}>÷ Поровну на всех · {everyone.length}</button>{/if}
            <button role="menuitem" class="danger" onclick={() => fromMenu(() => void remove())}>🗑 Удалить</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {#if stepper}
    <div class="portion-summary" class:unit-mine={myUnits.length > 0}>
      <div class="unit-consumers">
        {#each tally as { person, count } (person.id)}
          <span class="consumer-pill"><span class="person-avatar mini tone-{app.personIndex(person.id) % 5}">{initial(person.name)}</span>{person.name}{count > 1 ? ` ×${count}` : ''}</span>
        {/each}
        {#if free.length === item.quantity}<span class="unit-empty">Пока никто не отметил</span>
        {:else if free.length}<span class="unit-note">свободно {free.length}</span>{/if}
      </div>
      {#if me}
        <div class="portion-stepper" role="group" aria-label={`Ваши порции: ${item.name}`}>
          <button type="button" aria-label="Убрать одну порцию" disabled={giveBack === undefined} onclick={() => app.toggleUnit(item, giveBack!)}>−</button>
          <span aria-live="polite"><b>{myUnits.length}</b> из {item.quantity}</span>
          <button type="button" aria-label="Взять ещё порцию" title={nextFree === undefined ? 'Свободных порций нет — поделить порцию можно в списке по порциям' : ''} disabled={nextFree === undefined} onclick={() => app.toggleUnit(item, nextFree!)}>+</button>
        </div>
      {/if}
    </div>
    <button type="button" class="ghost-button units-toggle" aria-expanded={showUnits} onclick={toggleUnits}>{showUnits ? 'Свернуть порции ▴' : 'Делили порцию? По порциям ▾'}</button>
  {/if}
  {#if showUnits}
  <div class="unit-list">
    {#each units as unit (unit)}
      {@const key = String(unit)}
      {@const custom = item.unitModes?.[key] === 'custom'}
      {@const people = consumers(unit)}
      {@const mine = Boolean(app.selectedPerson && people.some(person => person.id === app.selectedPerson))}
      {@const pending = Boolean(item.unitIds?.[unit] && app.pendingUnits[item.unitIds[unit]])}
      <div class="unit-row" class:unit-mine={mine}>
        {#if item.quantity > 1}<span class="unit-label">№{unit + 1}</span>{/if}
        <div class="unit-consumers">
          {#each people as person (person.id)}
            <span class="consumer-pill"><span class="person-avatar mini tone-{app.personIndex(person.id) % 5}">{initial(person.name)}</span>{person.name}{custom ? ` · ${formatUzs(item.unitCustomAmounts?.[key]?.[person.id] ?? 0)}` : ''}</span>
          {:else}
            <span class="unit-empty">Пока никто не отметил</span>
          {/each}
          {#if !custom && people.length > 1}<span class="unit-note">по {item.unitPrice % people.length ? '~' : ''}{formatUzs(Math.round(item.unitPrice / people.length))}</span>{/if}
        </div>
        <div class="unit-actions">
          {#if custom}
            <span class="unit-note">Доли вручную</span>
          {:else if app.selectedPerson}
            <button class="mine-toggle" class:active={mine} aria-pressed={mine} aria-busy={pending} disabled={pending} onclick={() => app.toggleUnit(item, unit)}>{mine ? '✓ Моё' : 'Это моё'}</button>
          {/if}
          {#if app.isOwner}<button class="ghost-button" aria-expanded={app.editingUnit === `${item.id}:${key}`} onclick={() => toggleEditor(key)}>Доли</button>{/if}
        </div>
      </div>
      {#if app.editingUnit === `${item.id}:${key}`}<CustomShareEditor {item} {unit} />{/if}
    {/each}
  </div>
  {/if}
  {#if app.isOwner && canShareAll && !units.some(unit => isUnitAssigned(item, unit))}
    <button class="ghost-button share-all" disabled={app.busy} title="Хлеб, чай, кальян — всё, что брали на всех" onclick={shareWithEveryone}>÷ Поровну на всех · {everyone.length}</button>
  {/if}
</article>
