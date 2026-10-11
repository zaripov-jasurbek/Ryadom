<script lang="ts">
  import { app } from '../lib/store.svelte'
  import { homePath } from '../lib/routes'
  import { install, installHint, promptInstall } from '../lib/pwa.svelte'
  import Icon from './Icon.svelte'
  import InstallHintModal from './InstallHintModal.svelte'

  // Install sits next to the name on the home page, where it is seen first.
  // Chrome and Edge install on a tap; Safari (iPhone, iPad, Mac) can only be shown the steps.
  let hintOpen = $state(false)
  function installApp() { if (install.prompt) void promptInstall(); else hintOpen = true }
</script>

<header class="topbar">
  <a class="brand" href={homePath()} onclick={(e) => { e.preventDefault(); app.goHome() }}><span class="brand-mark">р</span>рядом</a>
  {#if app.mode === 'home' && (install.prompt || installHint)}<button class="soft-button" onclick={installApp}><Icon name="install" /> Установить</button>{/if}
</header>

{#if hintOpen}<InstallHintModal onclose={() => hintOpen = false} />{/if}
