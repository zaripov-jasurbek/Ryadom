<script lang="ts">
  import { onMount } from 'svelte'
  import { errorMessage } from '../lib/errors'
  import { joinState } from '../lib/join'
  import { limits } from '../lib/limits'
  import type { CheckPreview } from '../lib/remote'
  import { app } from '../lib/store.svelte'

  // A browser that was here before goes straight in. Anyone new says who they are first: random letters
  // confused people, and the name is checked against everyone already at the table.
  let error = $state('')
  let preview = $state<CheckPreview | null>(null)
  let asking = $state(false)
  let name = $state(app.savedName)
  // The field scolds only after the first try, then as the name is fixed.
  let tried = $state(false)
  let serverProblem = $state('')
  // A try failed but was not refused: the next one goes in by the saved token (see joinState).
  let retrying = $state(false)

  const taken = $derived(preview?.participants ?? [])
  const expected = $derived(preview?.expected_guests ?? null)
  const form = $derived(joinState(name, taken, expected, retrying))
  const full = $derived(form.full)
  const problem = $derived(serverProblem || (tried ? form.problem : ''))

  async function open() {
    error = ''
    if (!app.needsName()) { error = await app.joinSharedCheck(); return }
    try {
      preview = await app.previewCheck()
      if (!preview) error = 'Чек не найден — возможно, его удалили'
      else asking = true
    } catch (failure) { console.error(failure); error = errorMessage(failure, 'Не удалось открыть чек') }
  }

  async function join() {
    tried = true; serverProblem = ''
    if (form.problem || full || app.isPending('join')) return
    const failure = await app.joinSharedCheck(name)
    if (!failure) return
    retrying = app.hasJoinToken()
    // Someone took the name or the last place a moment ago: show it here and refresh who is at the table.
    serverProblem = failure
    const fresh = await app.previewCheck().catch(() => preview)
    if (fresh) preview = fresh
    else error = 'Чек не найден — возможно, его удалили'
  }

  onMount(() => { void open() })
</script>

<main class="form-page">
  {#if error}
    <section class="panel form-card join-gone">
      <div class="empty-illustration" aria-hidden="true">🧾</div>
      <h1>Не открылось</h1>
      <p class="lead">{error}</p>
      <button class="primary-button wide" disabled={app.isPending('join')} onclick={open}>Попробовать ещё раз</button>
      <button class="ghost-button" onclick={() => app.goHome()}>На главную</button>
    </section>
  {:else if asking && preview}
    <form class="panel form-card join-card" onsubmit={(e) => { e.preventDefault(); void join() }}>
      <div class="eyebrow">Вас пригласили</div>
      <h1>{preview.title}</h1>
      {#if taken.length}
        <p class="lead">За столом: {taken.join(', ')}{expected ? ` · ${taken.length} из ${expected}` : ''}</p>
      {/if}
      {#if full}
        <p class="form-error" role="alert">Мест больше нет: за столом уже {taken.length} из {expected}. Попросите создателя чека добавить место.</p>
        <button type="button" class="primary-button wide" onclick={open}>Проверить ещё раз</button>
      {:else}
        <!-- svelte-ignore a11y_autofocus -->
        <label class="field">Как вас зовут?
          <input bind:value={name} oninput={() => serverProblem = ''} placeholder="Например, Азиз" maxlength={limits.nameMax} autocomplete="given-name" enterkeyhint="go" aria-invalid={Boolean(problem)} aria-describedby="join-name-note" autofocus />
        </label>
        {#if problem}<p class="form-error" id="join-name-note" role="alert">{problem}</p>
        {:else}<p class="field-note" id="join-name-note">Это имя увидят все за столом. От {limits.nameMin} до {limits.nameMax} символов.</p>{/if}
        <button class="primary-button wide" disabled={app.isPending('join')}>{app.isPending('join') ? 'Входим…' : 'Войти в чек'} <span aria-hidden="true">↗</span></button>
      {/if}
      <button type="button" class="ghost-button" onclick={() => app.goHome()}>На главную</button>
    </form>
  {:else}
    <div class="join-loading" role="status">Открываем чек…</div>
  {/if}
</main>
