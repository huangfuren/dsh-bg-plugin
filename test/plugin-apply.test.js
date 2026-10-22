/**
 * 装配层冒烟测试：用假 ctx 跑一遍 `apply()`，确认三个路由真的挂上去了。
 *
 * 这条最容易出「静默失效」：webServer 取不到时插件不报错、只是什么也不做，
 * 界面上表现为「背景设置打不开图、上传没反应」，而日志里一片安静。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import plugin from '../lib/index.js'
import { makeTempDir, makeReq, makeRes, pngBytes } from './helpers.mjs'
import { buildMultipartBody } from '../lib/multipart.js'

const BOUNDARY = '----dshbgApplyTest'

/** 造一个最小 ctx：只提供 webServer，并记录注册与 effect。 */
function makeCtx() {
  const routes = []
  const disposers = []
  const effects = []
  const webServer = {
    register(spec) {
      routes.push(spec)
      const dispose = () => { spec.disposed = true }
      disposers.push(dispose)
      return dispose
    },
  }
  const ctx = {
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'sandboxPolicy') return undefined
      return undefined
    },
    on() { /* 本测试不需要 service-added */ },
    effect(fn) { effects.push(fn) },
  }
  return { ctx, routes, effects }
}

test('apply 注册出 /bg-rpc /bg-upload /bg-file 三个路由', (t) => {
  const temp = makeTempDir()
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = temp.dir
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    temp.dispose()
  })

  const { ctx, routes, effects } = makeCtx()
  plugin.apply(ctx)

  const byPath = new Map(routes.map((r) => [r.path, r]))
  assert.deepEqual([...byPath.keys()].sort(), ['/bg-file', '/bg-rpc', '/bg-upload'])
  assert.equal(byPath.get('/bg-rpc').kind, 'exact')
  assert.equal(byPath.get('/bg-upload').kind, 'exact')
  assert.equal(byPath.get('/bg-file').kind, 'prefix')
  for (const route of routes) assert.equal(typeof route.handler, 'function')

  // effect 里注册了清理函数：注销后应把三个路由都释放掉。
  assert.equal(effects.length, 1)
  const disposeAll = effects[0]()
  assert.equal(typeof disposeAll, 'function')
  disposeAll()
  assert.equal(routes.every((r) => r.disposed === true), true)
})

test('apply 之后上传与读取能串起来', async (t) => {
  const temp = makeTempDir()
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = temp.dir
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    temp.dispose()
  })

  const { ctx, routes } = makeCtx()
  plugin.apply(ctx)
  const upload = routes.find((r) => r.path === '/bg-upload').handler
  const file = routes.find((r) => r.path === '/bg-file').handler

  const bytes = pngBytes(256, 128)
  const body = buildMultipartBody(BOUNDARY, [{ name: 'file', filename: 'a.png', type: 'image/png', data: bytes }])
  const upRes = makeRes()
  await upload(makeReq({
    method: 'POST',
    url: '/bg-upload',
    headers: { 'content-type': 'multipart/form-data; boundary=' + BOUNDARY },
    body,
  }), upRes)
  assert.equal(upRes.statusCode, 200)
  const id = upRes.json.data.id

  // 存储根应是 $DSH_HOME/background
  const onDisk = readFileSync(join(temp.dir, 'background', '.dsh-bg-' + id + '.png'))
  assert.deepEqual(onDisk, bytes)

  const getRes = makeRes()
  await file(makeReq({ method: 'GET', url: '/bg-file/' + id }), getRes)
  assert.equal(getRes.statusCode, 200)
  assert.deepEqual(getRes.body, bytes)
})

test('宿主 API 变化时 apply 不抛异常（只降级本插件）', () => {
  const broken = {
    get() { throw new Error('ctx.get exploded') },
    on() { throw new Error('ctx.on exploded') },
    effect() { throw new Error('ctx.effect exploded') },
  }
  // 绝不连带 DSH 起不来：apply 必须整体兜住。
  assert.doesNotThrow(() => plugin.apply(broken))
})
