/**
 * 校验单包的包声明、加载声明与客户端入口。
 *
 * 零依赖：只做 JSON.parse 与字符串匹配，不引 YAML 库 —— 本脚本要在 CI 里、
 * 在没跑过 install 的干净 checkout 上执行。
 *
 * 为什么值得检查这几条：本仓是**一个包**（宿主半在 lib/，客户端半在 client/），
 * 但 DSH 的三处声明分散在三个地方，任何一处与包名不一致，症状都不是「报错」而是
 * 「静默不生效」：
 *
 * - `dsh.bundle.patch` 缺失 → 安装器以 not-a-bundle 直接拒绝，只有真正安装时才暴露；
 * - `dsh.client.platform` 写错（只接受 "web"）→ 客户端模块整块不被加载，设置页空白；
 * - `client/client.js` 里 `__ModuleLoader__.load({ id })` 的 id 与包名不符 →
 *   宿主按包名注册客户端模块，对不上号就加载不到。这条最容易在改名后漏掉，
 *   所以下面用正则把它读出来比对。
 */
import { readFileSync, existsSync } from 'node:fs'

/** 期望的包名。硬编码而非从清单读回：改名时这条必须跟着改，避免只改一半。 */
const EXPECTED_NAME = 'dsh-bg-plugin'

const failures = []
const check = (label, ok, detail = '') => {
  if (ok) {
    console.log(`ok   ${label}`)
  } else {
    console.error(`FAIL ${label}${detail === '' ? '' : ' — ' + detail}`)
    failures.push(label)
  }
}

/** 去掉 YAML / JS 里单双引号差异，便于只做包含匹配。 */
const normalize = (text) => text.replace(/["']/g, '')
const read = (file) => readFileSync(file, 'utf8')

let manifest
try {
  manifest = JSON.parse(read('package.json'))
  check('package.json parses', true)
} catch (error) {
  console.error(`FAIL package.json parses — ${error.message}`)
  process.exit(1)
}

const name = String(manifest.name)

// 1) 包名：与期望值一致，且不带 npm scope —— 占 `@deepseek-ai/` 这类官方命名空间
//    永远发不了 npm，安装命令也会被 scope 拖长。
check(`name is ${EXPECTED_NAME}`, name === EXPECTED_NAME, `got ${name}`)
check('name is unscoped', !name.startsWith('@'), `${name} 带 npm scope`)

// 2) 组合包声明：安装器据此识别「这是个 DSH 插件」。
const patchRef = manifest.dsh?.bundle?.patch
check('declares dsh.bundle.patch', typeof patchRef === 'string', `got ${String(patchRef)}`)
check('files ships cordis.patch.yml', Array.isArray(manifest.files) && manifest.files.includes('cordis.patch.yml'))

// 3) 两半入口必须真实存在：重构时最容易犯的错就是声明还指着老路径，
//    而这类错误直到插件被加载时才暴露。
const mainRef = manifest.main
check('main entry declared', typeof mainRef === 'string', `got ${String(mainRef)}`)
check('main entry exists', typeof mainRef === 'string' && existsSync(mainRef), String(mainRef))

const clientRef = manifest.exports?.['./client']
check('exports ./client', typeof clientRef === 'string', `got ${String(clientRef)}`)
check('client entry exists', typeof clientRef === 'string' && existsSync(clientRef), String(clientRef))

check('files ships lib/', Array.isArray(manifest.files) && manifest.files.includes('lib'))
check('files ships client/', Array.isArray(manifest.files) && manifest.files.includes('client'))

// 4) 客户端平台标识：dsh 只接受 "web"（桌面版也是 Electron 加载同一个 web 界面）。
const platform = manifest.dsh?.client?.platform
check('dsh.client.platform is "web"', platform === 'web', `got ${String(platform)}`)

// 5) inject 只能列宿主的客户端包。列表里出现本包或自定义包名，说明把
//    「注入依赖」和「自我注册」搞混了 —— 后者由 dsh.client 声明自动完成。
const inject = manifest.dsh?.client?.inject
check('dsh.client.inject is an array', Array.isArray(inject), `got ${typeof inject}`)
if (Array.isArray(inject)) {
  const stray = inject.filter((entry) => !String(entry).startsWith('@deepseek-ai/dsh-'))
  check('inject only references host packages', stray.length === 0, `unexpected: ${stray.join(', ')}`)
}

// 6) 客户端 loader id 必须等于包名。宿主按包名注册客户端模块，对不上号就静默不加载。
if (typeof clientRef === 'string' && existsSync(clientRef)) {
  const matched = /__ModuleLoader__\s*\.\s*load\(\s*\{[\s\S]{0,160}?id\s*:\s*["']([^"']+)["']/.exec(read(clientRef))
  check('client loader id is present', matched !== null, clientRef)
  check('client loader id equals package name', matched?.[1] === name, `got ${String(matched?.[1])}`)
}

// 7) patch 必须恰好插入一条、且插的是本包。单包结构下多插一条就是重复挂载。
if (typeof patchRef === 'string' && existsSync(patchRef)) {
  const patch = normalize(read(patchRef))
  check('patch file exists', true)
  check('patch inserts this package', patch.includes(name), `no "${name}" in ${patchRef}`)
  const inserts = (patch.match(/^\s*-?\s*id:\s*\S+/gm) ?? []).length
  check('patch inserts exactly one module', inserts === 1, `found ${inserts}`)
}

// 8) 运行边界：宿主侧用 node:fs / fs/promises，太老的 Node 没有稳定的 ESM 行为。
check('engines.node declared', typeof manifest.engines?.node === 'string', String(manifest.engines?.node))
check('engines.dsh declared', typeof manifest.engines?.dsh === 'string', String(manifest.engines?.dsh))
check('peerDependency react declared', typeof manifest.peerDependencies?.react === 'string')

if (failures.length > 0) {
  console.error(`\ncheck-manifests FAILED (${failures.length})`)
  process.exit(1)
}
console.log('\ncheck-manifests PASS')
