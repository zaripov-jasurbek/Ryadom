<script lang="ts">
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'

  let title = $state('')
  let ownerName = $state(app.savedName)
  let fee = $state<number | null>(10)
  let paymentDetails = $state('')
  // The database stores numeric(5,2) between 0 and 100; an emptied field must not become NaN totals.
  const feeValid = $derived(typeof fee === 'number' && Number.isFinite(fee) && fee >= 0 && fee <= 100)
  const ready = $derived(Boolean(title.trim() && ownerName.trim() && feeValid))

  function submit() {
    if (!ready || app.busy) return
    void app.createBill(title.trim(), ownerName.trim(), Math.round(fee! * 100) / 100, paymentDetails.trim())
  }
</script>

<main class="form-page">
  <button class="back-link" onclick={() => app.goHome()}>← Назад</button>
  <form class="panel form-card" onsubmit={(e) => { e.preventDefault(); submit() }}>
    <div class="eyebrow">Новый чек</div>
    <h1>Начнём с названия</h1>
    <p class="lead">Ресторан, повод или просто «Ужин в пятницу».</p>
    <label class="field">Как назовём чек?<input bind:value={title} placeholder="Например, Ужин у Тимура" maxlength={limits.titleLength} required /></label>
    <label class="field">Ваше имя<input bind:value={ownerName} placeholder="Как к вам обращаться?" maxlength={limits.nameLength} autocomplete="given-name" required /></label>
    <label class="field"><span>Обслуживание <span class="label-hint">{feeValid ? 'если есть в счёте' : 'от 0 до 100%'}</span></span>
      <span class="suffix-input"><input type="number" bind:value={fee} min="0" max="100" step="0.01" inputmode="decimal" aria-invalid={!feeValid} /><span>%</span></span>
    </label>
    <div class="chip-row" role="group" aria-label="Быстрый выбор процента">
      {#each [0, 10, 12, 15] as preset (preset)}<button type="button" class="chip" class:active={fee === preset} onclick={() => fee = preset}>{preset}%</button>{/each}
    </div>
    <label class="field"><span>Карта или телефон для перевода <span class="label-hint">по желанию</span></span><input bind:value={paymentDetails} placeholder="8600 1234 5678 9012" maxlength={limits.paymentDetailsLength} autocomplete="off" /></label>
    <p class="field-note">Гости увидят его в итогах и скопируют в одно касание. Срок действия карты и коды из SMS не нужны никогда.</p>
    <button class="primary-button wide" disabled={app.busy || !ready}>{app.busy ? 'Создаём…' : 'Создать чек'} <span aria-hidden="true">↗</span></button>
    <div class="privacy-note">🔒 Без регистрации. Чек доступен только по ссылке.</div>
  </form>
</main>
