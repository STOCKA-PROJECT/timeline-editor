import { describe, expect, it } from 'vitest'
import type { ShowPackage } from '~/types/show'
import { BUNDLE_EXTENSION, bundleFileName, shortHash, slugify } from '~/utils/bundle/fileName'
import sample from '../fixtures/belen-2026.show.json'

const pkg = sample as ShowPackage

describe('slugify', () => {
  it.each([
    ['Pessebre 2026 (mostra)', 'pessebre-2026-mostra'],
    // The same case rpi4-system/tests/test_bundle.py checks: accents are not letters for the slug.
    ['  ¡Belén! 2026 ', 'bel-n-2026'],
    ['Belén   de   Nadal', 'bel-n-de-nadal'],
    ['SHOW Final v2', 'show-final-v2'],
    ['--ja--net--', 'ja-net'],
    ['show_2026.json', 'show-2026-json'],
    ['2026', '2026']
  ])('slugify(%j) → %j', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it.each([[''], ['   '], ['àéíòú'], ['!!!'], ['---']])('falls back to "show" for %j', (input) => {
    expect(slugify(input)).toBe('show')
  })

  it('never starts or ends with a dash and never doubles one', () => {
    for (const name of ['  a  b  ', '(a)(b)', 'a--b', '-a-']) {
      const slug = slugify(name)
      expect(slug).not.toMatch(/^-|-$|--/)
    }
  })
})

describe('shortHash', () => {
  it('takes the 8 hex digits after the sha256: prefix', () => {
    expect(shortHash('sha256:88db057d40d0926dab27200759f898fddc5161abc9104f84b192984fa9cb4ce5')).toBe('88db057d')
  })
})

describe('bundleFileName', () => {
  it('names the shared sample exactly like the Python tool', () => {
    expect(bundleFileName(pkg)).toBe('pessebre-2026-mostra-88db057d.belen.zip')
  })

  it('falls back to "show" when the name has nothing usable', () => {
    expect(bundleFileName({ meta: { ...pkg.meta, name: '¡¡¡' } })).toBe(`show-88db057d${BUNDLE_EXTENSION}`)
  })

  it('the same show under another name keeps the hash part', () => {
    const renamed = bundleFileName({ meta: { ...pkg.meta, name: 'Altre nom' } })
    expect(renamed).toBe('altre-nom-88db057d.belen.zip')
    expect(renamed.endsWith(BUNDLE_EXTENSION)).toBe(true)
  })
})
