<script lang="ts">
  import { app } from '../lib/store.svelte'
  import { homePath } from '../lib/routes'
  import ThemeToggle from './ThemeToggle.svelte'
</script>

<header class="topbar">
  <a class="brand" href={homePath()} onclick={(e) => { e.preventDefault(); app.goHome() }}><span class="brand-mark">р</span>рядом</a>
  <div class="top-actions"><ThemeToggle /></div>
</header>
