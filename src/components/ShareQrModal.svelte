<script lang="ts">
  import { renderSVG } from 'uqr'
  import { prefersShareSheet } from '../lib/share'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  const link = app.publicLink()
  // Black on white in both themes: phone cameras read dark modules on a light background most reliably.
  const svg = renderSVG(link, { ecc: 'M', border: 2, blackColor: '#1d241f', whiteColor: '#ffffff' })

  function copy() {
    void app.copy(link, 'Ссылка скопирована')
  }
</script>

<Modal labelledby="share-qr-title" onclose={() => app.qrOpen = false} onsubmit={copy}>
  <h2 id="share-qr-title">Пригласить за стол</h2>
  <p class="lead">Покажите код или отправьте ссылку.</p>
  <div class="qr-frame" role="img" aria-label="QR-код со ссылкой на чек">{@html svg}</div>
  <div class="qr-actions">
    {#if prefersShareSheet()}<button type="button" class="soft-button" onclick={() => app.invite()}>Отправить</button>{/if}
    <button class="primary-button">Скопировать ссылку</button>
  </div>
</Modal>
