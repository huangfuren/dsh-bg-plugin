/**
 * 格式识别与尺寸嗅探的回归测试。
 *
 * 重点守三件事：
 *  1. 四种位图各自的尺寸都能正确读出（旧实现读不出 WebP，模糊强度会退化成 1920×1080）。
 *  2. 非图片字节一律不认（宿主同源回放，认错了等于开了任意内容上传的口子）。
 *  3. RIFF 容器里只有 WEBP 算图，WAV/AVI 不算（旧实现只看 RIFF 前四字节）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sniffMime,
  sniffSize,
  extOfMime,
  mimeOfExt,
  isSupportedMime,
  IMAGE_EXTS,
} from '../bg/lib/image-format.js'
import {
  pngBytes,
  gifBytes,
  jpegBytes,
  webpLossyBytes,
  webpLosslessBytes,
  webpExtendedBytes,
} from './helpers.mjs'

test('识别四类位图的 mime', () => {
  assert.equal(sniffMime(pngBytes()), 'image/png')
  assert.equal(sniffMime(jpegBytes()), 'image/jpeg')
  assert.equal(sniffMime(gifBytes()), 'image/gif')
  assert.equal(sniffMime(webpLossyBytes()), 'image/webp')
  assert.equal(sniffMime(webpLosslessBytes()), 'image/webp')
  assert.equal(sniffMime(webpExtendedBytes()), 'image/webp')
})

test('非图片与空数据一律不识别', () => {
  assert.equal(sniffMime(null), null)
  assert.equal(sniffMime(Buffer.alloc(0)), null)
  assert.equal(sniffMime(Buffer.from('<html><script>alert(1)</script></html>')), null)
  assert.equal(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
  assert.equal(sniffMime(Buffer.from('BM' + 'x'.repeat(40))), null)
})

test('RIFF 容器里只有 WEBP 算图片', () => {
  // WAV：同样是 RIFF 头，但第 8~11 字节是 WAVE。
  const wav = Buffer.alloc(64)
  wav.write('RIFF', 0, 'ascii')
  wav.write('WAVE', 8, 'ascii')
  assert.equal(sniffMime(wav), null)
  assert.equal(sniffSize(wav), null)
})

test('PNG 尺寸', () => {
  assert.deepEqual(sniffSize(pngBytes(1920, 1080)), { width: 1920, height: 1080 })
  // 宽高大于 2^15，验证按无符号读而不是按位运算读成负数。
  assert.deepEqual(sniffSize(pngBytes(70000, 40000)), { width: 70000, height: 40000 })
})

test('GIF 尺寸', () => {
  assert.deepEqual(sniffSize(gifBytes(120, 90)), { width: 120, height: 90 })
})

test('JPEG 尺寸（跳过 APP0 直达 SOF0）', () => {
  assert.deepEqual(sniffSize(jpegBytes(800, 600)), { width: 800, height: 600 })
  assert.deepEqual(sniffSize(jpegBytes(3840, 2160)), { width: 3840, height: 2160 })
})

test('JPEG 缺 SOF 时返回 null 而不是死循环', () => {
  const noSof = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xff, 0xff, 0xff])])
  assert.equal(sniffSize(noSof), null)
})

test('WebP 三种编码的尺寸', () => {
  assert.deepEqual(sniffSize(webpLossyBytes(640, 480)), { width: 640, height: 480 })
  assert.deepEqual(sniffSize(webpLosslessBytes(200, 100)), { width: 200, height: 100 })
  assert.deepEqual(sniffSize(webpExtendedBytes(1000, 700)), { width: 1000, height: 700 })
})

test('WebP 起始码被破坏时返回 null', () => {
  const broken = webpLossyBytes(640, 480)
  broken[23] = 0x00
  assert.equal(sniffSize(broken), null)
})

test('尺寸为 0 视为未嗅到', () => {
  assert.equal(sniffSize(pngBytes(0, 0)), null)
})

test('mime 与扩展名互转', () => {
  for (const ext of IMAGE_EXTS) {
    const mime = mimeOfExt(ext)
    assert.equal(extOfMime(mime), ext === 'jpeg' ? 'jpg' : ext)
  }
  assert.equal(extOfMime('image/jpg'), 'jpg')
  assert.equal(extOfMime('image/tiff'), 'png')
  assert.equal(mimeOfExt('bmp'), 'image/png')
})

test('isSupportedMime 只认白名单', () => {
  assert.equal(isSupportedMime('image/png'), true)
  assert.equal(isSupportedMime('IMAGE/WEBP'), true)
  assert.equal(isSupportedMime('image/svg+xml'), false)
  assert.equal(isSupportedMime('text/html'), false)
  assert.equal(isSupportedMime(undefined), false)
})
