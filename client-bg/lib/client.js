window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-bg",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
		function stringToBase64(s) {
			let out = ''
			for (let i = 0; i < s.length; i += 3) {
				const b0 = s.charCodeAt(i)
				const b1 = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
				const b2 = i + 2 < s.length ? s.charCodeAt(i + 2) : 0
				out += B64C[b0 >> 2]
				out += B64C[((b0 & 3) << 4) | (b1 >> 4)]
				out += i + 1 < s.length ? B64C[((b1 & 15) << 2) | (b2 >> 6)] : '='
				out += i + 2 < s.length ? B64C[b2 & 63] : '='
			}
			return out
		}
		const POS_X = ['left', 'center', 'right']
		const POS_Y = ['top', 'center', 'bottom']
		const FIT_OPTS = [['cover', '覆盖 Cover'], ['contain', '包含 Contain'], ['stretch', '拉伸 Stretch']]
		const DEFAULT_STATE = {
			version: 3,
			enabled: false,
			current: null,
			images: [],
			opacity: 100,
			brightness: 75,
			mask: 15,
			blur: 0,
			posX: 'center',
			posY: 'center',
			fit: 'cover',
		}
		function blurredImageUrl(url, w, h, blur, origin) {
			const width = (w && w > 0) ? w : 1920
			const height = (h && h > 0) ? h : 1080
			const minDim = Math.min(width, height)
			const stdDev = Math.max(1, Math.round(blur * minDim / 1000))
			const href = (origin && url.charAt(0) === '/') ? origin + url : url
			const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">'
				+ '<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' + stdDev + '"/></filter></defs>'
				+ '<image href="' + href + '" xlink:href="' + href + '" x="0" y="0" width="' + width + '" height="' + height + '" preserveAspectRatio="xMidYMid slice" filter="url(#b)"/></svg>'
			return 'data:image/svg+xml;base64,' + stringToBase64(svg)
		}
		function composeBg(st, scheme, show) {
			if (show === false) return scheme === 'dark' ? '#14161a' : '#f8fafc'
			const mask = st.mask > 0 ? st.mask / 100 : 0
			const dark = st.brightness < 100 ? 1 - st.brightness / 100 : 0
			const fade = st.opacity < 100 ? 1 - st.opacity / 100 : 0
			const base = scheme === 'dark' ? '16,18,22' : '248,250,252'
			let layers = ''
			if (mask > 0) layers += 'linear-gradient(rgba(0,0,0,' + mask + '), rgba(0,0,0,' + mask + ')), '
			if (dark > 0) layers += 'linear-gradient(rgba(0,0,0,' + dark + '), rgba(0,0,0,' + dark + ')), '
			if (fade > 0) layers += 'linear-gradient(rgba(' + base + ',' + fade + '), rgba(' + base + ',' + fade + ')), '
			const id = st.current
			const item = id ? st.images.find((x) => x.id === id) : null
			if (!item) return layers + '#14161a'
			const url = '/bg-file/' + item.id
			let bg = url
			if (st.blur > 0) {
				try { bg = blurredImageUrl(url, item.width, item.height, st.blur, st.origin) } catch (e) { bg = url }
			}
			const size = st.fit === 'cover' ? 'cover' : st.fit === 'contain' ? 'contain' : '100% 100%'
			return layers + "url('" + bg + "') " + st.posX + ' ' + st.posY + ' / ' + size + ' no-repeat fixed'
		}
		const CSS = `
			.dshbg-page { padding: 28px 32px; max-width: 800px; }
			.dshbg-title { font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-primary); margin: 0 0 6px; }
			.dshbg-sub { font-size: 12.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary); margin: 0 0 20px; }
			.dshbg-label { font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); margin: 22px 0 10px; }
			.dshbg-preview { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; background-size: cover; transition: background .2s; min-height: 130px; }
			.dshbg-preview-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
			.dshbg-preview-tag { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
			.dshbg-msg { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px; max-width: 72%; }
			.dshbg-msg.other { align-self: flex-end; }
			.dshbg-msg-line { height: 8px; border-radius: 4px; background: var(--dsw-alias-label-secondary); opacity: .45; }
			.dshbg-msg-line.w70 { width: 70%; } .dshbg-msg-line.w90 { width: 90%; } .dshbg-msg-line.w40 { width: 40%; } .dshbg-msg-line.w60 { width: 60%; }
			.dshbg-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer; }
			.dshbg-check input { accent-color: var(--dsw-alias-brand-primary); }
			.dshbg-upload { display: flex; flex-direction: column; gap: 8px; }
			.dshbg-upload-form { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
			.dshbg-upload-form input[type="file"] { font-size: 12px; color: var(--dsw-alias-label-secondary); max-width: 240px; }
			.dshbg-upload-status { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
			.dshbg-upload-status.error { color: var(--dsw-alias-state-error-primary); }
			.dshbg-upload-status.ok { color: var(--dsw-alias-state-success-primary); }
			.dshbg-empty { font-size: 13px; color: var(--dsw-alias-label-tertiary); padding: 10px 0; }
			.dshbg-switch { appearance: none; display: inline-flex; align-items: center; justify-content: center; font: inherit; background: none; border: none; cursor: pointer; padding: 3px; border-radius: 999px; flex: none; }
			.dshbg-switch:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.dshbg-switch-track { position: relative; display: block; width: 38px; height: 22px; border-radius: 999px; background: var(--dsw-alias-border-l2); transition: background .18s ease; }
			.dshbg-switch.on .dshbg-switch-track { background: var(--dsw-alias-brand-primary); }
			.dshbg-switch-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: transform .18s ease; }
			.dshbg-switch.on .dshbg-switch-knob { transform: translateX(16px); }
			.dshbg-dim { opacity: .45; pointer-events: none; }
			.dshbg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
			.dshbg-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; cursor: pointer; transition: border-color .15s; }
			.dshbg-card:hover { border-color: var(--dsw-alias-border-l2); }
			.dshbg-card.active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary); }
			.dshbg-card-thumb { height: 84px; background-size: cover; background-position: center; }
			.dshbg-card-name { font-size: 12px; color: var(--dsw-alias-label-primary); padding: 8px 10px 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.dshbg-card-foot { display: flex; align-items: center; justify-content: space-between; padding: 2px 8px 8px; }
			.dshbg-badge { font-size: 11px; color: var(--dsw-alias-state-success-primary); }
			.dshbg-del { appearance: none; font: inherit; font-size: 11px; color: var(--dsw-alias-state-error-primary); background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
			.dshbg-del:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.dshbg-slider-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
			.dshbg-slider-row span { font-size: 13px; color: var(--dsw-alias-label-secondary); width: 56px; flex: none; }
			.dshbg-slider-row input[type="range"] { flex: 1; max-width: 240px; accent-color: var(--dsw-alias-brand-primary); }
			.dshbg-slider-row code { font-size: 12px; color: var(--dsw-alias-label-secondary); min-width: 40px; font-family: ui-monospace, monospace; }
			.dshbg-posgrid { display: grid; grid-template-columns: repeat(3, 34px); gap: 4px; }
			.dshbg-poscell { width: 34px; height: 34px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; }
			.dshbg-poscell:hover { border-color: var(--dsw-alias-border-l2); }
			.dshbg-poscell.active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary); }
			.dshbg-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; overflow: hidden; }
			.dshbg-seg button { appearance: none; font: inherit; font-size: 13px; padding: 6px 14px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); border: none; cursor: pointer; border-right: 1px solid var(--dsw-alias-border-l1); }
			.dshbg-seg button:last-child { border-right: none; }
			.dshbg-seg button.active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 500; }
			.dshbg-actions { margin-top: 20px; display: flex; align-items: center; gap: 12px; }
			.dshbg-btn { appearance: none; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 14px; cursor: pointer; }
			.dshbg-btn:hover { border-color: var(--dsw-alias-border-l2); }
			.dshbg-btn.primary { background: var(--dsw-alias-brand-primary); color: #fff; border-color: transparent; }
			.dshbg-btn:disabled { opacity: .45; cursor: default; }
			.dshbg-status { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
			/* When the background is off we paint the chrome surfaces opaquely
			   so nothing renders a backdrop behind the transparent columns.
			   body[data-dsh-bg] is written by this plugin on every apply. The
			   selectors are plugin-owned (no foreign-skin assumptions) so this
			   stays correct across DSH releases. */
			body[data-dsh-bg='off'] .dshbg-page { background: var(--dsw-alias-bg-base); }
		`

		function BackgroundPage(props) {
			const st = props.state
			const [, force] = React.useState(0)
			const set = (patch) => { Object.assign(st, patch); force((n) => n + 1) }
			const commit = (patch) => {
				touched.current = true
				Object.assign(st, patch)
				force((n) => n + 1)
				props.applyNow(st)
				props.scheduleSave(st, (ok) => setSaveStatus(ok ? 'saved' : 'error'))
			}
			const [saveStatus, setSaveStatus] = React.useState('saved')
			const [uploadStatus, setUploadStatus] = React.useState('idle')
			// True once the user has changed anything in this mount; the async
			// config hydration below must not clobber their in-session choice
			// (e.g. toggling the background off before the load round-trips).
			const touched = React.useRef(false)

			React.useEffect(() => {
				let alive = true
				props.load().then((cfg) => {
					if (!alive || !cfg || cfg.version !== 3) return
					if (touched.current) return
					const next = {
						...st,
						enabled: !!cfg.enabled,
						current: cfg.current || null,
						images: Array.isArray(cfg.images) ? cfg.images : [],
						opacity: typeof cfg.opacity === 'number' ? cfg.opacity : st.opacity,
						brightness: typeof cfg.brightness === 'number' ? cfg.brightness : st.brightness,
						mask: typeof cfg.mask === 'number' ? cfg.mask : st.mask,
						blur: typeof cfg.blur === 'number' ? cfg.blur : st.blur,
						posX: POS_X.indexOf(cfg.posX) !== -1 ? cfg.posX : st.posX,
						posY: POS_Y.indexOf(cfg.posY) !== -1 ? cfg.posY : st.posY,
						fit: cfg.fit === 'contain' || cfg.fit === 'stretch' ? cfg.fit : 'cover',
					}
					Object.assign(st, next)
					force((n) => n + 1)
					props.applyNow(st)
				}).catch(() => {})
				return () => { alive = false }
			}, [])

			const onFile = (e) => {
				const f = e.target.files && e.target.files[0]
				if (!f) return
				setUploadStatus('uploading')
				props.upload(f).then((res) => {
					if (res && res.id) {
						setUploadStatus('done')
						const images = st.images.filter((x) => x.id !== res.id).concat({ id: res.id, name: res.name, width: res.width || null, height: res.height || null, mime: res.mime })
						commit({ images, current: res.id, enabled: true })
					} else setUploadStatus('error')
				}).catch(() => setUploadStatus('error'))
			}
			const removeImage = (id) => {
				props.deleteImage(id)
				const images = st.images.filter((x) => x.id !== id)
				commit({ images, current: st.current === id ? null : st.current })
			}

			const scheme = props.scheme()
			const nodes = []
			nodes.push(React.createElement('h2', { className: 'dshbg-title', key: 't' }, '背景设置'))
			nodes.push(React.createElement('p', { className: 'dshbg-sub', key: 's' },
				'上传并管理你的全屏背景图片。背景铺满整个窗口（含侧栏），不影响任何 UI 操作；参数自动保存，重启 Harness 后仍保留。'))

			nodes.push(React.createElement('div', { className: 'dshbg-label', key: 'l0' }, '实时预览'))
			nodes.push(React.createElement('div', {
				key: 'pv',
				className: 'dshbg-preview',
				style: { background: composeBg(st, scheme, st.enabled).replace(/ fixed$/, '') },
			},
				React.createElement('div', { className: 'dshbg-preview-bar' },
					React.createElement('span', { className: 'dshbg-preview-tag' }, st.enabled && st.current ? '背景已启用' : '背景未启用'),
					React.createElement('button', {
						type: 'button',
						role: 'switch',
						'aria-checked': !!st.enabled,
						'aria-label': '背景开关',
						title: st.enabled ? '点击关闭背景' : '点击开启背景',
						className: 'dshbg-switch' + (st.enabled ? ' on' : ''),
						onClick: () => {
							commit({ enabled: !st.enabled })
							props.saveNow(st).then((ok) => setSaveStatus(ok ? 'saved' : 'error'))
						},
					},
						React.createElement('span', { className: 'dshbg-switch-track' },
							React.createElement('span', { className: 'dshbg-switch-knob' }))))),
				React.createElement('div', { className: 'dshbg-msg' },
					React.createElement('div', { className: 'dshbg-msg-line w70' }),
					React.createElement('div', { className: 'dshbg-msg-line w90' }),
					React.createElement('div', { className: 'dshbg-msg-line w40' })))

			nodes.push(React.createElement('div', { className: 'dshbg-label', key: 'l2' }, '上传背景图片'))
			{
				const hint = uploadStatus === 'idle' ? '支持 JPG / PNG / WebP，选择后自动上传应用'
					: uploadStatus === 'uploading' ? '上传中…'
					: uploadStatus === 'done' ? '已上传并应用，关闭设置查看完整效果'
					: '上传失败，请重试'
				nodes.push(React.createElement('div', { className: 'dshbg-upload', key: 'up' },
					React.createElement('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', onChange: onFile }),
					React.createElement('div', { className: 'dshbg-upload-status' + (uploadStatus === 'error' ? ' error' : uploadStatus === 'done' ? ' ok' : ''), key: 'us' }, hint)))
			}

			nodes.push(React.createElement('div', { className: 'dshbg-label', key: 'l3' }, '我的背景'))
			if (st.images.length === 0) {
				nodes.push(React.createElement('div', { className: 'dshbg-empty', key: 'em' }, '还没有背景图片，先上传一张吧。'))
			} else {
				nodes.push(React.createElement('div', { className: 'dshbg-grid', key: 'g' },
					st.images.map((img) => React.createElement('div', {
						key: img.id,
						className: 'dshbg-card' + (st.current === img.id ? ' active' : ''),
						onClick: () => commit({ current: img.id, enabled: true }),
					},
						React.createElement('div', { className: 'dshbg-card-thumb', style: { background: "url('/bg-file/" + img.id + "') center / cover no-repeat" } }),
						React.createElement('div', { className: 'dshbg-card-name' }, img.name || img.id),
						React.createElement('div', { className: 'dshbg-card-foot' },
							st.current === img.id ? React.createElement('span', { className: 'dshbg-badge' }, '使用中') : React.createElement('span', null),
							React.createElement('button', { type: 'button', className: 'dshbg-del', onClick: (ev) => { ev.stopPropagation(); removeImage(img.id) } }, '删除'),
						)))))
			}

			nodes.push(React.createElement('div', { className: 'dshbg-group' + (st.enabled ? '' : ' dshbg-dim'), key: 'params' },
				React.createElement('div', { className: 'dshbg-label' }, '参数'),
				React.createElement('div', { className: 'dshbg-slider-row' },
					React.createElement('span', null, '透明度'),
					React.createElement('input', { type: 'range', min: 0, max: 100, step: 1, value: st.opacity, onChange: (e) => commit({ opacity: Number(e.target.value) }) }),
					React.createElement('code', null, st.opacity + '%')),
				React.createElement('div', { className: 'dshbg-slider-row' },
					React.createElement('span', null, '亮度'),
					React.createElement('input', { type: 'range', min: 0, max: 100, step: 1, value: st.brightness, onChange: (e) => commit({ brightness: Number(e.target.value) }) }),
					React.createElement('code', null, st.brightness + '%')),
				React.createElement('div', { className: 'dshbg-slider-row' },
					React.createElement('span', null, '遮罩'),
					React.createElement('input', { type: 'range', min: 0, max: 100, step: 1, value: st.mask, onChange: (e) => commit({ mask: Number(e.target.value) }) }),
					React.createElement('code', null, st.mask + '%')),
				React.createElement('div', { className: 'dshbg-slider-row' },
					React.createElement('span', null, '模糊'),
					React.createElement('input', { type: 'range', min: 0, max: 20, step: 1, value: st.blur, onChange: (e) => commit({ blur: Number(e.target.value) }) }),
					React.createElement('code', null, st.blur + 'px'))))

			nodes.push(React.createElement('div', { className: 'dshbg-group' + (st.enabled ? '' : ' dshbg-dim'), key: 'posgroup' },
				React.createElement('div', { className: 'dshbg-label' }, '背景位置'),
				React.createElement('div', { className: 'dshbg-posgrid' },
					POS_Y.map((y) => POS_X.map((x) => React.createElement('button', {
						key: x + '-' + y,
						type: 'button',
						className: 'dshbg-poscell' + (st.posX === x && st.posY === y ? ' active' : ''),
						onClick: () => commit({ posX: x, posY: y }),
					}))))))

			nodes.push(React.createElement('div', { className: 'dshbg-group' + (st.enabled ? '' : ' dshbg-dim'), key: 'fitgroup' },
				React.createElement('div', { className: 'dshbg-label' }, '填充方式'),
				React.createElement('div', { className: 'dshbg-seg' },
					FIT_OPTS.map(([id, label]) => React.createElement('button', {
						key: id,
						type: 'button',
						className: st.fit === id ? 'active' : '',
						onClick: () => commit({ fit: id }),
					}, label)))))

			nodes.push(React.createElement('div', { className: 'dshbg-actions', key: 'act' },
				React.createElement('button', { type: 'button', className: 'dshbg-btn', onClick: () => {
					props.restore()
					const fresh = { ...DEFAULT_STATE }
					Object.keys(fresh).forEach((k) => { st[k] = fresh[k] })
					force((n) => n + 1)
					props.scheduleSave(null, (ok) => setSaveStatus(ok ? 'saved' : 'error'))
				} }, '关闭背景并清空设置'),
				React.createElement('span', { className: 'dshbg-status' },
					saveStatus === 'saved' ? '已自动保存' : saveStatus === 'error' ? '保存失败（仅本次生效）' : '')))

			return React.createElement('div', { className: 'dshbg-page' }, nodes)
		}

		// 0.1.5：activate 可能被 service-added 事件重复触发，加一次性守卫。
		let activated = false

		// 兼容性加固：只声明真正必需的服务。timer 仅是 debounce 的可选优化
		// （activate 内已有回退），放进 inject 反而会让「宿主不提供 timer」变成
		// 本插件永远 pending、彻底不激活。故移除，改为运行时探测。
		const inject = ['slots', 'theme']

		// Graceful degradation: defer activation until all required services
		// become available. Re-runs on cordis service-added events so plugins
		// remain functional across DSH boot-order changes.
		function tryApply(ctx) {
			// 兼容性加固：探测每一步的 API 形状并整体兜底，宿主变化只禁用背景功能。
			try {
				const slots = ctx.get('slots')
				const theme = ctx.get('theme')
				const timer = ctx.get('timer')
				if (slots === undefined || theme === undefined) return false
				if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
					console.warn('[bg] slots API changed; background disabled')
					return false
				}
				// 只读用 getTheme 取当前明暗；不再需要 overrideTokens（见「写入权边界」注释），
				// 所以也不再拿它当激活前提。
				if (typeof theme.getTheme !== 'function') {
					console.warn('[bg] theme.getTheme unavailable; background disabled')
					return false
				}
				return activate(ctx, slots, theme, timer)
			} catch (err) {
				console.warn('[bg] init failed; background disabled: ' + (err && err.message ? err.message : err))
				// 允许后续 service-added 事件重试（activate 的一次性守卫需回滚）。
				activated = false
				return false
			}
		}

		function apply(ctx) {
			// Try once; if services not ready yet, wait via event.
			if (tryApply(ctx)) return
			if (typeof ctx.on === 'function') {
				ctx.on('service-added', (name) => {
					if (name === 'slots' || name === 'theme') tryApply(ctx)
				})
			}
		}

		function activate(ctx, slots, theme, timer) {
			if (activated) return true
			activated = true
			// 0.1.5 打包产物缺失该声明，补上（原先直接引用未定义的 styleEl 导致 styleEl is not defined）。
			const styleEl = document.createElement('style')
			styleEl.dataset.plugin = '@deepseek-ai/dsh-client-bg'
			styleEl.textContent = CSS
			document.head.appendChild(styleEl)
			ctx.effect(() => () => { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) })

			// Live 规则：背景 token 的 !important 声明，由本插件独占。
			// ThemePresenter 与其它皮肤（aqua 等）写 --dsw-alias-bg-base / --dsw-specific-sidebar-fill
			// 走的是「非 important」路径（inline 或主题覆盖层，按注册顺序后者胜），
			// 因此开关是否可见取决于谁的层后注册 —— 这就是「点了开关背景不出现」的原因。
			// important 的 author 声明在层叠中压过所有非 important 声明，背景从此说了算。
			const liveEl = document.createElement('style')
			liveEl.dataset.plugin = '@deepseek-ai/dsh-client-bg/live'
			document.head.appendChild(liveEl)
			ctx.effect(() => () => { if (liveEl.parentNode) liveEl.parentNode.removeChild(liveEl) })

			const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || ''
			const rpc = (op, args) => fetch('/bg-rpc', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ op, args }),
			}).then((r) => r.json()).catch(() => null)
			const upload = (file) => {
				const fd = new FormData()
				fd.append('file', file)
				return fetch('/bg-upload', { method: 'POST', body: fd })
					.then((r) => r.json())
					.then((res) => (res && res.ok ? res.data : null))
					.catch(() => null)
			}

			let disposed = false

			// ── 写入权边界（本次冲突的根治）────────────────────────────────
			// --dsw-alias-bg-base / --dsw-specific-sidebar-fill 是**共享 token**：
			//   · ThemePresenter 拥有 body 的 inline 写入（非 important）；
			//   · 皮肤（aqua 等）拥有自己的 theme 覆盖层，按注册顺序后者胜。
			// 本插件过去也在 body.style 上 set/removeProperty —— 与呈现器抢同一个
			// 声明槽：setProperty 会在呈现器之后覆盖它，removeProperty 更狠，会把
			// 呈现器刚写进去的值直接删掉（关闭背景后皮肤颜色丢失，就是旧版加「中性
			// 覆盖层」打补丁的由来）。
			// 现在插件**完全不碰 body.style、也不注册自己的覆盖层**，只用一条自有的
			// !important 样式规则参与层叠：important 的 author 声明压过一切非 important
			// 声明，因此开关始终说了算，而其它写入者各自的层互不干扰。
			const syncAttribute = (st) => {
				try {
					document.body.setAttribute('data-dsh-bg', st.enabled && st.current ? 'on' : 'off')
				} catch (e) { /* best-effort */ }
			}
			// 唯一的写入点：开=写入背景规则；关=清空规则（回到皮肤/主题自己的颜色）。
			const paintLive = (st) => {
				try {
					if (!st.enabled || !st.current) { liveEl.textContent = ''; return }
					liveEl.textContent = 'body[data-dsh-bg="on"]{'
						+ '--dsw-alias-bg-base:' + composeBg(st, scheme()) + ' !important;'
						+ '--dsw-specific-sidebar-fill:transparent !important;'
						+ '}'
				} catch (e) { /* best-effort */ }
			}
			const applyNow = (st) => {
				if (disposed) return
				try {
					syncAttribute(st) // live 规则以该属性为选择器
					paintLive(st)
				} catch (err) {
					console.error('[bg] apply failed:', err && err.message ? err.message : err)
				}
			}
			/** 关闭：清空自有规则并落 off 属性；不触碰任何共享 token 的写入。 */
			const restore = () => {
				try { liveEl.textContent = '' } catch (e) { /* best-effort */ }
				try { document.body.setAttribute('data-dsh-bg', 'off') } catch (e) { /* best-effort */ }
			}
			ctx.effect(() => () => { disposed = true; restore() })

			const serialize = (st) => ({
				version: 3,
				enabled: !!st.enabled,
				current: st.current,
				images: st.images,
				opacity: st.opacity,
				brightness: st.brightness,
				mask: st.mask,
				blur: st.blur,
				posX: st.posX,
				posY: st.posY,
				fit: st.fit,
			})
			const save = async (st) => {
				const res = await rpc('save', st === null ? null : serialize(st))
				return res && res.ok === true
			}
			const scheduleSave = timer !== undefined && typeof timer.debounce === 'function'
				? timer.debounce((st, cb) => { if (!disposed) save(st).then((ok) => { if (!disposed && cb) cb(ok) }) }, 600)
				: (st, cb) => { if (!disposed) save(st).then((ok) => { if (!disposed && cb) cb(ok) }) }

			const load = async () => {
				const res = await rpc('load')
				return res && res.ok ? res.data : null
			}
			const deleteImage = (id) => rpc('delete', { id })
			const scheme = () => {
				try {
					const snap = theme.getTheme()
					return snap && snap.active && snap.active.colorScheme ? snap.active.colorScheme : 'light'
				} catch (e) { return 'light' }
			}

			// Warm-start: apply the persisted background as soon as the plugin mounts,
			// so a page refresh restores it without opening settings.
			load().then((cfg) => {
				if (disposed) return
				if (cfg && cfg.version === 3) {
					const st = { ...DEFAULT_STATE }
					st.enabled = !!cfg.enabled
					st.current = cfg.current || null
					st.images = Array.isArray(cfg.images) ? cfg.images : []
					st.opacity = typeof cfg.opacity === 'number' ? cfg.opacity : st.opacity
					st.brightness = typeof cfg.brightness === 'number' ? cfg.brightness : st.brightness
					st.mask = typeof cfg.mask === 'number' ? cfg.mask : st.mask
					st.blur = typeof cfg.blur === 'number' ? cfg.blur : st.blur
					st.posX = POS_X.indexOf(cfg.posX) !== -1 ? cfg.posX : st.posX
					st.posY = POS_Y.indexOf(cfg.posY) !== -1 ? cfg.posY : st.posY
					st.fit = cfg.fit === 'contain' || cfg.fit === 'stretch' ? cfg.fit : 'cover'
					applyNow(st)
				}
			}).catch(() => {})

			const state = { ...DEFAULT_STATE, origin }
			syncAttribute(state)
			// 跟随明暗切换：只重画 !important 规则，不调用 overrideTokens（否则自触发 publish 成环）。
			if (typeof ctx.on === 'function') {
				ctx.on('theme/change', () => { if (!disposed) paintLive(state) })
			}
			try {
				slots.inject('settings.section', () => slots.register(
					{ name: 'settings.section', id: 'background', order: 12, label: () => '背景设置' },
					(props) => React.createElement(BackgroundPage, { state, applyNow, restore, scheduleSave, saveNow: save, load, deleteImage, upload, scheme }),
				))
			} catch (err) {
				console.warn('[bg] settings section registration failed: ' + (err && err.message ? err.message : err))
			}
			return true
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
