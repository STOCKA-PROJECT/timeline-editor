import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Stocka Timeline Editor — separate Nuxt app that authenticates against the same
// Spring Boot backend via its own BFF (server/) and a one-time handoff ticket. It is an installable
// web app: rendered in the browser only (SPA), with a service worker (public/sw.js) that keeps it
// available offline; the data it needs offline lives in IndexedDB (utils/offline).
const API_BASE_URL = process.env.NUXT_API_BASE_URL ?? 'http://localhost:9095'

/** Every file of the public output, as URLs, for the service worker to precache. */
function publicFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push('/' + relative(dir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.filter(f => !f.endsWith('.map') && f !== '/sw.js' && f !== '/sw-manifest.json').sort()
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  // Browser-only rendering: every route is the same shell, which the service worker can serve
  // offline. The BFF under server/ still runs on the server.
  ssr: false,
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
        { name: 'robots', content: 'noindex, nofollow' },
        { name: 'theme-color', content: '#0b5a66' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
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

  hooks: {
    // List the built files for the service worker (public/sw.js precaches them on install).
    'nitro:build:public-assets'(nitro) {
      const dir = nitro.options.output.publicDir
      const manifest = { version: `${Date.now().toString(36)}`, files: publicFiles(dir) }
      writeFileSync(join(dir, 'sw-manifest.json'), JSON.stringify(manifest))
    }
  },

  typescript: {
    strict: true,
    typeCheck: false
  }
})
