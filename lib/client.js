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
		// v2：默认态从「展开」改为「mini（收起）」。键名升级 = 旧的展开选择不再沿用，
		// 所有人回到新的默认态；之后仍然记住用户自己点出来的选择。
		const STORAGE_KEY = "dsh-todo-float:expanded.v2";
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
		/** mini（收起）胶囊的设计高度：header 上下 7px padding + 20px 行高 + 上下 0.5px 边框。 */
		const MINI_CARD_HEIGHT = 35;

		const CSS = [
			".dsh-todo-float-root{position:fixed;z-index:60;display:flex;justify-content:flex-end;pointer-events:none}",
			// 卡片底色：先用不透明的 bg-base 打底，再把当前主题的菜单色叠上去。菜单 token 在不少主题里带 alpha
			// （宿主默认就是 rgba(...,.94)），单独用它会让卡片透出后面的会话内容。
			// mini（收起）态的宽度上限 = 用户在展开态拖出来的宽度（组件把
			// --dsh-todo-float-card-width 内联写死在卡片上）：短任务仍收缩成窄胶囊，
			// 长任务最多长到展开宽度，不会再出现「mini 比展开还宽」。
			".dsh-todo-float-card{pointer-events:auto;box-sizing:border-box;position:relative;width:320px;min-width:240px;max-width:min(var(--dsh-todo-float-card-width,320px),calc(100vw - 48px));background-color:var(--dsw-alias-bg-base,var(--dsw-specific-menu));background-image:linear-gradient(var(--dsw-specific-menu,transparent),var(--dsw-specific-menu,transparent));border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.16));overflow:hidden;transition:width .24s cubic-bezier(.22,.61,.36,1),box-shadow .16s ease}",
			".dsh-todo-float-card[data-collapsed='true']{width:auto;min-width:0}",
			// 展开 / 收起：外层 grid 的行高在 1fr 与 0fr 之间过渡，列表常驻 DOM、高度自动量出，
			// 不用写死像素高度。收起后再用 visibility 把内容移出可聚焦集合（延迟到动画结束）。
			".dsh-todo-float-body{display:grid;grid-template-rows:1fr;overflow:hidden;transition:grid-template-rows .24s cubic-bezier(.22,.61,.36,1),opacity .2s ease,visibility 0s}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-body{grid-template-rows:0fr;opacity:0;visibility:hidden;width:0;transition:grid-template-rows .24s cubic-bezier(.22,.61,.36,1),opacity .2s ease,visibility 0s linear .24s}",
			".dsh-todo-float-body>.dsh-todo-float-list{min-height:0;transition:padding .24s cubic-bezier(.22,.61,.36,1)}",
			// 收起态把列表自身的上下内边距一起收掉：否则行高归零后仍会留下 4+11 的空白条
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-list{padding-top:0;padding-bottom:0}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-resize{display:none}",
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
			// mini 态全部完成时：对勾走成功色，一眼能看出「都做完了」
			".dsh-todo-float-lead[data-done='true']{color:var(--dsw-alias-state-success-primary)}",
			".dsh-todo-float-title{flex:none;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
			".dsh-todo-float-progress{flex:auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:13px;font-weight:400}",
			// mini（收起）态：只留「→ + 当前任务」一条窄胶囊，标签与箭头都收掉，
			// 任务名过长时省略号截断（悬停的 title 里有完整进度）。
			// 进度文本不再自带宽度上限：mini 的宽度上限只能是卡片自己的 max-width
			// （= 展开态拖出来的宽度）。留着 340px / 52vw 这条，收紧展开宽度后
			// mini 仍会按独立上限变宽 —— 就是「mini 比展开还宽」的来源。
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-title{display:none}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-chevron{display:none}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-progress{flex:auto;min-width:0;max-width:none}",
			".dsh-todo-float-chevron{display:grid;place-items:center;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .24s cubic-bezier(.22,.61,.36,1)}",
			// 常驻一枚向下箭头，展开态整体转 180° —— 折叠/展开时看得见方向变化，而不是瞬间换图标
			".dsh-todo-float-card:not([data-collapsed='true']) .dsh-todo-float-chevron{transform:rotate(180deg)}",
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
			"@media (prefers-reduced-motion:reduce){.dsh-todo-float-spin{animation:none}.dsh-todo-float-card,.dsh-todo-float-body,.dsh-todo-float-chevron{transition:none}}",
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
			let style = document.getElementById(STYLE_ID);
			if (style === null) {
				style = document.createElement("style");
				style.id = STYLE_ID;
				document.head.appendChild(style);
			}
			// 每次都写入当前版本的样式：client 插件被热重载时，旧 <style> 还挂在 head 上，
			// 只创建不更新会让「新的渲染逻辑 + 旧的 CSS」一起跑（表现为收起态只变窄、
			// 列表却收不起来）。
			if (style.textContent !== CSS) style.textContent = CSS;
		}

		/** Read the remembered expanded/collapsed choice; mini（收起）是默认态。 */
		function readExpanded() {
			try {
				const stored = window.localStorage.getItem(STORAGE_KEY);
				return stored === null ? false : stored === "1";
			} catch {
				return false;
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
				return h(primitives.IconCheckOutlineRegular, {});
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

			/* diag: write runtime truth to localStorage so the agent can read
			 * it from disk (leveldb strings) without DevTools/screenshots. */
			React.useEffect(() => {
				try {
					const node = rootRef.current;
					const rect = node === null ? null : node.getBoundingClientRect();
					const probe = { at: new Date().toISOString(), fn: typeof useProjection, todosLen: todos.length, mode, hasRoot: node !== null };
					if (rect) probe.rect = { top: Math.round(rect.top), right: Math.round(rect.right), w: Math.round(rect.width), h: Math.round(rect.height) };
					const corner = document.querySelector('[data-conversation-header-corner]');
					if (corner) { const cr = corner.getBoundingClientRect(); probe.corner = { h: Math.round(cr.height), w: Math.round(cr.width) }; }
					const scroller = document.querySelector('[data-conversation-scroll]');
					probe.scrollerFound = scroller !== null;
					if (scroller) { const sr = scroller.getBoundingClientRect(); probe.scroller = { top: Math.round(sr.top), right: Math.round(sr.right), w: Math.round(sr.width) }; }
					window.localStorage.setItem("dsh-todo-float:diag", JSON.stringify(probe));
				} catch {}
			});

			/* 订阅自愈：`useProjection("todos")` 在长连接重连后可能不再触发重渲染
			 * （实测 host 侧 todo/write 事件齐全，而本组件数分钟不渲染、todosLen
			 * 恒为 0；同一时刻 inbox 投影实时正常）。这里只在「当前读到 0 条」时
			 * 做 2s 低频强制刷新——一旦确实有 todo 就立刻停，不常驻开销。 */
			const [, forceTick] = React.useState(0);
			React.useEffect(() => {
				if (todos.length > 0) return void 0;
				const timer = window.setInterval(() => {
					forceTick((n) => n + 1);
				}, 2000);
				return () => window.clearInterval(timer);
			}, [todos.length]);

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
					// max-width 也读这枚变量：不同步的话，拖宽时旧 max-width 会把卡片卡住
					card.style.setProperty("--dsh-todo-float-card-width", last + "px");
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

			// Placement: pinned to the session column's top-right corner. When the
			// session header shows its view tab row (对话/轨迹/上下文, marked
			// `data-conversation-tabs`), the card joins THAT row's right side — the
			// empty stretch to the right of the tab buttons — instead of hanging
			// below it; the 3px nudge optically centers the mini pill against the
			// tab buttons. Without a tab row (single-view sessions, hideChrome) it
			// falls back to sitting just below the header. Recomputed when the
			// column resizes (right sidebar toggles, window resize, panel drags)
			// and whenever the card re-renders with a different size state.
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
					const right = `${Math.round(usableColumn ? Math.max(12, window.innerWidth - columnRect.right + 16) : 20)}px`;
					const tabsRow = document.querySelector('[data-conversation-tabs]');
					if (tabsRow !== null) {
						const tabsRect = tabsRow.getBoundingClientRect();
						if (tabsRect.height > 0) {
							// 量第一个 tab 按钮而不是整行:行 rect 带上下 padding,直接用
							// 它会让胶囊比按钮低一截。mini 胶囊与按钮垂直居中;展开态
							// 从按钮顶边往下伸(MINI_CARD_HEIGHT = 7+7 padding + 20 行高 + 1 边框)。
							const firstTab = tabsRow.querySelector('[role="tab"]');
							const buttonRect = firstTab !== null ? firstTab.getBoundingClientRect() : tabsRect;
							const lift = expanded ? 0 : Math.max(0, (buttonRect.height - MINI_CARD_HEIGHT) / 2);
							node.style.top = `${Math.round(buttonRect.top + lift)}px`;
							node.style.right = right;
							return;
						}
					}
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
					node.style.right = right;
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
			}, [todos.length, expanded]);

			if (todos.length === 0 || mode !== MODE_CARD) return null;

			const label = progressLabel(todos, false);
			// mini（收起）态只显示「正在做的那一条」：优先 in_progress，其次第一条未完成的，
			// 都没有则退回进度摘要。收起态因此是一条窄胶囊，而不是把整张清单挤扁。
			const activeItem = todos.find((item) => item.status === "in_progress")
				|| todos.find((item) => item.status !== "completed");
			const doneCount = todos.filter((item) => item.status === "completed").length;
			const allDone = doneCount === todos.length;
			// 全做完时不能只剩一个光秃秃的 「5/5」：给一句带语义的收尾文案
			const compactLabel = activeItem
				? activeItem.content
				: (allDone ? "全部完成 " + doneCount + "/" + todos.length : progressLabel(todos, true));
			// mini 态的字形：在做 → 箭头；全做完 → 对勾（成功色）
			const leadGlyph = expanded
				? h(primitives.IconChecklistOutlineRegular, {})
				: allDone
					? h(primitives.IconCheckOutlineRegular, {})
					: h("svg", {
						width: 12, height: 12, viewBox: "0 0 12 12", fill: "none",
						"aria-hidden": true
					}, h("path", {
						d: "M2 6h7.2M6.6 3.2 9.4 6l-2.8 2.8",
						stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round"
					}));
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
						// 宽度 state 始终以 CSS 变量挂在卡片上（mini 态的 max-width 也读它），
						// 展开态再额外写死 width。拖动期间直接改 DOM，松手回写 state。
						style: expanded
							? { width: width + "px", "--dsh-todo-float-card-width": width + "px" }
							: { "--dsh-todo-float-card-width": width + "px" }
					},
					h("div", {
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
						h("span", {
							className: "dsh-todo-float-lead",
							"aria-hidden": true,
							"data-done": !expanded && allDone ? "true" : undefined
						}, leadGlyph),
						h("span", { className: "dsh-todo-float-title" }, "任务"),
						h("span", { className: "dsh-todo-float-progress" }, expanded ? label : compactLabel),
						h(
							"span",
							{ className: "dsh-todo-float-chevron", "aria-hidden": true },
							h(primitives.IconChevronDownOutlineRegular, {})
						)
					),
					h(
						"div",
						{ className: "dsh-todo-float-body" },
						h(
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
							active ? h(primitives.IconCheckOutlineRegular, {}) : null
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
			/* 设置入口 = 「内置插件」页里本插件的 per-plugin tab：
			 * settings.plugins.tab 按插件清单行 id 用 { only: row.id } 过滤渲染。 */
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "dsh-todo-float",
				order: 10,
				label: () => "任务清单"
			}, TodoFloatSettings));
		}

		exports.name = "dsh-todo-float";
		exports.inject = ["slots"];
		exports.apply = apply;
		return module.exports;
	}
});
