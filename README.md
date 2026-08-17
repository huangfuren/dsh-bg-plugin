# dsh-bg-plugin

DeepSeek Harness (DSH) 自定义背景插件 —— 为 `dsh web` 界面提供持久化的全窗口背景：上传图片、实时预览、调节透明度/亮度/遮罩/模糊、选择位置与填充方式，设置持久保存。

A persistent full-window background plugin for the DeepSeek Harness web UI. Upload an image, preview it live, and tune opacity / brightness / mask / blur / position / fit. Settings persist across restarts.

## 结构 / Structure

| 目录 | 说明 |
|---|---|
| `bg/` | 宿主端（Node half）：图片存储、`/bg-upload` `/bg-file` `/bg-rpc` 路由、配置持久化 |
| `client-bg/` | 客户端（Web half）：设置面板 UI、主题 Token 渲染、fetch 上传 |

## 功能 / Features

- 全窗口背景图，覆盖聊天界面
- 上传 PNG / JPEG / GIF / WebP（≤16MB），服务端嗅探尺寸与 MIME
- 实时预览 + 设置：透明度、亮度、黑色遮罩、高斯模糊（SVG 滤镜）、位置（9 宫格）、填充方式（cover / contain / stretch）
- 配置经 Host `fs` 落盘持久化，重启不丢失
- 关闭开关即回到原生界面，不改 DSH 任何源码

## 安装 / Install

插件以两个包形式安装进 DSH profile：

```powershell
# 把 bg 与 client-bg 两个目录链接/复制到 profile 的 node_modules，
# 并在 cordis.patch.yml 中登记（示例）：
# - insert:
#     - id: bg
#       name: '@deepseek-ai/dsh-bg'
#     - id: client-bg
#       name: '@deepseek-ai/dsh-client-bg'
```

设置入口：**设置 → 通用设置 → 外观**（背景相关调节块）。

## 开发 / Development

- 宿主端：`bg/lib/index.js`，纯 Node，无构建步骤
- 客户端：`client-bg/lib/client.js`，浏览器侧 React 代码
- 依赖：`react`（peerDependency），宿主服务 `webServer`、`fs`、`sandboxPolicy`

## License / 开源协议

[MIT](LICENSE)
