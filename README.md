# AI Company Pocket

AI Company Pocket 是一个面向便携式墨水屏设备的本地 AI 工具监控与语音交互界面。它把用户电脑里的 AI 工具具象化成一家“AI 公司”：Codex、Claude Code、OpenClaw 等工具是公司里的员工，主控是调度员。用户可以在小屏幕上看到各工具的状态、用量、任务、权限请求和产出资产，并通过物理按键和语音向这些真实工具继续下达指令。

当前仓库包含两个界面：

- `PocketApp`：现在的主线界面，面向便携墨水屏，GitHub Pages 默认展示这个版本。
- `App` + `OfficeStage`：早期桌面工作区界面，仍保留作视觉/动画参考，也可本地打开。

线上 demo：

```text
https://dd199510-commits.github.io/ai-company-pocket/
```

GitHub Pages 是纯静态环境，不能访问使用者本机的 bridge，因此线上会显示一份 demo 状态。真实工具状态、真实 session、usage、permission、语音回复都需要在本机启动 bridge 后使用。

## 产品定位

这个项目不是一个新的聊天机器人，也不是把 Codex/Claude/OpenClaw 重新包一层独立对话。它的核心目标是：

1. 显示用户本机真实 AI 工具的运行状态。
2. 显示各工具的用量，例如 Codex/Claude 的 5h、7d 剩余额度，OpenClaw 的周 token 消耗。
3. 显示真实工具 session 列表，按最近活跃优先。
4. 显示 permission 请求，用户可以进入详情后通过语音 approve 或 reject。
5. 当某个 AI 工具有新完成任务、待许可、正在运行任务时，在对应员工头上显示视觉提示。
6. 在特定真实 session 中语音回复时，尽量回到同一个工具、同一个 session，而不是在 Pocket 内部另起一条独立对话。
7. 沉淀 AI 工具产出的资产，后续用于“公司资产库”和跨工具调用。

换句话说，Pocket 是“AI 工具公司前台 + 小屏指挥台”。真实能力仍来自本机 Codex、Claude Code、OpenClaw 等工具。

## 快速启动

安装依赖：

```bash
npm install
```

启动本机 bridge：

```bash
npm run bridge
```

启动前端：

```bash
npm run dev
```

常用地址：

```text
Pocket UI:    http://127.0.0.1:5173/pocket
Desktop UI:   http://127.0.0.1:5173/?mode=desktop
Bridge API:   http://127.0.0.1:5181
Runtime API:  http://127.0.0.1:5181/api/runtime
Pocket API:   http://127.0.0.1:5181/api/pocket/status
```

也可以双击：

```text
启动工作台.command
```

## 构建与发布

```bash
npm run lint
npm run build
```

GitHub Pages 通过 `.github/workflows/pages.yml` 部署 `dist/`。`vite.config.js` 使用相对 base，适配 GitHub Pages 的仓库路径。

入口选择在 `src/main.jsx`：

- `/pocket` 或 `?mode=pocket`：渲染 `PocketApp`。
- `?mode=desktop` 或 `/workspace`：渲染早期桌面工作区。
- `github.io/ai-company-pocket`：默认渲染 `PocketApp`。

`PocketApp` 里有 GitHub Pages 专用 demo fallback：当页面运行在 `github.io/ai-company-pocket` 且 bridge 不可用时，会展示一份静态 demo 状态。这个 fallback 只用于公开 demo，不用于本地真实联调。

## 交互模型

目标硬件只有方向键和一个 hold 按钮，并支持语音输入。因此交互尽量围绕三种按键动作：

```text
上下 / 左右: 切换选中对象或列表条目
短按:       确认 / 进入
双击:       返回上一级
长按 Hold:  语音输入
```

主界面对象包括：

- 主控：进入通知列表，或在没有选中特定工具时接收总控指令。
- Codex：进入 Codex 最近真实 session 列表。
- Claude：进入 Claude Code 最近真实 session 列表。
- OpenClaw：进入 OpenClaw 的任务或命令入口。
- Perms：进入待 permission 列表。
- Assets：进入公司资产沉淀列表。

二级菜单规则：

- session 列表只先显示最近几条。
- 列表末尾的 `...` 用短按加载更早一页。
- 条目多时通过上下键滚动，不无限撑高面板。
- 进入详情后，上下键滚动详情正文。
- 在 session 详情里长按语音，应该回复当前 session。
- 在主界面选中某个 AI 员工时长按语音，默认回复这个员工最新 active session。
- 在 permission 详情里长按语音，说“同意/允许/approve”会确认，说“拒绝/不同意/reject”会走拒绝或反馈逻辑。

状态提示：

- `!`：有新完成任务，查看后消失。
- `?`：有待处理 permission。
- `...`：该工具正在运行任务。
- 主控显示“有新消息!”：存在未查看的新完成任务。

## 目录结构

```text
src/
  main.jsx                    # 前端入口选择：Pocket / Desktop / Pages demo
  PocketApp.jsx               # 墨水屏主界面、像素角色、菜单、语音交互
  App.jsx                     # 早期桌面工作区 UI
  components/OfficeStage.jsx  # 早期办公室视觉场景和员工动画
  agents.js                   # 桌面工作区用的 agent 静态配置
  styles.css                  # 两套 UI 的样式和像素动画

scripts/
  openclaw-visual-bridge.mjs  # bridge 入口 shim
  bridge/
    server.mjs                # HTTP API、SSE、Origin/token 校验
    pocket.mjs                # Pocket 状态汇总、usage、真实 session、语音命令
    pipeline.mjs              # 通用任务管线与 permission confirm
    events.mjs                # 任务状态、pendingActions、历史持久化
    config.mjs                # env、路径、能力注册表、Agent 配置
    planner.mjs               # 主控规划器
    context.mjs               # 跨任务上下文
    infer.mjs                 # 规则推断
    lib.mjs                   # 通用工具函数
    executors/                # 文件、研究、文书、系统能力执行器

artifacts/
  task-history.jsonl          # 本地任务历史
  pocket/                     # Pocket 语音命令日志、setup 脚本等运行文件
```

架构分层的旧说明仍在 `ARCHITECTURE.md`，但它主要描述早期本地 OS Agent 工作台。后续以本 README 的 Pocket 定位为准。

## Bridge API

Bridge 默认监听：

```text
http://127.0.0.1:5181
```

重要接口：

```text
GET  /api/runtime
GET  /api/pocket/status?force=1
POST /api/pocket/command
POST /api/pocket/setup
POST /api/actions/confirm
GET  /api/history?limit=20
GET  /api/events
POST /api/tasks
```

`GET /api/pocket/status` 返回 Pocket UI 的核心数据。简化结构如下：

```js
{
  refreshedAt,
  readiness: {
    readyCount,
    total,
    headline
  },
  tools: [
    {
      id: 'codex',
      name: 'Codex',
      shortName: 'CDX',
      status: 'online',
      detail: '...',
      station: { x, y },
      usage: {
        value,
        percent,
        display: {
          mode: 'remaining',
          type: 'codex',
          rows: [
            { label: '5H', value: '59%', percent: 59, reset: '02:31' },
            { label: '7D', value: '84%', percent: 84, reset: '6/29 16:22' }
          ]
        }
      }
    }
  ],
  tasks: {
    active: [],
    pending: [],
    history: [],
    recentCommands: []
  },
  assets: {
    recentCount
  }
}
```

`POST /api/pocket/command` 用于语音指令：

```js
{
  target: 'codex' | 'claude-code' | 'openclaw' | 'supervisor',
  message: '用户语音转写文本',
  toolSessionId: '真实工具 session id',
  toolSessionCwd: '/absolute/workdir',
  toolSessionSource: 'vscode' | 'exec' | 'claude-code' | 'desktop'
}
```

如果 `target` 是 `supervisor`，bridge 会走 `startTask`，相当于主控接收任务。如果 `target` 是具体工具，bridge 会尝试回复真实工具 session。

## 真实工具接入

### Codex

状态与 session：

- 进程探测：`ps axo ...`，匹配 Codex.app、codex CLI、codex app-server。
- session 来源：`~/.codex/sessions/**/*.jsonl`。
- usage 来源：Codex session 日志里的 `token_count` / `rate_limits`。
- 读取窗口：最近 30 天 session，最多扫描一定数量文件，避免卡顿。

回复逻辑：

- Pocket 不应该创建一个孤立的“Pocket 内部 Codex 会话”。
- 用户必须先进入某个真实 Codex session，或选中 Codex 时存在 latest active session。
- 对桌面/app 来源 session，bridge 会优先走 Codex Desktop app-server 的 resume/turn 机制。
- 对 exec 来源 session，会走 `codex exec resume`。
- 回复完成后会尝试调用 `open codex://threads/<threadId>`，让 Codex Desktop 刷新到对应 thread。

相关代码：

```text
scripts/bridge/pocket.mjs
  readCodexLocalUsage
  readCodexRecentSessions
  sendCodexDesktopTurn
  startPocketCommand target === 'codex'
```

可选环境变量：

```bash
POCKET_SYNC_CODEX_DESKTOP_UI=0
```

设置为 `0` 后，bridge 不会自动用 deep link 拉起或切换 Codex Desktop UI。

注意：Codex session jsonl 必须从 `session_meta` 开始。若遇到 `rollout does not start with session metadata`，说明某个 jsonl 不是完整标准 session，读取逻辑要跳过或容错。

### Claude Code

状态与 session：

- CLI 探测：`claude --version`、`claude auth status`。
- session 来源：`~/.claude/projects/**/*.jsonl`。
- usage 来源：优先 `claude -p /usage --output-format text`，同时扫描本地 session 日志中的 `usage` 字段。
- 若本地日志只有 token 消耗，没有 rate limit 字段，UI 可能无法显示百分比，只能展示 token 统计或“未读到百分比”。

回复逻辑：

- 目标是回复真实 Claude Code session，不在 Pocket 里新建孤立会话。
- 当前实现通过 `claude --print --output-format text --permission-mode dontAsk --resume <sessionId> <message>`。
- 如果 CLI 未登录，会返回 setup_required。

相关代码：

```text
scripts/bridge/pocket.mjs
  readClaudeAuthStatus
  readClaudeLocalUsage
  readClaudeCliUsage
  readClaudeRecentSessions
  startPocketCommand target === 'claude-code'
```

### OpenClaw

状态与 usage：

- `openclaw status --no-color`
- `openclaw gateway usage-cost --days 7 --json --timeout 8000`

回复逻辑：

- 当前使用 `openclaw agent --agent main --session-key agent:main:pocket --message ...`。
- 如果 OpenClaw 没有百分比 usage，Pocket UI 以周 token 消耗作为展示重点。

## 前端实现说明

`src/PocketApp.jsx` 目前比较集中，主要块如下：

- `createDemoPocketStatus`：GitHub Pages demo fallback。
- `CodexSprite` / `ClaudeSprite` / `OpenClawSprite` / `MainSprite`：灰阶像素吉祥物。
- `PixelTool`：单个员工工位。
- `UsageTile`：顶部 usage 条。
- `PocketMenuPanel`：二级列表菜单。
- `PocketDetailPanel`：session / notification / asset / permission 详情。
- `buildSessionRows`、`buildNotificationRows`、`buildAssetRows`：把 bridge status 转成菜单行。
- `sendCommand`：语音指令路由逻辑。

样式集中在 `src/styles.css`。Pocket 相关 class 大多以 `pocket-` 或 `pk-` 开头。

后续重构建议：

```text
src/pocket/
  sprites.jsx
  menus.jsx
  status-model.js
  speech.js
  PocketApp.jsx
```

目前先保持单文件，便于快速迭代；当 UI 逻辑稳定后再拆。

## Usage 展示规则

Pocket 顶部 usage 区域使用“剩余百分比条”作为主视觉。

Codex / Claude Code：

- 有 5h 和 7d 两个窗口时，上下两条显示。
- label 用 `5H` / `7D`。
- value 显示剩余百分比。
- reset 时间：
  - 5h：只显示时间，例如 `02:31`。
  - 7d：显示日期和时间，例如 `6/29 16:22`。

OpenClaw：

- 如果没有可用百分比，显示周 token 消耗。
- 当前 demo 显示 `7D TOK 23.2M`。

Bridge 侧由 `buildLimitDisplay`、`buildOpenClawUsageDisplay` 等函数生成 `tool.usage.display.rows`。前端只消费 rows，不应该重新推断业务含义。

## Permission 设计

Permission 不应该在主界面直接 approve。正确流程：

1. 选中 `PERMS`。
2. 短按进入待许可列表。
3. 选中某个 permission。
4. 短按进入详情。
5. 长按语音说 approve / reject / 补充意见。

`/api/actions/confirm` 当前只实现确认执行。若后续要支持明确 reject，建议增加：

```text
POST /api/actions/reject
```

或扩展 `/api/actions/confirm` 的 body：

```js
{ actionId, decision: 'approve' | 'reject', reason }
```

## 已知限制

1. GitHub Pages 只能展示静态 demo，无法连接访问者本机 bridge。
2. Codex Desktop UI 的刷新依赖 `codex://threads/<threadId>` deep link，不等于官方稳定 API。
3. Claude Desktop 和 Claude Code 的 session/CLI 能力边界需要继续验证；当前主要走 Claude Code CLI。
4. Claude usage 的百分比字段并不总能从本地日志读到，`claude /usage` 输出格式变化时需要更新解析。
5. Pocket 语音输入依赖浏览器 `SpeechRecognition` / `webkitSpeechRecognition`。不支持时会 fallback 成一条默认状态查询。
6. 当前 bridge 主要面向本机 localhost 使用，未按公网服务做安全加固。
7. `PocketApp.jsx` 仍偏大，后续多人协作时建议拆文件。

## 给后续 Claude Code 的阅读路线

如果你是后续接手的 Claude Code，建议按这个顺序读：

1. 先读本 README，确认产品定位：Pocket 是真实 AI 工具的镜像和遥控器，不是新聊天系统。
2. 读 `src/main.jsx`，确认路由和 Pages demo 入口。
3. 读 `src/PocketApp.jsx` 的状态消费逻辑，重点看 `refresh`、`items`、`sendCommand`、`renderPanel`。
4. 读 `scripts/bridge/server.mjs` 的 API 路由。
5. 读 `scripts/bridge/pocket.mjs`，重点看：
   - `buildPocketStatus`
   - `readCodexRecentSessions`
   - `readClaudeRecentSessions`
   - `readCachedLocalUsage`
   - `startPocketCommand`
6. 再读 `scripts/bridge/events.mjs` 和 `scripts/bridge/pipeline.mjs`，理解任务历史和 permission 来源。
7. 如需改早期桌面视觉，再读 `src/App.jsx`、`src/components/OfficeStage.jsx`、`src/agents.js`。

修改原则：

- 不要把 Pocket 语音回复改成新建本地 fake session。
- 不要让 Pages demo 逻辑污染本机真实 bridge 状态。
- 不要在前端硬编码 usage 语义，优先让 bridge 返回明确的 `usage.display.rows`。
- 改真实工具 session 解析时，优先做容错和跳过坏文件，不要因为单个坏 jsonl 让整个 Pocket 状态失败。
- 如果新增 AI 工具，先在 bridge 里扩展 tool spec 和 status model，再在前端补 sprite 和 station。

## 常用排查命令

检查 bridge：

```bash
/usr/bin/curl -s http://127.0.0.1:5181/api/runtime | jq .
/usr/bin/curl -s http://127.0.0.1:5181/api/pocket/status?force=1 | jq .
```

检查 Codex session：

```bash
find ~/.codex/sessions -name '*.jsonl' -mtime -7 | tail
```

检查 Claude session：

```bash
find ~/.claude/projects -name '*.jsonl' -mtime -7 | tail
```

检查 OpenClaw：

```bash
openclaw status --no-color
openclaw gateway usage-cost --days 7 --json --timeout 8000
```

本机预览 Pages build：

```bash
npm run build
npm run preview
```

线上部署后可用 Playwright 或浏览器确认：

```text
https://dd199510-commits.github.io/ai-company-pocket/
```

预期是 pocket 墨水屏界面，顶部有 usage 区，工区中有 Codex、Claude、OpenClaw 三个员工，而不是早期彩色桌面 workspace。
