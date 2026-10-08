<script lang="ts">
  import { onMount, type Snippet } from 'svelte'

  /** `fill` stretches the card to the screen's height, for content that sizes itself to the room left. */
  let { labelledby, onclose, onsubmit, fill = false, children }: { labelledby: string; onclose: () => void; onsubmit: () => void; fill?: boolean; children: Snippet } = $props()
  let card: HTMLDivElement

  const focusable = () => [...card.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]')]

  onMount(() => {
    // Focus moves into the dialog and returns to the button that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!card.contains(document.activeElement)) focusable().find(element => !element.classList.contains('modal-close'))?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  })

  function trapFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab') return
    const items = focusable()
    if (!items.length) return
    const first = items[0], last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose() }}>
  <div class="modal-card" class:fill role="dialog" aria-modal="true" aria-labelledby={labelledby} tabindex="-1" bind:this={card} onkeydown={trapFocus}>
    <form class="modal-form" onsubmit={(e) => { e.preventDefault(); onsubmit() }}>
      <button type="button" class="modal-close" aria-label="Закрыть" onclick={onclose}>×</button>
      {@render children()}
    </form>
  </div>
</div>
