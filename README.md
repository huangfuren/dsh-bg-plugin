# dsh-bg-plugin

中文 | [English](README.en.md)

DeepSeek Harness (DSH) 自定义背景插件 —— 为 `dsh web` 界面提供持久化的全窗口背景：上传图片、实时预览、调节面板实底/透明度/亮度/遮罩/模糊、选择位置与填充方式，设置持久保存。

## 结构

| 目录 | 说明 |
|---|---|
| `lib/` | 宿主端（Node half）：图片存储、`/bg-upload` `/bg-file` `/bg-rpc` 路由、配置持久化 |
| `client/` | 客户端（Web half）：设置面板 UI、主题 Token 渲染、fetch 上传 |
| `test/` | 宿主侧的回归测试（`node --test`，零依赖） |

两半在同一个包里：宿主侧由 `main` 指向 `lib/index.js`，客户端侧由 `exports["./client"]` 指向 `client/client.js`，`package.json` 里同时声明 `dsh.bundle.patch` 与 `dsh.client`。

宿主端内部按职责拆成四个模块，`lib/index.js` 只做装配：

| 文件 | 职责 |
|---|---|
| `lib/image-format.js` | 按字节签名识别 PNG / JPEG / GIF / WebP，并嗅探像素宽高 |
| `lib/multipart.js` | `multipart/form-data` 解析 |
| `lib/storage.js` | 配置与图片落盘、旧格式懒迁移、孤儿回收 |
| `lib/routes.js` | 三个 HTTP 路由，含流式限额与缓存头 |

## 功能

- 全窗口背景图，覆盖聊天界面
- 上传 PNG / JPEG / GIF / WebP（≤16MB），服务端按**字节签名**判定格式并嗅探尺寸
- 实时预览 + 设置：**面板实底**、透明度、亮度、黑色遮罩、高斯模糊（SVG 滤镜）、位置（9 宫格）、填充方式（cover / contain / stretch）
- 默认观感为「壁纸当底纹、内容坐实底」（模糊 6 / 遮罩 12 / 面板实底 70），文字对比度不随壁纸明暗漂移；一键「恢复推荐观感」，也可把面板实底拖到 0 回到壁纸铺满
- 配置与图片落盘持久化（默认 `$DSH_HOME/background`），重启不丢失
- 关闭开关即回到原生界面，不改 DSH 任何源码

## 存储

图片以**原始字节**存盘（`.dsh-bg-<id>.png|jpg|gif|webp`），配置在同目录的 `.dsh-bg-config.json`。

- 1.0.1 及更早把图片包成 `{mime, data: base64}` 的 JSON，体积大 33%，读取时还要全量解码。旧文件会在**第一次被访问时**自动迁移成原图并删掉，不需要手动处理。
- `/bg-file/<id>` 响应带 `Cache-Control: ... immutable`：id 一次生成终身不变，刷新页面不再重下图库。
- 「关闭背景并清空设置」会真正删掉图片文件与配置；启动时另有一次孤儿回收，清掉没有配置引用的残留文件（只清落盘超过 1 小时的，避免误删正在上传的图）。

## 安装

**一个包**，同时含宿主半与客户端半 —— `dsh.bundle.patch` 让插件安装器接受它，`dsh.client` 让宿主在网页端加载 `exports["./client"]`。装一次就齐，不存在「只装了宿主半、设置页看不见」的状态。

```bash
# 网页版 CLI（profile 换成 desktop 即为桌面版）
dsh plugin --profile desktop add link:/absolute/path/to/dsh-bg-plugin

# 或直接从 GitHub
dsh plugin --profile desktop add github:huangfuren/dsh-bg-plugin

# 本地开发时记得加 --ignore-scripts（沙箱会拦原生依赖的构建脚本）
```

不用安装器时的手工等价写法：把仓库目录链接进 profile 的 `node_modules`，并登记一条加载项。

```yaml
# cordis.patch.yml
- insert:
    - id: bg
      name: 'dsh-bg-plugin'
```

> **1.2.0 起合并为单包**。此前是 `@deepseek-ai/dsh-bg` + `@deepseek-ai/dsh-client-bg` 两个包，要装两次，还容易漏装客户端半。已装旧版的话，把两个旧包移除后按上面装一次即可；配置与图片都在 `$DSH_HOME/background`，不受影响。

设置入口：**设置 → 通用设置 → 外观**（背景相关调节块）。

## 联动

`dsh-client-ui-aqua`（玻璃主题）的壁纸模式会自动采用本插件当前选中的图片：在「设置 → 背景设置」上传/选图即可，无需在 aqua 里再传一遍；关掉本插件，aqua 回落到流体背景。

## 开发

- 宿主端：`lib/`，纯 Node ESM，无构建步骤
- 客户端：`client/client.js`，浏览器侧 React 代码（`window.__ModuleLoader__.load` 的 `id` 必须等于包名）
- 依赖：`react`（peerDependency），宿主服务 `webServer`、`sandboxPolicy`
- 校验：`npm run verify`（语法 + 包声明 + 测试）；测试可单跑 `npm test`

## License

[MIT](LICENSE)
