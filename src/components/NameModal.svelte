<script lang="ts">
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  // Opened from your name next to the card button: the name everyone else at the table sees.
  const current = app.selectedPerson ? app.personName(app.selectedPerson) : ''
  let name = $state(app.savedName && current === app.savedName ? current : '')

  async function submit() {
    if (app.busy) return
    const value = name.trim()
    if (!value || value === current) { app.nameOpen = false; return }
    if (await app.rename(value)) app.nameOpen = false
  }
</script>

<Modal labelledby="name-title" onclose={() => app.nameOpen = false} onsubmit={() => void submit()}>
  <div class="eyebrow">Ваше имя</div>
  <h2 id="name-title">Как вас видят остальные?</h2>
  <!-- svelte-ignore a11y_autofocus -->
  <label class="field">Имя<input bind:value={name} placeholder={current} maxlength={limits.nameLength} autocomplete="given-name" enterkeyhint="done" autofocus /></label>
  <p class="field-note">Себя в чеке вы видите как «Я». Имя сохранится и для следующих чеков.</p>
  <button class="primary-button wide" disabled={app.busy}>Сохранить <span aria-hidden="true">✓</span></button>
</Modal>
