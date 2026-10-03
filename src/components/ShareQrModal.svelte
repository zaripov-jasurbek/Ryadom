<script lang="ts">
  import { renderSVG } from 'uqr'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  const link = app.publicLink()
  const shared = Boolean(app.bill?.dbId)
  // Black on white in both themes: phone cameras read dark modules on a light background most reliably.
  const svg = renderSVG(link, { ecc: 'M', border: 2, blackColor: '#1d241f', whiteColor: '#ffffff' })
  const canShare = typeof navigator.share === 'function'

  function copy() {
    void app.copy(link, shared ? 'Ссылка скопирована — гости могут открыть чек' : 'Демо-ссылка скопирована · доступна только в этом браузере')
  }
  async function share() {
    try { await navigator.share({ title: app.bill?.title, text: 'Открой чек и отметь, что ты заказывал', url: link }) }
    catch (error) { if ((error as Error).name !== 'AbortError') copy() }
  }
</script>

<Modal labelledby="share-qr-title" onclose={() => app.qrOpen = false} onsubmit={copy}>
  <div class="eyebrow">{shared ? 'Пригласить за стол' : 'Демо-режим'}</div>
  <h2 id="share-qr-title">Наведите камеру</h2>
  <p class="lead">{shared ? 'Друзья сканируют код камерой телефона и сразу попадают в чек.' : 'Ссылка откроется только в этом браузере — подключите Supabase, чтобы делиться чеком.'}</p>
  <div class="qr-frame" role="img" aria-label="QR-код со ссылкой на чек">{@html svg}</div>
  <div class="qr-link">{link.replace(/^https?:\/\//, '')}</div>
  <div class="qr-actions">
    {#if canShare}<button type="button" class="soft-button" onclick={() => void share()}>Поделиться</button>{/if}
    <button class="primary-button">Скопировать ссылку</button>
  </div>
</Modal>
