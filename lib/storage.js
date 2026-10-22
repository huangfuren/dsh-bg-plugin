/**
 * 图片与配置的落盘层（只依赖 node:fs / node:path，不依赖任何宿主服务）。
 *
 * 存储布局（`root` 默认是 `$DSH_HOME/background`）：
 *
 *   .dsh-bg-config.json          配置（enabled / current / images[] / 四个参数）
 *   .dsh-bg-<id>.png|jpg|gif|webp  图片原始字节
 *
 * 为什么改存原始字节：1.0.1 及更早把图片包成 `{mime, data: base64}` 的 JSON，
 * 体积凭空大 33%，且每次读取都要「整文件读 → 解析 JSON → 全量 base64 解码」。
 * 实测 16MB 图解码要 461ms（Buffer 一步到位只要 4ms），解码中间态还会把内存放大
 * 近 100 倍 —— 在 Electron 主进程里就是直接卡死桌面版。现在磁盘上就是原图，
 * 读取只剩一次 readFile。
 *
 * 旧格式不会丢：`readImage()` 命中不到新文件时会去找旧的 `.json`，解码后写成
 * 原图并删掉旧文件（懒迁移，只在真正被访问到时发生一次）。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs'
import { readFile, writeFile, rename, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  IMAGE_EXTS,
  extOfMime,
  isSupportedMime,
  mimeOfExt,
  sniffMime,
} from './image-format.js'

/** 图片 id 只允许小写字母数字：不接受 `/`、`\`、`.`，路径拼接无法逃出 root。 */
const ID_RE = /^[a-z0-9]{3,64}$/

/** images[] 上限，防止畸形配置把设置页拖死。 */
const MAX_IMAGES = 200

/** 落盘文件名 → 反解出 id 与扩展名。 */
const FILE_RE = /^\.dsh-bg-([a-z0-9]{3,64})\.(png|jpg|gif|webp|json)$/

export function isValidImageId(id) {
  return typeof id === 'string' && ID_RE.test(id)
}

/**
 * 创建存储实例。所有路径都由 root 与 id 拼出，id 已过白名单校验。
 *
 * @param {object} options
 * @param {string} options.root 存储根目录（绝对或相对均可）
 * @param {{info:Function, warn:Function, error:Function}} [options.log]
 */
export function createStorage({ root, log = console }) {
  const CFG_FILE = join(root, '.dsh-bg-config.json')

  const imagePath = (id, ext) => join(root, '.dsh-bg-' + id + '.' + ext)
  const legacyPath = (id) => join(root, '.dsh-bg-' + id + '.json')

  // ── 配置 ────────────────────────────────────────────────────────────
  function readConfig() {
    try {
      if (!existsSync(CFG_FILE)) return null
      const text = readFileSync(CFG_FILE, 'utf8')
      if (!text || !text.trim()) return null
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' ? sanitizeConfig(parsed) : null
    } catch (err) {
      log.error('[bg] readConfig failed: ' + errText(err))
      return null
    }
  }

  function writeConfig(cfg) {
    if (cfg === null || cfg === undefined) {
      try {
        if (existsSync(CFG_FILE)) writeFileSync(CFG_FILE, 'null')
        return true
      } catch (err) {
        log.error('[bg] writeConfig(null) failed: ' + errText(err))
        return false
      }
    }
    const clean = sanitizeConfig(cfg)
    try {
      mkdirSync(root, { recursive: true })
      writeAtomic(CFG_FILE, JSON.stringify(clean, null, 2))
      return true
    } catch (err) {
      log.error('[bg] writeConfig failed: ' + errText(err))
      return false
    }
  }

  // ── 图片 ────────────────────────────────────────────────────────────
  /**
   * 读一张图。先找新格式（原图），找不到再尝试懒迁移旧 JSON。
   * @returns {Promise<{mime:string, bytes:Buffer}|null>}
   */
  async function readImage(id) {
    if (!isValidImageId(id)) return null
    for (const ext of IMAGE_EXTS) {
      const file = imagePath(id, ext)
      let bytes
      try {
        bytes = await readFile(file)
      } catch {
        continue
      }
      if (!bytes || bytes.length === 0) continue
      return { mime: mimeOfExt(ext), bytes }
    }
    return migrateLegacyImage(id)
  }

  /** 把 1.0.1 的 `{mime, data: base64}` 文件就地转成原图；成功后删旧文件。 */
  async function migrateLegacyImage(id) {
    const file = legacyPath(id)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return null
    }
    try {
      const stored = JSON.parse(text)
      if (!stored || typeof stored.data !== 'string' || stored.data === '') return null
      const bytes = Buffer.from(stored.data, 'base64')
      if (bytes.length === 0) return null
      const mime = isSupportedMime(stored.mime) ? String(stored.mime).toLowerCase() : (sniffMime(bytes) || 'image/png')
      const ext = extOfMime(mime)
      mkdirSync(root, { recursive: true })
      await writeFileAtomic(imagePath(id, ext), bytes)
      try { await unlink(file) } catch { /* 旧文件删不掉也不影响读取 */ }
      log.info('[bg] migrated legacy image ' + id + ' -> .' + ext)
      return { mime, bytes }
    } catch (err) {
      log.error('[bg] migrate legacy image ' + id + ' failed: ' + errText(err))
      return null
    }
  }

  /**
   * 写一张图。tmp + rename 原子落盘：中途崩溃不会留下半张图被当成有效图回放。
   * @returns {Promise<boolean>}
   */
  async function writeImage(id, mime, bytes) {
    if (!isValidImageId(id)) return false
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) return false
    const target = imagePath(id, extOfMime(mime))
    try {
      mkdirSync(root, { recursive: true })
      await writeFileAtomic(target, bytes)
      return true
    } catch (err) {
      log.error('[bg] writeImage failed: ' + errText(err))
      return false
    }
  }

  /**
   * 删除一张图（所有扩展名 + 旧 JSON 一并清）。
   * @returns {Promise<boolean>} 调用后该 id 是否已不留任何文件。
   */
  async function deleteImage(id) {
    if (!isValidImageId(id)) return false
    let ok = true
    const targets = IMAGE_EXTS.map((ext) => imagePath(id, ext)).concat([legacyPath(id)])
    for (const file of targets) {
      try {
        await unlink(file)
      } catch (err) {
        if (err && err.code === 'ENOENT') continue
        ok = false
        log.error('[bg] deleteImage failed: ' + errText(err))
      }
    }
    return ok
  }

  /** 磁盘上现存图片的 id 列表（不含旧 JSON，那只是待迁移的残骸）。 */
  function listImageIds() {
    const ids = new Set()
    let names = []
    try {
      names = readdirSync(root)
    } catch {
      return []
    }
    for (const name of names) {
      const m = FILE_RE.exec(name)
      if (!m || m[2] === 'json') continue
      ids.add(m[1])
    }
    return [...ids]
  }

  /**
   * 清空：删掉所有图片文件、旧 JSON 与配置文件。
   * 这是「关闭背景并清空设置」该走的路径 —— 只把配置写成 null 会把图片永久留在盘上。
   * @returns {Promise<{files:number, config:boolean}>}
   */
  async function clear() {
    let files = 0
    let names = []
    try {
      names = readdirSync(root)
    } catch {
      names = []
    }
    for (const name of names) {
      if (!/^\.dsh-bg-[a-z0-9]{3,64}\.(png|jpg|gif|webp|json)$/.test(name)) continue
      if (name === '.dsh-bg-config.json') continue
      try {
        await unlink(join(root, name))
        files += 1
      } catch (err) {
        if (!err || err.code !== 'ENOENT') log.error('[bg] clear failed on ' + name + ': ' + errText(err))
      }
    }
    let config = false
    try {
      await unlink(CFG_FILE)
      config = true
    } catch (err) {
      if (!err || err.code !== 'ENOENT') log.error('[bg] clear config failed: ' + errText(err))
      config = !existsSync(CFG_FILE)
    }
    return { files, config }
  }

  /**
   * 孤儿回收：配置里没引用的图片文件、以及残留的 .tmp 中间文件，超过 `maxAgeMs` 就删。
   *
   * 只在启动时跑一次。`maxAgeMs` 是防呆：刚上传、配置还没落盘的图（保存失败、或另一个
   * 标签页正在上传）不能当成垃圾清掉，所以只清「已经躺了一段时间」的。
   *
   * @returns {Promise<{removed:number, kept:number}>}
   */
  async function gcOrphans({ maxAgeMs = 3600_000 } = {}) {
    const cfg = readConfig()
    const referenced = new Set()
    if (cfg && Array.isArray(cfg.images)) {
      for (const item of cfg.images) if (item && isValidImageId(item.id)) referenced.add(item.id)
    }
    if (cfg && isValidImageId(cfg.current)) referenced.add(cfg.current)

    let names = []
    try {
      names = readdirSync(root)
    } catch {
      return { removed: 0, kept: 0 }
    }

    const deadline = Date.now() - maxAgeMs
    let removed = 0
    let kept = 0
    for (const name of names) {
      const isTmp = name.startsWith('.dsh-bg-') && name.endsWith('.tmp')
      const m = FILE_RE.exec(name)
      if (!isTmp && !m) continue
      if (!isTmp && name === '.dsh-bg-config.json') continue
      // 被配置引用的 id 一律保留 —— 包括它的旧 JSON：那正是懒迁移还没用上的原始数据，
      // 提前回收等于把图删了。
      if (!isTmp && m && referenced.has(m[1])) continue
      let info
      try {
        info = await stat(join(root, name))
      } catch {
        continue
      }
      if (info.mtimeMs > deadline) { kept += 1; continue }
      try {
        await unlink(join(root, name))
        removed += 1
      } catch {
        /* 回收失败不是错误，下次启动再试 */
      }
    }
    return { removed, kept }
  }

  /**
   * 一次性迁移：从历史存储根（沙箱工作区 / 进程 cwd）把配置文件与图片搬进当前根。
   * 只在当前根还没有配置时执行，且**不删**来源目录，失败也不影响启动。
   *
   * @param {string[]} candidates 候选来源目录
   * @returns {string|null} 实际采用的来源目录
   */
  function adoptFrom(candidates) {
    if (existsSync(CFG_FILE)) return null
    for (const dir of candidates) {
      if (!dir || dir === root) continue
      const cfg = join(dir, '.dsh-bg-config.json')
      if (!existsSync(cfg)) continue
      try {
        mkdirSync(root, { recursive: true })
        copyFileSync(cfg, CFG_FILE)
        for (const name of readdirSync(dir)) {
          if (!/^\.dsh-bg-[a-z0-9]{3,64}\.(png|jpg|gif|webp|json)$/.test(name)) continue
          if (name === '.dsh-bg-config.json') continue
          try { copyFileSync(join(dir, name), join(root, name)) } catch { /* 单张失败不中断 */ }
        }
        log.info('[bg] adopted storage from ' + dir + ' -> ' + root)
        return dir
      } catch (err) {
        log.error('[bg] adopt from ' + dir + ' failed: ' + errText(err))
      }
    }
    return null
  }

  return {
    root,
    CFG_FILE,
    isValidId: isValidImageId,
    readConfig,
    writeConfig,
    sanitizeConfig,
    readImage,
    writeImage,
    deleteImage,
    listImageIds,
    clear,
    gcOrphans,
    adoptFrom,
  }
}

// ── 工具 ──────────────────────────────────────────────────────────────

function errText(err) {
  return err && err.message ? err.message : String(err)
}

function tmpName(file) {
  return file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
}

function writeAtomic(file, text) {
  const tmp = tmpName(file)
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } catch {
    // tmp + rename 在个别文件系统（网络盘、目标被占用）上会失败，退化为直写，
    // 顺手清掉可能残留的 tmp。直写失败就真的抛出，让调用方回报 storage 错误。
    writeFileSync(file, text)
    try { unlinkSync(tmp) } catch { /* 没留下中间文件 */ }
  }
}

async function writeFileAtomic(file, bytes) {
  const tmp = tmpName(file)
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, file)
  } catch (err) {
    try { await unlink(tmp) } catch { /* ignore */ }
    throw err
  }
}

/**
 * 配置归一化。客户端传来的状态一律不可信：越界的参数会让背景渲染出不可见的
 * 极端值，非法 id 会让 images[] 里出现点不开的项，超长数组能把设置页拖死。
 */
export function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null
  const images = []
  const seen = new Set()
  if (Array.isArray(raw.images)) {
    for (const item of raw.images) {
      if (!item || typeof item !== 'object') continue
      const id = typeof item.id === 'string' ? item.id : ''
      if (!isValidImageId(id) || seen.has(id)) continue
      seen.add(id)
      const entry = {
        id,
        name: typeof item.name === 'string' ? item.name.slice(0, 200) : id,
        mime: isSupportedMime(item.mime) ? String(item.mime).toLowerCase() : 'image/png',
        width: positiveInt(item.width),
        height: positiveInt(item.height),
      }
      if (typeof item.url === 'string' && item.url.startsWith('/')) entry.url = item.url.slice(0, 500)
      images.push(entry)
      if (images.length >= MAX_IMAGES) break
    }
  }
  const current = typeof raw.current === 'string' && seen.has(raw.current) ? raw.current : null
  return {
    version: 3,
    enabled: raw.enabled === true && current !== null,
    current,
    images,
    opacity: clampInt(raw.opacity, 0, 100, 100),
    brightness: clampInt(raw.brightness, 0, 100, 100),
    mask: clampInt(raw.mask, 0, 100, 12),
    blur: clampInt(raw.blur, 0, 20, 6),
    // 面板实底：主题底色铺在壁纸之上的浓度。旧配置没有这个键，落到推荐值 70，
    // 也就是升级后默认变「看得清」；用户把它调回 0 即为旧行为。
    overlay: clampInt(raw.overlay, 0, 100, 70),
    posX: ['left', 'center', 'right'].includes(raw.posX) ? raw.posX : 'center',
    posY: ['top', 'center', 'bottom'].includes(raw.posY) ? raw.posY : 'center',
    fit: ['cover', 'contain', 'stretch'].includes(raw.fit) ? raw.fit : 'cover',
  }
}

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function positiveInt(value) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null
  return Math.round(n)
}
