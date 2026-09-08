import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // maplibre-gl ships a separate worker bundle (maplibre-gl-worker.mjs)
    // that Vite's dependency pre-bundler mishandles, leaving the terrain
    // worker request permanently pending and the map blank. Excluding the
    // package from optimization is the standard workaround.
    exclude: ['maplibre-gl'],
  },
})
