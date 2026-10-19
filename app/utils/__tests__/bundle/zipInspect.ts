// Reads a zip's central directory: fflate's `unzipSync` gives the bytes back but not how each
// entry was stored, and the contract requires assets STORED and JSON deflated.

export interface ZipEntryInfo {
  name: string
  /** 0 = stored, 8 = deflate. */
  method: number
  compressedSize: number
  size: number
  /** Offset of the local header: the first entry written sits at 0. */
  offset: number
}

const CENTRAL_DIRECTORY = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50

export function zipEntries(zip: Uint8Array): ZipEntryInfo[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let eocd = zip.length - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== END_OF_CENTRAL_DIRECTORY) eocd--
  if (eocd < 0) throw new Error('not a zip: no end of central directory')
  const count = view.getUint16(eocd + 10, true)
  let pos = view.getUint32(eocd + 16, true)
  const entries: ZipEntryInfo[] = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== CENTRAL_DIRECTORY) throw new Error(`bad central directory entry at ${pos}`)
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    entries.push({
      name: new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nameLength)),
      method: view.getUint16(pos + 10, true),
      compressedSize: view.getUint32(pos + 20, true),
      size: view.getUint32(pos + 24, true),
      offset: view.getUint32(pos + 42, true)
    })
    pos += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
