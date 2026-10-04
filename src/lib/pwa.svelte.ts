// Home-screen install: Chrome and Edge (Android, Windows) offer it through beforeinstallprompt; the app shows its own button.
import { installHintFor } from './platform'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export const install = $state<{ prompt: InstallPromptEvent | null }>({ prompt: null })

const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
export const installHint = installHintFor(navigator.userAgent, navigator.maxTouchPoints, standalone)

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
