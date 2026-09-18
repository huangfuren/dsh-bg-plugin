// Host half of the full-window background plugin.
//
// Storage layer: node:fs directly, rooted at $DSH_HOME/background.
//
// 为什么不用 ctx.get('fs')：profile 层的 ctx 在全新启动时不提供 session-scoped
// 的 `fs` 服务（ctx.get('fs') === undefined），而 apply 时若一次性捕获该服务，
// 就会永久拿到 undefined —— 表现为 /bg-upload 返回 500 storage、/bg-rpc load
// 恒为 null、/bg-file/<id> 一律 404，即“设置 → 背景设置 用不了”。
// 同样的结论在旧版 @deepseek-ai/dsh-bg2 的头部注释里已经写过，这里把存储层
// 收回 node:fs，并保留一次性迁移，避免历史图片丢失。

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, unlinkSync } from 'node:fs'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function bytesToBase64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? B64[b2 & 63] : '='
  }
  return out
}
function base64ToBytes(b64) {
  const rev = {}
  for (let i = 0; i < B64.length; i++) rev[B64[i]] = i
  const out = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < b64.length; i++) {
    const c = b64[i]
    if (c === '=' || c === '\n' || c === '\r' || c === ' ') continue
    const v = rev[c]
    if (v === undefined) continue
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}
function findBytes(haystack, needle, from) {
  outer: for (let i = from; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}
function sniffSize(bytes) {
  if (!bytes || bytes.length < 24) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return {
      width: (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19],
      height: (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23],
    }
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 <= bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] }
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3]
      i += 2 + len
    }
    return null
  }
  return null
}

/** 稳定存储根：优先 $DSH_HOME/background（跨部署迁移不丢数据），其次用户主目录。 */
function stableRoot() {
  const dshHome = (process.env.DSH_HOME || '').trim()
  if (dshHome !== '') return dshHome + '/background'
  const user = (process.env.USERPROFILE || process.env.HOME || '').trim()
  return user !== '' ? user + '/.dsh/background' : null
}

export default {
  apply(ctx) {
    const disposers = []
    let disposed = false

    const root = stableRoot() || '.dsh-bg-data'
    const CFG_FILE = root + '/.dsh-bg-config.json'
    const imgFile = (id) => root + '/.dsh-bg-' + id + '.json'
    const uid = () => 'bg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const pathnameOf = (url) => {
      const raw = url || '/'
      const q = raw.indexOf('?')
      const noQuery = q === -1 ? raw : raw.slice(0, q)
      const h = noQuery.indexOf('#')
      return h === -1 ? noQuery : noQuery.slice(0, h)
    }

    // ── 一次性迁移：从历史根（沙箱工作区 / 进程 cwd / 旧部署根）搬进稳定根 ──
    const migrate = () => {
      try {
        if (existsSync(CFG_FILE)) return
        const candidates = []
        const sandboxPolicy = ctx.get('sandboxPolicy')
        if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string') candidates.push(sandboxPolicy.workspaceRoot)
        try { candidates.push(process.cwd()) } catch {}
        for (const cand of candidates) {
          if (!cand || cand === root) continue
          const cfg = cand + '/.dsh-bg-config.json'
          if (!existsSync(cfg)) continue
          try {
            mkdirSync(root, { recursive: true })
            copyFileSync(cfg, CFG_FILE)
            for (const n of readdirSync(cand)) {
              if (n.startsWith('.dsh-bg-') && n.endsWith('.json') && n !== '.dsh-bg-config.json') {
                try { copyFileSync(cand + '/' + n, root + '/' + n) } catch {}
              }
            }
            console.log('[bg] migrated storage from ' + cand + ' -> ' + root)
            return
          } catch (err) {
            console.error('[bg] migration from ' + cand + ' failed: ' + (err && err.message ? err.message : err))
          }
        }
      } catch {}
    }
    migrate()

    // ── node:fs 存储（不依赖 ctx.get('fs')，见文件头注释）──
    const readConfig = () => {
      try {
        if (!existsSync(CFG_FILE)) return null
        const text = readFileSync(CFG_FILE, 'utf8')
        if (!text || !text.trim()) return null
        const parsed = JSON.parse(text)
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch (err) {
        console.error('[bg] readConfig failed: ' + (err && err.message ? err.message : err))
        return null
      }
    }
    const writeConfig = (cfg) => {
      try {
        mkdirSync(root, { recursive: true })
        writeFileSync(CFG_FILE, JSON.stringify(cfg === undefined ? null : cfg, null, 2))
        return true
      } catch (err) {
        console.error('[bg] writeConfig failed: ' + (err && err.message ? err.message : err))
        return false
      }
    }
    const readImage = (id) => {
      try {
        const f = imgFile(id)
        if (!existsSync(f)) return null
        const text = readFileSync(f, 'utf8')
        if (!text || !text.trim()) return null
        const stored = JSON.parse(text)
        if (!stored || typeof stored.data !== 'string' || stored.data.length === 0) return null
        const bytes = base64ToBytes(stored.data)
        if (bytes.length === 0) return null
        return { mime: stored.mime || 'image/png', bytes }
      } catch (err) {
        console.error('[bg] readImage failed: ' + (err && err.message ? err.message : err))
        return null
      }
    }
    const writeImage = (id, mime, bytes) => {
      try {
        mkdirSync(root, { recursive: true })
        writeFileSync(imgFile(id), JSON.stringify({ mime, data: bytesToBase64(bytes) }))
        return true
      } catch (err) {
        console.error('[bg] writeImage failed: ' + (err && err.message ? err.message : err))
        return false
      }
    }
    const deleteImage = (id) => {
      try { unlinkSync(imgFile(id)) } catch {}
    }

    const sendJson = (res, status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    const readBody = async (req) => {
      const chunks = []
      for await (const chunk of req) chunks.push(new Uint8Array(chunk))
      let total = 0
      for (const c of chunks) total += c.length
      const body = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { body.set(c, off); off += c.length }
      return body
    }

    const registerRoutes = (ws) => {
      disposers.push(ws.register({
        kind: 'exact',
        path: '/bg-rpc',
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
            const body = await readBody(req)
            const payload = JSON.parse(new TextDecoder('utf-8').decode(body))
            const op = payload && payload.op
            const args = payload && payload.args
            if (op === 'load') return sendJson(res, 200, { ok: true, data: readConfig() })
            if (op === 'save') {
              // 写失败必须如实回报：旧实现无论成败都回 ok:true，导致存储层坏掉时前端只看到“静默无效”。
              const ok = writeConfig(args === undefined ? null : args)
              return ok
                ? sendJson(res, 200, { ok: true })
                : sendJson(res, 500, { ok: false, error: 'storage' })
            }
            if (op === 'delete') {
              const id = args && typeof args.id === 'string' ? args.id : ''
              if (!id) return sendJson(res, 400, { ok: false, error: 'id' })
              deleteImage(id)
              return sendJson(res, 200, { ok: true })
            }
            return sendJson(res, 400, { ok: false, error: 'op' })
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) })
          }
        },
      }))

      disposers.push(ws.register({
        kind: 'exact',
        path: '/bg-upload',
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
            const contentType = req.headers['content-type'] || ''
            const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
            if (!boundaryMatch) return sendJson(res, 400, { ok: false, error: 'no-boundary' })
            const body = await readBody(req)
            if (body.length > 16 * 1024 * 1024) return sendJson(res, 413, { ok: false, error: 'too-large' })
            const marker = new TextEncoder().encode('--' + (boundaryMatch[1] || boundaryMatch[2]))
            const CRLFCRLF = new Uint8Array([13, 10, 13, 10])
            const markers = []
            {
              let from = 0
              while (true) {
                const idx = findBytes(body, marker, from)
                if (idx === -1) break
                markers.push(idx)
                from = idx + marker.length
              }
            }
            if (markers.length < 2) return sendJson(res, 400, { ok: false, error: 'malformed' })
            let fileStart = -1
            let fileEnd = -1
            let fileType = ''
            let fileName = ''
            for (let i = 0; i < markers.length - 1; i++) {
              let p = markers[i] + marker.length
              if (body[p] === 13) p += 2
              const hdrEnd = findBytes(body, CRLFCRLF, p)
              if (hdrEnd === -1) continue
              const headerText = new TextDecoder('utf-8').decode(body.subarray(p, hdrEnd))
              const disp = /name="([^"]+)"/.exec(headerText)
              if (!disp) continue
              let contentEnd = markers[i + 1]
              if (body[contentEnd - 1] === 10 && body[contentEnd - 2] === 13) contentEnd -= 2
              const cStart = hdrEnd + 4
              if (cStart > contentEnd) continue
              if (disp[1] === 'file') {
                fileStart = cStart
                fileEnd = contentEnd
                const ct = /content-type:\s*([^\r\n]+)/i.exec(headerText)
                if (ct) fileType = ct[1].trim()
                const fn = /filename="([^"]+)"/.exec(headerText)
                if (fn) fileName = fn[1]
              }
            }
            if (fileStart === -1 || fileEnd <= fileStart) return sendJson(res, 400, { ok: false, error: 'no-file' })
            const fileBytes = body.subarray(fileStart, fileEnd)
            let mime = fileType || ''
            if (!mime) {
              if (fileBytes[0] === 0xff && fileBytes[1] === 0xd8) mime = 'image/jpeg'
              else if (fileBytes[0] === 0x89 && fileBytes[1] === 0x50 && fileBytes[2] === 0x4e && fileBytes[3] === 0x47) mime = 'image/png'
              else if (fileBytes[0] === 0x47 && fileBytes[1] === 0x49 && fileBytes[2] === 0x46) mime = 'image/gif'
              else if (fileBytes[0] === 0x52 && fileBytes[1] === 0x49 && fileBytes[2] === 0x46 && fileBytes[3] === 0x46) mime = 'image/webp'
              else mime = 'image/png'
            }
            const id = uid()
            const stored = writeImage(id, mime, fileBytes)
            if (!stored) return sendJson(res, 500, { ok: false, error: 'storage' })
            const size = sniffSize(fileBytes)
            return sendJson(res, 200, {
              ok: true,
              data: {
                id,
                name: fileName || '背景图 ' + id.slice(-4),
                url: '/bg-file/' + id,
                mime,
                width: size ? size.width : null,
                height: size ? size.height : null,
              },
            })
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) })
          }
        },
      }))

      disposers.push(ws.register({
        kind: 'prefix',
        path: '/bg-file',
        handler: async (req, res) => {
          try {
            const id = pathnameOf(req.url).slice('/bg-file/'.length)
            if (!id) { res.writeHead(404); res.end(); return }
            const img = readImage(id)
            if (!img) { res.writeHead(404); res.end(); return }
            res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'no-store' })
            res.end(img.bytes)
          } catch (err) {
            res.writeHead(500); res.end()
          }
        },
      }))
    }

    // webServer 可能在该行 apply 时还没起来：优先用 cordis 的 service-added 事件，
    // 老版本 cordis 回退到轮询，避免“路由没注册”这类静默失效。
    const scheduleRoutes = () => {
      if (disposed) return
      let registered = false
      const register = () => {
        if (registered || disposed) return
        const ws = ctx.get('webServer')
        if (ws) {
          registered = true
          registerRoutes(ws)
        }
      }
      register()
      if (registered) return
      if (typeof ctx.on === 'function') {
        ctx.on('service-added', (name) => { if (name === 'webServer') register() })
      }
      let tries = 0
      const attempt = () => {
        if (disposed || registered) return
        tries += 1
        const again = ctx.get('webServer')
        if (again) {
          registered = true
          registerRoutes(again)
          return
        }
        if (tries < 40) {
          setTimeout(attempt, 500)
        } else {
          console.error('[bg] webServer never became available; routes not registered')
        }
      }
      setTimeout(attempt, 500)
    }
    scheduleRoutes()

    ctx.effect(() => () => {
      disposed = true
      for (const d of disposers) d()
    })
  },
}
