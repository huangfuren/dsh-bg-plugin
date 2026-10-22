// Host half of the full-window background plugin.
//
// 职责边界：本文件只做「装配」—— 解析存储根、把历史数据接过来、把三个路由挂到
// webServer 上、启动时跑一次孤儿回收。真正的实现在同目录的四个模块里：
//
//   image-format.js  格式识别与像素尺寸嗅探（PNG / JPEG / GIF / WebP）
//   multipart.js     multipart/form-data 解析
//   storage.js       配置与图片落盘（原图存盘 + 旧 base64 JSON 懒迁移）
//   routes.js        /bg-rpc /bg-upload /bg-file
//
// 为什么不用 ctx.get('fs')：profile 层的 ctx 在全新启动时不提供 session-scoped
// 的 `fs` 服务（ctx.get('fs') === undefined），而 apply 时若一次性捕获该服务，
// 就会永久拿到 undefined —— 表现为 /bg-upload 返回 500 storage、/bg-rpc load
// 恒为 null、/bg-file/<id> 一律 404，即「设置 → 背景设置 用不了」。
// 同样的结论在旧版 @deepseek-ai/dsh-bg2 的头部注释里已经写过，这里把存储层
// 收回 node:fs，并保留一次性迁移，避免历史图片丢失。

import { createStorage } from './storage.js'
import { createRouteHandlers } from './routes.js'

/** 稳定存储根：优先 $DSH_HOME/background（跨部署迁移不丢数据），其次用户主目录。 */
function stableRoot() {
  const dshHome = (process.env.DSH_HOME || '').trim()
  if (dshHome !== '') return dshHome + '/background'
  const user = (process.env.USERPROFILE || process.env.HOME || '').trim()
  return user !== '' ? user + '/.dsh/background' : null
}

function applyInner(ctx) {
  const disposers = []
  let disposed = false

  const root = stableRoot() || '.dsh-bg-data'
  const storage = createStorage({ root })
  const handlers = createRouteHandlers({ storage })

  // ── 一次性迁移：从历史根（沙箱工作区 / 进程 cwd / 旧部署根）搬进稳定根 ──
  const candidates = []
  const sandboxPolicy = ctx.get('sandboxPolicy')
  if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string') candidates.push(sandboxPolicy.workspaceRoot)
  try { candidates.push(process.cwd()) } catch { /* cwd 可能已失效 */ }
  storage.adoptFrom(candidates)

  // ── 启动回收：清掉没有配置引用的图片文件与残留的 .tmp 中间文件 ──
  // 只清「已经躺了一小时」的，避免把另一个标签页正在上传、配置还没落盘的图当垃圾。
  Promise.resolve()
    .then(() => storage.gcOrphans({ maxAgeMs: 3600_000 }))
    .then((result) => {
      if (disposed || !result || result.removed === 0) return
      console.log('[bg] gc removed ' + result.removed + ' orphan file(s)')
    })
    .catch((err) => {
      console.error('[bg] gc failed: ' + (err && err.message ? err.message : err))
    })

  const registerRoutes = (ws) => {
    disposers.push(ws.register({ kind: 'exact', path: '/bg-rpc', handler: handlers.rpc }))
    disposers.push(ws.register({ kind: 'exact', path: '/bg-upload', handler: handlers.upload }))
    disposers.push(ws.register({ kind: 'prefix', path: '/bg-file', handler: handlers.file }))
  }

  // webServer 可能在该行 apply 时还没起来：优先用 cordis 的 service-added 事件，
  // 老版本 cordis 回退到轮询，避免「路由没注册」这类静默失效。
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
}

export default {
  apply(ctx) {
    // 兼容性加固：apply 抛出会让 DSH 的启动审计（assertEntriesActivated）把本插件
    // 判为 fiber FAILED 并拒绝启动整个 dsh。这里整体兜底：宿主 API 若发生未预料的
    // 变化，只降级本插件（背景功能不可用）并记录日志，绝不连带 dsh 起不来。
    try {
      applyInner(ctx)
    } catch (err) {
      console.error('[bg] init failed; background feature disabled: ' + (err && err.message ? err.message : err))
    }
  },
}
