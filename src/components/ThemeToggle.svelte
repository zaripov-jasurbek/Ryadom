<script lang="ts">
  import { setTheme, theme, themes } from '../lib/theme.svelte'

  // One button that steps through light, system and dark: three always-visible buttons crowd a phone's top bar.
  const current = $derived(themes.find(option => option.value === theme.current) ?? themes[0])
  const next = $derived(themes[(themes.indexOf(current) + 1) % themes.length])
</script>

<button class="icon-button theme-toggle" aria-label={`${current.label}. Переключить: ${next.label.toLowerCase()}`} title={current.label} onclick={() => setTheme(next.value)}>{current.icon}</button>
