<script lang="ts">
  import { installHint } from '../lib/pwa.svelte'
  import Modal from './Modal.svelte'

  let { onclose }: { onclose: () => void } = $props()
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose() }} />

<Modal labelledby="install-title" {onclose} onsubmit={onclose}>
  <div class="eyebrow">Приложение</div>
  <h2 id="install-title">{installHint === 'mac' ? 'Добавьте «Рядом» в Dock' : 'Добавьте «Рядом» на экран «Домой»'}</h2>
  <p class="lead">Чеки будут открываться одним касанием.</p>
  <ol class="install-steps">
    {#if installHint === 'mac'}
      <li>В строке меню Safari откройте <b>Файл</b>.</li>
      <li>Выберите <b>Добавить в Dock</b> и нажмите <b>Добавить</b>.</li>
    {:else}
      <li>Нажмите <b>Поделиться</b> <span class="share-glyph" aria-hidden="true">⬆︎</span> — внизу экрана или рядом с адресом.</li>
      <li>Пролистайте и выберите <b>На экран «Домой»</b>.</li>
      <li>Нажмите <b>Добавить</b>.</li>
    {/if}
  </ol>
  <button class="primary-button wide">Понятно</button>
</Modal>
