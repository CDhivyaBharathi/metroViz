import { defineConfig } from 'vite'

export default defineConfig({
  // Dev: forward API calls to uvicorn, so no CORS is needed (PLAN.md C5).
  server: { proxy: { '/api': 'http://localhost:8000' } },
  test: { environment: 'jsdom', passWithNoTests: true },
})
