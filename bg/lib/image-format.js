/**
 * 图片格式识别与尺寸嗅探（零依赖，只认 PNG / JPEG / GIF / WebP 四种位图）。
 *
 * 为什么只认这四种：宿主把 `/bg-file/<id>` 与页面同源提供，若允许任意字节入库并按
 * 上传者声明的 Content-Type 回放，等于给同源开了「上传 HTML/SVG 即执行脚本」的口子。
 * 因此入库前一律以**字节签名**判定格式，声明值只作参考；不在白名单内直接拒绝。
 *
 * 尺寸只在**上传时**嗅探一次，结果随配置存进 images[]，供客户端按宽高计算模糊强度
 * （blur 的 stdDeviation 与图像短边成比例，缺尺寸会退化成 1920×1080 的固定强度）。
 */

/** 允许落盘的扩展名（顺序即 readImage 的探测顺序）。 */
export const IMAGE_EXTS = ['png', 'jpg', 'gif', 'webp']

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

const EXT_TO_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** mime → 落盘扩展名；未知一律按 png（调用方此前已用 sniffMime 把过期值挡掉）。 */
export function extOfMime(mime) {
  return MIME_TO_EXT[String(mime || '').toLowerCase()] || 'png'
}

/** 落盘扩展名 → mime。 */
export function mimeOfExt(ext) {
  return EXT_TO_MIME[String(ext || '').toLowerCase()] || 'image/png'
}

/** 是否为允许入库的 mime。 */
export function isSupportedMime(mime) {
  return Object.prototype.hasOwnProperty.call(MIME_TO_EXT, String(mime || '').toLowerCase())
}

/**
 * 按字节签名判定格式。不做任何解码，只看文件头魔数。
 * @returns {string|null} `image/png` / `image/jpeg` / `image/gif` / `image/webp`，不识别则 null。
 */
export function sniffMime(bytes) {
  if (!bytes || bytes.length < 12) return null
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  // GIF87a / GIF89a
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  // RIFF....WEBP —— 只判 RIFF 会把 WAV/AVI 也认成图，必须再看第 8~11 字节。
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp'
  return null
}

/**
 * 嗅探像素宽高。
 * @returns {{width:number, height:number}|null} 无法识别、或不支持该编码时返回 null。
 */
export function sniffSize(bytes) {
  if (!bytes) return null
  const mime = sniffMime(bytes)
  if (mime === 'image/png') return pngSize(bytes)
  if (mime === 'image/gif') return gifSize(bytes)
  if (mime === 'image/jpeg') return jpegSize(bytes)
  if (mime === 'image/webp') return webpSize(bytes)
  return null
}

/** IHDR 固定在第 8~24 字节：宽高各 4 字节大端。 */
function pngSize(bytes) {
  if (bytes.length < 24) return null
  const width = bytes.readUInt32BE ? bytes.readUInt32BE(16) : be32(bytes, 16)
  const height = bytes.readUInt32BE ? bytes.readUInt32BE(20) : be32(bytes, 20)
  return sane(width, height)
}

function be32(bytes, off) {
  return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0
}

/** 逻辑屏幕宽高：第 6~9 字节，小端 16 位。 */
function gifSize(bytes) {
  if (bytes.length < 10) return null
  return sane(bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8))
}

/** 逐段扫 JPEG 标记，命中 SOFn（含帧头的那几个）即取帧宽高。 */
function jpegSize(bytes) {
  if (bytes.length < 4) return null
  let i = 2
  while (i + 9 <= bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue }
    const marker = bytes[i + 1]
    // 填充字节与无长度字段的独立标记（SOI/EOI/RSTn/TEM）都不带 payload。
    if (marker === 0xff) { i += 1; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
    // SOF0..SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC) 这三个非帧头标记。
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > bytes.length) return null
      return sane((bytes[i + 7] << 8) | bytes[i + 8], (bytes[i + 5] << 8) | bytes[i + 6])
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    // 长度字段异常时只前进 2 字节，保证循环一定推进（否则会死循环）。
    if (!Number.isFinite(len) || len < 2) { i += 2; continue }
    i += 2 + len
  }
  return null
}

/** WebP 三种编码的宽高藏在不同块里：VP8（有损）、VP8L（无损）、VP8X（扩展/动图）。 */
function webpSize(bytes) {
  if (bytes.length < 30) return null
  const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (fourcc === 'VP8 ') {
    // 20..22 是帧标签，23..25 是起始码 0x9d 0x01 0x2a，之后各 14 位宽高。
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return sane(readU16LE(bytes, 26) & 0x3fff, readU16LE(bytes, 28) & 0x3fff)
  }
  if (fourcc === 'VP8L') {
    if (bytes[20] !== 0x2f) return null
    const b = readU32LE(bytes, 21)
    return sane((b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1)
  }
  if (fourcc === 'VP8X') {
    // 24..26 = 画布宽-1（24 位小端），27..29 = 画布高-1。
    return sane(readU24LE(bytes, 24) + 1, readU24LE(bytes, 27) + 1)
  }
  return null
}

function readU16LE(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8)
}

function readU24LE(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16)
}

function readU32LE(bytes, off) {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0
}

/** 尺寸合理性闸门：0 或超大值都视为「没嗅到」，让客户端走兜底。 */
function sane(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  if (width > 100000 || height > 100000) return null
  return { width, height }
}
