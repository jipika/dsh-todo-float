# dsh-todo-float

> Float the conversation to-do list as a collapsible card in the top-right corner of the
> session — switchable back to the stock panel from Settings.
>
> 把会话里的「任务」清单做成**可在设置里切换的两种显示模式**，默认是会话右上角的悬浮卡片。

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

| 模式 | 表现 |
| --- | --- |
| **卡片模式**（默认） | 会话**右上角悬浮卡片**，点卡片头部可收起 / 展开（形态参考 macOS 的「进程」浮动卡片） |
| **列表模式** | 恢复 DSH 原来的样式：任务显示在**输入框上方的清单面板**里 |

切换位置：**设置 → 任务清单 →「任务清单显示模式」**（左侧导航里的一项）。
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

## 卡片模式的细节

- 展开态：`任务 1 进行中 · 2 待处理` + 逐条任务（✅ 完成 / 转圈 进行中 / 虚线圆 待处理）。
- 收起态：一枚小胶囊 `任务 0/3`；展开 / 收起记在 `localStorage["dsh-todo-float:expanded"]`，默认展开。
- **宽度可拖**：鼠标移到卡片**左边缘**会出现一根竖直把手（`cursor: ew-resize`），按住左右拖即可调宽；
  范围钳制在 **240px ~ 560px**（还会再受 `100vw - 48px` 限制），松手即写入
  `localStorage["dsh-todo-float:width"]`，下次打开沿用。收起态是 `width:auto` 胶囊，不受影响。
  拖动期间直接改 DOM 并关掉宽度过渡（`[data-resizing='1']{transition:none}`），松手才回写 React state。
- 位置贴住会话列右上角：右边界对齐会话列（右侧栏打开时自动避让），顶边在会话头部下方 12px。
- 会话标题行的角落元素（`[data-conversation-header-corner]`）与 ResizeObserver 一起负责跟随布局变化。

## 原理（零源码补丁）

- 浏览器半边 `lib/client.js` 用 `window.__ModuleLoader__.load({ id, factory })` 手写，做三件事：
  1. 往官方 list slot `conversation.input.dock` 再注册一个条目 `todo-float` → 渲染悬浮卡片；
     数据仍取自官方投影 `useProjection("todos")`，内容/状态/进度与官方一致。
  2. 往 `settings.section` 注册一节（id `todo-float`，label「任务清单」）→ 设置里的模式切换。
  3. 注入 CSS：只有 `<html data-todo-float-mode="card">` 时才隐藏官方那枚面板
     （`[data-testid="todo-panel"]{display:none}`），列表模式下它原样回来。
- 卡片 `ReactDOM.createPortal` 到 `document.body` + `position: fixed`：留在 composer 子树里
  会被困在 `_composerSeat` 的层叠上下文，宽度拖拽手柄会吞掉点击。
- host 半边 `lib/index.js` 是空 `apply()`（只为让 cordis 行有 fiber），启动时打一行
  `[dsh-todo-float] host half mounted` 供排查。

## 已知限制

- 依赖官方 slot 名（`conversation.input.dock`、`settings.section`）、`useProjection("todos")`
  与 `[data-testid="todo-panel"]`；官方重构这些契约后需要跟改。
- 切走再切回某个会话时，todos 投影可能变空（**官方面板同样如此**，不是本插件的 bug；刷新后恢复）。

## License

MIT © 2026 jipika
