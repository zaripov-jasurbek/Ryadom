<script lang="ts">
  import { renderSVG } from 'uqr'
  import { prefersShareSheet } from '../lib/share'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  const link = app.publicLink()
  const shared = Boolean(app.bill?.dbId)
  // Black on white in both themes: phone cameras read dark modules on a light background most reliably.
  const svg = renderSVG(link, { ecc: 'M', border: 2, blackColor: '#1d241f', whiteColor: '#ffffff' })

  function copy() {
    void app.copy(link, shared ? 'Ссылка скопирована — гости могут открыть чек' : 'Ссылка скопирована, но этот чек открывается только на этом устройстве')
  }
</script>

<Modal labelledby="share-qr-title" onclose={() => app.qrOpen = false} onsubmit={copy}>
  <div class="eyebrow">{shared ? 'Пригласить за стол' : 'Только на этом устройстве'}</div>
  <h2 id="share-qr-title">Наведите камеру</h2>
  <p class="lead">{shared ? 'Друзья сканируют код камерой телефона и сразу попадают в чек.' : 'Этот чек сохранён только здесь, друзья по ссылке его не откроют. Итог можно отправить им из вкладки «Итоги».'}</p>
  <div class="qr-frame" role="img" aria-label="QR-код со ссылкой на чек">{@html svg}</div>
  <div class="qr-link">{link.replace(/^https?:\/\//, '')}</div>
  <div class="qr-actions">
    {#if shared && prefersShareSheet()}<button type="button" class="soft-button" onclick={() => app.invite()}>Отправить</button>{/if}
    <button class="primary-button">Скопировать ссылку</button>
  </div>
</Modal>
