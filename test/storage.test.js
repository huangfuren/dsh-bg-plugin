/**
 * 存储层回归测试。
 *
 * 覆盖这次改动的四条主线：
 *  1. 图片以原图落盘，读回来逐字节一致（旧实现是 base64 JSON）。
 *  2. 1.0.1 的旧 JSON 文件能被懒迁移成原图，迁移后旧文件消失、图不丢。
 *  3. id 白名单挡得住目录穿越，任何带 `/` `\` `.` 的 id 都不落盘。
 *  4. 「清空」真的删文件；启动回收只清没被引用且足够旧的孤儿。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createStorage, sanitizeConfig, isValidImageId } from '../lib/storage.js'
import { makeTempDir, pngBytes } from './helpers.mjs'

const silent = { info() {}, warn() {}, error() {} }

/** 建一个临时存储根，返回 storage 与清理函数。 */
function setup() {
  const temp = makeTempDir()
  const storage = createStorage({ root: temp.dir, log: silent })
  return { dir: temp.dir, storage, dispose: temp.dispose }
}

test('原图落盘与读取逐字节一致', async () => {
  const { dir, storage, dispose } = setup()
  try {
    const bytes = pngBytes(300, 200)
    assert.equal(await storage.writeImage('bgabc123', 'image/png', bytes), true)
    // 磁盘上是原图，不是 base64 JSON —— 这正是体积与内存的收益来源。
    assert.deepEqual(readFileSync(join(dir, '.dsh-bg-bgabc123.png')), bytes)
    const back = await storage.readImage('bgabc123')
    assert.equal(back.mime, 'image/png')
    assert.deepEqual(back.bytes, bytes)
  } finally {
    dispose()
  }
})

test('删除会清掉该 id 的所有扩展名', async () => {
  const { dir, storage, dispose } = setup()
  try {
    // 同一 id 写两种格式（模拟历史遗留），删除必须两种都清掉。
    await storage.writeImage('bgabc123', 'image/png', pngBytes())
    await storage.writeImage('bgabc123', 'image/webp', pngBytes())
    assert.equal(existsSync(join(dir, '.dsh-bg-bgabc123.png')), true)
    assert.equal(existsSync(join(dir, '.dsh-bg-bgabc123.webp')), true)
    assert.equal(await storage.deleteImage('bgabc123'), true)
    assert.equal(await storage.readImage('bgabc123'), null)
    assert.deepEqual(readdirSync(dir), [])
  } finally {
    dispose()
  }
})

test('删除不存在的图返回 true（幂等）', async () => {
  const { storage, dispose } = setup()
  try {
    assert.equal(await storage.deleteImage('bgnofile01'), true)
  } finally {
    dispose()
  }
})

test('旧 base64 JSON 懒迁移成原图', async () => {
  const { dir, storage, dispose } = setup()
  try {
    const bytes = pngBytes(64, 48)
    const legacy = join(dir, '.dsh-bg-bgold0001.json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(legacy, JSON.stringify({ mime: 'image/png', data: bytes.toString('base64') }))
    const back = await storage.readImage('bgold0001')
    assert.equal(back.mime, 'image/png')
    assert.deepEqual(back.bytes, bytes)
    // 迁移后：新文件在，旧 JSON 已删，图本身没丢。
    assert.equal(existsSync(join(dir, '.dsh-bg-bgold0001.png')), true)
    assert.equal(existsSync(legacy), false)
  } finally {
    dispose()
  }
})

test('旧 JSON 里 mime 不可信时按字节嗅探', async () => {
  const { dir, storage, dispose } = setup()
  try {
    const bytes = pngBytes(10, 10)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.dsh-bg-bgold0002.json'), JSON.stringify({ mime: 'image/svg+xml', data: bytes.toString('base64') }))
    const back = await storage.readImage('bgold0002')
    assert.equal(back.mime, 'image/png')
  } finally {
    dispose()
  }
})

test('损坏的旧 JSON 返回 null 且不崩', async () => {
  const { dir, storage, dispose } = setup()
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.dsh-bg-bgbad0001.json'), '{not json')
    assert.equal(await storage.readImage('bgbad0001'), null)
    writeFileSync(join(dir, '.dsh-bg-bgbad0002.json'), JSON.stringify({ mime: 'image/png', data: '' }))
    assert.equal(await storage.readImage('bgbad0002'), null)
  } finally {
    dispose()
  }
})

test('id 白名单挡住目录穿越与非法字符', async () => {
  const bad = ['../../etc/passwd', 'bg..', 'BG123', 'bg/123', 'bg\\123', 'bg 123', '', 'a', 'x'.repeat(80), '../bgabc', 'bg-123']
  for (const id of bad) {
    assert.equal(isValidImageId(id), false, 'should reject ' + JSON.stringify(id))
    const { dir, storage, dispose } = setup()
    try {
      assert.equal(await storage.writeImage(id, 'image/png', pngBytes()), false)
      assert.equal(await storage.readImage(id), null)
      assert.equal(await storage.deleteImage(id), false)
      // 目录里不该出现任何由非法 id 造出来的文件。
      assert.equal(existsSync(dir) ? readdirSync(dir).length : 0, 0)
    } finally {
      dispose()
    }
  }
})

test('清空会删掉全部图片与配置', async () => {
  const { dir, storage, dispose } = setup()
  try {
    await storage.writeImage('bgabc001', 'image/png', pngBytes())
    await storage.writeImage('bgabc002', 'image/webp', pngBytes())
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.dsh-bg-bgabc003.json'), JSON.stringify({ mime: 'image/png', data: pngBytes().toString('base64') }))
    assert.equal(storage.writeConfig({ version: 3, enabled: true, current: 'bgabc001', images: [{ id: 'bgabc001' }, { id: 'bgabc002' }] }), true)

    const result = await storage.clear()
    assert.equal(result.config, true)
    assert.equal(existsSync(storage.CFG_FILE), false)
    assert.deepEqual(readdirSync(dir), [])
    assert.equal(await storage.readImage('bgabc001'), null)
  } finally {
    dispose()
  }
})

test('启动回收：只清没被引用且足够旧的孤儿', async () => {
  const { dir, storage, dispose } = setup()
  try {
    const old = Date.now() / 1000 - 7200
    await storage.writeImage('bgkeep0001', 'image/png', pngBytes())
    await storage.writeImage('bgdrop0001', 'image/png', pngBytes())
    storage.writeConfig({ version: 3, enabled: true, current: 'bgkeep0001', images: [{ id: 'bgkeep0001' }] })
    // 两个文件都改成 2 小时前，排除「因为太新而被保留」的干扰。
    for (const name of readdirSync(dir)) {
      if (name === '.dsh-bg-config.json') continue
      utimesSync(join(dir, name), old, old)
    }

    const result = await storage.gcOrphans({ maxAgeMs: 3600_000 })
    assert.equal(result.removed, 1)
    assert.equal(existsSync(join(dir, '.dsh-bg-bgkeep0001.png')), true)
    assert.equal(existsSync(join(dir, '.dsh-bg-bgdrop0001.png')), false)
  } finally {
    dispose()
  }
})

test('启动回收：保留被引用图片的旧 JSON（懒迁移的数据源）', async () => {
  const { dir, storage, dispose } = setup()
  try {
    const old = Date.now() / 1000 - 7200
    mkdirSync(dir, { recursive: true })
    const legacy = join(dir, '.dsh-bg-bgkeep0002.json')
    writeFileSync(legacy, JSON.stringify({ mime: 'image/png', data: pngBytes().toString('base64') }))
    storage.writeConfig({ version: 3, enabled: true, current: 'bgkeep0002', images: [{ id: 'bgkeep0002' }] })
    utimesSync(legacy, old, old)
    const result = await storage.gcOrphans({ maxAgeMs: 3600_000 })
    assert.equal(result.removed, 0)
    assert.equal(existsSync(legacy), true)
  } finally {
    dispose()
  }
})

test('启动回收：新文件不当作孤儿', async () => {
  const { dir, storage, dispose } = setup()
  try {
    // 没有配置，但文件刚写 —— 可能是另一个标签页正在上传、配置还没落盘。
    await storage.writeImage('bgfresh001', 'image/png', pngBytes())
    const result = await storage.gcOrphans({ maxAgeMs: 3600_000 })
    assert.equal(result.removed, 0)
    assert.equal(existsSync(join(dir, '.dsh-bg-bgfresh001.png')), true)
  } finally {
    dispose()
  }
})

test('adoptFrom 只在当前根没有配置时搬一次', async () => {
  const target = makeTempDir()
  const source = makeTempDir()
  const storage = createStorage({ root: target.dir, log: silent })
  try {
    writeFileSync(join(source.dir, '.dsh-bg-config.json'), JSON.stringify({ version: 3, enabled: false, images: [] }))
    writeFileSync(join(source.dir, '.dsh-bg-bgmove0001.png'), pngBytes())
    assert.equal(storage.adoptFrom([source.dir]), source.dir)
    assert.equal(existsSync(join(target.dir, '.dsh-bg-bgmove0001.png')), true)
    // 第二次调用：当前根已有配置，不再搬。
    assert.equal(storage.adoptFrom([source.dir]), null)
  } finally {
    target.dispose()
    source.dispose()
  }
})

test('配置归一化：越界参数被夹紧，非法 id 被丢弃', () => {
  const cfg = sanitizeConfig({
    version: 99,
    enabled: true,
    current: 'bgok00001',
    images: [
      { id: 'bgok00001', name: 'a', mime: 'image/png', width: 100, height: 50 },
      { id: '../../etc/passwd', name: 'evil' },
      { id: 'bgok00001', name: 'duplicate' },
      { id: 'bgok00002', mime: 'text/html', width: -5, height: 'x' },
      null,
    ],
    opacity: 999,
    brightness: -20,
    mask: 50.6,
    blur: '7',
    posX: 'middle',
    posY: 'bottom',
    fit: 'squish',
  })
  assert.equal(cfg.version, 3)
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.current, 'bgok00001')
  assert.deepEqual(cfg.images.map((i) => i.id), ['bgok00001', 'bgok00002'])
  assert.equal(cfg.images[1].mime, 'image/png')
  assert.equal(cfg.images[1].width, null)
  assert.equal(cfg.opacity, 100)
  assert.equal(cfg.brightness, 0)
  assert.equal(cfg.mask, 51)
  assert.equal(cfg.blur, 7)
  assert.equal(cfg.posX, 'center')
  assert.equal(cfg.posY, 'bottom')
  assert.equal(cfg.fit, 'cover')
})

test('current 不在 images 里时自动关闭背景', () => {
  const cfg = sanitizeConfig({ enabled: true, current: 'bgmissing01', images: [] })
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.current, null)
})

test('sanitizeConfig 对非对象输入返回 null', () => {
  assert.equal(sanitizeConfig(null), null)
  assert.equal(sanitizeConfig(undefined), null)
  assert.equal(sanitizeConfig('x'), null)
})

test('配置文件坏掉时读取返回 null 而不是抛', () => {
  const { dir, storage, dispose } = setup()
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(storage.CFG_FILE, '{broken')
    assert.equal(storage.readConfig(), null)
    // 空文件同理
    writeFileSync(storage.CFG_FILE, '   ')
    assert.equal(storage.readConfig(), null)
  } finally {
    dispose()
  }
})

test('写配置后能读回同一个形状', () => {
  const { storage, dispose } = setup()
  try {
    assert.equal(storage.writeConfig({ version: 3, enabled: true, current: 'bgabc001', images: [{ id: 'bgabc001', name: 'x' }], opacity: 80 }), true)
    const cfg = storage.readConfig()
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.current, 'bgabc001')
    assert.equal(cfg.opacity, 80)
    assert.equal(cfg.images.length, 1)
  } finally {
    dispose()
  }
})

test('rmSync 清理不再需要临时目录时不留垃圾', () => {
  // 保护性用例：确认临时目录建在系统 tmp 而不是仓库里（避免 CI 把文件提交进仓）。
  const { dir, dispose } = setup()
  assert.equal(dir.startsWith(process.cwd()), false)
  dispose()
  assert.equal(existsSync(dir), false)
  rmSync(dir, { recursive: true, force: true })
})
