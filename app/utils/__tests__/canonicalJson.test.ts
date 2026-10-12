import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from '~/utils/canonicalJson'

describe('canonicalJson', () => {
  it('sorts keys recursively and strips whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}')
  })

  it('writes integral numbers without decimals and keeps booleans, like show_hash.py', () => {
    expect(canonicalJson({ a: 10.0, b: 0.5, c: [1.0, 2.25], invert: true })).toBe('{"a":10,"b":0.5,"c":[1,2.25],"invert":true}')
  })

  it('keeps non-ASCII text literal and drops undefined values', () => {
    expect(canonicalJson({ name: 'Pessebre · Àngel', skip: undefined })).toBe('{"name":"Pessebre · Àngel"}')
  })

  it('sha256Hex matches a known digest', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
