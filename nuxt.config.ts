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

  app: {
    head: {
      title: 'Stocka · Timeline Editor',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'robots', content: 'noindex, nofollow' }
      ],
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }]
    }
  },

  typescript: {
    strict: true,
    typeCheck: false
  }
})
