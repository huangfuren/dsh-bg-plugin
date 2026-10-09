# dsh-bg-plugin

中文 | [English](README.en.md)

DeepSeek Harness (DSH) 自定义背景插件 —— 为 `dsh web` 界面提供持久化的全窗口背景：上传图片、实时预览、调节透明度/亮度/遮罩/模糊、选择位置与填充方式，设置持久保存。

## 结构

| 目录 | 说明 |
|---|---|
| `bg/` | 宿主端（Node half）：图片存储、`/bg-upload` `/bg-file` `/bg-rpc` 路由、配置持久化 |
| `client-bg/` | 客户端（Web half）：设置面板 UI、主题 Token 渲染、fetch 上传 |

## 功能

- 全窗口背景图，覆盖聊天界面
- 上传 PNG / JPEG / GIF / WebP（≤16MB），服务端嗅探尺寸与 MIME
- 实时预览 + 设置：透明度、亮度、黑色遮罩、高斯模糊（SVG 滤镜）、位置（9 宫格）、填充方式（cover / contain / stretch）
- 配置经 Host `fs` 落盘持久化，重启不丢失
- 关闭开关即回到原生界面，不改 DSH 任何源码

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

- 宿主端：`bg/lib/index.js`，纯 Node，无构建步骤
- 客户端：`client-bg/lib/client.js`，浏览器侧 React 代码
- 依赖：`react`（peerDependency），宿主服务 `webServer`、`fs`、`sandboxPolicy`

## License

[MIT](LICENSE)
