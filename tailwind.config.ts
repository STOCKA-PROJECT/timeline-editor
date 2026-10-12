import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'

export default {
  content: [
    './app/components/**/*.{vue,ts}',
    './app/layouts/**/*.vue',
    './app/pages/**/*.vue',
    './app/composables/**/*.ts',
    './app/app.vue',
    './app/error.vue'
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'var(--c-bg)',
          card: 'var(--c-bg-card)',
          alt: 'var(--c-bg-alt)',
          soft: 'var(--c-bg-soft)'
        },
        field: 'var(--c-field)',
        selected: 'var(--c-selected)',
        ink: {
          DEFAULT: 'var(--c-ink)',
          soft: 'var(--c-ink-soft)',
          muted: 'var(--c-ink-muted)'
        },
        line: {
          DEFAULT: 'var(--c-line)',
          strong: 'var(--c-line-strong)',
          control: 'var(--c-line-control)'
        },
        accent: {
          DEFAULT: 'var(--c-accent)',
          ink: 'var(--c-accent-ink)',
          soft: 'var(--c-accent-soft)',
          on: 'var(--c-on-accent)'
        },
        highlight: {
          DEFAULT: 'var(--c-highlight)',
          ink: 'var(--c-highlight-ink)',
          on: 'var(--c-on-highlight)'
        },
        ok: {
          DEFAULT: 'var(--c-ok)',
          soft: 'var(--c-ok-soft)'
        },
        danger: {
          DEFAULT: 'var(--c-danger)',
          soft: 'var(--c-danger-soft)'
        },
        warn: {
          DEFAULT: 'var(--c-warn)',
          soft: 'var(--c-warn-soft)'
        }
      },
      fontFamily: {
        display: ['Archivo', 'Helvetica Neue', 'Arial', ...defaultTheme.fontFamily.sans],
        sans: ['IBM Plex Sans', 'system-ui', ...defaultTheme.fontFamily.sans],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        card: 'var(--shadow-raised)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)'
      }
    }
  },
  plugins: []
} satisfies Config
