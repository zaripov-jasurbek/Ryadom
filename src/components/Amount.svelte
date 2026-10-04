<script lang="ts">
  import { Tween } from 'svelte/motion'
  import { cubicOut } from 'svelte/easing'
  import { formatUzs } from '../lib/calculations'

  let { value }: { value: number } = $props()
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  // A total rolls to its new value, so a change someone else made at the table gets noticed.
  const shown = Tween.of(() => value, { duration: still ? 0 : 450, easing: cubicOut })
</script>

{formatUzs(Math.round(shown.current))}
