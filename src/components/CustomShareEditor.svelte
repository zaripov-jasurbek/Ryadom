<script lang="ts">
  import { formatUzs, splitInteger, type BillItem } from '../lib/calculations'
  import { app } from '../lib/store.svelte'

  let { item, unit }: { item: BillItem; unit: number } = $props()
  const key = $derived(String(unit))
  const participants = $derived(app.bill!.participants)
  const custom = $derived(item.unitModes?.[key] === 'custom')

  // Start from the current split; an unclaimed unit starts split across everyone.
  function initialAmounts(): Record<string, number> {
    const prior = item.unitCustomAmounts?.[key] ?? item.unitAmounts?.[key]
    if (prior) return Object.fromEntries(participants.map(person => [person.id, prior[person.id] ?? 0]))
    const consumers = item.unitSelections[key] ?? []
    const shares = splitInteger(item.unitPrice, participants.map(person => consumers.length ? (consumers.includes(person.id) ? 1 : 0) : 1))
    return Object.fromEntries(participants.map((person, index) => [person.id, shares[index]]))
  }
  let amounts = $state<Record<string, number>>(initialAmounts())

  const clean = (value: unknown) => Math.max(0, Math.floor(Number(value ?? 0)) || 0)
  const total = $derived(participants.reduce((sum, person) => sum + clean(amounts[person.id]), 0))

  async function save() {
    if (total !== item.unitPrice) { app.notify(`Доли должны составить ${formatUzs(item.unitPrice)}`); return }
    if (await app.saveCustomShares(item, unit, Object.fromEntries(participants.map(person => [person.id, clean(amounts[person.id])])))) app.editingUnit = ''
  }
  async function reset() {
    if (!window.confirm('Сбросить ручное распределение? Позиция снова разделится поровну.')) return
    if (await app.resetCustomShares(item, unit)) app.editingUnit = ''
  }
</script>

<div class="custom-share-editor">
  <div class="editor-head"><b>Распределить {formatUzs(item.unitPrice)}</b><span class="muted">Введите сумму для каждого</span></div>
  {#each participants as person (person.id)}
    <label class="editor-row"><span>{person.name}</span><span class="suffix-input compact"><input type="number" min="0" step="1" inputmode="numeric" bind:value={amounts[person.id]} /><span>сум</span></span></label>
  {/each}
  <div class="editor-status" class:ok={total === item.unitPrice}>
    {total === item.unitPrice ? '✓ Сумма сходится' : total < item.unitPrice ? `Осталось распределить ${formatUzs(item.unitPrice - total)}` : `Лишние ${formatUzs(total - item.unitPrice)}`}
  </div>
  <div class="editor-actions">
    <button type="button" class="ghost-button" onclick={() => amounts = Object.fromEntries(participants.map(person => [person.id, 0]))}>Очистить</button>
    {#if custom}<button type="button" class="ghost-button danger" onclick={() => void reset()}>Сбросить разделение</button>{/if}
    <span class="spacer"></span>
    <button type="button" class="soft-button" onclick={() => app.editingUnit = ''}>Отмена</button>
    <button type="button" class="accent-button" disabled={total !== item.unitPrice || app.busy} onclick={() => void save()}>Сохранить</button>
  </div>
</div>
