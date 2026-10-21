// Local persistence of the installed editor: what it needs to keep working without a connection.
// Three stores, all keyed by string:
//   - `responses`: last JSON answer of each GET the editor makes (catalog, ports, actions, timeline…)
//   - `blobs`:     raw bytes of attachments (audio files) so the bundle can be built offline
//   - `scenes`:    one record per timeline with the local document and its sync state
// The IndexedDB implementation runs in the browser; tests use the in-memory one.

export const OFFLINE_DB_NAME = 'stocka-timeline-editor'
export const OFFLINE_DB_VERSION = 1
export const OFFLINE_STORES = ['responses', 'blobs', 'scenes'] as const
export type OfflineStoreName = (typeof OFFLINE_STORES)[number]

/** Minimal async key-value API over named stores. Values are structured-cloneable. */
export interface KvStore {
  get<T>(store: OfflineStoreName, key: string): Promise<T | undefined>
  put<T>(store: OfflineStoreName, key: string, value: T): Promise<void>
  delete(store: OfflineStoreName, key: string): Promise<void>
  /** Every value of a store (small stores only: `scenes`). */
  values<T>(store: OfflineStoreName): Promise<T[]>
}

/** In-memory store with the same semantics (values are deep-copied like IndexedDB does). */
export class MemoryKvStore implements KvStore {
  private readonly data = new Map<OfflineStoreName, Map<string, unknown>>()

  private bucket(store: OfflineStoreName): Map<string, unknown> {
    let b = this.data.get(store)
    if (!b) {
      b = new Map()
      this.data.set(store, b)
    }
    return b
  }

  async get<T>(store: OfflineStoreName, key: string): Promise<T | undefined> {
    const value = this.bucket(store).get(key)
    return value === undefined ? undefined : structuredClone(value) as T
  }

  async put<T>(store: OfflineStoreName, key: string, value: T): Promise<void> {
    this.bucket(store).set(key, structuredClone(value))
  }

  async delete(store: OfflineStoreName, key: string): Promise<void> {
    this.bucket(store).delete(key)
  }

  async values<T>(store: OfflineStoreName): Promise<T[]> {
    return [...this.bucket(store).values()].map(v => structuredClone(v) as T)
  }
}

/** Promise of an IDBRequest's result. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** {@link KvStore} over IndexedDB (one object store per {@link OfflineStoreName}). */
export class IndexedDbKvStore implements KvStore {
  private constructor(private readonly db: IDBDatabase) {}

  /** Opens (and creates or upgrades) the editor's database. */
  static async open(factory: IDBFactory = indexedDB, name: string = OFFLINE_DB_NAME): Promise<IndexedDbKvStore> {
    const req = factory.open(name, OFFLINE_DB_VERSION)
    req.onupgradeneeded = () => {
      for (const store of OFFLINE_STORES) {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store)
      }
    }
    return new IndexedDbKvStore(await request(req))
  }

  private async run<T>(store: OfflineStoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const tx = this.db.transaction(store, mode)
    const result = request(op(tx.objectStore(store)))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return result
  }

  async get<T>(store: OfflineStoreName, key: string): Promise<T | undefined> {
    return await this.run(store, 'readonly', s => s.get(key)) as T | undefined
  }

  async put<T>(store: OfflineStoreName, key: string, value: T): Promise<void> {
    await this.run(store, 'readwrite', s => s.put(value, key))
  }

  async delete(store: OfflineStoreName, key: string): Promise<void> {
    await this.run(store, 'readwrite', s => s.delete(key))
  }

  async values<T>(store: OfflineStoreName): Promise<T[]> {
    return await this.run(store, 'readonly', s => s.getAll()) as T[]
  }

  close(): void {
    this.db.close()
  }
}
