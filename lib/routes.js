/**
 * `/bg-rpc` `/bg-upload` `/bg-file` 三个路由的处理函数。
 *
 * 与 `index.js` 分开是为了能脱离宿主直接测试：这里只依赖「一个 storage 实例」和
 * 两个可注入的数值（上传上限、请求体上限），不碰 ctx、不碰全局状态。
 *
 * 三条硬约束，都是旧实现踩过的坑：
 *  1. **上传必须边收边判体积**。旧实现先把整个 body 收完再比 16MB，意味着一个
 *     超大请求照样能把主进程内存打满 —— 限额形同虚设。
 *  2. **回放必须带长缓存**。图片 id 一次生成、终身不变，旧实现的 `no-store` 让每次
 *     刷新页面都把整库图片重下一遍、重新解码一遍。
 *  3. **id 必须过白名单**。旧实现把 URL 尾部直接拼进文件名，`../` 能跳出存储目录。
 */

import { parseMultipart, boundaryOf } from './multipart.js'
import { extOfMime, isSupportedMime, sniffMime, sniffSize } from './image-format.js'

/** 单张图片上限（与客户端预检一致）。 */
export const DEFAULT_MAX_UPLOAD = 16 * 1024 * 1024

/** 请求体上限 = 图片上限 + multipart 头部/边界冗余。 */
const BODY_SLACK = 256 * 1024

/** `/bg-rpc` 的请求体上限：配置里只有 id/名称/参数，1MB 足够。 */
const MAX_RPC_BODY = 1024 * 1024

/** 图片 id 终身不变，可以永久缓存。 */
const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * 读取请求体，超过 `limit` 立即中止（不再继续累积）。
 *
 * 不用 `for await (const chunk of req)`：那种写法在 `break`/抛错离开循环时会把
 * 可读流 destroy 掉，客户端还没读到 413 就先收到连接重置。这里改用事件监听，
 * 命中上限后由调用方 `resume()` 排空剩余数据，413 能正常送达。
 *
 * @returns {Promise<Buffer>} 错误对象的 `code` 为 `TOO_LARGE` / `ABORTED`。
 */
export function readBodyLimited(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers && req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      reject(errWithCode('too-large', 'TOO_LARGE'))
      return
    }
    const chunks = []
    let total = 0
    let settled = false

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAbort)
      req.off('close', onAbort)
    }
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.length
      if (total > limit) {
        settle(reject, errWithCode('too-large', 'TOO_LARGE'))
        return
      }
      chunks.push(buf)
    }
    const onEnd = () => settle(resolve, Buffer.concat(chunks, total))
    const onError = (err) => settle(reject, err)
    const onAbort = () => settle(reject, errWithCode('aborted', 'ABORTED'))

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAbort)
    req.on('close', onAbort)
  })
}

function errWithCode(message, code) {
  const err = new Error(message)
  err.code = code
  return err
}

/** 把剩余请求体读掉丢弃，让 413/400 能正常收尾而不是把连接晾住。 */
function drain(req) {
  try {
    req.on('data', () => {})
    req.resume()
  } catch {
    /* 已结束的流 resume 会抛，忽略 */
  }
}

function pathnameOf(url) {
  const raw = url || '/'
  const q = raw.indexOf('?')
  const noQuery = q === -1 ? raw : raw.slice(0, q)
  const h = noQuery.indexOf('#')
  return h === -1 ? noQuery : noQuery.slice(0, h)
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj))
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length })
  res.end(body)
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, headers)
  res.end()
}

/**
 * 创建三个路由处理器。
 *
 * @param {object} options
 * @param {ReturnType<import('./storage.js').createStorage>} options.storage
 * @param {number} [options.maxUpload] 单张图片上限
 * @param {{info:Function,warn:Function,error:Function}} [options.log]
 * @returns {{rpc:Function, upload:Function, file:Function}}
 */
export function createRouteHandlers({ storage, maxUpload = DEFAULT_MAX_UPLOAD, log = console }) {
  const maxBody = maxUpload + BODY_SLACK
  const uid = () => 'bg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

  // ── /bg-rpc ───────────────────────────────────────────────────────
  async function rpc(req, res) {
    try {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
      const body = await readBodyLimited(req, MAX_RPC_BODY)
      let payload
      try {
        payload = JSON.parse(body.toString('utf8'))
      } catch {
        return sendJson(res, 400, { ok: false, error: 'json' })
      }
      const op = payload && payload.op
      const args = payload && payload.args

      if (op === 'load') return sendJson(res, 200, { ok: true, data: storage.readConfig() })

      if (op === 'save') {
        // 写失败必须如实回报：旧实现无论成败都回 ok:true，存储层坏掉时前端只看到「静默无效」。
        const ok = storage.writeConfig(args === undefined ? null : args)
        return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 500, { ok: false, error: 'storage' })
      }

      if (op === 'delete') {
        const id = args && typeof args.id === 'string' ? args.id : ''
        if (!storage.isValidId(id)) return sendJson(res, 400, { ok: false, error: 'id' })
        const ok = await storage.deleteImage(id)
        return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 500, { ok: false, error: 'storage' })
      }

      if (op === 'clear') {
        const result = await storage.clear()
        return sendJson(res, 200, { ok: true, data: result })
      }

      return sendJson(res, 400, { ok: false, error: 'op' })
    } catch (err) {
      if (err && err.code === 'TOO_LARGE') return sendJson(res, 413, { ok: false, error: 'too-large' })
      log.error('[bg] rpc failed: ' + text(err))
      return sendJson(res, 500, { ok: false, error: 'internal' })
    }
  }

  // ── /bg-upload ────────────────────────────────────────────────────
  async function upload(req, res) {
    try {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
      const boundary = boundaryOf(req.headers && req.headers['content-type'])
      if (!boundary) return sendJson(res, 400, { ok: false, error: 'no-boundary' })

      let body
      try {
        body = await readBodyLimited(req, maxBody)
      } catch (err) {
        if (err && err.code === 'TOO_LARGE') {
          drain(req)
          return sendJson(res, 413, { ok: false, error: 'too-large', limit: maxUpload })
        }
        if (err && err.code === 'ABORTED') return sendJson(res, 400, { ok: false, error: 'aborted' })
        throw err
      }

      const parsed = parseMultipart(body, boundary)
      if (!parsed) return sendJson(res, 400, { ok: false, error: 'malformed' })
      const file = parsed.files.find((item) => item.name === 'file') || parsed.files[0]
      if (!file || !file.data || file.data.length === 0) return sendJson(res, 400, { ok: false, error: 'no-file' })
      if (file.data.length > maxUpload) {
        return sendJson(res, 413, { ok: false, error: 'too-large', limit: maxUpload })
      }

      // 一律以字节签名定格式，声明值只用于兜底。声明值不可信：允许它说了算等于
      // 允许上传任意字节（含 HTML/SVG）并以同源身份回放。
      const mime = sniffMime(file.data)
      if (!mime || !isSupportedMime(mime)) {
        return sendJson(res, 415, { ok: false, error: 'unsupported' })
      }

      const id = uid()
      const stored = await storage.writeImage(id, mime, file.data)
      if (!stored) return sendJson(res, 500, { ok: false, error: 'storage' })

      const size = sniffSize(file.data)
      return sendJson(res, 200, {
        ok: true,
        data: {
          id,
          name: file.filename || '背景图 ' + id.slice(-4),
          url: '/bg-file/' + id,
          mime,
          ext: extOfMime(mime),
          size: file.data.length,
          width: size ? size.width : null,
          height: size ? size.height : null,
        },
      })
    } catch (err) {
      log.error('[bg] upload failed: ' + text(err))
      return sendJson(res, 500, { ok: false, error: 'internal' })
    }
  }

  // ── /bg-file/<id> ─────────────────────────────────────────────────
  async function file(req, res) {
    try {
      const method = req.method || 'GET'
      if (method !== 'GET' && method !== 'HEAD') return sendEmpty(res, 405, { Allow: 'GET, HEAD' })

      const raw = pathnameOf(req.url).slice('/bg-file/'.length)
      let id = raw
      try {
        id = decodeURIComponent(raw)
      } catch {
        return sendEmpty(res, 400)
      }
      // 白名单校验：id 只可能是小写字母数字，任何 `.` `/` `\` 都不可能通过。
      if (!storage.isValidId(id)) return sendEmpty(res, 404, { 'Cache-Control': 'no-store' })

      const img = await storage.readImage(id)
      if (!img) return sendEmpty(res, 404, { 'Cache-Control': 'no-store' })

      res.writeHead(200, {
        'Content-Type': img.mime,
        'Content-Length': img.bytes.length,
        'Cache-Control': IMMUTABLE,
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(method === 'HEAD' ? undefined : img.bytes)
    } catch (err) {
      log.error('[bg] file failed: ' + text(err))
      try { sendEmpty(res, 500) } catch { /* 已发过头就放弃 */ }
    }
  }

  return { rpc, upload, file }
}

function text(err) {
  return err && err.message ? err.message : String(err)
}
