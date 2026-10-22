# Changelog

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

本仓是**一个包**，宿主半与客户端半分居两个目录：

| 目录 | 内容 |
|---|---|
| `lib/` | 宿主半（Node ESM）：存储与 `/bg-*` 路由 |
| `client/` | 客户端半（浏览器 React）：设置面板与背景渲染 |

1.2.0 起合并为单包；此前是两个独立包，版本号各自演进，详见该版本条目。下列条目按时间倒序，标注涉及的目录。

## Unreleased

（暂无）

## 1.3.0

观感修复：让壁纸退成「底纹」，内容回到实底上。配置格式仍是 `version: 3`，不丢图、不丢设置，
旧配置自动套上新的推荐铺底。

- **新增「面板实底」（`overlay`，0–100，默认 70）**：把主题底色铺在壁纸之上，内容面因此
  是「实底 + 底纹」而不是「一张图」。它是本次可读性问题的正解旋钮：越高字越清楚、壁纸越淡；
  拖到 0 即完全回到 1.2.x 的「壁纸铺满」，拖到 100 则壁纸不可见。
- **默认值改为推荐观感**：`mask` 15 → 12、`brightness` 75 → 100、`blur` 0 → 6。
  旧默认（遮罩 15 + 压暗 25）只把图压暗约 36%，浅色壁纸在暗色主题下仍把正文糊成一片；
  现在改由铺底承担对比度，压暗只用于调氛围。
- **设置页新增「恢复推荐观感」**：只重置上述五个参数，不动图库与选中项。
- **预览与真实一致**：`.dshbg-msg` 原先用不透明的 `--dsw-alias-bg-layer-1`，而真实对话区
  是被壁纸覆盖的 `--dsw-alias-bg-base`，于是「预览好看、进去一糊」。现在预览改用与 `overlay`
  同源的 `rgba(...)`，所见即所得。

### 为什么不是「半透明面板」

最初设想是把 `--dsw-alias-bg-layer-1/-2` 与 `--dsw-alias-bg-base` 改成 `rgba()` 半透明，
让面板浮在壁纸上。读过 `ui-theme` 的源码后放弃：`--dsw-alias-bg-base` 同时被
**吸顶会话标题**（`ui-chat/tests/sticky-header-styles.client.spec.ts`）、下拉菜单
（`ui-primitives/MenuSurface.module.css`）、代码块（`CodeBlock.module.css`）、
`MessageItem` 等多处引用，其中吸顶标题与菜单正是靠它**遮住**下层内容 —— 改成半透明会让
滚动内容从标题和菜单里透出来。故实底改为**烘焙进壁纸层叠**（`linear-gradient` 铺在图片之上）：
视觉效果等价（面板与壁纸仍是实底关系），但每一处 `bg-base` 拿到的都是同一条不透明层叠，
不破坏任何吸顶/浮层。`--dsw-specific-sidebar-fill` 继续保持 `transparent`，侧栏因此与内容区
共用同一份层叠，密度一致。

## 1.2.0

**包结构变更（安装方式破坏性，配置与数据不受影响）**：两个包合并为一个，包名从
`@deepseek-ai/dsh-bg` + `@deepseek-ai/dsh-client-bg` 改为 **`dsh-bg-plugin`**。

- **为什么要合并**：`@deepseek-ai/` 是官方 scope，第三方包永远发不上 npm；去掉 scope
  后的 `dsh-bg` 又已被第三方占用（0.1.2），`dsh-client-bg` 虽可用但拆着要装两次，且
  容易出现「只装了宿主半、设置页里看不到背景设置」的半装状态。合并成一个包后，装一次
  就完整，安装命令也只有一条。
- **目录**：`bg/lib/` → `lib/`，`client-bg/lib/client.js` → `client/client.js`；
  `client-bg/lib/index.js`（原本只是一段空 `apply`）删除。文件用 `git mv` 移动，历史可追。
- **声明**：一份 `package.json` 同时给出 `main`（宿主半）、`exports["./client"]`
  （客户端半）、`dsh.bundle.patch` 与 `dsh.client`；`cordis.patch.yml` 由两条 insert
  并为一条（客户端侧改由 `dsh.client` 驱动加载，不再需要单独插入）。
- **客户端 loader id** 同步改为包名。宿主按包名注册客户端模块，id 与包名不一致时不会
  报错，只会静默不加载 —— 所以这条也进了自动校验。
- **校验**：`check-manifests` 从「校验两个包」改写为单包，并新增三条防回归检查：包名不得
  带 npm scope、`__ModuleLoader__.load` 的 id 必须等于包名、patch 必须恰好插入一条。
- **不变**：配置格式仍是 `version: 3`，存储仍是 `$DSH_HOME/background` 下的原图 +
  `.dsh-bg-config.json`。升级不丢图、不丢设置，无需迁移。

## 1.1.0

两个包同步升版。主体是存储层的性能重写 + 一批稳定性修复，行为契约不变（配置 `version`
仍是 3，旧数据自动迁移）。

### 性能（`bg`）

- **图片改存原始字节**：`.dsh-bg-<id>.png|jpg|gif|webp`，不再包成 `{mime, data: base64}`
  的 JSON。16MB 上限下实测：写 1242ms → 12ms（约 100×）、读 446ms → 7ms（约 64×）、
  磁盘占用 −25%。旧 JSON 在首次被访问时**懒迁移**成原图并删掉，不丢图。
- **去掉手写 base64**：宿主侧不再有 ~130 行纯 JS 编解码（慢两个数量级、内存放大近 100 倍），
  全程 `Buffer`；客户端渲染模糊层用的 SVG data URI 改用百分号编码，也不再需要 base64。
- **`/bg-file` 加长缓存**：`Cache-Control: public, max-age=31536000, immutable`。图片 id
  一次生成终身不变，刷新页面不再重下图库（旧值 `no-store` 每次都重下 + 重解码）。

### 修复（`bg`）

- **上传改为流式限额**：先看 `content-length`，再逐块累计，超 16MB 立刻中止。旧实现先
  读完整个 body 再比，超大请求照样能把主进程内存打满。
- **入库只认字节签名**：只接受 PNG / JPEG / GIF / WebP 的魔数，其余一律 415。旧实现信任
  上传者声明的 `Content-Type`，等于允许把 HTML / SVG 以同源身份回放。
- **id 白名单**：`/bg-file/<id>` 的 id 必须匹配 `[a-z0-9]{3,64}`，`../` 再也跳不出存储目录。
- **新增 `clear` 操作**：删掉全部图片文件 + 配置。旧实现「关闭背景并清空设置」只把配置写成
  `null`，图片永久留在盘上。
- **启动孤儿回收**：清掉配置没引用的图片与残留 `.tmp`（只清落盘超过 1 小时的，避免误删
  正在上传的图）。
- **写盘原子化**：配置与图片都走 tmp + rename，中途崩溃不会留下半张图被当成有效图回放。
- **配置归一化**：保存时夹紧越界参数、丢弃非法 id、`current` 不在 `images` 里时自动关闭背景。
- **尺寸嗅探补 WebP**：VP8 / VP8L / VP8X 三种编码都能取宽高（旧实现返回 `null`，模糊强度
  退化成 1920×1080）；同时收紧 PNG 签名与 RIFF 判定（WAV 不再被当成图片）。
- 读图改异步 `fs/promises`，不再用同步读阻塞事件循环。

### 修复（`client-bg`）

- **清空设置真正删文件**：按钮改走 `clear`，并把失败回报到状态行。
- **删除图片等待结果**：删失败时保留条目并提示重试，不再「界面说删了、盘上还在」。
- **卸载时补存**：600ms debounce 会随设置页卸载被丢弃，拖完滑杆立刻切走等于白改；现在
  卸载时若有未落盘改动会立即补一次保存。
- **上传前体积预检** + 超限/格式不支持分别给提示，不再一律「上传失败」。
- 上传输入框在选择后清空，同一张图删了再选也能重新触发。
- 上传响应按新契约（`{ok, data, error}`）处理。

### 文档

- README 拆分为中英两版，默认中文：`README.md`（中文，默认入口）+ `README.en.md`（英文），
  两版顶部互链。此前是单文件中英混排，现按 7 个插件仓的统一约定拆分。
- 补「存储」一节：落盘格式、懒迁移、缓存头、清空与孤儿回收的边界。

### 测试与 CI

- 新增 `test/`：格式嗅探、multipart 解析、存储层、三个路由、装配层冒烟，共 **62 个用例**，
  零依赖 `node --test`。
- 新增私有根 `package.json`（`private: true`）提供 `npm run verify` = 语法检查 + 包声明
  校验 + 测试。
- CI 从「只跑 `node --check`」改为 `npm run verify`，矩阵不变（Node 22/24 × 三个 OS）
  —— 字节序、CRLF、路径语义这几类错必须三个平台都跑到。
- `check-manifests.mjs` 增加两项：`main` 入口文件必须存在（重构最容易留的老路径）、
  根 `package.json` 必须 `private`。

## 1.0.1

- `bg`：patch 只插入自己（不再顺带插入 client 半）。
- `client-bg`：新增自插 `cordis.patch.yml` + `dsh.bundle.patch`，并补入 `files`，
  使 client 半可被 DSH 插件安装器独立安装；修复"只装 `@deepseek-ai/dsh-bg` 会缺 client 半"
  的误解（`client-bg` 并不在 `bg` 的 dependencies 中）。
- README：补双包安装说明与 `dsh-client-ui-aqua` 联动说明。
