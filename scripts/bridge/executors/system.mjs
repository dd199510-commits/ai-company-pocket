// executors/system.mjs — 应用/系统执行器：打开文件、打开应用（敏感动作先确认）、日程占位。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PLANNER_API_KEY, PLANNER_MODE, WORKSPACE_ROOT } from '../config.mjs'
import { activeTasks, emitEvent, pendingActions } from '../events.mjs'
import { findRecentSavedFile } from '../context.mjs'
import {
  extractFirstFilePath,
  normalizeArtifactPath,
  resolveExistingFileReference,
  stringArg,
  unsupportedCapabilityResult,
} from '../lib.mjs'
import { callPlannerJson } from '../planner.mjs'

async function prepareOpenSavedFile({ taskId, agentId, threadId, announceSupervisor = true }) {
  const saved = await findRecentSavedFile(taskId, threadId)
  if (!saved) {
    const answer = '我没找到最近保存的文件。你可以告诉我文件名，或者先让我重新保存一次。'
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-open-saved-missing`,
      status: 'done',
      title: '打开文件',
      detail: answer,
      metric: '未找到文件',
      bubble: '缺少',
      announce: true,
    })
    return { answer, plan: [], results: [] }
  }

  if (announceSupervisor) {
    const supervisorBrief = [
      `我找到了刚才保存的文件：${saved.relativePath}`,
      '我会准备打开它，确认后由系统调用默认应用打开。',
    ].join('\n')
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-supervisor-open-saved`,
      status: 'done',
      title: '主控理解与派活',
      detail: supervisorBrief,
      metric: '打开已保存文件',
      bubble: '打开',
      announce: true,
    })
  }

  const actionId = `action-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const action = {
    actionId,
    taskId,
    agentId: 'app-agent',
    ownerAgentId: agentId,
    type: 'open_file',
    filePath: saved.path,
    relativePath: saved.relativePath,
    title: `打开 ${path.basename(saved.relativePath)}`,
    detail: `将用 macOS 默认应用打开 ${saved.relativePath}。`,
    createdAt: new Date().toISOString(),
  }
  pendingActions.set(actionId, action)
  emitEvent({
    type: 'action_required',
    taskId,
    agentId: 'app-agent',
    actionId,
    title: action.title,
    detail: action.detail,
    metric: '等待用户确认',
    bubble: '确认',
  })
  return {
    pendingAction: action,
    answer: `找到文件了：${saved.relativePath}\n确认后我会帮你打开。`,
  }
}

async function prepareOpenFilePath({ taskId, agentId, filePath, announceSupervisor = true }) {
  const absolutePath = await resolveExistingFileReference(filePath)
  if (!absolutePath || !existsSync(absolutePath)) {
    const normalizedPath = normalizeArtifactPath(filePath)
    const relative = normalizedPath ? path.relative(WORKSPACE_ROOT, normalizedPath) : String(filePath ?? '')
    const answer = `我没找到要打开的文件：${relative || '未提供路径'}。`
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-open-file-missing`,
      status: 'failed',
      title: '打开文件',
      detail: answer,
      metric: '文件不存在',
      bubble: '缺少',
      announce: true,
    })
    return { answer }
  }

  const relativePath = path.relative(WORKSPACE_ROOT, absolutePath)
  if (announceSupervisor) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-supervisor-open-file`,
      status: 'done',
      title: '主控理解与派活',
      detail: `我会准备打开文件：${relativePath}`,
      metric: '打开指定文件',
      bubble: '打开',
      announce: true,
    })
  }

  const actionId = `action-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const action = {
    actionId,
    taskId,
    agentId: 'app-agent',
    ownerAgentId: agentId,
    threadId: activeTasks.get(taskId)?.threadId,
    type: 'open_file',
    filePath: absolutePath,
    relativePath,
    title: `打开 ${path.basename(relativePath)}`,
    detail: `将用 macOS 默认应用打开 ${relativePath}。`,
    createdAt: new Date().toISOString(),
  }
  pendingActions.set(actionId, action)
  emitEvent({
    type: 'action_required',
    taskId,
    agentId: 'app-agent',
    actionId,
    title: action.title,
    detail: action.detail,
    metric: '等待用户确认',
    bubble: '确认',
  })
  return {
    pendingAction: action,
    answer: `找到文件了：${relativePath}\n确认后我会帮你打开。`,
  }
}
function inferAppName(message) {
  const pairs = [
    [/chrome|谷歌|浏览器/i, 'Google Chrome'],
    [/safari/i, 'Safari'],
    [/微信|wechat/i, 'WeChat'],
    [/邮件|mail/i, 'Mail'],
    [/日历|calendar/i, 'Calendar'],
    [/备忘录|notes/i, 'Notes'],
    [/访达|finder/i, 'Finder'],
    [/终端|terminal/i, 'Terminal'],
  ]
  return pairs.find(([pattern]) => pattern.test(message))?.[1] ?? null
}

function normalizeAppAction(action) {
  const allowed = new Set(['open_file', 'open_app', 'unknown'])
  const normalized = String(action ?? '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'unknown'
}

async function buildAppAgentIntent({ message }) {
  if (!PLANNER_API_KEY || PLANNER_MODE !== 'llm') {
    const filePath = extractFirstFilePath(message)
    const appName = inferAppName(message)
    return {
      action: filePath ? 'open_file' : appName ? 'open_app' : 'unknown',
      confidence: filePath || appName ? 0.65 : 0.2,
      filePath,
      appName,
      instruction: message,
    }
  }
  const parsed = await callPlannerJson({
    system: [
      'You are the embedded intent model inside a local application assistant.',
      'Decide only local app/system intent. Do not answer the user.',
      'Return only JSON: {"action":"open_file|open_app|unknown","confidence":0.0,"filePath":null,"appName":null,"instruction":"..."}',
      'Use open_file when the user asks to open a local file/report/document, including follow-ups with a concrete filename.',
      'Use open_app only when the user explicitly asks to open or launch a named local app such as Chrome, Mail, Calendar, Finder, Terminal, WeChat, Safari.',
      'Use unknown when the user asks about a topic, search, food, company, or generic action without explicitly opening a local app/file.',
      'Do not turn generic topics into app launches.',
    ].join('\n'),
    payload: {
      userMessage: message,
      explicitFilePath: extractFirstFilePath(message),
      heuristicAppName: inferAppName(message),
    },
  })
  return {
    action: normalizeAppAction(parsed.action),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
    filePath: typeof parsed.filePath === 'string' && parsed.filePath.trim() ? parsed.filePath.trim() : extractFirstFilePath(message),
    appName: typeof parsed.appName === 'string' && parsed.appName.trim() ? parsed.appName.trim() : inferAppName(message),
    instruction: typeof parsed.instruction === 'string' && parsed.instruction.trim() ? parsed.instruction.trim() : message,
  }
}

async function executeSystemAgent({ taskId, agentId, message, ownerAgentId = agentId }) {
  const intent = await buildAppAgentIntent({ message })
  if (intent.action === 'open_file' && intent.filePath) {
    return prepareOpenFilePath({
      taskId,
      agentId: ownerAgentId,
      filePath: intent.filePath,
      announceSupervisor: false,
    })
  }

  const appName = intent.action === 'open_app' ? intent.appName : null
  if (!appName) {
    return {
      answer: [
        `我这边还没法确定要操作哪个本机应用。`,
        '',
        '你可以直接说：“打开 Chrome”“打开邮件”“打开日历”。',
        `如果你其实是想查「${message}」相关内容，可以补一句：附近店铺、做法、价格，或者外卖。`,
        '',
        '涉及真的启动应用、发送消息或修改数据时，我都会先停下来等你确认。',
      ].join('\n'),
    }
  }

  const actionId = `action-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const action = {
    actionId,
    taskId,
    agentId,
    type: 'open_app',
    appName,
    ownerAgentId,
    title: `打开 ${appName}`,
    detail: `将调用 macOS open -a "${appName}"。`,
    createdAt: new Date().toISOString(),
  }
  pendingActions.set(actionId, action)
  emitEvent({
    type: 'action_required',
    taskId,
    agentId,
    actionId,
    title: action.title,
    detail: action.detail,
    metric: '等待用户确认',
    bubble: '确认',
  })
  return {
    pendingAction: action,
    answer: `已准备动作：${action.title}。请在右侧任务面板确认后执行。`,
  }
}
async function executeScheduleAgent({ message }) {
  const intent = PLANNER_API_KEY && PLANNER_MODE === 'llm'
    ? await callPlannerJson({
        system: [
          'You are the embedded intent model inside a schedule assistant placeholder.',
          'Return only JSON: {"intent":"schedule|reminder|calendar|unknown","confidence":0.0,"summary":"..."}',
          'Do not claim to have scheduled anything. This assistant is reserved and has no execution functions yet.',
        ].join('\n'),
        payload: { userMessage: message },
      }).catch(() => null)
    : null
  return {
    answer: [
      '日程助手目前只是预留工位，还没有接入真实日历、提醒或排期执行能力。',
      intent?.summary ? `我理解你的日程意图是：${intent.summary}` : `我理解你想处理日程相关事项：${message}`,
      '后面接入时，这里会负责日程创建、提醒、冲突检查和排期建议。',
    ].join('\n'),
  }
}
async function executeAppCapability({ taskId, agentId, step, previousResult, threadId }) {
  const args = step.args ?? {}
  if (step.capability === 'open_file') {
    const explicit = stringArg(args, 'filePath')
      ?? stringArg(args, 'path')
      ?? previousResult?.savedPath
    if (explicit) {
      return prepareOpenFilePath({
        taskId,
        agentId,
        filePath: explicit,
        announceSupervisor: false,
      })
    }
    return prepareOpenSavedFile({ taskId, agentId, threadId, announceSupervisor: false })
  }
  if (step.capability === 'open_app') {
    return executeSystemAgent({
      taskId,
      agentId,
      ownerAgentId: 'main',
      message: step.message,
    })
  }
  return unsupportedCapabilityResult('应用助手', step.capability)
}

export {
  prepareOpenSavedFile,
  prepareOpenFilePath,
  executeSystemAgent,
  executeScheduleAgent,
  executeAppCapability,
}
