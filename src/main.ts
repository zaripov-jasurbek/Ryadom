import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { registerPwa } from './lib/pwa.svelte'

registerPwa()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
