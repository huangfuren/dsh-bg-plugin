# dsh-bg-plugin

English | [中文](README.md)

A persistent full-window background plugin for the DeepSeek Harness (DSH) web UI. Upload an image, preview it live, and tune opacity / brightness / mask / blur / position / fit. Settings persist across restarts.

## Structure

| Directory | Description |
|---|---|
| `bg/` | Host half (Node): image storage, the `/bg-upload` `/bg-file` `/bg-rpc` routes, config persistence |
| `client-bg/` | Client half (Web): settings panel UI, theme-token renderer, fetch-based upload |

## Features

- A full-window background image covering the chat surface
- Upload PNG / JPEG / GIF / WebP (≤16 MB); the server sniffs dimensions and MIME
- Live preview plus settings: opacity, brightness, black mask, Gaussian blur (SVG filter), position (3×3 grid), fit (cover / contain / stretch)
- Config is persisted to disk through the host `fs`, so it survives restarts
- Flip the switch off and the stock UI returns; no changes to DSH source

## Installation

This plugin is **two independent packages**, each declaring `dsh.bundle.patch` (a bundle), so each can be installed on its own by the DSH plugin installer:

| Package | Directory | Role |
|---|---|---|
| `@deepseek-ai/dsh-bg` | `bg/` | Host half: image storage and the `/bg-*` routes |
| `@deepseek-ai/dsh-client-bg` | `client-bg/` | Client half: settings panel and background rendering |

Add each local directory (or Git repository) through the desktop "Add plugin" dialog or the CLI (**both are required**):

```bash
# Web UI CLI (switch the profile to `desktop` for the desktop app)
dsh plugin --profile desktop add link:/absolute/path/to/dsh-bg-plugin/bg
dsh plugin --profile desktop add link:/absolute/path/to/dsh-bg-plugin/client-bg
```

The manual equivalent: link both directories into the profile's `node_modules` and register two loader entries.

```yaml
# cordis.patch.yml (only needed when not using the installer)
- insert:
    - id: bg
      name: '@deepseek-ai/dsh-bg'
    - id: client-bg
      name: '@deepseek-ai/dsh-client-bg'
```

> Since v1.0.1 the client half inserts itself (it ships its own `cordis.patch.yml`) instead of being pulled in by `bg`'s patch — the earlier arrangement made it look as if installing `bg` was enough, when in fact `client-bg` is not in `bg`'s dependencies and pnpm would not install it for you.

Settings entry: **Settings → General → Appearance** (the background control block).

## Integration

`dsh-client-ui-aqua` (the glass theme) lets its wallpaper mode use whatever image this plugin currently has selected: upload or pick an image under "Settings → Background" and aqua follows it — no second upload. Turn this plugin off and aqua falls back to its fluid backdrop.

## Development

- Host half: `bg/lib/index.js`, plain Node, no build step
- Client half: `client-bg/lib/client.js`, browser-side React code
- Dependencies: `react` (peerDependency); host services `webServer`, `fs`, `sandboxPolicy`

## License

[MIT](LICENSE)
