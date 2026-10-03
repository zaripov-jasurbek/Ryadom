<script lang="ts">
  import { formatUzs } from '../lib/calculations'
  import { plural } from '../lib/format'
  import { app, grandTotal } from '../lib/store.svelte'
</script>

<main class="home-page">
  <section class="hero">
    <div class="hero-copy">
      <div class="eyebrow"><span class="accent-star">✳</span> Друзья. Ужин. Без сложных подсчётов.</div>
      <h1>Счёт на всех.<br /><span>Дружба цела.</span></h1>
      <p>Создайте чек, поделитесь ссылкой — и пусть каждый отметит своё. Остальное мы посчитаем.</p>
      <button class="primary-button" onclick={() => app.beginCreate()}>Создать новый чек <span aria-hidden="true">↗</span></button>
      <div class="hero-note"><span class="note-avatars" aria-hidden="true"><b>J</b><b>A</b><b>B</b></span>Понятно каждому за пару секунд</div>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="receipt-card">
        <div class="receipt-top"><span>РАЗДЕЛЯЕМ ВМЕСТЕ</span><span>✳</span></div>
        <div class="receipt-title">Вечер<br />с друзьями</div>
        <div class="receipt-row"><span>Пицца маргарита</span><b>84 000</b></div>
        <div class="receipt-row"><span>Лимонад × 3</span><b>45 000</b></div>
        <div class="receipt-row"><span>Хлеб на всех</span><b>20 000</b></div>
        <div class="receipt-line"></div>
        <div class="receipt-total"><span>Итого</span><b>149 000 <small>сум</small></b></div>
        <div class="receipt-footer"><span class="mini-dots"><i></i><i></i><i></i></span> уже делят 4 человека</div>
      </div>
      <div class="floating-tag tag-split">🥖 хлеб на всех <b>÷ 4</b></div>
      <div class="floating-tag tag-done">✓ Всё сходится!</div>
    </div>
  </section>

  {#if app.bills.length}
    <section class="recent">
      <div class="section-row"><h2>Ваши чеки</h2><span class="muted">{plural(app.bills.length, 'чек', 'чека', 'чеков')}</span></div>
      <div class="saved-list">
        {#each app.bills as saved (saved.id)}
          <button class="saved-card" onclick={() => app.openCheck(saved.id)}>
            <span class="saved-icon" aria-hidden="true">🧾</span>
            <span class="saved-text"><b>{saved.title}</b><small>{plural(saved.participants.length, 'участник', 'участника', 'участников')} · {plural(saved.items.length, 'позиция', 'позиции', 'позиций')}</small></span>
            <span class="saved-total">{formatUzs(grandTotal(saved))}</span>
            <span class="saved-arrow" aria-hidden="true">→</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section class="how-section">
    <div class="section-heading"><div class="eyebrow">Всё просто</div><h2>Четыре шага — и можно заказывать десерт</h2></div>
    <div class="steps-grid">
      <article><span class="step-no">01</span><div class="step-icon">🧾</div><h3>Создайте чек</h3><p>Добавьте позиции и стоимость — это займёт минуту.</p></article>
      <article><span class="step-no">02</span><div class="step-icon">🔗</div><h3>Поделитесь ссылкой</h3><p>Отправьте друзьям. Регистрация никому не нужна.</p></article>
      <article><span class="step-no">03</span><div class="step-icon">✅</div><h3>Каждый отмечает своё</h3><p>Гости выбирают блюда, которые заказали или делили.</p></article>
      <article><span class="step-no">04</span><div class="step-icon">💸</div><h3>Оплатите спокойно</h3><p>Видно, кто сколько должен и что уже оплачено.</p></article>
    </div>
  </section>

  <section class="bottom-cta">
    <div><div class="eyebrow">Хороший вечер начинается здесь</div><h2>Первый чек — за вами</h2></div>
    <button class="primary-button" onclick={() => app.beginCreate()}>Создать чек <span aria-hidden="true">↗</span></button>
  </section>
</main>
