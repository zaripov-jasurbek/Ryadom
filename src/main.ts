import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { registerPwa } from './lib/pwa.svelte'
import { reloadOnStaleBuild } from './lib/update'

registerPwa()
reloadOnStaleBuild()
// iOS Safari only shows :active (the pressed look of every button) once the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true })

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
