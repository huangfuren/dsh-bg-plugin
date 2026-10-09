/**
 * 校验两个包的包声明与加载声明。
 *
 * 零依赖：只做 JSON.parse 与字符串匹配，不引 YAML 库 —— 本脚本要在 CI 里、
 * 在没跑过 install 的干净 checkout 上执行。
 *
 * 为什么值得检查这几条：本仓库是**两个独立的包**，各自声明 `dsh.bundle.patch`
 * 才能被插件安装器接受（少了它，桌面版「添加插件」与 `dsh plugin add` 会以
 * not-a-bundle 直接拒绝，而这个问题只有真正安装时才会暴露）。同时客户端半的
 * `dsh.client.platform` 只接受 "web"，写错会让客户端模块整块不被加载。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 期望校验的包：目录、包名、以及自己的 patch 里应插入的模块名。 */
const PACKAGES = [
  { dir: 'bg', name: '@deepseek-ai/dsh-bg' },
  { dir: 'client-bg', name: '@deepseek-ai/dsh-client-bg' }
]

const failures = []
const check = (label, ok, detail = '') => {
  if (ok) {
    console.log(`ok   ${label}`)
  } else {
    console.error(`FAIL ${label}${detail === '' ? '' : ' — ' + detail}`)
    failures.push(label)
  }
}

/** 去掉 YAML 里单/双引号差异，便于只做包含匹配。 */
const normalize = (text) => text.replace(/["']/g, '')

for (const { dir, name } of PACKAGES) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    check(`${dir}/package.json exists`, false)
    continue
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    check(`${dir}/package.json parses`, false, error.message)
    continue
  }
  check(`${dir}/package.json parses`, true)
  check(`${dir} name is ${name}`, manifest.name === name, `got ${String(manifest.name)}`)

  const patchRef = manifest.dsh?.bundle?.patch
  check(`${dir} declares dsh.bundle.patch`, typeof patchRef === 'string', `got ${String(patchRef)}`)
  if (typeof patchRef !== 'string') continue

  const patchPath = join(dir, patchRef)
  if (!existsSync(patchPath)) {
    check(`${dir} patch file exists`, false, patchPath)
    continue
  }
  const patch = normalize(readFileSync(patchPath, 'utf8'))
  check(`${dir} patch inserts itself`, patch.includes(name), `no "${name}" in ${patchPath}`)
}

// 客户端半的平台标识：dsh 只接受 "web"，写别的值会让客户端模块整块不被加载。
const clientManifestPath = join('client-bg', 'package.json')
if (existsSync(clientManifestPath)) {
  const client = JSON.parse(readFileSync(clientManifestPath, 'utf8'))
  const platform = client.dsh?.client?.platform
  check('client-bg dsh.client.platform is "web"', platform === 'web', `got ${String(platform)}`)
  check('client-bg exports ./client', typeof client.exports?.['./client'] !== 'undefined')
}

if (failures.length > 0) {
  console.error(`\ncheck-manifests FAILED (${failures.length})`)
  process.exit(1)
}
console.log('\ncheck-manifests PASS')
