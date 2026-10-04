<script lang="ts">
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'

  let name = $state(app.savedName)
  let error = $state('')
  const owner = $derived(Boolean(app.token))

  async function submit() {
    if (!name.trim() || app.busy) return
    error = await app.joinSharedCheck(name.trim())
  }
</script>

<main class="form-page">
  <button class="back-link" onclick={() => app.goHome()}>← На главную</button>
  <form class="panel form-card" onsubmit={(e) => { e.preventDefault(); void submit() }}>
    <div class="eyebrow">Приглашение в чек</div>
    <h1>{owner ? 'Войти как создатель' : 'Кто за этим столом?'}</h1>
    <p class="lead">{owner ? 'Подтвердим секретную ссылку владельца. Введите своё имя, чтобы восстановить участника.' : 'Введите имя, под которым вас увидят друзья.'}</p>
    <label class="field">{owner ? 'Ваше имя в чеке' : 'Ваше имя'}<input bind:value={name} placeholder="Например, Aziz" maxlength={limits.nameLength} autocomplete="given-name" required /></label>
    {#if error}<div class="form-error" role="alert">{error}</div>{/if}
    <button class="primary-button wide" disabled={app.busy || !name.trim()}>{app.busy ? 'Подключаемся…' : owner ? 'Открыть чек' : 'Присоединиться'} <span aria-hidden="true">↗</span></button>
    <div class="privacy-note">🔒 Вход без пароля и регистрации.</div>
  </form>
</main>
