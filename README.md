# 马维斯式本地 AI 工作台 MVP

这是一个从“多 Agent 数字员工视觉程序”改造出来的本地 OS Agent MVP。当前版本保留工位式视觉空间，但产品语义改为“主控助手 + 可替换能力执行器”：

- 主控助手：理解用户目标，可把复合请求拆成多个步骤，并串联不同能力执行。
- 文件助手：建立本地文本索引，按文件名和内容检索资料并返回命中片段。
- 浏览器助手：真实读取 URL 或执行轻量网页搜索；需要“截图/点击”时会用 Playwright 控制本机 Chrome。
- 会议助手：预留 OpenClaw / meeting-agent-runtime 执行器。
- 应用助手：识别常见本机应用，先展示确认卡片，用户确认后才调用 macOS `open -a`。

OpenClaw 不再是唯一底座，而是会议、消息、定时、本地 runtime 等能力的执行器之一。

## 启动

```bash
npm install
npm run bridge
npm run dev
```

默认地址：

```text
frontend: http://127.0.0.1:5173
bridge:   http://127.0.0.1:5181
workspace root: 当前项目目录
OpenClaw meeting gateway: ws://127.0.0.1:18920
```

## 当前闭环

1. 点击“演示任务”。
2. 主控助手把“看看项目文件并给建议”路由给文件助手。
3. 本地 bridge 扫描工作区文件，写入 `artifacts/file-index.json`，并检索可解析文本文件。
4. 前端通过 SSE 展示任务时间线、执行器状态和最终结果。
5. 任务事件会写入 `artifacts/task-history.jsonl`，刷新页面后可在“最近任务”里回看。

也可以直接选择浏览器助手输入 URL，例如：

```text
读取 https://example.com
读取 https://example.com 并截图
打开 https://example.com 点击 Learn more 并截图
```

选择文件助手可以按内容查本地项目：

```text
搜索 planner 在哪个文件里
找一下 Playwright 截图逻辑
```

选择应用助手输入：

```text
打开 Chrome
```

系统会先显示确认卡片，点击确认后才真正打开应用。

也可以直接发给主控助手一个复合任务：

```text
读取 https://example.com 并截图，然后打开日历
```

主控会先让浏览器助手执行网页步骤，再把应用动作停在确认卡片。

## 可选 LLM 规划器

默认使用本地规则规划，保证离线可跑。当前项目可以用 `.env` 切到 DeepSeek 的轻量路由模型：

```bash
OS_AGENT_PLANNER_MODE=llm
OS_AGENT_PLANNER_PROVIDER=deepseek
OS_AGENT_PLANNER_BASE_URL=https://api.deepseek.com
OS_AGENT_PLANNER_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=...
npm run bridge
```

也可以切到其它 OpenAI-compatible 的 LLM 规划器：

```bash
export OS_AGENT_PLANNER_MODE=llm
export OPENAI_API_KEY=...
export OS_AGENT_PLANNER_MODEL=gpt-4.1-mini
npm run bridge
```

如果 LLM 调用失败，bridge 会自动回退到规则规划。

## 目录

```text
src/
  App.jsx
  agents.js
  main.jsx
  styles.css
scripts/
  openclaw-visual-bridge.mjs
```

## 下一步

- 把 bridge 拆成 `executors/file|browser|openclaw|system` 模块。
- 给文件助手升级向量检索或 SQLite FTS，支持更大的本地目录。
- 给浏览器助手继续扩展 browser-use / Playwright，支持更稳的填表、登录态复用和页面截图回放。
- 给应用助手扩展 macOS Shortcuts / AppleScript，支持更多可确认动作。
- 给主控助手接入 LangGraph 或 OpenAI Agents SDK，升级为可持久化规划器。
- 增加更细的权限策略、人工接管状态和历史任务详情页。
