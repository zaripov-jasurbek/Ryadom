<script lang="ts">
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  // Taken once: a new question replaces this sheet through the {#key} in App.
  const request = app.confirmRequest!
</script>

<!-- Focus lands on "Отмена" first, so Enter on a stray tap never deletes anything. -->
<Modal labelledby="confirm-title" onclose={() => app.answerConfirm(false)} onsubmit={() => app.answerConfirm(true)}>
  <h2 id="confirm-title">{request.title}</h2>
  {#if request.body}<p class="lead">{request.body}</p>{/if}
  <div class="confirm-actions">
    <button type="button" class="soft-button" onclick={() => app.answerConfirm(false)}>Отмена</button>
    <button class={request.danger ? 'danger-button confirm-danger' : 'accent-button'}>{request.action}</button>
  </div>
</Modal>
