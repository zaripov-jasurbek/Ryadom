<script lang="ts">
  import { formatUzs, type BillItem } from '../lib/calculations'
  import { initial, itemIcon } from '../lib/format'
  import { app } from '../lib/store.svelte'
  import CustomShareEditor from './CustomShareEditor.svelte'

  let { item }: { item: BillItem } = $props()
  const units = $derived(Array.from({ length: item.quantity }, (_, unit) => unit))

  function consumers(unit: number) {
    const key = String(unit), custom = item.unitModes?.[key] === 'custom' ? item.unitCustomAmounts?.[key] : undefined
    return app.bill!.participants.filter(person => custom ? (custom[person.id] ?? 0) > 0 : item.unitSelections[key]?.includes(person.id))
  }
  function remove() {
    if (window.confirm(`Удалить позицию «${item.name}»?`)) void app.removeItem(item)
  }
  function toggleEditor(key: string) {
    const id = `${item.id}:${key}`
    app.editingUnit = app.editingUnit === id ? '' : id
  }
</script>

<article class="panel item-card">
  <div class="item-head">
    <div class="item-icon" aria-hidden="true">{itemIcon(item.name)}</div>
    <div class="item-title">
      <b>{item.name}</b>
      <span class="muted">{formatUzs(item.unitPrice)}{item.quantity > 1 ? ` × ${item.quantity} = ${formatUzs(item.unitPrice * item.quantity)}` : ''}</span>
    </div>
    {#if app.isOwner}<button class="icon-button danger" aria-label={`Удалить позицию «${item.name}»`} title="Удалить позицию" onclick={remove}>🗑</button>{/if}
  </div>
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
</article>
