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
    expect(shortHash('sha256:48a434c027e3fe7420d094bb5cbf119924f1e0c93b385cddd9766d808a00c92d')).toBe('48a434c0')
  })
})

describe('bundleFileName', () => {
  it('names the shared sample exactly like the Python tool', () => {
    expect(bundleFileName(pkg)).toBe('pessebre-2026-mostra-48a434c0.belen.zip')
  })

  it('falls back to "show" when the name has nothing usable', () => {
    expect(bundleFileName({ meta: { ...pkg.meta, name: '¡¡¡' } })).toBe(`show-48a434c0${BUNDLE_EXTENSION}`)
  })

  it('the same show under another name keeps the hash part', () => {
    const renamed = bundleFileName({ meta: { ...pkg.meta, name: 'Altre nom' } })
    expect(renamed).toBe('altre-nom-48a434c0.belen.zip')
    expect(renamed.endsWith(BUNDLE_EXTENSION)).toBe(true)
  })
})
