import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { IndexedDbKvStore, MemoryKvStore, OFFLINE_STORES, type KvStore } from '~/utils/offline/kvStore'

const implementations: Array<[string, () => Promise<KvStore>]> = [
  ['MemoryKvStore', async () => new MemoryKvStore()],
  ['IndexedDbKvStore', async () => IndexedDbKvStore.open(new IDBFactory(), 'test-db')]
]

describe.each(implementations)('%s', (_name, make) => {
  it('returns undefined for a missing key', async () => {
    const kv = await make()
    expect(await kv.get('responses', 'nope')).toBeUndefined()
  })

  it('stores, overwrites and deletes values per store', async () => {
    const kv = await make()
    await kv.put('responses', 'a', { n: 1 })
    await kv.put('scenes', 'a', { n: 2 })
    expect(await kv.get('responses', 'a')).toEqual({ n: 1 })
    expect(await kv.get('scenes', 'a')).toEqual({ n: 2 })
    await kv.put('responses', 'a', { n: 3 })
    expect(await kv.get('responses', 'a')).toEqual({ n: 3 })
    await kv.delete('responses', 'a')
    expect(await kv.get('responses', 'a')).toBeUndefined()
    expect(await kv.get('scenes', 'a')).toEqual({ n: 2 })
  })

  it('keeps binary data intact', async () => {
    const kv = await make()
    const bytes = new Uint8Array([0, 1, 254, 255]).buffer
    await kv.put('blobs', 'audio', bytes)
    const back = await kv.get<ArrayBuffer>('blobs', 'audio')
    expect(Array.from(new Uint8Array(back!))).toEqual([0, 1, 254, 255])
  })

  it('lists every value of a store', async () => {
    const kv = await make()
    await kv.put('scenes', 'x', { id: 'x' })
    await kv.put('scenes', 'y', { id: 'y' })
    await kv.put('responses', 'z', { id: 'z' })
    const ids = (await kv.values<{ id: string }>('scenes')).map(v => v.id).sort()
    expect(ids).toEqual(['x', 'y'])
  })

  it('returns copies: mutating a read value does not change the store', async () => {
    const kv = await make()
    await kv.put('responses', 'k', { list: [1] })
    const first = await kv.get<{ list: number[] }>('responses', 'k')
    first!.list.push(2)
    expect(await kv.get('responses', 'k')).toEqual({ list: [1] })
  })

  it('deleting a missing key is harmless', async () => {
    const kv = await make()
    await expect(kv.delete('blobs', 'ghost')).resolves.toBeUndefined()
  })
})

describe('IndexedDbKvStore persistence', () => {
  it('creates every store and keeps data across reopenings', async () => {
    const factory = new IDBFactory()
    const first = await IndexedDbKvStore.open(factory, 'persist')
    await first.put('scenes', 'org/1', { saved: true })
    first.close()
    const second = await IndexedDbKvStore.open(factory, 'persist')
    expect(await second.get('scenes', 'org/1')).toEqual({ saved: true })
    for (const store of OFFLINE_STORES) {
      await expect(second.values(store)).resolves.toBeInstanceOf(Array)
    }
    second.close()
  })
})
