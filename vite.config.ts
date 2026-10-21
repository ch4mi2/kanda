import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Off Vite's default 5173 so it doesn't collide with other projects' dev servers.
  server: { port: 5273, strictPort: true },
})
