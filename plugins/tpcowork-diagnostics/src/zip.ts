/**
 * A minimal ZIP writer on Node's own zlib, so the desktop payload carries no archive dependency. Deflate runs on libuv's
 * thread pool, which keeps Electron's main thread responsive while compressing. Archives stay far below the 4 GiB ZIP32
 * limit because evidence is capped at 50 MiB.
 */
import { promisify } from 'node:util'
import { crc32, deflateRaw } from 'node:zlib'

const deflate = promisify(deflateRaw)

export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  readonly name: string
  readonly data: Buffer
  /** Modification time stored for the entry; defaults to now. */
  readonly modified?: Date
}

/** MS-DOS date and time fields, the only timestamp ZIP32 headers carry. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** Build one ZIP archive; every entry is deflated unless deflating would make it larger. */
export async function createZip(entries: readonly ZipEntry[]): Promise<Buffer> {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = await deflate(entry.data, { level: 6 })
    const stored = compressed.byteLength >= entry.data.byteLength
    const body = stored ? entry.data : compressed
    const crc = crc32(entry.data)
    const { time, date } = dosDateTime(entry.modified ?? new Date())
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.byteLength, 18)
    local.writeUInt32LE(entry.data.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    locals.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(stored ? 0 : 8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.byteLength, 20)
    central.writeUInt32LE(entry.data.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.byteLength + name.byteLength + body.byteLength
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
