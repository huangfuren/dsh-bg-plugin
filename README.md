# dsh-bg-plugin

中文 | [English](README.en.md)

DeepSeek Harness (DSH) 自定义背景插件 —— 为 `dsh web` 界面提供持久化的全窗口背景：上传图片、实时预览、调节透明度/亮度/遮罩/模糊、选择位置与填充方式，设置持久保存。

## 结构

| 目录 | 说明 |
|---|---|
| `bg/` | 宿主端（Node half）：图片存储、`/bg-upload` `/bg-file` `/bg-rpc` 路由、配置持久化 |
| `client-bg/` | 客户端（Web half）：设置面板 UI、主题 Token 渲染、fetch 上传 |
| `test/` | 宿主侧的回归测试（`node --test`，零依赖） |

宿主端内部按职责拆成四个模块，`bg/lib/index.js` 只做装配：

| 文件 | 职责 |
|---|---|
| `bg/lib/image-format.js` | 按字节签名识别 PNG / JPEG / GIF / WebP，并嗅探像素宽高 |
| `bg/lib/multipart.js` | `multipart/form-data` 解析 |
| `bg/lib/storage.js` | 配置与图片落盘、旧格式懒迁移、孤儿回收 |
| `bg/lib/routes.js` | 三个 HTTP 路由，含流式限额与缓存头 |

## 功能

- 全窗口背景图，覆盖聊天界面
- 上传 PNG / JPEG / GIF / WebP（≤16MB），服务端按**字节签名**判定格式并嗅探尺寸
- 实时预览 + 设置：透明度、亮度、黑色遮罩、高斯模糊（SVG 滤镜）、位置（9 宫格）、填充方式（cover / contain / stretch）
- 配置与图片落盘持久化（默认 `$DSH_HOME/background`），重启不丢失
- 关闭开关即回到原生界面，不改 DSH 任何源码

## 存储

图片以**原始字节**存盘（`.dsh-bg-<id>.png|jpg|gif|webp`），配置在同目录的 `.dsh-bg-config.json`。

- 1.0.1 及更早把图片包成 `{mime, data: base64}` 的 JSON，体积大 33%，读取时还要全量解码。旧文件会在**第一次被访问时**自动迁移成原图并删掉，不需要手动处理。
- `/bg-file/<id>` 响应带 `Cache-Control: ... immutable`：id 一次生成终身不变，刷新页面不再重下图库。
- 「关闭背景并清空设置」会真正删掉图片文件与配置；启动时另有一次孤儿回收，清掉没有配置引用的残留文件（只清落盘超过 1 小时的，避免误删正在上传的图）。

## 安装

本插件是**两个独立的包**，各自都声明了 `dsh.bundle.patch`（组合包），因此都能被 DSH 的插件安装器单独安装：

| 包名 | 目录 | 作用 |
|---|---|---|
| `@deepseek-ai/dsh-bg` | `bg/` | 宿主端：图片存储与 `/bg-*` 路由 |
| `@deepseek-ai/dsh-client-bg` | `client-bg/` | 客户端：设置面板与背景渲染 |

桌面版「添加插件」或 CLI 逐个添加本地目录 / Git 仓库即可（**两个都要装**）：

```bash
# 网页版 CLI（profile 换成 desktop 即为桌面版）
dsh plugin --profile desktop add link:/absolute/path/to/dsh-bg-plugin/bg
dsh plugin --profile desktop add link:/absolute/path/to/dsh-bg-plugin/client-bg
```

手工安装时的等价写法：把两个目录链接进 profile 的 `node_modules`，并登记两条加载项。

```yaml
# cordis.patch.yml（仅在不用安装器时需要）
- insert:
    - id: bg
      name: '@deepseek-ai/dsh-bg'
    - id: client-bg
      name: '@deepseek-ai/dsh-client-bg'
```

> v1.0.1 起 client 半改为自插（自带 `cordis.patch.yml`），不再由 `bg` 的 patch 顺带插入 —— 早先那样做会让人以为装完 bg 就齐了，实际 `client-bg` 不在 `bg` 的 dependencies 里，pnpm 不会替它安装。

设置入口：**设置 → 通用设置 → 外观**（背景相关调节块）。

## 联动

`dsh-client-ui-aqua`（玻璃主题）的壁纸模式会自动采用本插件当前选中的图片：在「设置 → 背景设置」上传/选图即可，无需在 aqua 里再传一遍；关掉本插件，aqua 回落到流体背景。

## 开发

- 宿主端：`bg/lib/`，纯 Node ESM，无构建步骤
- 客户端：`client-bg/lib/client.js`，浏览器侧 React 代码
- 依赖：`react`（peerDependency），宿主服务 `webServer`、`sandboxPolicy`
- 校验：`npm run verify`（语法 + 包声明 + 测试）；测试可单跑 `npm test`

## License

[MIT](LICENSE)
