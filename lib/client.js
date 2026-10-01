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
//      `useProjection("todos")`（session scope 的 BUILTIN_SOURCE 提供）。
//
// 设计规范：所有视觉量都取自全局，不自造档位。
//   · 文案走官方 i18n：注册时声明 `locale: "conversation"`，框架把官方 `t`
//     注进组件 props，于是标题 / 进度 / 状态名与官方清单逐字一致，并跟随
//     「设置 → 界面语言」；本插件独有的文案注册在自己的 `todoFloat` 命名空间。
//   · 表面 = 官方 TodoPanel 的三层写法：`--dsw-alias-bg-base` 打不透明底 +
//     `--dsw-specific-menu` 叠主题色 + `--dsw-menu-backdrop-filter`，边缘走
//     `--dsw-elevation-stroke-color` + `--dsw-elevation-prominent`（不再自写
//     rgba 阴影兜底，也不再用 .5px border 造第二套边）。
//   · 行量 = 官方：header/body gap 10px、标题 13·500·24、进度 13/20、内衬
//     上下 6px 左右 12px、列表 max-height 180px、任务名单行省略号；字号一律
//     `--dsw-font-xs-13` / `--dsw-font-xs-strong-13`（不写散装 font-size+line-height）。
//   · 状态图标 = 官方 `StateDot`（primitives 导出），done/ongoing/idle 三档走
//     与官方 `statusDotState()` 同一映射，颜色与 reduced-motion 都由组件自带 ——
//     不再手画 spinner / 虚线圆，也不再自己覆盖 success 色。
//   · 键盘焦点 = 官方 `--dsw-focus-ring-width` / `--dsw-focus-ring-color`。
//   · 动效时长 = 官方档位（120ms hover / 160ms 位移 + `ease`），不设自定义贝塞尔。
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
		/** 官方命名空间：标题 / 进度 / 状态名逐字复用宿主字典。 */
		const CONVERSATION_NS = "conversation";
		/** 本插件独有文案的命名空间。 */
		const LOCALE_NS = "todoFloat";
		const zh = {
			"float.aria.resize": "拖动调整宽度",
			"float.aria.toggle": "展开或收起任务清单",
			"float.doneAll": "全部完成 {done}/{total}",
			"settings.tab": "任务清单",
			"settings.title": "任务清单显示模式",
			"settings.desc": "切换后立即生效，选择保存在本机。",
			"settings.mode.card": "卡片（右上角悬浮）",
			"settings.mode.list": "列表（输入框上方）",
			"settings.mode.card.title": "任务显示在会话右上角的悬浮卡片里，点卡片头部可收起 / 展开。",
			"settings.mode.list.title": "恢复 DSH 原来的样式：任务显示在输入框上方的清单面板里。"
		};
		const en = {
			"float.aria.resize": "Drag to resize",
			"float.aria.toggle": "Expand or collapse the to-do list",
			"float.doneAll": "All done {done}/{total}",
			"settings.tab": "To-dos",
			"settings.title": "To-do list display",
			"settings.desc": "Applies immediately; the choice is stored on this machine.",
			"settings.mode.card": "Card (floating, top right)",
			"settings.mode.list": "List (above the input)",
			"settings.mode.card.title": "Shows to-dos in a floating card at the top-right of the session; click its header to collapse or expand.",
			"settings.mode.list.title": "Restores the original DSH style: to-dos in the panel above the input box."
		};
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
		/** 会话头部高度（官方 header min-height 76px）＋ 一点呼吸位，仅兜底用。 */
		const HEADER_OFFSET = 84;
		/**
		 * mini（收起）胶囊高度的**兜底值**：内衬上下各 6px + 进度行 20px（收起态 title
		 * 被 `display:none`，可见行只剩 progress）。定位时优先量真实的 header + 内衬，
		 * 只有量不到（尚未布局）才用这里，因此字体档位或内衬变化都不会让胶囊偏位。
		 */
		const MINI_CARD_HEIGHT = 32;

		/**
		 * 卡片层级：必须低于官方 overlay 层。
		 *
		 * 官方 shell 把所有插件弹窗 / overlay 统一挂在
		 * `div.P9Gu9a_overlayLayer{position:absolute;z-index:20}`（里面有
		 * `[data-slot="shell.overlay"]`），而它自己是 `<body>` 下的普通 div ——
		 * 也就是说任何一个挂在 overlay 里的弹窗（不管内部写 200 还是 1000），
		 * 有效层级都被封顶在 **20**。
		 *
		 * 卡片 portal 到 `<body>`，所以 z-index 直接和 overlayLayer 的 20 在同一层
		 * 比较：写 60 就会压住所有插件弹窗（实测「上下文洞察」面板被胶囊盖住）。
		 * 取 15 —— 高于会话内元素（官方会话内最高 10）又留出与 overlay 层的安全间距。
		 */
		const CARD_Z_INDEX = 15;

		const CSS = [
			".dsh-todo-float-root{position:fixed;z-index:" + CARD_Z_INDEX + ";display:flex;justify-content:flex-end;pointer-events:none}",
			// 表面三层 + 描边走 elevation：与官方 TodoPanel.module.css 的 root 同一组声明。
			// `--dsw-specific-menu` 在多数主题里带 alpha，所以先由 bg-base 打不透明底；
			// 描边用 `--dsw-elevation-stroke-color`（官方浮层的边都这么画，描边在阴影里、
			// 不占布局），不再叠一条 .5px border。官方浮层 hover 不换阴影档位，所以这里
			// 也不写 :hover{box-shadow} 那条同值声明。
			".dsh-todo-float-card{pointer-events:auto;box-sizing:border-box;position:relative;width:320px;min-width:240px;max-width:min(var(--dsh-todo-float-width,320px),calc(100vw - 48px));border:0;border-radius:var(--dsw-radius-lg);background-color:var(--dsw-alias-bg-base);background-image:linear-gradient(var(--dsw-specific-menu,transparent),var(--dsw-specific-menu,transparent));backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);overflow:hidden;transition:width 160ms ease}",
			".dsh-todo-float-card[data-collapsed='true']{width:auto;min-width:0}",
			// 展开 / 收起：外层 grid 的行高在 1fr 与 0fr 之间过渡，列表常驻 DOM、高度自动量出，
			// 不用写死像素高度。收起后再用 visibility 把内容移出可聚焦集合（延迟到动画结束）。
			".dsh-todo-float-body{display:grid;grid-template-rows:1fr;overflow:hidden;transition:grid-template-rows 160ms ease,opacity 120ms ease,visibility 0s}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-body{grid-template-rows:0fr;opacity:0;visibility:hidden;width:0;transition:grid-template-rows 160ms ease,opacity 120ms ease,visibility 0s linear 160ms}",
			".dsh-todo-float-body>.dsh-todo-float-list{min-height:0}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-resize{display:none}",
			// 左边缘的竖直拖拽把手：几何与光标沿用官方宽度把手那档（8px / col-resize /
			// touch-action:none / 透明底），可见条只在 hover 或拖动时出现。
			".dsh-todo-float-resize{position:absolute;left:0;top:0;bottom:0;width:8px;cursor:col-resize;touch-action:none;border:0;background:0 0}",
			".dsh-todo-float-resize::after{content:'';position:absolute;left:3px;top:50%;width:2px;height:28px;margin-top:-14px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-border-l2);opacity:0;transition:opacity 120ms ease,background 120ms ease}",
			".dsh-todo-float-card:hover .dsh-todo-float-resize::after{opacity:1}",
			".dsh-todo-float-card[data-resizing='1']{transition:none;user-select:none;cursor:col-resize}",
			".dsh-todo-float-card[data-resizing='1'] .dsh-todo-float-resize::after{opacity:1;background:var(--dsw-alias-state-business-primary)}",
			// 头部行与列表都在 `.dsh-todo-float-inner` 里，内衬与行间距逐字取自官方 body
			// （padding 6px 12px / gap 8px）：官方 header 自己 `padding:0`、也不加 hover 底色，
			// 所以这里同样不给 header 造第二套内衬与 hover 填充。
			".dsh-todo-float-inner{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:6px 12px;transition:gap 160ms ease}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-inner{gap:0}",
			".dsh-todo-float-header{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:0;background:0 0;border:none;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}",
			// 焦点环走官方 dock 按钮那档：内描边（卡片 overflow:hidden 会裁掉外扩的 outline）。
			".dsh-todo-float-header:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px;border-radius:var(--dsw-radius-sm)}",
			".dsh-todo-float-lead{display:grid;place-items:center;flex:none;color:var(--dsw-alias-label-tertiary);transition:color 120ms ease}",
			// mini 态全部完成时：对勾走成功色，一眼能看出「都做完了」
			".dsh-todo-float-lead[data-done='true']{color:var(--dsw-alias-state-success-primary)}",
			".dsh-todo-float-title{flex:none;font:var(--dsw-font-xs-strong-13);line-height:24px;color:var(--dsw-alias-label-primary)}",
			".dsh-todo-float-progress{flex:auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);transition:color 120ms ease}",
			// mini（收起）态：只留「→ + 当前任务」一条窄胶囊，标签与箭头都收掉，
			// 任务名过长时省略号截断（悬停的 title 里有完整进度）。
			// 进度文本不再自带宽度上限：mini 的宽度上限只能是卡片自己的 max-width
			// （= 展开态拖出来的宽度）。留着独立上限的话，收紧展开宽度后 mini 仍会变宽
			// —— 就是「mini 比展开还宽」的来源。
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-title{display:none}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-chevron{display:none}",
			".dsh-todo-float-card[data-collapsed='true'] .dsh-todo-float-progress{flex:auto;min-width:0;max-width:none}",
			".dsh-todo-float-chevron{display:grid;place-items:center;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform 160ms ease,color 120ms ease}",
			// 常驻一枚向下箭头，展开态整体转 180° —— 折叠/展开时看得见方向变化，而不是瞬间换图标
			".dsh-todo-float-card:not([data-collapsed='true']) .dsh-todo-float-chevron{transform:rotate(180deg)}",
			// 可点反馈走官方 DisclosureRow（宿主自己的展开/收起行）那一档：**只改颜色、
			// 不动几何**。刻意不用 hover 底色 + 内边距：那会让行盒长高几像素，而 mini 胶囊
			// 的垂直居中按头部高度算，hover 前后就会跟 tab 按钮错位。
			// 必须写在上面三条基础色规则**之后**（同特异性靠书写顺序决胜）；外层 `:where()`
			// 把特异性压到 (0,1,0)，全完成态的 `.lead[data-done='true']` 成功色 (0,2,0) 才不会被盖掉。
			":where(.dsh-todo-float-header:hover) .dsh-todo-float-lead,:where(.dsh-todo-float-header:hover) .dsh-todo-float-progress,:where(.dsh-todo-float-header:hover) .dsh-todo-float-chevron{color:var(--dsw-alias-label-secondary)}",
			// 列表：内衬与行间距都由 `.dsh-todo-float-inner` 给出，所以 list 自身
			// padding:0 —— 与官方 `.w9rwOa_list{gap:8px;max-height:180px;padding:0}` 逐字同量。
			".dsh-todo-float-list{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;max-height:180px;overflow-y:auto;overscroll-behavior:contain}",
			// 行色 = 官方：整条 secondary，完成态只是内容转 tertiary（官方 root 上
			// **没有**任何按 data-status 改文字色的规则，进行中靠 StateDot 的 ongoing
			// 动画表达），所以这里不再自造 in_progress 提亮那一档。
			".dsh-todo-float-item{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-width:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}",
			".dsh-todo-float-item[data-status='completed'] .dsh-todo-float-content{color:var(--dsw-alias-label-tertiary)}",
			// 字形盒 16×16（官方 glyph），StateDot 自己带颜色与 reduced-motion 处理
			".dsh-todo-float-glyph{display:grid;place-items:center;flex:none;width:16px;height:16px}",
			// 任务名单行省略号：与官方 content 一致（长任务在胶囊/卡片里都只占一行）
			".dsh-todo-float-content{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}",
			"@media (prefers-reduced-motion:reduce){.dsh-todo-float-card,.dsh-todo-float-body,.dsh-todo-float-inner,.dsh-todo-float-chevron,.dsh-todo-float-resize::after{transition:none}}",
			"/* 卡片模式才隐藏官方 dock 面板；列表模式下这条不生效，官方那枚面板原样回来 */",
			"[" + MODE_ATTR + "='" + MODE_CARD + "'] [data-testid='todo-panel']{display:none !important}",
			"/* 设置 → 任务清单：行量取自官方 settings 行（EnterBehaviorRow 那一档） */",
			".dsh-todo-float-settings{display:flex;flex-direction:column}",
			".dsh-todo-float-settings-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}",
			".dsh-todo-float-settings-text{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;padding-right:48px}",
			".dsh-todo-float-settings-title{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}",
			".dsh-todo-float-settings-desc{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}",
			".dsh-todo-float-settings-note{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:12px 0 0}"
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

		/**
		 * Header summary: "·"-joined per-status counts, built from the official
		 * `conversation` dictionary (`todo.progress.*`) — same keys, same wording,
		 * same zero-count-as-noise rule as the built-in panel.
		 */
		function progressLabel(todos, t, compact) {
			const done = todos.filter((item) => item.status === "completed").length;
			const active = todos.filter((item) => item.status === "in_progress").length;
			const pending = todos.length - done - active;
			if (compact) return `${done}/${todos.length}`;
			return [
				...done > 0 ? [t("todo.progress.done", { done })] : [],
				...active > 0 ? [t("todo.progress.active", { active })] : [],
				...pending > 0 ? [t("todo.progress.pending", { pending })] : []
			].join(" · ");
		}

		/** Same lifecycle → state mapping the built-in panel uses. */
		function stateDotState(status) {
			if (status === "completed") return "done";
			if (status === "in_progress") return "ongoing";
			return "idle";
		}

		function statusKey(status) {
			if (status === "completed") return "todo.status.completed";
			if (status === "in_progress") return "todo.status.inProgress";
			return "todo.status.pending";
		}

		/**
		 * The floating card: registers into the session-scoped `conversation.input.dock`
		 * list slot (so it receives the session binding hooks) but positions itself
		 * fixed against the session column's top-right corner.
		 *
		 * `t` is injected by the slot framework because the registration declares
		 * `locale: "conversation"` — the official to-do wording, for free, in
		 * whichever language the shell is set to.
		 */
		function TodoFloat({ useProjection, tf, t }) {
			const todos = useProjection("todos") ?? [];
			const mode = React.useSyncExternalStore(subscribeMode, getMode, getMode);
			const [expanded, setExpanded] = React.useState(readExpanded);
			const [width, setWidth] = React.useState(readWidth);
			const rootRef = React.useRef(null);
			const anchorRef = React.useRef(null);

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
					card.style.setProperty("--dsh-todo-float-width", last + "px");
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
			// below it; the optical centre is matched against the tab button height.
			// Without a tab row (single-view sessions, hideChrome) it falls back to
			// sitting just below the header. Recomputed when the column resizes
			// (right sidebar toggles, window resize, panel drags) and whenever the
			// card re-renders with a different size state.
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
				/**
				 * mini（收起）胶囊的高度 = 头部行 + 内衬上下。刻意**不**量卡片自身：
				 * 卡片高度正被 grid 的 0fr↔1fr 过渡驱动，收起途中量会拿到中间值。
				 * 这两块都不参与动画，量到的就是最终稳定值；量不到（尚未布局）才用兜底常量。
				 */
				const miniCardHeight = () => {
					const inner = node.querySelector(".dsh-todo-float-inner");
					const header = node.querySelector(".dsh-todo-float-header");
					if (inner === null || header === null) return MINI_CARD_HEIGHT;
					const style = window.getComputedStyle(inner);
					const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
					const total = header.getBoundingClientRect().height + padding;
					return total > 0 ? total : MINI_CARD_HEIGHT;
				};
				const place = () => {
					const columnRect = column === null ? null : column.getBoundingClientRect();
					const usableColumn = columnRect !== null && columnRect.width > 0;
					const right = `${Math.round(usableColumn ? Math.max(12, window.innerWidth - columnRect.right + 16) : 20)}px`;
					const tabsRow = document.querySelector('[data-conversation-tabs]');
					if (tabsRow !== null) {
						const tabsRect = tabsRow.getBoundingClientRect();
						if (tabsRect.height > 0) {
							// 量第一个 tab 按钮而不是整行：行 rect 带上下 padding，直接用
							// 它会让胶囊比按钮低一截。mini 胶囊与按钮垂直居中；展开态
							// 从按钮顶边往下伸。
							const firstTab = tabsRow.querySelector('[role="tab"]');
							const buttonRect = firstTab !== null ? firstTab.getBoundingClientRect() : tabsRect;
							const lift = expanded ? 0 : Math.max(0, (buttonRect.height - miniCardHeight()) / 2);
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

			const label = progressLabel(todos, t, false);
			// mini（收起）态只显示「正在做的那一条」：优先 in_progress，其次第一条未完成的，
			// 都没有则退回进度摘要。收起态因此是一条窄胶囊，而不是把整张清单挤扁。
			const activeItem = todos.find((item) => item.status === "in_progress")
				|| todos.find((item) => item.status !== "completed");
			const doneCount = todos.filter((item) => item.status === "completed").length;
			const allDone = doneCount === todos.length;
			// 全做完时不能只剩一个光秃秃的 「5/5」：给一句带语义的收尾文案
			const compactLabel = activeItem
				? activeItem.content
				: allDone
					? tf("float.doneAll", { done: doneCount, total: todos.length })
					: progressLabel(todos, t, true);
			// mini 态的字形：在做 → 官方右向 chevron；全做完 → 对勾（走 done 档的成功色）
			const leadGlyph = expanded
				? h(primitives.IconChecklistOutlineRegular, {})
				: allDone
					? h(primitives.IconCheckOutlineRegular, {})
					: h(primitives.IconChevronRightOutlineRegular, {});
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
						"aria-label": t("todo.title"),
						title: label,
						// 宽度 state 始终以 CSS 变量挂在卡片上（mini 态的 max-width 也读它），
						// 展开态再额外写死 width。拖动期间直接改 DOM，松手回写 state。
						style: expanded
							? { width: width + "px", "--dsh-todo-float-width": width + "px" }
							: { "--dsh-todo-float-width": width + "px" }
					},
					h("div", {
						className: "dsh-todo-float-resize",
						role: "separator",
						"aria-orientation": "vertical",
						"aria-label": tf("float.aria.resize"),
						title: tf("float.aria.resize") + "（" + MIN_CARD_WIDTH + "–" + MAX_CARD_WIDTH + "px）",
						onPointerDown: startResize
					}),
					h(
						"div",
						{ className: "dsh-todo-float-inner" },
					h(
						"button",
						{
							type: "button",
							className: "dsh-todo-float-header",
							"aria-expanded": expanded,
							title: tf("float.aria.toggle"),
							onClick: () => setExpanded((value) => !value)
						},
						h("span", {
							className: "dsh-todo-float-lead",
							"aria-hidden": true,
							"data-done": !expanded && allDone ? "true" : undefined
						}, leadGlyph),
						h("span", { className: "dsh-todo-float-title" }, t("todo.title")),
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
								h("span", {
									className: "dsh-todo-float-glyph",
									role: "img",
									"aria-label": t(statusKey(item.status))
								}, h(primitives.StateDot, {
									// 与官方清单同参：只给 state，dot 档、done/ongoing/idle
									// 三档颜色与 reduced-motion 都由组件自带。
									state: stateDotState(item.status)
								})),
								h("span", { className: "dsh-todo-float-content", title: item.content }, item.content)
							))
						)
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

		/**
		 * 设置 →「任务清单」：官方设置行（标题 14/22 + 说明 12/18 + 底部分隔线）
		 * 配官方 `SegmentedControl`（自带 CSS：轨道 = hover 填充，指示器 = 抬起的
		 * 白胶囊 + soft elevation），不再自造 radio 卡片。
		 */
		function TodoFloatSettings({ tf }) {
			const mode = React.useSyncExternalStore(subscribeMode, getMode, getMode);
			return h(
				"div",
				{ className: "dsh-todo-float-settings" },
				h(
					"div",
					{ className: "dsh-todo-float-settings-row" },
					h(
						"div",
						{ className: "dsh-todo-float-settings-text" },
						h("div", { className: "dsh-todo-float-settings-title" }, tf("settings.title")),
						h("div", { className: "dsh-todo-float-settings-desc" }, tf(mode === MODE_LIST ? "settings.mode.list.title" : "settings.mode.card.title"))
					),
					h(primitives.SegmentedControl, {
						id: "dsh-todo-float-mode",
						label: tf("settings.title"),
						value: mode,
						options: [
							{ value: MODE_CARD, label: tf("settings.mode.card") },
							{ value: MODE_LIST, label: tf("settings.mode.list") }
						],
						onChange: setMode
					})
				),
				h("div", { className: "dsh-todo-float-settings-note" }, tf("settings.desc"))
			);
		}

		/**
		 * Browser half entry: waiting on the conversation plugin's dock slot.
		 *
		 * `locale` is the host dictionary service (same seat the official UI
		 * packages declare); the dictionaries are registered inside an effect so a
		 * hot reload replaces them instead of colliding on the namespace.
		 */
		function apply(ctx) {
			ensureStyle();
			applyModeAttribute();
			ctx.effect(() => {
				const offZh = ctx.locale.register(LOCALE_NS, "zh", zh);
				const offEn = ctx.locale.register(LOCALE_NS, "en", en);
				return () => {
					offZh();
					offEn();
				};
			}, "dsh-todo-float: dictionaries");
			const tf = ctx.locale.bind(LOCALE_NS);
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "todo-float",
				order: 50,
				// 声明官方命名空间 → 框架把 `t` 注进 props，任务文案与官方清单同源；
				// 本插件独有的 `tf` 走 inject 席位传进来。
				locale: CONVERSATION_NS,
				inject: () => ({ tf })
			}, TodoFloat));
			/* 设置入口 = 「内置插件」页里本插件的 per-plugin tab：
			 * settings.plugins.tab 按插件清单行 id 用 { only: row.id } 过滤渲染。 */
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "dsh-todo-float",
				order: 10,
				label: () => tf("settings.tab"),
				locale: LOCALE_NS,
				inject: () => ({ tf })
			}, TodoFloatSettings));
		}

		exports.name = "dsh-todo-float";
		exports.inject = ["slots", "locale"];
		exports.apply = apply;
		return module.exports;
	}
});
