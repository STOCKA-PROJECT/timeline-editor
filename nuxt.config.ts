// Stocka Timeline Editor — separate Nuxt app that authenticates against the same
// Spring Boot backend via its own BFF (server/) and a one-time handoff ticket.
const API_BASE_URL = process.env.NUXT_API_BASE_URL ?? 'http://localhost:9095'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  future: { compatibilityVersion: 4 },
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt'],
  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    apiBaseUrl: API_BASE_URL,
    public: {
      // URL of the main Stocka frontend, used for "back to Stocka" links.
      stockaUrl: process.env.NUXT_PUBLIC_STOCKA_URL ?? 'http://localhost:3000'
    }
  },

  // URLs de producción: van dentro del wrangler.json que Nitro genera en el build de
  // Cloudflare Workers, así cada deploy las re-aplica. No configurarlas a mano en el
  // dashboard: `wrangler deploy` ELIMINA las variables de texto añadidas por dashboard.
  // Solo afecta al deploy en Workers; `nuxt dev` y builds locales las ignoran.
  nitro: {
    cloudflare: {
      wrangler: {
        vars: {
          NUXT_API_BASE_URL: 'https://stocka.xeye.es',
          NUXT_PUBLIC_STOCKA_URL: 'https://stocka.joanmartorellcoll03.workers.dev'
        }
      }
    }
  },

  app: {
    head: {
      title: 'Stocka · Timeline Editor',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'robots', content: 'noindex, nofollow' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        // Brandbook fonts: Archivo (titles), IBM Plex Sans (UI), IBM Plex Mono (codes and data).
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap'
        }
      ]
    }
  },

  typescript: {
    strict: true,
    typeCheck: false
  }
})
