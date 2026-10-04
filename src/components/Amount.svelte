<script lang="ts">
  import { untrack } from 'svelte'
  import { Tween } from 'svelte/motion'
  import { cubicOut } from 'svelte/easing'
  import { formatUzs } from '../lib/calculations'

  let { value }: { value: number } = $props()
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  // A total rolls to its new value, so a change someone else made at the table gets noticed.
  const shown = new Tween(untrack(() => value), { duration: 450, easing: cubicOut })
  $effect.pre(() => {
    const target = value
    if (target === untrack(() => shown.target)) return
    // A hidden tab gets no animation frames, so there the amount changes at once instead of when the tab is seen.
    void shown.set(target, still || document.hidden ? { duration: 0 } : undefined)
  })
</script>

{formatUzs(Math.round(shown.current))}
