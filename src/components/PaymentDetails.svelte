<script lang="ts">
  import { formatPaymentDetails, isNumberLike, paymentCopyValue } from '../lib/format'
  import { app } from '../lib/store.svelte'

  let { details, owner = '' }: { details: string; owner?: string } = $props()
</script>

<div class="pay-details">
  <span class="pay-icon" aria-hidden="true">💳</span>
  <div class="pay-text">
    <small>Куда переводить{owner ? ` · ${owner}` : ''}</small>
    <b class:card-number={isNumberLike(details)}>{formatPaymentDetails(details)}</b>
  </div>
  <button type="button" class="soft-button" onclick={() => app.copy(paymentCopyValue(details), 'Номер скопирован')}>Скопировать</button>
</div>
