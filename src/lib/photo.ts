/**
 * Opens the system picker for one photo: on a phone it offers the camera and the gallery in one menu.
 * Must be called from a tap. Resolves null when the picker is dismissed, in browsers that report it.
 */
export function pickPhoto(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    // Safari opens the picker only for an input in the page.
    input.className = 'visually-hidden'
    input.tabIndex = -1
    const done = (file: File | null) => { input.remove(); resolve(file) }
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => done(null), { once: true })
    document.body.append(input)
    input.click()
  })
}
