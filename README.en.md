# dsh-bg-plugin

English | [中文](README.md)

A persistent full-window background plugin for the DeepSeek Harness (DSH) web UI. Upload an image, preview it live, and tune the panel plate / opacity / brightness / mask / blur / position / fit. Settings persist across restarts.

## Structure

| Directory | Description |
|---|---|
| `lib/` | Host half (Node): image storage, the `/bg-upload` `/bg-file` `/bg-rpc` routes, config persistence |
| `client/` | Client half (Web): settings panel UI, theme-token renderer, fetch-based upload |
| `test/` | Host-side regression tests (`node --test`, zero dependencies) |

Both halves live in one package: `main` points at `lib/index.js`, `exports["./client"]` points at `client/client.js`, and `package.json` declares `dsh.bundle.patch` and `dsh.client` side by side.

The host half is split by responsibility; `lib/index.js` only wires things together:

| File | Responsibility |
|---|---|
| `lib/image-format.js` | Byte-signature detection for PNG / JPEG / GIF / WebP, plus pixel dimensions |
| `lib/multipart.js` | `multipart/form-data` parsing |
| `lib/storage.js` | Config and image persistence, lazy migration of the old format, orphan GC |
| `lib/routes.js` | The three HTTP routes, with streaming limits and cache headers |

## Features

- A full-window background image covering the chat surface
- Upload PNG / JPEG / GIF / WebP (≤16 MB); the server validates format by **byte signature** and sniffs dimensions
- Live preview plus settings: **panel plate**, opacity, brightness, black mask, Gaussian blur (SVG filter), position (3×3 grid), fit (cover / contain / stretch)
- Defaults favour readability — the wallpaper becomes a texture under a themed plate (blur 6 / mask 12 / plate 70), so contrast no longer drifts with the image; one click restores the recommended look, and dragging the plate to 0 brings back a full-bleed wallpaper
- Config and images persist to disk (default `$DSH_HOME/background`), so they survive restarts
- Flip the switch off and the stock UI returns; no changes to DSH source

## Storage

Images are stored as **raw bytes** (`.dsh-bg-<id>.png|jpg|gif|webp`) next to `.dsh-bg-config.json`.

- Version 1.0.1 and earlier wrapped each image in a `{mime, data: base64}` JSON file: 33 % larger, and every read decoded the whole payload. Old files are migrated to raw images automatically the **first time they are read**, then the JSON is removed — no manual step needed.
- `/bg-file/<id>` answers with `Cache-Control: ... immutable`: an id is generated once and never changes, so refreshing the page no longer re-downloads the whole library.
- "Turn off background and clear settings" now actually deletes image files and the config. On startup there is also an orphan sweep that removes files no config references — only ones older than an hour, so an upload in progress is never collected.

## Installation

This is **one package** holding both halves — `dsh.bundle.patch` makes it acceptable to the plugin installer, and `dsh.client` tells the host to load `exports["./client"]` on the web surface. One install is complete; there is no "host half only, settings page missing" state.

```bash
# Web UI CLI (switch the profile to `desktop` for the desktop app)
dsh plugin --profile desktop add link:/absolute/path/to/dsh-bg-plugin

# Or straight from GitHub
dsh plugin --profile desktop add github:huangfuren/dsh-bg-plugin

# Add --ignore-scripts for local development (the sandbox blocks native build scripts)
```

The manual equivalent: link the repository directory into the profile's `node_modules` and register one loader entry.

```yaml
# cordis.patch.yml
- insert:
    - id: bg
      name: 'dsh-bg-plugin'
```

> **Merged into a single package as of 1.2.0.** Before that it was `@deepseek-ai/dsh-bg` + `@deepseek-ai/dsh-client-bg`, two packages and two installs, with a real chance of installing only the host half. If you had the old pair, remove both and install once as above — the config and images live in `$DSH_HOME/background` and are untouched.

Settings entry: **Settings → General → Appearance** (the background control block).

## Integration

`dsh-client-ui-aqua` (the glass theme) lets its wallpaper mode use whatever image this plugin currently has selected: upload or pick an image under "Settings → Background" and aqua follows it — no second upload. Turn this plugin off and aqua falls back to its fluid backdrop.

## Development

- Host half: `lib/`, plain Node ESM, no build step
- Client half: `client/client.js`, browser-side React code (the `id` in `window.__ModuleLoader__.load` must equal the package name)
- Dependencies: `react` (peerDependency); host services `webServer`, `sandboxPolicy`
- Verify: `npm run verify` (syntax + manifests + tests); tests alone via `npm test`

## License

[MIT](LICENSE)
