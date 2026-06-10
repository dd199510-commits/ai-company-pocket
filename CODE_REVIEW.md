# 代码体检报告 · 多 Agent 数字员工工作台

> 评审范围：`scripts/openclaw-visual-bridge.mjs`（2843 行）、`src/agents.js`、`README.md`、`package.json`、git 状态。
> 评审日期：2026-06-01

---

## 一、总体判断

这是一个结构清晰、能跑通闭环的 MVP：主控助手 + 5 个能力执行器（文件 / 研究 / 浏览器 / 会议 / 应用），规则规划与 LLM 规划双轨，SSE 实时推送任务时间线。产品方向和分层思路是对的。

主要问题集中在三处：**工程基建缺失（无 commit、无测试）**、**单文件过大难维护**、**少量会影响线上体验的实现 bug**。下面按严重程度排列。

---

## 二、必须先处理（P0）

### 1. 仓库没有任何 commit
`git status` 显示 "No commits yet"，2843 行代码完全没有版本快照。任何重构出问题都无法回滚。
**动作**：重构前先 `git add -A && git commit`，建立基线。

### 2. 阻塞调用会冻结整个服务
`postJsonWithOptionalProxy`（L1296）在走代理时用 `spawnSync('curl', …)`，超时设到 **60 秒**。`spawnSync` 是同步阻塞，会卡死 Node 事件循环——意味着一次走代理的 Gemini 研究请求进行时，**整个 bridge 停摆**：SSE 不推送、其它任务排队、`/api/runtime` 无响应。同理 `listWorkspaceFiles`（`rg`/`find`）、`runCommand` 都是 `spawnSync`。
**动作**：代理 HTTP 请求改用异步（`undici` 的 `ProxyAgent`，或 `child_process.spawn` + Promise 包装）。文件扫描改异步或限制频率。

### 3. 默认模型名疑似无效
默认值 `deepseek-v4-flash`、`gpt-4.1-mini`、`gemini-3.5-flash`（L28/38）中，`deepseek-v4-flash` 和 `gemini-3.5-flash` 都不是真实模型名。你的 `.env` 里已覆盖，所以没暴露；但任何人 clone 后不配 `.env` 直接跑 LLM 模式会静默失败再回退规则。
**动作**：默认值改成确实存在的模型，或在启动时校验并打印告警。

---

## 三、实现 bug（P1）

### 4. `inferNoteTitle` 参数不匹配
函数签名只接收 `sourceMessage`（L640），但在 L756、L1021 用两个参数调用 `inferNoteTitle(userMessage, answer)` / `inferNoteTitle(target.sourceMessage, target.answer)`。第二个参数 `answer` 被静默丢弃。不会崩，但说明"用回答内容来推断标题"的意图从未生效，标题质量受影响。
**动作**：要么让函数真正使用 answer，要么删掉多余实参。

### 5. 历史文件每次操作全量重读
`readHistoryEvents`（L285）每次被调用都把整个 `task-history.jsonl` 读进来 `JSON.parse` 逐行。而 `findRecentSavedFile`、`findLastSaveableAnswer`、`buildSupervisorRuntimeContext` 在**每个任务**里都会调用它。历史越长越慢，且是同步在请求路径上。
**动作**：内存里维护一个"最近保存文件"索引，避免重复全量扫盘。

### 6. `synthesizeWithPlannerModel` 解析不一致
L1231 直接 `JSON.parse(content)`，没用 `buildLlmSupervisorPlan` 里那套 `parsePlannerJson`（去除 ```json 围栏、截取首尾花括号）。依赖 `response_format: json_object` 能挡住大部分情况，但换一个不严格遵守的模型就会抛异常。
**动作**：统一走 `parsePlannerJson`。

---

## 四、安全与健壮性（P1/P2）

### 7. HTTP 接口无任何鉴权
bridge 监听 127.0.0.1，但 `/api/tasks` 能触发 `open -a`（启动任意应用）、读取工作区文件、Playwright 自动化。任何本机进程（包括浏览器里的恶意网页通过 localhost 请求）都能调用。CORS 还开了 `*`。
**动作**：至少加一个本地 token 校验，或校验 `Origin`，拒绝跨站请求。敏感动作（`open`）已有二次确认，是好的。

### 8. SSRF 面
`extractFirstUrl` 把用户消息里的任意 URL 直接交给 Playwright / fetch，包括 `http://localhost:xxx`、内网地址、`file://` 变体。本地工具风险可控，但若以后做成服务就是漏洞。
**动作**：加 URL 白名单/协议校验（仅 http(s)、禁私网段）。

### 9. `.env` 含明文密钥（已 gitignore，✓）
确认 `.env` 在 `.gitignore` 内，密钥不会进仓库。保持现状即可，提醒别手滑 `git add -f`。

---

## 五、可维护性 / 坏味道（P2）

### 10. 单文件 2843 行，职责高度耦合
一个文件里塞了：HTTP server、规则规划器、LLM 规划器、6 个执行器、文件索引、HTML/Markdown 互转、天气、浏览器自动化、历史持久化。难测试、难定位、难协作。README 自己也写了要拆。
**动作**（与"重构 bridge"任务对应）：拆成
```
scripts/bridge/
  server.mjs          # HTTP/SSE 路由
  events.mjs          # emitEvent / taskRecords / 历史持久化
  planner/
    rules.mjs
    llm.mjs
  executors/
    file.mjs  research.mjs  browser.mjs  openclaw.mjs  system.mjs
  lib/
    html.mjs  markdown.mjs  text.mjs  http.mjs
  config.mjs          # 所有 env 读取集中到这里
```

### 11. 业务硬编码
`buildSupervisorBrief`、`isExternalMeetingPrep` 里写死了"浦发"（L443/530）。这是把一次演示场景固化进了通用代码。
**动作**：抽成配置或去掉特例。

### 12. 重复逻辑
`inferReportFormat`（L589）与 `inferSaveFormat`（L554）几乎一样；`stripHtml` 与 `htmlToStructuredText` 大段重复；多个 history 扫描函数结构雷同。
**动作**：合并去重。

### 13. 规则规划器靠大量重叠正则
`classifyCapability`、`inferFallbackIntent`、`isSocialChat` 等用长正则堆意图判断，规则互相交叠、顺序敏感、难以预测。短期能用，长期建议把规则层也收敛成"少量明确规则 + 兜底交给 LLM"。

### 14. 魔法数字遍布
端口、超时、`slice(0, 220/900/1400/2200)`、score 权重 8/5/2 等散落各处。
**动作**：集中到 `config.mjs` 常量。

---

## 六、缺失项（P2）

- **零测试**：规划器路由、format 推断、html→text 这些纯函数最值得先补单测，重构时当安全网。
- **无结构化日志**：现在是 `console.error` 字符串。
- **前端 `App.jsx` 1234 行**：本次未深入，但同样偏大，后续可拆组件。

---

## 七、建议执行顺序

1. **先 commit**，建立基线（P0-1）。
2. 给纯函数补一批单测（planner 路由、format 推断、html 解析）。
3. 按第 10 条拆分 bridge，**每拆一块跑一次测试**，行为不变。
4. 顺手修 P0-2（阻塞调用）、P1 的几个 bug。
5. 再做功能增强（文件助手 SQLite FTS、规划器持久化等 README "下一步"）。

> 这样重构有测试兜底、有 commit 可回滚，风险最低。
