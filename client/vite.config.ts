import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (['react/', 'react-dom/', 'react-router-dom/'].some(p => id.includes(p))) return 'vendor'
            if (['lucide-react/', 'react-markdown/'].some(p => id.includes(p))) return 'ui'
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/users': 'http://localhost:8787',
      '/sessions': 'http://localhost:8787',
      '/admin': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
      '/weather': 'http://localhost:8787',
      '/agents': { target: 'ws://localhost:8787', ws: true },
    },
  },
})
