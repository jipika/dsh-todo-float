// dsh-todo-float — browser half.
//
// 目标：把会话里的「任务」清单从输入框上方的 dock（slot
// `conversation.input.dock`，官方 `@deepseek-ai/dsh-client-ui-conversation`
// 的 `conversation-todo-dock`）搬到会话右上角的**悬浮卡片**里，点击头部可
// 缩小 / 展开（形态参考 macOS 的「进程」浮动卡片）。
//
// 做法（零源码补丁）：
//   1. 往同一个 list slot 注册自己的条目 `todo-float`，渲染一个 fixed 定位的
//      卡片，贴住会话列右上角（JS 读取会话根元素的 rect，自动适配右侧栏 /
//      窗口尺寸）；
//   2. 注入一行 CSS 把官方那枚 dock 面板（`[data-testid="todo-panel"]`）隐藏，
//      于是「任务」只剩右上角这一份；
//   3. 数据仍取自同一份投影：slot 组件拿到的 keyed hook
//      `useProjection("todos")`（session scope 的 BUILTIN_SOURCE 提供），
//      所以任务更新、状态图标、进度文案都与官方一致。
//
// 回滚：删掉 profile `cordis.patch.yml` 里 id 为 `todo-float` 的 insert 行，
// 重启应用即可（官方 dock 面板立刻回来）。
window.__ModuleLoader__.load({
	id: "dsh-todo-float",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const ReactDOM = require("react-dom");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		const STYLE_ID = "dsh-todo-float-style";
		const STORAGE_KEY = "dsh-todo-float:expanded";
		const MODE_STORAGE_KEY = "dsh-todo-float:mode";
		const WIDTH_STORAGE_KEY = "dsh-todo-float:width";
		/** 展开态卡片宽度：拖动把手与存值都受这两条钳制。 */
		const MIN_CARD_WIDTH = 240;
		const MAX_CARD_WIDTH = 560;
		const DEFAULT_CARD_WIDTH = 320;
		/** `<html>` 上的模式标记：CSS 只在 card 模式下隐藏官方 dock 面板。 */
		const MODE_ATTR = "data-todo-float-mode";
		const MODE_CARD = "card";
		const MODE_LIST = "list";
		/** 会话头部高度（官方 headermin-height 76px）＋ 一点呼吸位。 */
		const HEADER_OFFSET = 84;

		const CSS = [
			".dsh-todo-float-root{position:fixed;z-index:60;display:flex;justify-content:flex-end;pointer-events:none}",
			".dsh-todo-float-card{pointer-events:auto;box-sizing:border-box;position:relative;width:320px;min-width:240px;max-width:min(560px,calc(100vw - 48px));background:var(--dsw-specific-menu,var(--dsw-alias-bg-base));border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.16));overflow:hidden;transition:width .16s ease,box-shadow .16s ease}",
			".dsh-todo-float-card[data-collapsed='true']{width:auto;min-width:0}",
			// 左边缘的竖直拖拽把手：卡片贴住右侧，所以往左拉 = 变宽
			".dsh-todo-float-resize{position:absolute;left:0;top:0;bottom:0;width:9px;cursor:ew-resize;touch-action:none;background:0 0}",
			".dsh-todo-float-resize::after{content:'';position:absolute;left:3px;top:50%;width:3px;height:30px;margin-top:-15px;border-radius:2px;background:var(--dsw-alias-border-l2);opacity:0;transition:opacity .15s ease,background .15s ease}",
			".dsh-todo-float-card:hover .dsh-todo-float-resize::after{opacity:1}",
			".dsh-todo-float-card[data-resizing='1']{transition:none;user-select:none;cursor:ew-resize}",
			".dsh-todo-float-card[data-resizing='1'] .dsh-todo-float-resize::after{opacity:1;background:var(--dsw-alias-state-business-primary)}",
			".dsh-todo-float-card:hover{box-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(0,0,0,.2))}",
			".dsh-todo-float-header{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:7px 12px;background:0 0;border:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}",
			".dsh-todo-float-header:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsh-todo-float-header:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}",
			".dsh-todo-float-lead{display:grid;place-items:center;flex:none;color:var(--dsw-alias-label-tertiary)}",
			".dsh-todo-float-title{flex:none;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
			".dsh-todo-float-progress{flex:auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:13px;font-weight:400}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-progress{font-variant-numeric:tabular-nums;flex:none}",
			".dsh-todo-float-chevron{display:grid;place-items:center;flex:none;color:var(--dsw-alias-label-tertiary)}",
			".dsh-todo-float-list{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;margin:0;padding:4px 12px 11px;list-style:none;max-height:min(240px,50vh);overflow-y:auto;overscroll-behavior:contain}",
			".dsh-todo-float-item{display:flex;align-items:flex-start;gap:8px;min-width:0;font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary)}",
			".dsh-todo-float-item[data-status='in_progress']{color:var(--dsw-alias-label-primary)}",
			".dsh-todo-float-item[data-status='completed'] .dsh-todo-float-content{color:var(--dsw-alias-label-tertiary)}",
			".dsh-todo-float-glyph{display:grid;place-items:center;flex:none;width:16px;height:16px;margin-top:1px}",
			".dsh-todo-float-glyph[data-status='completed']{color:var(--dsw-alias-state-success-primary)}",
			".dsh-todo-float-glyph[data-status='in_progress']{color:var(--dsw-alias-state-business-primary)}",
			".dsh-todo-float-glyph[data-status='pending']{color:var(--dsw-alias-label-caption)}",
			".dsh-todo-float-spin{animation:dsh-todo-float-spin 1s linear infinite}",
			"@keyframes dsh-todo-float-spin{to{transform:rotate(360deg)}}",
			".dsh-todo-float-content{min-width:0;overflow-wrap:anywhere}",
			"@media (prefers-reduced-motion:reduce){.dsh-todo-float-spin{animation:none}.dsh-todo-float-card{transition:none}}",
			"/* 卡片模式才隐藏官方 dock 面板；列表模式下这条不生效，官方那枚面板原样回来 */",
			"[" + MODE_ATTR + "='" + MODE_CARD + "'] [data-testid='todo-panel']{display:none !important}",
			"/* 设置 → 任务清单 */",
			".dsh-todo-float-settings{display:flex;flex-direction:column;gap:10px;padding:2px 0}",
			".dsh-todo-float-settings-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}",
			".dsh-todo-float-settings-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:-4px 0 2px}",
			".dsh-todo-float-option{box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;width:100%;padding:10px 12px;background:0 0;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;color:inherit;font:inherit;text-align:left;cursor:pointer}",
			".dsh-todo-float-option:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsh-todo-float-option:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}",
			".dsh-todo-float-option[data-active='true']{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}",
			".dsh-todo-float-option-mark{display:grid;place-items:center;flex:none;width:16px;height:16px;margin-top:2px;color:var(--dsw-alias-state-business-primary)}",
			".dsh-todo-float-option-body{display:flex;flex-direction:column;gap:2px;min-width:0}",
			".dsh-todo-float-option-title{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}",
			".dsh-todo-float-option-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}"
		].join("");

		/**
		 * Inject the stylesheet once (module side effects stay inside the
		 * factory, which materializes on first import — same discipline as the
		 * official client bundles).
		 */
		function ensureStyle() {
			if (document.getElementById(STYLE_ID)) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		/** Read the remembered expanded/collapsed choice; expanded by default. */
		function readExpanded() {
			try {
				const stored = window.localStorage.getItem(STORAGE_KEY);
				return stored === null ? true : stored === "1";
			} catch {
				return true;
			}
		}

		/** Read the remembered card width, clamped to the allowed range. */
		function readWidth() {
			try {
				const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
				if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_CARD_WIDTH;
				return Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.round(stored)));
			} catch {
				return DEFAULT_CARD_WIDTH;
			}
		}

		/** The widest the card may get right now (viewport-aware). */
		function maxWidthNow() {
			try {
				return Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, window.innerWidth - 48));
			} catch {
				return MAX_CARD_WIDTH;
			}
		}

		/**
		 * Display mode: `card` = 右上角悬浮卡片（默认），`list` = 官方输入框上方清单。
		 * 一个模块级的极小 store：卡片组件与设置页组件订阅它，切换即时生效；
		 * 选择落在 localStorage，并镜像到 `<html data-todo-float-mode>` 供 CSS 判定。
		 */
		const modeListeners = new Set();
		let currentMode = readMode();

		/** Read the remembered display mode; card by default. */
		function readMode() {
			try {
				return window.localStorage.getItem(MODE_STORAGE_KEY) === MODE_LIST ? MODE_LIST : MODE_CARD;
			} catch {
				return MODE_CARD;
			}
		}

		/** Mirror the mode onto <html> so the stylesheet can gate the built-in panel. */
		function applyModeAttribute() {
			document.documentElement.setAttribute(MODE_ATTR, currentMode);
		}

		function getMode() {
			return currentMode;
		}

		function setMode(next) {
			const value = next === MODE_LIST ? MODE_LIST : MODE_CARD;
			if (value === currentMode) return;
			currentMode = value;
			try {
				window.localStorage.setItem(MODE_STORAGE_KEY, value);
			} catch {}
			applyModeAttribute();
			for (const listener of [...modeListeners]) listener();
		}

		function subscribeMode(listener) {
			modeListeners.add(listener);
			return () => {
				modeListeners.delete(listener);
			};
		}

		/** Header summary: "·"-joined per-status counts, mirroring the built-in panel. */
		function progressLabel(todos, compact) {
			const done = todos.filter((item) => item.status === "completed").length;
			const active = todos.filter((item) => item.status === "in_progress").length;
			const pending = todos.length - done - active;
			if (compact) return `${done}/${todos.length}`;
			return [
				...(done > 0 ? [`${done} 已完成`] : []),
				...(active > 0 ? [`${active} 进行中`] : []),
				...(pending > 0 ? [`${pending} 待处理`] : [])
			].join(" · ");
		}

		/** Status glyph: check for done, spinning ring for active, dotted ring for pending. */
		function StatusGlyph({ status }) {
			if (status === "completed") {
				return h(primitives.IconCheckOutline14, {});
			}
			if (status === "in_progress") {
				return h(
					"svg",
					{ className: "dsh-todo-float-spin", width: 12, height: 12, viewBox: "0 0 12 12", "aria-hidden": true },
					h("circle", { cx: 6, cy: 6, r: 4.8, fill: "none", stroke: "currentColor", strokeOpacity: 0.25, strokeWidth: 1.4 }),
					h("path", { d: "M6 1.2a4.8 4.8 0 0 1 4.8 4.8", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" })
				);
			}
			return h("svg", { width: 12, height: 12, viewBox: "0 0 12 12", "aria-hidden": true },
				h("circle", { cx: 6, cy: 6, r: 4.8, fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeDasharray: "2.4 2.4" })
			);
		}

		/**
		 * The floating card: registers into the session-scoped `conversation.input.dock`
		 * list slot (so it receives the session binding hooks) but positions itself
		 * fixed against the session column's top-right corner.
		 */
		function TodoFloat({ useProjection }) {
			const todos = useProjection("todos") ?? [];
			const mode = React.useSyncExternalStore(subscribeMode, getMode, getMode);
			const [expanded, setExpanded] = React.useState(readExpanded);
			const [width, setWidth] = React.useState(readWidth);
			const rootRef = React.useRef(null);
			const anchorRef = React.useRef(null);

			React.useEffect(() => {
				try {
					window.localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0");
				} catch {}
			}, [expanded]);

			React.useEffect(() => {
				try {
					window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(width)));
				} catch {}
			}, [width]);

			/**
			 * 拖动左边缘调宽：卡片贴住右侧，所以鼠标左移 = 变宽。
			 * 拖动期间直接改 DOM（不走 state）避免每帧重渲染，松手才落 state 并持久化。
			 */
			const startResize = (event) => {
				if (event.button !== undefined && event.button !== 0) return;
				const card = event.currentTarget.parentElement;
				if (card === null) return;
				event.preventDefault();
				event.stopPropagation();
				const startX = event.clientX;
				const startWidth = card.getBoundingClientRect().width;
				const min = MIN_CARD_WIDTH;
				const max = maxWidthNow();
				let last = Math.round(startWidth);
				card.setAttribute("data-resizing", "1");
				const onMove = (moveEvent) => {
					last = Math.round(Math.min(max, Math.max(min, startWidth + (startX - moveEvent.clientX))));
					card.style.width = last + "px";
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
					card.removeAttribute("data-resizing");
					setWidth(last);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
			};

			// Placement: pinned to the session column's top-right corner, and
			// recomputed when that column resizes (right sidebar toggles, window
			// resize, panel drags).
			React.useLayoutEffect(() => {
				const node = rootRef.current;
				if (node === null) return;
				// The card is portalled out of the conversation subtree, so the real
				// session column is found through the zero-size anchor that stays in
				// the dock slot. `[data-slot]` wrappers are zero-sized, so measure the
				// scroll column (`data-conversation-scroll`) and the session header
				// (`data-conversation-header-corner`) — that makes the card dodge the
				// right sidebar and sit right below the header.
				const anchor = anchorRef.current;
				const column = anchor === null ? null : anchor.closest('[data-conversation-scroll]');
				const place = () => {
					const columnRect = column === null ? null : column.getBoundingClientRect();
					const usableColumn = columnRect !== null && columnRect.width > 0;
					let headerBottom = null;
					for (const corner of document.querySelectorAll('[data-conversation-header-corner]')) {
						const cornerRect = corner.getBoundingClientRect();
						if (cornerRect.height <= 0) continue;
						const header = corner.closest("header");
						const headerRect = header === null ? null : header.getBoundingClientRect();
						if (headerRect !== null && headerRect.height > 0) {
							headerBottom = headerRect.bottom;
							break;
						}
					}
					node.style.top = `${Math.round(headerBottom !== null ? headerBottom + 12 : usableColumn ? columnRect.top + 16 : HEADER_OFFSET)}px`;
					node.style.right = `${Math.round(usableColumn ? Math.max(12, window.innerWidth - columnRect.right + 16) : 20)}px`;
				};
				place();
				const observer = typeof ResizeObserver === "function" && column !== null
					? new ResizeObserver(place)
					: null;
				if (observer !== null) observer.observe(column);
				window.addEventListener("resize", place);
				return () => {
					window.removeEventListener("resize", place);
					if (observer !== null) observer.disconnect();
				};
			}, [todos.length]);

			if (todos.length === 0 || mode !== MODE_CARD) return null;

			const label = progressLabel(todos, !expanded);
			// The card is portalled to <body>: inside the composer subtree it sat in
			// that stacking context and the conversation width handle (z-index 8)
			// swallowed every click on it. A hidden anchor stays in the dock so the
			// placement effect can still measure the session column.
			const card = h(
				"div",
				{ ref: rootRef, className: "dsh-todo-float-root", "data-testid": "todo-float" },
				h(
					"section",
					{
						className: "dsh-todo-float-card",
						"data-collapsed": String(!expanded),
						"aria-label": "任务",
						title: progressLabel(todos, false),
						// 展开态用 state 里的宽度；拖动期间直接改 DOM，松手回写 state
						style: expanded ? { width: width + "px" } : undefined
					},
					expanded && h("div", {
						className: "dsh-todo-float-resize",
						role: "separator",
						"aria-orientation": "vertical",
						"aria-label": "拖动调整宽度",
						title: "拖动调整宽度（最小 " + MIN_CARD_WIDTH + "px / 最大 " + MAX_CARD_WIDTH + "px）",
						onPointerDown: startResize
					}),
					h(
						"button",
						{
							type: "button",
							className: "dsh-todo-float-header",
							"aria-expanded": expanded,
							onClick: () => setExpanded((value) => !value)
						},
						h("span", { className: "dsh-todo-float-lead", "aria-hidden": true }, h(primitives.IconChecklistOutline14, {})),
						h("span", { className: "dsh-todo-float-title" }, "任务"),
						h("span", { className: "dsh-todo-float-progress" }, label),
						h(
							"span",
							{ className: "dsh-todo-float-chevron", "aria-hidden": true },
							expanded ? h(primitives.IconChevronUpOutline14, {}) : h(primitives.IconChevronDownOutline14, {})
						)
					),
					expanded && h(
						"ul",
						{ className: "dsh-todo-float-list" },
						todos.map((item) => h(
							"li",
							{ key: item.content, className: "dsh-todo-float-item", "data-status": item.status },
							h("span", { className: "dsh-todo-float-glyph", "data-status": item.status, "aria-hidden": true }, h(StatusGlyph, { status: item.status })),
							h("span", { className: "dsh-todo-float-content" }, item.content)
						))
					)
				)
			);

			return h(
				React.Fragment,
				null,
				h("span", {
					ref: anchorRef,
					"data-todo-float-anchor": "",
					"aria-hidden": true,
					style: { display: "none" }
				}),
				ReactDOM.createPortal(card, document.body)
			);
		}

		/** 设置 →「任务清单」：列表模式 / 卡片模式二选一，切换即时生效。 */
		function TodoFloatSettings() {
			const mode = React.useSyncExternalStore(subscribeMode, getMode, getMode);
			const options = [
				{
					value: MODE_CARD,
					title: "卡片模式（右上角悬浮）",
					desc: "任务显示在会话右上角的悬浮卡片里，点卡片头部可收起 / 展开。"
				},
				{
					value: MODE_LIST,
					title: "列表模式（输入框上方）",
					desc: "恢复 DSH 原来的样式：任务显示在输入框上方的清单面板里。"
				}
			];
			return h(
				"div",
				{ className: "dsh-todo-float-settings" },
				h("div", { className: "dsh-todo-float-settings-title" }, "任务清单显示模式"),
				h("div", { className: "dsh-todo-float-settings-desc" }, "切换后立即生效，选择保存在本机（localStorage）。"),
				options.map((option) => {
					const active = mode === option.value;
					return h(
						"button",
						{
							key: option.value,
							type: "button",
							role: "radio",
							"aria-checked": active,
							"data-active": String(active),
							"data-testid": `todo-float-mode-${option.value}`,
							className: "dsh-todo-float-option",
							onClick: () => setMode(option.value)
						},
						h(
							"span",
							{ className: "dsh-todo-float-option-mark", "aria-hidden": true },
							active ? h(primitives.IconCheckOutline14, {}) : null
						),
						h(
							"span",
							{ className: "dsh-todo-float-option-body" },
							h("span", { className: "dsh-todo-float-option-title" }, option.title),
							h("span", { className: "dsh-todo-float-option-desc" }, option.desc)
						)
					);
				})
			);
		}

		/** Browser half entry: waiting on the conversation plugin's dock slot. */
		function apply(ctx) {
			ensureStyle();
			applyModeAttribute();
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "todo-float",
				order: 50
			}, TodoFloat));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "todo-float",
				order: 50,
				label: () => "任务清单"
			}, TodoFloatSettings));
		}

		exports.name = "dsh-todo-float";
		exports.inject = ["slots"];
		exports.apply = apply;
		return module.exports;
	}
});
