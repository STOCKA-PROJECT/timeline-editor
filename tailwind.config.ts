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
        ink: {
          DEFAULT: 'var(--c-ink)',
          soft: 'var(--c-ink-soft)',
          muted: 'var(--c-ink-muted)'
        },
        line: {
          DEFAULT: 'var(--c-line)',
          strong: 'var(--c-line-strong)'
        },
        accent: {
          DEFAULT: 'var(--c-accent)',
          ink: 'var(--c-accent-ink)',
          soft: 'var(--c-accent-soft)'
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
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        card: '0 4px 20px rgba(60, 50, 30, .06), 0 1px 2px rgba(60, 50, 30, .04)'
      }
    }
  },
  plugins: []
} satisfies Config
