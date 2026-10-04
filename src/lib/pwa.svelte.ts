// Home-screen install: Chrome and Android offer it through beforeinstallprompt; the app shows its own button.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export const install = $state<{ prompt: InstallPromptEvent | null }>({ prompt: null })

export function registerPwa() {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); install.prompt = event as InstallPromptEvent })
  window.addEventListener('appinstalled', () => install.prompt = null)
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(error => console.warn('Service worker not registered', error))
  }
}

export async function promptInstall() {
  const event = install.prompt
  if (!event) return
  install.prompt = null
  await event.prompt()
}
