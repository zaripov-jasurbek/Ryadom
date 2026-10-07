<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from '../lib/store.svelte'

  // Opening the link is joining: the check opens right away, under a name the guest can change in the summary.
  let error = $state('')
  async function join() { error = await app.joinSharedCheck() }
  onMount(() => { void join() })
</script>

<main class="form-page">
  {#if error}
    <section class="panel form-card join-gone">
      <div class="empty-illustration" aria-hidden="true">🧾</div>
      <h1>Не открылось</h1>
      <p class="lead">{error}</p>
      <button class="primary-button wide" disabled={app.busy} onclick={join}>Попробовать ещё раз</button>
      <button class="ghost-button" onclick={() => app.goHome()}>На главную</button>
    </section>
  {:else}
    <div class="join-loading" role="status">Открываем чек…</div>
  {/if}
</main>
