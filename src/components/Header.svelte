<script lang="ts">
  import { app } from '../lib/store.svelte'
  import { homePath } from '../lib/routes'
  import { setTheme, theme, themes } from '../lib/theme.svelte'

  const live = $derived(Boolean(app.bill?.dbId && app.mode === 'check'))
</script>

<header class="topbar">
  <a class="brand" href={homePath()} onclick={(e) => { e.preventDefault(); app.goHome() }}><span class="brand-mark">р</span>рядом</a>
  <div class="top-actions">
    {#if live}<span class="sync-pill sync-live"><i></i>Онлайн</span>{/if}
    <div class="theme-switch" role="radiogroup" aria-label="Тема оформления">
      {#each themes as option (option.value)}
        <button role="radio" aria-checked={theme.current === option.value} aria-label={option.label} title={option.label} class:active={theme.current === option.value} onclick={() => setTheme(option.value)}>{option.icon}</button>
      {/each}
    </div>
  </div>
</header>
