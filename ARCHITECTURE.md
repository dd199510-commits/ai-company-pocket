# 架构说明 · 多 Agent 数字员工工作台

> 2026-06-10 重构后版本。原 5538 行单文件 bridge 已拆分为分层模块，本文档说明分层、数据流，以及最重要的——**新增能力的标准路径**，避免再用"加正则补丁"的方式扩展。

## 一、分层结构

```text
scripts/
  openclaw-visual-bridge.mjs   # 入口 shim（保持 npm run bridge 不变）
  bridge/
    config.mjs        # 单一事实来源：env、路径、模型、AGENTS、CAPABILITY_REGISTRY
    lib.mjs           # 纯工具：文本/路径/子进程(全异步)/HTTP，无业务状态，可单测
    infer.mjs         # 正则启发式推断（格式/标题/轻量意图），只放纯函数
    events.mjs        # 运行时状态 + SSE 事件总线 + 历史持久化（带内存缓存）
    context.mjs       # 跨任务上下文：会话历史、最近保存文件、主控运行时上下文
    planner.mjs       # 主控规划器：LLM 规划（注册表约束）+ 规则兜底
    executors/
      file.mjs        # 文件助手：索引/检索/读/写/转换/改写/比较/管理
      research.mjs    # 研究助手：grounding 问答/读网页/浏览器自动化/天气
      writing.mjs     # 文书助手：起草/润色/总结/录音转纪要
      system.mjs      # 应用助手 + 日程占位：打开文件/应用（先确认）
    pipeline.mjs      # 通用执行管线：能力分发、多步编排、任务生命周期、确认动作
    server.mjs        # HTTP/SSE 路由 + Origin/token 校验 + 运行时快照
src/
  components/OfficeStage.jsx   # 办公室可视化（SVG 角色、连线动画、状态大屏）
```

依赖方向单向：`config ← lib ← infer ← events ← context ← planner ← executors ← pipeline ← server`，无循环依赖。

## 二、一次任务的数据流

```text
POST /api/tasks
  → pipeline.startTask（生成 taskId，emit task_started）
  → planner.buildSupervisorPlan
      LLM 模式：意图识别 → 只能从 CAPABILITY_REGISTRY 选能力 → workflow JSON
      规则模式：离线兜底（闲聊直答 / 关键词路由）
  → pipeline.executeSupervisorTask 逐步执行 workflow
      每步：emit agent_message(交接) → CAPABILITY_EXECUTORS[agentId](step)
      上一步结果作为 previousResult 传给下一步（如 研究 → write_file）
      敏感动作（打开应用/删文件）→ pendingActions + action_required，等用户确认
  → emit task_finished / task_failed → SSE 推给前端 → 写入 task-history.jsonl
```

## 三、通用化的核心机制（为什么不再打补丁）

1. **能力注册表是唯一扩展点。** `config.CAPABILITY_REGISTRY` 声明每个助手的能力、参数 schema 和描述；LLM 规划器的 system prompt 自动注入该注册表，**只允许**从中选能力，缺能力时显式返回 `missingCapabilities`，不会拿别的能力硬凑。这意味着：领域对象（报告/笔记/会议材料）一律表达为 `args.scope / query / format / title`，而不是新建 `count_pufa_reports` 这类一次性能力。

2. **管线统一处理横切关注点。** `pipeline.mjs` 的 `CAPABILITY_EXECUTORS` / `AGENT_EXECUTORS` 注册表统一负责：注册表校验、步骤事件、结果传递、确认门禁、任务收尾。执行器只关心"把这一个能力做对"。

3. **正则启发式被圈进 infer.mjs。** 历史遗留的 40+ 意图正则集中在一个文件里，定位明确：只做"格式/标题/轻量歧义"推断和离线兜底。新意图判断默认交给 LLM 规划器，而不是往 infer.mjs 加正则。

## 四、新增一个能力的标准路径（示例：日程助手 create_reminder）

1. `config.mjs` → `CAPABILITY_REGISTRY['schedule-agent']` 加声明：

```js
create_reminder: {
  label: '创建提醒',
  description: '在系统中创建一条提醒，执行前需要用户确认。',
  args: { title: '提醒内容', at: 'ISO 时间或自然语言时间' },
},
```

2. `executors/system.mjs`（或新建 `executors/schedule.mjs`）实现 `executeScheduleCapability({ taskId, agentId, step })`，敏感动作走 `pendingActions` + `action_required` 事件。

3. `pipeline.mjs` → `CAPABILITY_EXECUTORS` 挂载 `'schedule-agent': executeScheduleCapability`。

完成。主控 LLM 自动从注册表看到新能力并开始路由，前端无需改动（事件协议不变）。**不需要**改 planner、不需要加正则、不需要动其它执行器。

## 五、本次修复记录（对应 CODE_REVIEW.md）

- P0-2 事件循环阻塞：删除所有 `spawnSync`（代理 curl、rg/find 扫描、python 转换、open 命令），统一 `runCommandAsync`。
- P1-5 历史全量重读：`events.mjs` 增加 `historyEventsCache`，追加写入时同步进缓存。
- P1-6 解析不一致：`synthesizeWithPlannerModel` 统一走 `parsePlannerJson`。
- P0-3 默认模型名：替换为真实模型名，未显式配置时启动告警。
- P2-11 业务硬编码：移除规划器中"浦发"特例，会前调研改为通用机构调研。
- P1-7 接口无鉴权：`server.mjs` 增加 Origin 白名单（仅 localhost）+ 可选 `VISUAL_BRIDGE_TOKEN`。
- 规则模式闲聊返回"完成 0 个步骤"的缺陷已修复（直接返回兜底答案）。

## 六、后续建议（按优先级）

1. 给 `lib.mjs` / `infer.mjs` / `planner.mjs` 纯函数补单测（node:test 即可），重构时当安全网。
2. 把 `executeFileCapability` 内部 if 链进一步拆成"能力名 → 处理函数"映射，与注册表逐项对应。
3. LLM 规划失败时增加一次重试（指数退避），降低"模型抖动→任务失败"概率。
4. SSRF 防护：`fetchTextPage` 增加协议/私网段校验（若未来对外提供服务则必做）。
5. 文件索引升级 SQLite FTS，支持更大工作区。
