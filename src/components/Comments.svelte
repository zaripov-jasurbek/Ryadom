<script lang="ts">
  import type { CommentMessage } from '../lib/calculations'
  import { commentDate, initial } from '../lib/format'
  import { app } from '../lib/store.svelte'

  let text = $state('')
  const comments = $derived(app.bill?.comments ?? [])

  async function send() {
    const body = text.trim()
    if (!body || !app.selectedPerson || app.busy) return
    if (await app.addComment(body)) text = ''
  }
  function remove(comment: CommentMessage) {
    if (window.confirm('Удалить комментарий?')) void app.deleteComment(comment)
  }
</script>

<section class="panel comments-card">
  <div class="section-row"><div><div class="eyebrow">Комментарии</div><h2>Общий разговор</h2></div><span class="muted">{comments.length || ''}</span></div>
  <div class="comment-list">
    {#each comments as comment (comment.id)}
      {@const name = app.personName(comment.participantId)}
      <article class:own={comment.participantId === app.selectedPerson}>
        <span class="person-avatar tone-{app.personIndex(comment.participantId) % 5}">{initial(name)}</span>
        <div class="comment-body">
          <div class="comment-meta"><b>{name}</b><time datetime={comment.createdAt}>{commentDate.format(new Date(comment.createdAt))}</time></div>
          <p>{comment.body}</p>
        </div>
        {#if app.selectedPerson && comment.participantId === app.selectedPerson}<button class="icon-button small danger" aria-label="Удалить комментарий" title="Удалить комментарий" onclick={() => remove(comment)}>×</button>{/if}
      </article>
    {:else}
      <p class="no-comments">Комментариев пока нет — напишите первым.</p>
    {/each}
  </div>
  <form class="comment-form" onsubmit={(e) => { e.preventDefault(); void send() }}>
    <textarea bind:value={text} maxlength="1000" rows="1" aria-label="Комментарий" placeholder={app.selectedPerson ? 'Напишите сообщение… (Enter — отправить)' : 'Выберите себя, чтобы писать'} disabled={!app.selectedPerson} onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send() } }}></textarea>
    <button class="accent-button" disabled={!text.trim() || !app.selectedPerson} aria-label="Отправить">↑</button>
  </form>
</section>
