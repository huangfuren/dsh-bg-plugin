/**
 * 路由层回归测试（不需要宿主，直接喂假 req/res）。
 *
 * 守的是三条以前真出过问题的边界：
 *  1. 上传必须边收边判体积 —— 超限要在读到上限时立刻断，而不是先收完再比。
 *  2. 入库只认字节签名 —— 声明 `text/html` 也存不进非图片内容。
 *  3. `/bg-file/<id>` 必须带长缓存、对非法 id 一律 404、支持 HEAD。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStorage } from '../lib/storage.js'
import { createRouteHandlers, readBodyLimited } from '../lib/routes.js'
import { buildMultipartBody } from '../lib/multipart.js'
import { makeTempDir, makeReq, makeRes, pngBytes } from './helpers.mjs'

const silent = { info() {}, warn() {}, error() {} }
const BOUNDARY = '----dshbgTestBoundary'

function setup({ maxUpload } = {}) {
  const temp = makeTempDir()
  const storage = createStorage({ root: temp.dir, log: silent })
  const handlers = createRouteHandlers({ storage, maxUpload, log: silent })
  return { dir: temp.dir, storage, handlers, dispose: temp.dispose }
}

function uploadReq(buffer, { declaredLength } = {}) {
  const headers = { 'content-type': 'multipart/form-data; boundary=' + BOUNDARY }
  if (declaredLength !== undefined) headers['content-length'] = String(declaredLength)
  return makeReq({ method: 'POST', url: '/bg-upload', headers, body: buffer })
}

function fileBody(bytes, { filename = 'wall.png', type = 'image/png' } = {}) {
  return buildMultipartBody(BOUNDARY, [{ name: 'file', filename, type, data: bytes }])
}

// ── readBodyLimited ───────────────────────────────────────────────────

test('readBodyLimited 正常读完', async () => {
  const body = Buffer.from('hello world')
  const buf = await readBodyLimited(makeReq({ body, chunks: 3 }), 1024)
  assert.deepEqual(buf, body)
})

test('readBodyLimited 超过上限立即报 TOO_LARGE', async () => {
  const body = Buffer.alloc(4096, 0x41)
  await assert.rejects(() => readBodyLimited(makeReq({ body, chunks: 8 }), 1024), (err) => err.code === 'TOO_LARGE')
})

test('readBodyLimited 按声明长度提前拒绝，不读流', async () => {
  const req = makeReq({ body: Buffer.alloc(4096), headers: { 'content-length': '4096' } })
  await assert.rejects(() => readBodyLimited(req, 1024), (err) => err.code === 'TOO_LARGE')
})

// ── /bg-upload ────────────────────────────────────────────────────────

test('上传成功：原图落盘、尺寸已嗅探', async () => {
  const { dir, handlers, dispose } = setup()
  try {
    const bytes = pngBytes(320, 180)
    const res = makeRes()
    await handlers.upload(uploadReq(fileBody(bytes)), res)
    assert.equal(res.statusCode, 200)
    const payload = res.json
    assert.equal(payload.ok, true)
    assert.equal(payload.data.mime, 'image/png')
    assert.equal(payload.data.width, 320)
    assert.equal(payload.data.height, 180)
    assert.match(payload.data.id, /^[a-z0-9]{3,64}$/)
    // 磁盘上是原图字节，不是 base64。
    assert.deepEqual(readFileSync(join(dir, '.dsh-bg-' + payload.data.id + '.png')), bytes)
  } finally {
    dispose()
  }
})

test('上传：声明 text/html 也拦不住按签名识别（结果仍是图片）', async () => {
  const { handlers, dispose } = setup()
  try {
    const res = makeRes()
    await handlers.upload(uploadReq(fileBody(pngBytes(10, 10), { type: 'text/html' })), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.json.data.mime, 'image/png')
  } finally {
    dispose()
  }
})

test('上传非图片内容返回 415 且不落盘', async () => {
  const { dir, handlers, dispose } = setup()
  try {
    const res = makeRes()
    await handlers.upload(uploadReq(fileBody(Buffer.from('<svg onload="alert(1)"></svg>'), { filename: 'x.svg', type: 'image/svg+xml' })), res)
    assert.equal(res.statusCode, 415)
    assert.equal(res.json.error, 'unsupported')
    assert.equal(existsSync(dir) ? readdirSync(dir).length : 0, 0)
  } finally {
    dispose()
  }
})

test('上传超过上限返回 413', async () => {
  const { handlers, dispose } = setup({ maxUpload: 512 })
  try {
    const big = Buffer.concat([pngBytes(10, 10), Buffer.alloc(4096, 0x41)])
    const res = makeRes()
    await handlers.upload(uploadReq(fileBody(big)), res)
    assert.equal(res.statusCode, 413)
    assert.equal(res.json.error, 'too-large')
    assert.equal(res.json.limit, 512)
  } finally {
    dispose()
  }
})

test('上传体超上限时按声明长度提前 413', async () => {
  const { handlers, dispose } = setup({ maxUpload: 1024 })
  try {
    const res = makeRes()
    await handlers.upload(uploadReq(fileBody(pngBytes(10, 10)), { declaredLength: 50 * 1024 * 1024 }), res)
    assert.equal(res.statusCode, 413)
  } finally {
    dispose()
  }
})

test('上传缺 boundary 返回 400', async () => {
  const { handlers, dispose } = setup()
  try {
    const res = makeRes()
    await handlers.upload(makeReq({ method: 'POST', url: '/bg-upload', headers: { 'content-type': 'multipart/form-data' }, body: Buffer.from('x') }), res)
    assert.equal(res.statusCode, 400)
    assert.equal(res.json.error, 'no-boundary')
  } finally {
    dispose()
  }
})

test('上传非 POST 返回 405', async () => {
  const { handlers, dispose } = setup()
  try {
    const res = makeRes()
    await handlers.upload(makeReq({ method: 'GET', url: '/bg-upload' }), res)
    assert.equal(res.statusCode, 405)
  } finally {
    dispose()
  }
})

// ── /bg-file ──────────────────────────────────────────────────────────

test('读取图片：原字节 + 长缓存 + nosniff', async () => {
  const { storage, handlers, dispose } = setup()
  try {
    const bytes = pngBytes(100, 60)
    await storage.writeImage('bgread0001', 'image/png', bytes)
    const res = makeRes()
    await handlers.file(makeReq({ method: 'GET', url: '/bg-file/bgread0001' }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-type'], 'image/png')
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(Number(res.headers['content-length']), bytes.length)
    assert.deepEqual(res.body, bytes)
  } finally {
    dispose()
  }
})

test('读取图片：HEAD 返回头不带体', async () => {
  const { storage, handlers, dispose } = setup()
  try {
    await storage.writeImage('bgread0002', 'image/png', pngBytes(10, 10))
    const res = makeRes()
    await handlers.file(makeReq({ method: 'HEAD', url: '/bg-file/bgread0002' }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, null)
  } finally {
    dispose()
  }
})

test('读取图片：带 query 仍能命中', async () => {
  const { storage, handlers, dispose } = setup()
  try {
    await storage.writeImage('bgread0003', 'image/png', pngBytes(10, 10))
    const res = makeRes()
    await handlers.file(makeReq({ method: 'GET', url: '/bg-file/bgread0003?v=2' }), res)
    assert.equal(res.statusCode, 200)
  } finally {
    dispose()
  }
})

test('读取图片：目录穿越与非法 id 一律 404', async () => {
  const { handlers, dispose } = setup()
  try {
    const urls = [
      '/bg-file/../.dsh-bg-config.json',
      '/bg-file/..%2F..%2Fetc%2Fpasswd',
      '/bg-file/%2e%2e%2f%2e%2e%2fwin.ini',
      '/bg-file/BG123',
      '/bg-file/',
      '/bg-file/bg%2F1',
    ]
    for (const url of urls) {
      const res = makeRes()
      await handlers.file(makeReq({ method: 'GET', url }), res)
      assert.equal(res.statusCode, 404, url)
      assert.equal(res.headers['cache-control'], 'no-store')
    }
  } finally {
    dispose()
  }
})

test('读取图片：不存在的 id 404', async () => {
  const { handlers, dispose } = setup()
  try {
    const res = makeRes()
    await handlers.file(makeReq({ method: 'GET', url: '/bg-file/bgnosuch01' }), res)
    assert.equal(res.statusCode, 404)
  } finally {
    dispose()
  }
})

test('读取图片：非 GET/HEAD 返回 405', async () => {
  const { handlers, dispose } = setup()
  try {
    const res = makeRes()
    await handlers.file(makeReq({ method: 'POST', url: '/bg-file/bgread0001' }), res)
    assert.equal(res.statusCode, 405)
  } finally {
    dispose()
  }
})

// ── /bg-rpc ───────────────────────────────────────────────────────────

function rpcReq(payload) {
  return makeReq({
    method: 'POST',
    url: '/bg-rpc',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

test('rpc：save 后 load 读回同一份配置', async () => {
  const { handlers, dispose } = setup()
  try {
    const save = makeRes()
    await handlers.rpc(rpcReq({ op: 'save', args: { version: 3, enabled: true, current: 'bgabc001', images: [{ id: 'bgabc001', name: '图一' }], opacity: 70 } }), save)
    assert.equal(save.statusCode, 200)

    const load = makeRes()
    await handlers.rpc(rpcReq({ op: 'load' }), load)
    const cfg = load.json.data
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.current, 'bgabc001')
    assert.equal(cfg.opacity, 70)
    assert.equal(cfg.images[0].name, '图一')
  } finally {
    dispose()
  }
})

test('rpc：save null 等价于清空配置（但不动图片文件）', async () => {
  const { dir, storage, handlers, dispose } = setup()
  try {
    await storage.writeImage('bgabc002', 'image/png', pngBytes())
    const save = makeRes()
    await handlers.rpc(rpcReq({ op: 'save', args: null }), save)
    assert.equal(save.json.ok, true)

    const load = makeRes()
    await handlers.rpc(rpcReq({ op: 'load' }), load)
    assert.equal(load.json.data, null)
    // 图片文件仍在 —— 真正删文件是 clear 的职责。
    assert.equal(existsSync(join(dir, '.dsh-bg-bgabc002.png')), true)
  } finally {
    dispose()
  }
})

test('rpc：delete 删掉指定图片', async () => {
  const { dir, storage, handlers, dispose } = setup()
  try {
    await storage.writeImage('bgabc003', 'image/png', pngBytes())
    const res = makeRes()
    await handlers.rpc(rpcReq({ op: 'delete', args: { id: 'bgabc003' } }), res)
    assert.equal(res.json.ok, true)
    assert.equal(existsSync(join(dir, '.dsh-bg-bgabc003.png')), false)
  } finally {
    dispose()
  }
})

test('rpc：delete 非法 id 返回 400', async () => {
  const { handlers, dispose } = setup()
  try {
    const res = makeRes()
    await handlers.rpc(rpcReq({ op: 'delete', args: { id: '../../etc/passwd' } }), res)
    assert.equal(res.statusCode, 400)
    assert.equal(res.json.error, 'id')
  } finally {
    dispose()
  }
})

test('rpc：clear 删图片与配置', async () => {
  const { dir, storage, handlers, dispose } = setup()
  try {
    await storage.writeImage('bgabc004', 'image/png', pngBytes())
    storage.writeConfig({ version: 3, enabled: true, current: 'bgabc004', images: [{ id: 'bgabc004' }] })
    const res = makeRes()
    await handlers.rpc(rpcReq({ op: 'clear' }), res)
    assert.equal(res.json.ok, true)
    assert.equal(res.json.data.files, 1)
    assert.equal(existsSync(join(dir, '.dsh-bg-bgabc004.png')), false)
    assert.equal(existsSync(storage.CFG_FILE), false)
  } finally {
    dispose()
  }
})

test('rpc：未知 op / 坏 JSON / 非 POST 都有明确状态码', async () => {
  const { handlers, dispose } = setup()
  try {
    const unknown = makeRes()
    await handlers.rpc(rpcReq({ op: 'nope' }), unknown)
    assert.equal(unknown.statusCode, 400)

    const badJson = makeRes()
    await handlers.rpc(makeReq({ method: 'POST', url: '/bg-rpc', headers: { 'content-type': 'application/json' }, body: '{oops' }), badJson)
    assert.equal(badJson.statusCode, 400)
    assert.equal(badJson.json.error, 'json')

    const wrongMethod = makeRes()
    await handlers.rpc(makeReq({ method: 'GET', url: '/bg-rpc' }), wrongMethod)
    assert.equal(wrongMethod.statusCode, 405)
  } finally {
    dispose()
  }
})
