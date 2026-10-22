/**
 * 测试用的小工具：临时目录、假的 req/res、四种图片的最小合法文件头。
 *
 * 假 req 用 `Readable.from([...chunks])` 造：它只在有人监听 data/resume 时才吐数据，
 * 与本插件「先挂监听再收」的读法一致；`headers` / `method` / `url` 直接挂到流对象上。
 */

import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 建一个用完即删的临时目录。 */
export function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bg-test-'))
  return {
    dir,
    dispose() {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 占用时忽略 */ }
    },
  }
}

/**
 * 造一个请求流。
 * @param {{method?:string,url?:string,headers?:Record<string,string>,body?:Buffer|string,chunks?:number}} options
 *        `chunks` 指定把 body 切成几段发出，用来验证分段累积逻辑。
 */
export function makeReq({ method = 'POST', url = '/', headers = {}, body = Buffer.alloc(0), chunks } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
  let parts
  if (chunks && chunks > 1) {
    const size = Math.ceil(buf.length / chunks)
    parts = []
    for (let i = 0; i < buf.length; i += size) parts.push(buf.subarray(i, i + size))
    if (parts.length === 0) parts.push(Buffer.alloc(0))
  } else {
    parts = [buf]
  }
  const req = Readable.from(parts)
  req.method = method
  req.url = url
  req.headers = { ...headers }
  return req
}

/** 造一个记录响应的假 res。 */
export function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status
      if (headers) {
        for (const [key, value] of Object.entries(headers)) this.headers[key.toLowerCase()] = value
      }
      return this
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      }
      this.ended = true
    },
    get json() {
      return this.body ? JSON.parse(this.body.toString('utf8')) : null
    },
  }
}

// ── 最小合法图片 ──────────────────────────────────────────────────────

/** PNG：签名 + IHDR（宽高各 4 字节大端）。 */
export function pngBytes(width = 64, height = 32) {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

/** GIF：GIF89a + 逻辑屏幕宽高（小端 16 位）。 */
export function gifBytes(width = 120, height = 90) {
  const buf = Buffer.alloc(13)
  buf.write('GIF89a', 0, 'ascii')
  buf.writeUInt16LE(width, 6)
  buf.writeUInt16LE(height, 8)
  return buf
}

/** JPEG：SOI + APP0 + SOF0 + EOI。 */
export function jpegBytes(width = 800, height = 600) {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ])
  const sof = Buffer.alloc(11)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(11, 2)
  sof[4] = 0x08
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 0x01
  sof[10] = 0x01
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])])
}

function riffHeader(fourcc, chunkSize = 32) {
  const buf = Buffer.alloc(40)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(chunkSize, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write(fourcc, 12, 'ascii')
  buf.writeUInt32LE(chunkSize - 12, 16)
  return buf
}

/** WebP 有损（VP8）：起始码之后是各 14 位宽高。 */
export function webpLossyBytes(width = 640, height = 480) {
  const buf = riffHeader('VP8 ')
  buf[23] = 0x9d
  buf[24] = 0x01
  buf[25] = 0x2a
  buf.writeUInt16LE(width & 0x3fff, 26)
  buf.writeUInt16LE(height & 0x3fff, 28)
  return buf
}

/** WebP 无损（VP8L）：14 位宽-1 + 14 位高-1。 */
export function webpLosslessBytes(width = 200, height = 100) {
  const buf = riffHeader('VP8L')
  buf[20] = 0x2f
  buf.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21)
  return buf
}

/** WebP 扩展（VP8X）：24 位小端的画布宽-1 / 高-1。 */
export function webpExtendedBytes(width = 1000, height = 700) {
  const buf = riffHeader('VP8X')
  const w = width - 1
  const h = height - 1
  buf[24] = w & 0xff
  buf[25] = (w >> 8) & 0xff
  buf[26] = (w >> 16) & 0xff
  buf[27] = h & 0xff
  buf[28] = (h >> 8) & 0xff
  buf[29] = (h >> 16) & 0xff
  return buf
}
