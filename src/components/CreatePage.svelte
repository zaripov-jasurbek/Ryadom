<script lang="ts">
  import { defaultTitle } from '../lib/format'
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'

  // Only the name is required: the bill is already on the table, so everything else can wait.
  // An empty title becomes «Ужин 4 октября»; the card for transfers is asked for in the summary.
  let title = $state('')
  const fallbackTitle = defaultTitle()
  let ownerName = $state(app.savedName)
  let fee = $state<number | null>(10)
  // The database stores numeric(5,2) between 0 and 100; an emptied field must not become NaN totals.
  const feeValid = $derived(typeof fee === 'number' && Number.isFinite(fee) && fee >= 0 && fee <= 100)
  const ready = $derived(Boolean(ownerName.trim() && feeValid))

  function submit() {
    if (!ready || app.busy) return
    void app.createBill(title.trim() || fallbackTitle, ownerName.trim(), Math.round(fee! * 100) / 100, '')
  }
</script>

<main class="form-page">
  <button class="back-link" onclick={() => app.goHome()}>← Назад</button>
  <form class="panel form-card" onsubmit={(e) => { e.preventDefault(); submit() }}>
    <div class="eyebrow">Новый чек</div>
    <h1>Кто платит по счёту?</h1>
    <p class="lead">Друзья вернут деньги вам. Позиции добавите на следующем шаге: сфотографируйте чек или введите вручную.</p>
    <label class="field">Ваше имя<input bind:value={ownerName} placeholder="Как к вам обращаться?" maxlength={limits.nameLength} autocomplete="given-name" required /></label>
    <label class="field"><span>Название <span class="label-hint">по желанию</span></span><input bind:value={title} placeholder={fallbackTitle} maxlength={limits.titleLength} /></label>
    <label class="field"><span>Обслуживание <span class="label-hint">{feeValid ? 'посмотрите в счёте' : 'от 0 до 100%'}</span></span>
      <span class="suffix-input"><input type="number" bind:value={fee} min="0" max="100" step="0.01" inputmode="decimal" aria-invalid={!feeValid} /><span>%</span></span>
    </label>
    <div class="chip-row" role="group" aria-label="Быстрый выбор процента">
      {#each [0, 10, 12, 15] as preset (preset)}<button type="button" class="chip" class:active={fee === preset} onclick={() => fee = preset}>{preset ? `${preset}%` : 'Нет'}</button>{/each}
    </div>
    <button class="primary-button wide" disabled={app.busy || !ready}>{app.busy ? 'Создаём…' : 'Создать чек'} <span aria-hidden="true">↗</span></button>
    <div class="privacy-note">🔒 Без регистрации. Чек доступен только по ссылке.</div>
  </form>
</main>
