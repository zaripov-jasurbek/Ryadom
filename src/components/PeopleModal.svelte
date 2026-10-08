<script lang="ts">
  import type { Participant } from '../lib/calculations'
  import { plural } from '../lib/format'
  import { app } from '../lib/store.svelte'
  import Modal from './Modal.svelte'

  const bill = $derived(app.bill!)
  const online = $derived(new Set([app.selectedPerson, ...app.onlineUsers.map(user => user.participantId)].filter(Boolean)))

  async function removeParticipant(person: Participant) {
    if (await app.confirm({ title: `Убрать ${person.name} из чека?`, body: 'Отметки, оплата и комментарии участника будут удалены.', action: 'Убрать', danger: true })) void app.removeParticipant(person)
  }
  function invite() { app.peopleOpen = false; app.qrOpen = true }
</script>

<Modal labelledby="people-title" onclose={() => app.peopleOpen = false} onsubmit={invite}>
  <div class="eyebrow">За столом</div>
  <h2 id="people-title">{plural(bill.participants.length, 'человек', 'человека', 'человек')}</h2>
  <ul class="people-list">
    {#each bill.participants as person (person.id)}
      {@const here = online.has(person.id)}
      <li>
        <span class="person-avatar tone-{app.tone(person.id)}" class:online={here}>{app.avatar(person)}</span>
        <div class="people-text">
          <b>{app.label(person)}</b>
          <small>{[app.isMe(person.id) ? `для остальных: ${person.name}` : '', person.id === app.ownerId ? 'платит по счёту' : '', here ? 'в сети' : 'не в сети'].filter(Boolean).join(' · ')}</small>
        </div>
        {#if app.isOwner && person.id !== app.ownerId}<button type="button" class="icon-button small danger" aria-label={`Убрать ${person.name} из чека`} title="Убрать из чека" onclick={() => removeParticipant(person)}>×</button>{/if}
      </li>
    {/each}
  </ul>
  <button class="primary-button wide">Пригласить ещё <span aria-hidden="true">＋</span></button>
</Modal>
