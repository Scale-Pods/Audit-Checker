import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { handleSalesRequest } from './api/lib/sales-service.js'
import { handleSalesQuickCheckRequest } from './api/lib/sales-qc-service.js'
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
          // '/api/sales' is a prefix of '/api/sales-qc', so the longer path has
          // to be tested first or quick-check rows would be served from the
          // main sales table.
          const routes = [
            { path: '/api/sales-qc', handler: handleSalesQuickCheckRequest },
            { path: '/api/sales', handler: handleSalesRequest },
            { path: '/api/audits', handler: handleAuditsRequest },
          ]

          server.middlewares.use(async (req, res, next) => {
            const route = routes.find(r => req.url?.startsWith(r.path))
            if (!route) return next()

            try {
              const { status, json } = await route.handler(req)
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              return res.end(JSON.stringify(json))
            } catch (err) {
              console.error(`dev ${route.path} error:`, err.message)
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              return res.end(JSON.stringify({ error: 'Internal server error' }))
            }
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