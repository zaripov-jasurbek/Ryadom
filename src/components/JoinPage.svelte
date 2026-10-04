<script lang="ts">
  import { onMount } from 'svelte'
  import { formatUzs, serviceFee } from '../lib/calculations'
  import { initial, plural } from '../lib/format'
  import { limits } from '../lib/limits'
  import type { CheckPreview } from '../lib/remote'
  import { app } from '../lib/store.svelte'

  let name = $state(app.savedName)
  let error = $state('')
  const owner = $derived(Boolean(app.token))
  // undefined while loading or when the preview failed: then the form works as before, just without the details.
  let preview = $state<CheckPreview | null | undefined>(undefined)
  onMount(() => { void app.previewJoin().then(result => preview = result) })

  const total = $derived(preview ? preview.foodTotal + serviceFee(preview.foodTotal, preview.servicePercent) : 0)
  // Two "Aziz" at one table are hard to tell apart in the totals.
  const taken = $derived(owner ? undefined : preview?.participants.find(person => person.trim().toLowerCase() === name.trim().toLowerCase()))

  async function submit() {
    if (!name.trim() || app.busy) return
    error = await app.joinSharedCheck(name.trim())
  }
</script>

<main class="form-page">
  <button class="back-link" onclick={() => app.goHome()}>← На главную</button>
  {#if preview === null}
    <section class="panel form-card join-gone">
      <div class="empty-illustration" aria-hidden="true">🧾</div>
      <h1>Чек не найден</h1>
      <p class="lead">Его удалили или он устарел. Попросите новую ссылку.</p>
      <button class="primary-button wide" onclick={() => app.goHome()}>На главную</button>
    </section>
  {:else}
    <form class="panel form-card" onsubmit={(e) => { e.preventDefault(); void submit() }}>
      <div class="eyebrow">{owner ? 'Ваш чек' : 'Вас пригласили в чек'}</div>
      <h1>{preview ? preview.title : owner ? 'Это ваш чек' : 'Кто за этим столом?'}</h1>
      {#if preview}
        <div class="join-preview">
          <span>{preview.items ? `${plural(preview.items, 'позиция', 'позиции', 'позиций')} · ${formatUzs(total)}` : 'Позиции ещё добавляют'}</span>
          <div class="join-people" aria-label="Уже за столом">
            {#each preview.participants.slice(0, 6) as person, i (i)}<span class="person-avatar mini tone-{i % 5}" title={person}>{initial(person)}</span>{/each}
            <small>{preview.participants.slice(0, 3).join(', ')}{preview.participants.length > 3 ? ` и ещё ${preview.participants.length - 3}` : ''}</small>
          </div>
        </div>
      {/if}
      {#if owner}<p class="lead">Введите имя, чтобы продолжить.</p>{/if}
      <label class="field">{owner ? 'Ваше имя в чеке' : 'Ваше имя'}<input bind:value={name} placeholder="Например, Aziz" maxlength={limits.nameLength} autocomplete="given-name" required /></label>
      {#if taken}<p class="field-note">«{taken}» уже за столом. Если это не вы, добавьте букву фамилии.</p>{/if}
      {#if error}<div class="form-error" role="alert">{error}</div>{/if}
      <button class="primary-button wide" disabled={app.busy || !name.trim()}>{app.busy ? 'Подключаемся…' : owner ? 'Открыть чек' : 'Присоединиться'} <span aria-hidden="true">↗</span></button>
      <div class="privacy-note">🔒 Без регистрации</div>
    </form>
  {/if}
</main>
