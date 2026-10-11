<script lang="ts" module>
  // Control icons in one thin stroke and the text's colour: emoji look different on every system, these do not.
  const icons = {
    back: ['M19 12H5', 'M11 18l-6-6 6-6'],
    plus: ['M12 5v14', 'M5 12h14'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    edit: ['M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
    trash: ['M4 7h16', 'M9 7V4.5h6V7', 'M6 7l1 12.5h10L18 7', 'M10 11v5', 'M14 11v5'],
    camera: ['M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z', 'M8.5 12.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0'],
    card: ['M5.5 5.5h13A2.5 2.5 0 0 1 21 8v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V8a2.5 2.5 0 0 1 2.5-2.5z', 'M3 10h18', 'M7 15h3'],
    install: ['M9.5 2.5h5A2.5 2.5 0 0 1 17 5v14a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 7 19V5a2.5 2.5 0 0 1 2.5-2.5z', 'M12 7v7', 'M9 11l3 3 3-3'],
    invite: ['M6.6 8a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0', 'M3.5 19.5c.7-3.4 3.2-5.3 6.5-5.3 1.6 0 3 .4 4.1 1.2', 'M18 14v6', 'M15 17h6'],
  }
  // Drawn filled rather than stroked: three dots.
  const more = ['M4.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0', 'M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0', 'M16.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0']
  export type IconName = keyof typeof icons | 'more'
</script>

<script lang="ts">
  let { name }: { name: IconName } = $props()
</script>

{#if name === 'more'}
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{#each more as d (d)}<path {d} />{/each}</svg>
{:else}
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{#each icons[name] as d (d)}<path {d} />{/each}</svg>
{/if}
