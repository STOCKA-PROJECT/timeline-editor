import { IndexedDbKvStore, MemoryKvStore, type KvStore } from '~/utils/offline/kvStore'

let opening: Promise<KvStore> | null = null

/**
 * The editor's local database (IndexedDB), opened once per page. If the browser refuses it
 * (private mode, quota), an in-memory store keeps the editor working; nothing survives a reload then.
 */
export function useOfflineDb(): Promise<KvStore> {
  if (!opening) {
    opening = (async () => {
      if (typeof indexedDB === 'undefined') return new MemoryKvStore()
      try {
        return await IndexedDbKvStore.open()
      } catch (error) {
        console.warn('IndexedDB no disponible: el treball sense connexió no es conservarà', error)
        return new MemoryKvStore()
      }
    })()
  }
  return opening
}
