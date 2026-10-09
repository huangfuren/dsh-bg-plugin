# Changelog

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

本仓是**两个独立的包**：

| 包名 | 目录 |
|---|---|
| `@deepseek-ai/dsh-bg` | `bg/` |
| `@deepseek-ai/dsh-client-bg` | `client-bg/` |

两者版本号各自独立演进；下列条目按时间倒序，标注涉及的包。

## Unreleased

- **文档：README 拆分为中英两版，默认中文。** 语言约定统一为 `README.md`（中文，默认入口）+
  `README.en.md`（英文），两版顶部互链。此前 README 是单文件中英混排，现按 7 个插件仓的
  统一约定拆分（本仓为该项规整的最后一个）。

## 1.0.1

- `bg`：patch 只插入自己（不再顺带插入 client 半）。
- `client-bg`：新增自插 `cordis.patch.yml` + `dsh.bundle.patch`，并补入 `files`，
  使 client 半可被 DSH 插件安装器独立安装；修复"只装 `@deepseek-ai/dsh-bg` 会缺 client 半"
  的误解（`client-bg` 并不在 `bg` 的 dependencies 中）。
- README：补双包安装说明与 `dsh-client-ui-aqua` 联动说明。
