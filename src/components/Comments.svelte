<script lang="ts">
  import type { CommentMessage } from '../lib/calculations'
  import { commentTime, initial } from '../lib/format'
  import { limits } from '../lib/limits'
  import { app } from '../lib/store.svelte'

  let text = $state('')
  const comments = $derived(app.bill?.comments ?? [])
  const full = $derived(comments.length >= limits.comments)
  const canWrite = $derived(Boolean(app.selectedPerson) && !full)
  // Folded into one line with the latest message, so the conversation does not lengthen the page.
  let open = $state(false)
  const last = $derived(comments.at(-1))

  async function send() {
    const body = text.trim()
    if (!body || !canWrite || app.busy) return
    if (await app.addComment(body)) text = ''
  }
  async function remove(comment: CommentMessage) {
    if (await app.confirm({ title: 'Удалить комментарий?', action: 'Удалить', danger: true })) void app.deleteComment(comment)
  }
</script>

<section class="panel comments-card" class:open>
  <button class="comments-toggle" aria-expanded={open} aria-controls="comments-body" onclick={() => open = !open}>
    <span class="comments-icon" aria-hidden="true">💬</span>
    <span class="comments-summary">
      <b>Обсуждение{comments.length ? ` · ${comments.length}` : ''}</b>
      {#if !open}<small>{last ? `${app.personName(last.participantId)}: ${last.body}` : 'Вопрос по счёту? Напишите здесь'}</small>{/if}
    </span>
    <span class="comments-chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
  </button>
  {#if open}
    <div class="comments-body" id="comments-body">
      <div class="comment-list">
        {#each comments as comment (comment.id)}
          {@const name = app.personName(comment.participantId)}
          <article class:own={comment.participantId === app.selectedPerson}>
            <span class="person-avatar tone-{app.personIndex(comment.participantId) % 5}">{initial(name)}</span>
            <div class="comment-body">
              <div class="comment-meta"><b>{name}</b><time datetime={comment.createdAt}>{commentTime(comment.createdAt)}</time></div>
              <p>{comment.body}</p>
            </div>
            {#if app.selectedPerson && comment.participantId === app.selectedPerson}<button class="icon-button small danger" aria-label="Удалить комментарий" title="Удалить комментарий" onclick={() => remove(comment)}>×</button>{/if}
          </article>
        {:else}
          <p class="no-comments">Комментариев пока нет — напишите первым.</p>
        {/each}
      </div>
      <form class="comment-form" onsubmit={(e) => { e.preventDefault(); void send() }}>
        <textarea bind:value={text} maxlength="1000" rows="1" aria-label="Комментарий" placeholder={full ? `В чеке уже ${limits.comments} комментариев` : app.selectedPerson ? 'Написать сообщение…' : 'Писать могут только участники чека'} disabled={!canWrite} onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send() } }}></textarea>
        <button class="accent-button" disabled={!text.trim() || !canWrite} aria-label="Отправить">↑</button>
      </form>
    </div>
  {/if}
</section>
