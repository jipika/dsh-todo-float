<div align="center">
  <img src="assets/icon.svg" width="72" alt="dsh-todo-float icon">
</div>

# dsh-todo-float

> **拥有**：`conversation.input.dock` 里的悬浮任务卡，以及隐藏官方 `[data-testid="todo-panel"]` 的那条 CSS。
> **冲突时**：与官方 todo dock 面板争同一份数据 —— 本插件把官方那份隐藏，两者只应存在一份；与 `dsh-plugin-polish` 在 composer dock 上的间距调整无交集。
> **回滚**：删 `todo-float` insert + 重启应用（官方 dock 面板自动回来）。

> Float the conversation to-do list as a collapsible card in the top-right corner of the
> session — switchable back to the stock panel from Settings.
>
> 把会话里的「任务」清单做成**可在设置里切换的两种显示模式**，默认是会话右上角的悬浮卡片。

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

| 模式 | 表现 |
| --- | --- |
| **卡片模式**（默认） | 会话**右上角悬浮卡片**，点卡片头部可收起 / 展开（形态参考 macOS 的「进程」浮动卡片） |
| **列表模式** | 恢复 DSH 原来的样式：任务显示在**输入框上方的清单面板**里 |

切换位置：**设置 → 内置插件 → 本插件条目 →「任务清单」页签**（不在左侧导航另开分栏）。
切换即时生效，无需重启、无需刷新；选择存在 `localStorage["dsh-todo-float:mode"]`，
并镜像到 `<html data-todo-float-mode="card|list">` 供 CSS 判定。

## 安装

两种装法任选其一（都会往 profile 的 `dependencies` 加一项，再配一行 insert）：

```bash
# ① npm（快，走 registry）
dsh plugin --profile <profile> add dsh-todo-float

# ② GitHub（源码直装，跟随 main 分支）
dsh plugin --profile <profile> add github:jipika/dsh-todo-float
```

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: todo-float
      name: dsh-todo-float
```

`desktop` profile 被 Electron 独占（CLI 子命令会被拒），需手改 `package.json` + `pnpm install`；
**改 `lib/client.js` 后必须重启 host 进程（或应用）**，刷新页面无效。

**回滚**：删掉（或注释 / `disabled: true`）那行 insert → 重启，官方面板与官方设置都恢复原样
（此时插件完全不加载，也不会留下 localStorage 影响）；彻底移除再删掉 dependencies 里的那一项并 `pnpm install`。

## 设计规范（与 DSH 全局统一）

卡片不是一个自造控件 —— 所有视觉量与文案都取自全局，官方改了我们跟着变：

- **表面** = 官方 `TodoPanel.module.css` 同一组声明：`--dsw-alias-bg-base` 打不透明底 +
  `--dsw-specific-menu` 叠主题色 + `--dsw-menu-backdrop-filter`，圆角 `--dsw-radius-lg`，
  边缘走 `--dsw-elevation-stroke-color` / `--dsw-elevation-prominent`（描边在阴影里，不占布局）。
- **行量** = 官方：内衬 `6px 12px`、行 gap 10px、标题 13·500·24、列表 `max-height:180px`、
  任务名单行省略号（悬停 title 看全名）。
- **字号** = 字体 token：`--dsw-font-xs-13` / `--dsw-font-xs-strong-13`（设置页 14 与 12 档同例），
  不写散装 `font-size` + `line-height`。
- **状态字形** = 官方 `StateDot`（done / ongoing / idle 三档，与官方 `statusDotState()` 同映射），
  颜色、呼吸动画、reduced-motion 全部自带。
- **焦点环** = `--dsw-focus-ring-width` / `--dsw-focus-ring-color`。
- **动效** = 官方时长档（120ms / 160ms + `ease`），不自定义贝塞尔曲线。
- **文案** = 官方 i18n：注册声明 `locale: "conversation"` → 框架注入官方 `t`，标题 / 进度 /
  状态名与官方清单逐字一致（含 `U+2002·U+2002` 分隔符），并跟随「设置 → 界面语言」切中英；
  插件独有文案注册在自己的 `todoFloat` 命名空间（zh + en 成对）。
- **设置页** = 官方设置行规范 + 官方 `SegmentedControl`，不自造 radio。

## 卡片模式的细节

- 展开态：`任务 1 已完成 · 1 进行中 · 1 待处理` + 逐条任务，状态字形用官方 `StateDot`
  （done 对勾 / ongoing 呼吸环 / idle 空心点），颜色、动画与 reduced-motion 全由官方组件自带。
- 收起态（默认）：一枚小胶囊，只显示当前任务名；全部完成时收成 `全部完成 3/3`。
  展开 / 收起记在 `localStorage["dsh-todo-float:expanded.v2"]`（换过键名，老用户回到新的默认收起态）。
- **宽度可拖**：鼠标移到卡片**左边缘**会出现一根竖直把手（`cursor: col-resize`，几何沿用官方宽度把手那档：8px 宽 / 透明底），按住左右拖即可调宽；
  范围钳制在 **240px ~ 560px**（还会再受 `100vw - 48px` 限制），松手即写入
  `localStorage["dsh-todo-float:width"]`，下次打开沿用。收起态是 `width:auto` 胶囊，但**宽度上限就是这里拖出来的值**
  （组件把宽度写成 `--dsh-todo-float-width`，卡片的 `max-width` 读它）：任务短时继续收缩成窄胶囊，
  任务长时最多长到展开宽度，不会比展开态还宽。
  拖动期间直接改 DOM 并关掉宽度过渡（`[data-resizing='1']{transition:none}`），松手才回写 React state。
- 位置贴住会话列右上角：右边界对齐会话列（右侧栏打开时自动避让），顶边在会话头部下方 12px。
- 会话标题行的角落元素（`[data-conversation-header-corner]`）与 ResizeObserver 一起负责跟随布局变化。

## 原理（零源码补丁）

- 浏览器半边 `lib/client.js` 用 `window.__ModuleLoader__.load({ id, factory })` 手写，做三件事：
  1. 往官方 list slot `conversation.input.dock` 再注册一个条目 `todo-float` → 渲染悬浮卡片；
     数据仍取自官方投影 `useProjection("todos")`，内容/状态/进度与官方一致。
  2. 往 `settings.plugins.tab` 注册一页（id = 包名 `dsh-todo-float`，「内置插件」页里本插件的 tab）→ 设置里的模式切换；
     行量取官方设置行规范，二选一用官方 `SegmentedControl`。
  3. 注入 CSS：只有 `<html data-todo-float-mode="card">` 时才隐藏官方那枚面板
     （`[data-testid="todo-panel"]{display:none}`），列表模式下它原样回来。
- 卡片 `ReactDOM.createPortal` 到 `document.body` + `position: fixed`：留在 composer 子树里
  会被困在 `_composerSeat` 的层叠上下文，宽度拖拽手柄会吞掉点击。
- host 半边 `lib/index.js` 是空 `apply()`（只为让 cordis 行有 fiber），启动时打一行
  `[dsh-todo-float] host half mounted` 供排查。

## 已知限制

- 依赖官方 slot 名（`conversation.input.dock`、`settings.plugins.tab`）、`useProjection("todos")`
  与 `[data-testid="todo-panel"]`；官方重构这些契约后需要跟改。
- 切走再切回某个会话时，todos 投影可能变空（**官方面板同样如此**，不是本插件的 bug；刷新后恢复）。

## License

MIT © 2026 jipika
