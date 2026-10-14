<script lang="ts">
  import { cleanName, nameProblem } from '../lib/format'
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  // Opened from your name at the bottom of the check: the name everyone else at the table sees.
  const current = app.selectedPerson ? app.personName(app.selectedPerson) : ''
  // Three random capitals («XMA») are not a name anyone chose, so the field starts empty with them as a hint.
  let name = $state(/^[A-Z]{3}$/.test(current) ? '' : current)
  // Everyone else's names: yours may not repeat one of them, whatever the case.
  const taken = (app.bill?.participants ?? []).filter(person => person.id !== app.selectedPerson).map(person => person.name)
  let tried = $state(false)
  const problem = $derived(tried ? nameProblem(name, taken) : '')

  async function submit() {
    if (app.isPending('name')) return
    tried = true
    if (cleanName(name) === current) { app.nameOpen = false; return }
    if (nameProblem(name, taken)) return
    if (await app.rename(name)) app.nameOpen = false
  }
</script>

<Modal labelledby="name-title" onclose={() => app.nameOpen = false} onsubmit={() => void submit()}>
  <div class="eyebrow">Ваше имя</div>
  <h2 id="name-title">Как вас видят остальные?</h2>
  <!-- svelte-ignore a11y_autofocus -->
  <label class="field">Имя<input bind:value={name} placeholder={current} maxlength={limits.nameMax} autocomplete="given-name" enterkeyhint="done" aria-invalid={Boolean(problem)} aria-describedby="name-note" autofocus /></label>
  {#if problem}<p class="form-error" id="name-note" role="alert">{problem}</p>
  {:else}<p class="field-note" id="name-note">От {limits.nameMin} до {limits.nameMax} символов. Себя в чеке вы видите как «Я». Имя сохранится и для следующих чеков.</p>{/if}
  <button class="primary-button wide" disabled={app.isPending('name')}>Сохранить <span aria-hidden="true">✓</span></button>
</Modal>
