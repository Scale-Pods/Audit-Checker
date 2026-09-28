import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { handleSalesRequest } from './api/lib/sales-service.js'
import { handleAuditsRequest } from './api/lib/audits-service.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  process.env.SUPABASE_URL = env.SUPABASE_URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
  process.env.FIREBASE_PROJECT_ID = env.FIREBASE_PROJECT_ID

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'dev-api-router',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith('/api/sales')) {
              try {
                const { status, json } = await handleSalesRequest(req)
                res.statusCode = status
                res.setHeader('Content-Type', 'application/json')
                return res.end(JSON.stringify(json))
              } catch (err) {
                console.error('dev /api/sales error:', err.message)
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                return res.end(JSON.stringify({ error: 'Internal server error' }))
              }
            }
            if (req.url?.startsWith('/api/audits')) {
              try {
                const { status, json } = await handleAuditsRequest(req)
                res.statusCode = status
                res.setHeader('Content-Type', 'application/json')
                return res.end(JSON.stringify(json))
              } catch (err) {
                console.error('dev /api/audits error:', err.message)
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                return res.end(JSON.stringify({ error: 'Internal server error' }))
              }
            }
            next()
          })
        },
      },
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})