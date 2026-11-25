# 轻量会话窗口（dsh-lite-session-window）

打开一个很长的会话时，不再把整段历史都拉进浏览器：首屏只加载**最近两轮**，更早的内容折叠在原有的「加载更早」按钮后面，滚到顶部或点大纲跳转时才一页页取回。

- 当前这一轮**永远完整**——正在生成、正在读的那轮不会被切断
- 只改 Web 端的取历史预算，不动会话数据、不动持久化、不动 Host
- Host 侧分页始终包含请求的 `throughSeq`，所以最新消息、流式回复、大纲跳转目标都不受影响

## 安装

这是一个 DSH 插件 bundle（包名 `@local/dsh-lite-session-window`，客户端 bundle，Node 侧无逻辑）。

1. 把本目录放到任意位置，例如 `~/dsh-lite-session-window`
2. 在 dsh web 里打开 **插件** 面板 → **添加插件** → 选择该目录
   （或者让 agent 用 `plugin_manager` 的 `install_bundle`，target 指向该目录的绝对路径）
3. 刷新页面生效；**插件** 列表里会出现「轻量会话窗口」

升级/改动后同样刷新页面（模块地址带内容哈希，旧 rev 会 404，刷新即换新）。

## 效果

在真实会话日志上跑同一套分页规则（解压后的记录，按消息数与 Turn 边界切页）：

| 会话 | 全部内容 | 原生首屏 | 本插件首屏 |
| --- | --- | --- | --- |
| 16 轮的 Recaf 会话 | 13.4 MB / 576 条 | 3.4 MB / 179 条 | **0.2 MB / 21 条** |
| 18 轮的会话 | — | — | **0.4 MB / 22 条** |
| 7 轮的 Ghidra 会话 | 7.8 MB / 417 条 | 1.0 MB / 69 条 | 3.4 MB / 192 条 |
| 2 轮的 subagent 会话 | 8.1 MB / 309 条 | 8.1 MB / 309 条 | 8.1 MB / 309 条 |

多轮长会话的首屏能少一个数量级。只有一两轮的会话本来就撑不满一次分页，折叠无处可折，行为不变——这类会话的重量来自「一轮里塞了几百次工具调用」。个别轮次特别大的会话（上表 Ghidra）按 Turn 收口反而比按 50 条消息切更大，这是「不切断当前轮」换来的代价，可以用下面的旋钮调回接近原生的行为。

## 为什么按 Turn 而不是按消息数

原生预算是 `maxMessages: 500` + `turnWindow: { minMessages: 50, minTurns: 2 }`：满 50 条消息且跨过 2 个 Turn 就停。问题在于它会在 Turn **中间**切断——一轮很长的对话可能只露出后半截，读起来是断的。

本插件改成「按 Turn 收口」：

| 请求 | 原生预算 | 本插件预算 |
| --- | --- | --- |
| 打开会话 / 重连 | 最多 500 条，至少 50 条且跨 2 个 Turn | 最近 **2 个 Turn**（`minTurns: 3`），最多 500 条 |
| 向上翻页 / 跳转 | 同上 | 每页 **2 个 Turn**（`minTurns: 3`），最多 400 条 |

`minTurns` 数的是从最新一条往回扫到的 `turn/start` 边界个数，N 个边界就是 N-1 个完整 Turn。

## 调参

客户端 bundle 不接收插件配置，预算写在 `client.js` 顶部：

```js
const settings = {
  openingTurns: 3,       // 首屏保留 2 个 Turn（N-1）
  openingMaxMessages: 500,
  pageTurns: 3,          // 每次「加载更早」2 个 Turn
  pageMaxMessages: 400,
}
```

运行时也能改，无需重新构建：

```js
window.__dshLiteWindow.settings.openingTurns = 2   // 只留当前轮
window.__dshLiteWindow.settings.pageTurns = 5
```

改完重新打开会话即可。把 `openingTurns` 调大、`openingMaxMessages` 调到 500 以上，就回到接近原生的行为。

## 实现

预算装在客户端会话历史流上：`SessionEventStream.prototype.follow` 和 `.readPage`（来自 `@deepseek-ai/dsh-api-session-controller` 的客户端导出）。两个方法都只是把请求原样交给 Host，插件在交出前改写 `maxMessages` 与 `turnWindow`，因此所有向后加载路径（首屏、重连、滚动翻页、大纲跳转）都会被覆盖。

```js
// 首屏：最近 2 个 Turn
{ maxMessages: 500, turnWindow: { minMessages: 1, minTurns: 3 } }
```

## 边界

- 只作用于 Web 端；Node、会话文件、Host 请求预算都不变
- 已经被加载进内存的旧事件不会被卸载（客户端没有卸载接口），折叠的含义是「不再主动加载」
- DSH 升级后若 `SessionEventStream` 的导出形状变化，插件会安静地什么都不做：不报错、不阻断启动
- 同一页面重复加载（HMR）只会安装一层预算；停用插件会还原原始方法
- 在 dsh `0.2.2-rc.5` 上验证过模块装载、请求改写与分页结果；页面内的视觉效果未经浏览器自动化验证

更细的说明与取舍见 [docs/DETAIL.md](docs/DETAIL.md)。

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
