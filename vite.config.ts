import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const [owner, repo] = process.env.GITHUB_REPOSITORY?.split('/') ?? []
const isUserSite = Boolean(owner && repo === owner + '.github.io')
const base = process.env.NODE_ENV === 'production' && repo && !isUserSite ? '/' + repo + '/' : '/'
export default defineConfig({
  plugins: [svelte()],
  base,
})
