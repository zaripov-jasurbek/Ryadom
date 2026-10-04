<script lang="ts">
  import type { Participant } from '../lib/calculations'
  import { createdDate, expiryDate, initial, plural } from '../lib/format'
  import { checkLifetimeDays, expiresAt } from '../lib/limits'
  import { app } from '../lib/store.svelte'
  import { setTheme, theme, themes } from '../lib/theme.svelte'

  const bill = $derived(app.bill!)
  // What each person is doing right now, from presence: "Выбирает Плов".
  const activity = $derived(new Map(app.onlineUsers.filter(user => user.participantId).map(user => [user.participantId!, user.activity])))
  const expires = $derived(expiresAt(bill.createdAt))

  async function removeParticipant(person: Participant) {
    if (await app.confirm({ title: `Убрать ${person.name} из чека?`, body: 'Отметки, оплата и комментарии участника будут удалены.', action: 'Убрать', danger: true })) void app.removeParticipant(person)
  }
</script>

<div class="table-section" role="tabpanel" id="panel-table" aria-labelledby="tab-table">
  <div class="panel share-banner">
    <div class="share-symbol" aria-hidden="true">🔗</div>
    <div class="share-text"><b>Позовите друзей за стол</b><span>По ссылке или QR-коду гости присоединятся по имени, без регистрации.</span></div>
    <div class="share-actions">
      <button class="soft-button" onclick={() => app.invite()}>Отправить ссылку</button>
      <button class="soft-button" onclick={() => app.qrOpen = true}><span aria-hidden="true">▦</span> QR-код</button>
    </div>
  </div>

  <section class="panel people-card" aria-label="Участники">
    <div class="section-row small"><span class="eyebrow">За столом · {bill.participants.length}</span><span class="online-count"><i></i>{app.onlineUsers.length || 1} онлайн</span></div>
    <ul class="people-list">
      {#each bill.participants as person, i (person.id)}
        {@const now = activity.get(person.id)}
        <li>
          <span class="person-avatar tone-{i % 5}">{initial(person.name)}</span>
          <div class="people-text">
            <b>{person.name}{app.selectedPerson === person.id ? ' · вы' : ''}</b>
            <small>{person.id === app.ownerId ? 'Платит по счёту' : ''}{person.id === app.ownerId && now ? ' · ' : ''}{#if now}<span class="online-now"><i></i>{now}</span>{/if}</small>
          </div>
          {#if app.isOwner && person.id !== app.ownerId}<button class="icon-button small danger" aria-label={`Убрать ${person.name} из чека`} title="Убрать из чека" onclick={() => removeParticipant(person)}>×</button>{/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if app.isOwner}
    <button class="panel settings-row" onclick={() => app.checkEditOpen = true}>
      <span class="share-symbol" aria-hidden="true">⚙</span>
      <span class="share-text"><b>Настройки чека</b><span>Название, обслуживание, карта для перевода, удаление</span></span>
      <span class="notice-action" aria-hidden="true">→</span>
    </button>
  {/if}

  <section class="panel about-card">
    <div class="about-row"><span>Создан</span><b>{createdDate.format(new Date(bill.createdAt))}</b></div>
    <div class="about-row" title={`Чеки хранятся ${plural(checkLifetimeDays, 'день', 'дня', 'дней')}`}><span>Удалится</span><b>{expiryDate.format(expires)}</b></div>
    <p class="field-note">Нужен итог надолго — сохраните картинку или PDF во вкладке «Оплата».</p>
    <div class="about-row"><span>Оформление</span>
      <div class="chip-row" role="radiogroup" aria-label="Тема оформления">
        {#each themes as option (option.value)}<button class="chip" role="radio" aria-checked={theme.current === option.value} class:active={theme.current === option.value} title={option.label} aria-label={option.label} onclick={() => setTheme(option.value)}>{option.icon}</button>{/each}
      </div>
    </div>
  </section>
</div>
