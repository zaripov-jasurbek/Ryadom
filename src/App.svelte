<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from './lib/store.svelte'
  import Header from './components/Header.svelte'
  import HomePage from './components/HomePage.svelte'
  import CreatePage from './components/CreatePage.svelte'
  import JoinPage from './components/JoinPage.svelte'
  import CheckPage from './components/CheckPage.svelte'
  import AddItemModal from './components/AddItemModal.svelte'
  import EditCheckModal from './components/EditCheckModal.svelte'
  import ShareQrModal from './components/ShareQrModal.svelte'
  import ConfirmSheet from './components/ConfirmSheet.svelte'
  import PeopleModal from './components/PeopleModal.svelte'
  import PayDetailsModal from './components/PayDetailsModal.svelte'
  import NameModal from './components/NameModal.svelte'

  onMount(() => app.init())

  // The scanner (its window, OCR and receipt parser) loads only once someone opens it; Tesseract and its models
  // load later still, when a photo is chosen.
  let ScanReceiptModal = $state<typeof import('./components/ScanReceiptModal.svelte').default | null>(null)
  $effect(() => {
    if (!app.scanOpen || ScanReceiptModal) return
    import('./components/ScanReceiptModal.svelte')
      .then(module => { ScanReceiptModal = module.default })
      .catch(() => { app.scanOpen = false; app.notify('Не удалось открыть сканер — нет интернета') })
  })
  // Each screen starts at the top instead of inheriting the previous screen's scroll position.
  $effect(() => { void app.mode; window.scrollTo(0, 0) })
</script>

<svelte:head>
  <title>{app.bill && app.mode === 'check' ? `${app.bill.title} · Рядом` : 'Рядом — разделите счёт легко'}</title>
  <meta name="description" content="Удобно разделите ресторанный счёт с друзьями" />
</svelte:head>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') app.closeOverlays() }} />

<div class="app-shell">
  <!-- A check is its own small app: its top bar replaces the site header. -->
  {#if app.mode !== 'check' || !app.bill}<Header />{/if}
  {#if !app.online}<div class="offline-banner" role="status">Нет интернета — изменения не сохранятся, пока связь не вернётся</div>{/if}

  {#if app.mode === 'home'}
    <HomePage />
  {:else if app.mode === 'create'}
    <CreatePage />
  {:else if app.mode === 'join'}
    <JoinPage />
  {:else if app.bill}
    <CheckPage />
  {/if}

  {#if app.addItemOpen && app.bill}<AddItemModal />{/if}
  {#if app.editingItem && app.bill}{#key app.editingItem.id}<AddItemModal item={app.editingItem} />{/key}{/if}
  {#if app.checkEditOpen && app.bill}<EditCheckModal />{/if}
  {#if app.scanOpen && (app.bill || app.mode === 'create') && ScanReceiptModal}<ScanReceiptModal />{/if}
  {#if app.qrOpen && app.bill}<ShareQrModal />{/if}
  {#if app.peopleOpen && app.bill}<PeopleModal />{/if}
  {#if app.payDetailsOpen && app.bill}<PayDetailsModal />{/if}
  {#if app.nameOpen && app.bill}<NameModal />{/if}
  {#if app.confirmRequest}{#key app.confirmRequest}<ConfirmSheet />{/key}{/if}
  {#if app.toast}<div class="toast" role="status" aria-live="polite">{app.toast}</div>{/if}
</div>
