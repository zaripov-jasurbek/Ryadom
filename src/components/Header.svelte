<script lang="ts">
  import { app } from '../lib/store.svelte'
  import { homePath } from '../lib/routes'
  import { setTheme, theme, themes } from '../lib/theme.svelte'

  // One button that steps through the themes: three always-visible buttons crowd the top bar on a phone.
  const current = $derived(themes.find(option => option.value === theme.current) ?? themes[0])
  const next = $derived(themes[(themes.indexOf(current) + 1) % themes.length])
</script>

<header class="topbar">
  <a class="brand" href={homePath()} onclick={(e) => { e.preventDefault(); app.goHome() }}><span class="brand-mark">р</span>рядом</a>
  <div class="top-actions">
    <button class="icon-button theme-toggle" aria-label={`${current.label}. Переключить: ${next.label.toLowerCase()}`} title={current.label} onclick={() => setTheme(next.value)}>{current.icon}</button>
  </div>
</header>
