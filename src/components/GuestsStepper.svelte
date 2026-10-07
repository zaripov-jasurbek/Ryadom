<script lang="ts">
  import { limits } from '../lib/limits'
  import { plural } from '../lib/format'
  import { haptic } from '../lib/haptics'

  // How many people are coming, the creator included. "Split among everyone" cuts shared items into this many parts,
  // so guests who come later pay the same as those already here.
  let { value = $bindable(), min = 1 }: { value: number; min?: number } = $props()
  function step(by: number) { haptic.selection(); value = Math.min(limits.participants, Math.max(min, value + by)) }
</script>

<div class="field guests-field">
  <span>Сколько вас? <span class="label-hint">вместе с вами</span></span>
  <div class="portion-stepper" role="group" aria-label="Сколько человек за столом">
    <button type="button" aria-label="Меньше" disabled={value <= min} onclick={() => step(-1)}>−</button>
    <span aria-live="polite"><b>{value}</b> {plural(value, 'человек', 'человека', 'человек').replace(/^\d+\s/, '')}</span>
    <button type="button" aria-label="Больше" disabled={value >= limits.participants} onclick={() => step(1)}>+</button>
  </div>
</div>
