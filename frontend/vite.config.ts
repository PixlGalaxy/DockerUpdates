import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // Keep the browser's Host header (localhost:5173) so it matches the Origin:
        // the backend rejects requests whose Origin is not its own host (CSRF protection).
        changeOrigin: false,
        // Container console (WebSocket)
        ws: true,
      },
    },
  },
})
