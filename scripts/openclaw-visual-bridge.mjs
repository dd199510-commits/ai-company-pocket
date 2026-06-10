#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

loadLocalEnv()

const HOST = process.env.VISUAL_BRIDGE_HOST ?? '127.0.0.1'
const PORT = Number.parseInt(process.env.VISUAL_BRIDGE_PORT ?? '5181', 10)
const RUNTIME_ROOT = process.env.MEETING_AGENT_RUNTIME_ROOT
  ?? '/Users/ddss/Documents/meeting-agent-runtime'
const WORKSPACE_ROOT = process.env.OS_AGENT_WORKSPACE_ROOT
  ?? path.resolve(process.cwd())
const ARTIFACT_ROOT = path.join(WORKSPACE_ROOT, 'artifacts')
const BROWSER_ARTIFACT_ROOT = path.join(ARTIFACT_ROOT, 'browser')
const NOTE_ARTIFACT_ROOT = path.join(ARTIFACT_ROOT, 'notes')
const HISTORY_LOG_PATH = path.join(ARTIFACT_ROOT, 'task-history.jsonl')
const FILE_INDEX_PATH = path.join(ARTIFACT_ROOT, 'file-index.json')
const FASTER_WHISPER_TRANSCRIBE = process.env.OS_AGENT_TRANSCRIBE_BIN
  ?? '/Users/ddss/.agents/skills/faster-whisper/scripts/transcribe'
const PLANNER_API_KEY = process.env.OS_AGENT_PLANNER_API_KEY
  ?? process.env.DEEPSEEK_API_KEY
  ?? process.env.OPENAI_API_KEY
const PLANNER_MODE = process.env.OS_AGENT_PLANNER_MODE ?? (PLANNER_API_KEY ? 'llm' : 'rules')
const PLANNER_MODEL = process.env.OS_AGENT_PLANNER_MODEL
  ?? (process.env.DEEPSEEK_API_KEY ? 'deepseek-v4-flash' : 'gpt-4.1-mini')
const PLANNER_BASE_URL = (
  process.env.OS_AGENT_PLANNER_BASE_URL
  ?? process.env.DEEPSEEK_BASE_URL
  ?? process.env.OPENAI_BASE_URL
  ?? (process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com' : 'https://api.openai.com/v1')
).replace(/\/$/, '')
const PLANNER_PROVIDER = process.env.OS_AGENT_PLANNER_PROVIDER
  ?? (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'openai-compatible')
const RESEARCH_PROVIDER = process.env.OS_AGENT_RESEARCH_PROVIDER ?? (process.env.GEMINI_API_KEY ? 'gemini' : 'browser')
const RESEARCH_MODEL = process.env.OS_AGENT_RESEARCH_MODEL ?? 'gemini-3.5-flash'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const RESEARCH_PROXY_URL = process.env.OS_AGENT_RESEARCH_PROXY
  ?? process.env.HTTPS_PROXY
  ?? process.env.https_proxy
  ?? process.env.HTTP_PROXY
  ?? process.env.http_proxy
  ?? null

const DEFAULT_RUNTIME = {
  profile: process.env.OPENCLAW_PROFILE ?? 'meeting-system',
  gatewayPort: Number.parseInt(process.env.OPENCLAW_GATEWAY_PORT ?? '18890', 10),
}

const AGENTS = [
  { id: 'main', name: '主控助手', executor: 'supervisor', metric: '可路由本地能力', description: '理解用户目标、承接上下文、拆解任务并派发给合适的数字员工。' },
  { id: 'file-agent', name: '文件助手', executor: 'file', metric: '可读取工作区文件', description: '索引和检索本地项目文件，提取文件片段和结构信息。' },
  { id: 'research-agent', name: '研究助手', executor: 'gemini-search', metric: '可搜索与读网页', description: '统一处理联网问答、网页读取、搜索结果整理和轻量浏览器操作。' },
  { id: 'writing-agent', name: '文书助手', executor: 'writing', metric: '可撰写材料', description: '撰写、改写、总结文字材料，并可从录音转写生成纪要。' },
  { id: 'schedule-agent', name: '日程助手', executor: 'schedule', metric: '能力预留', description: '预留日程、提醒、排期和日历协同能力，当前先不执行具体动作。' },
  { id: 'app-agent', name: '应用助手', executor: 'system', metric: 'MVP 需要确认', description: '启动本机应用、准备系统动作，涉及敏感操作时先等待用户确认。' },
]

const CAPABILITY_REGISTRY = {
  'file-agent': {
    list_reports: {
      label: '列出已生成报告',
      description: '兼容能力。优先使用 list_saved_files，scope=reports。',
      args: {},
      deprecated: true,
    },
    count_reports: {
      label: '统计已生成报告数量',
      description: '兼容能力。优先使用 count_files，scope=reports。',
      args: {},
      deprecated: true,
    },
    list_saved_files: {
      label: '列出已保存文件',
      description: '列出 artifacts/notes 等生成物目录中的已保存文件，可按 notes/reports、关键词、格式筛选。只用于已保存/已生成/报告/笔记/产物，不用于项目源码工作区。',
      args: { scope: '可选：notes/reports', query: '可选，文件名关键词', format: '可选，md/doc/pdf/txt/html/docx' },
    },
    count_files: {
      label: '统计文件数量',
      description: '统计 artifacts/notes 等生成物目录中的已保存文件数量，可按 notes/reports、关键词、格式筛选。只用于已保存/已生成/报告/笔记/产物，不用于项目源码工作区。',
      args: { scope: '可选：notes/reports', query: '可选，文件名关键词', format: '可选，md/doc/pdf/txt/html/docx' },
    },
    list_files: {
      label: '列出工作区索引文件',
      description: '列出当前项目工作区/源码目录中可读取的文本文件清单，并说明每个文件的用途。',
      args: {},
    },
    list_paths: {
      label: '列出工作区索引文件路径',
      description: '列出当前工作区可读取文本文件的完整路径。',
      args: {},
    },
    search_files: {
      label: '检索工作区文件',
      description: '在当前工作区可读取文本文件中检索相关内容。',
      args: { query: '检索问题或关键词' },
    },
    read_file: {
      label: '读取并总结文件',
      description: '读取用户指定或最近保存的本地文件并总结内容。',
      args: { filePath: '可选，文件路径；不提供时尝试使用最近保存文件' },
    },
    save_previous_answer: {
      label: '保存上一轮内容',
      description: '将同一对话里的上一轮可见回答保存为 md/doc/txt/html 等文件。',
      args: { format: '可选，md/doc/txt/html/pdf/docx' },
    },
    save_report: {
      label: '保存上一步报告',
      description: '兼容能力。优先使用 write_file，把上一步输出保存为指定格式文件。',
      args: { title: '可选，报告主题标题', format: '可选，md/doc/txt/html/pdf/docx' },
      deprecated: true,
    },
    write_file: {
      label: '写入文件',
      description: '把上一步输出或上一轮可见内容写入工作区生成物目录，可指定标题、格式和目标路径。',
      args: { title: '可选，文件主题标题', format: '可选，md/doc/txt/html/pdf/docx', targetPath: '可选，目标文件路径', source: '可选：previous_result/previous_answer' },
    },
    convert_file: {
      label: '转换文件格式',
      description: '把一个可读取本地文件转换成指定格式。',
      args: { filePath: '源文件路径', format: '目标格式，例如 doc/md/pdf/html/txt' },
    },
    rewrite_file: {
      label: '改写文件',
      description: '读取一个本地文件，按用户要求精炼、润色、改写，并保存为新文件。',
      args: { filePath: '源文件路径', instruction: '改写要求', format: '可选目标格式' },
    },
    compare_files: {
      label: '比较文件版本',
      description: '比较两份本地文件并输出差异报告。',
      args: { filePaths: '两个文件路径数组', format: '可选，比较结果保存格式' },
    },
    manage_file: {
      label: '管理文件',
      description: '删除、重命名、移动或复制文件。执行前会要求确认。',
      args: { operation: 'delete/rename/move/copy', filePath: '源文件路径', targetPath: '可选目标路径' },
    },
    delete_files: {
      label: '删除文件',
      description: '删除一个或多个工作区文件；可按显式路径删除，也可在 artifacts/notes 等安全范围内按查询条件批量删除。执行前会要求确认。',
      args: { filePaths: '可选，文件路径数组', scope: '可选：notes/reports/workspace', query: '可选，文件名关键词', keep: '可选：latest 表示保留最新匹配文件' },
    },
    cleanup_reports: {
      label: '清理报告文件',
      description: 'delete_files 的兼容别名：批量清理默认报告目录里的报告文件，例如删除旧报告并保留最新报告。执行前会要求确认。',
      args: { keep: 'latest，表示保留最新报告', scope: '默认 reports，表示文件名包含报告的文件' },
      deprecated: true,
    },
  },
  'research-agent': {
    grounded_answer: {
      label: '联网研究问答',
      description: '使用联网检索/Google Search grounding 回答最新事实、公司背景、比较研究、市场动态等问题。',
      args: { query: '研究问题' },
    },
    read_url: {
      label: '读取网页',
      description: '读取并总结用户提供的 URL 页面。',
      args: { url: '网页 URL' },
    },
    browser_action: {
      label: '浏览器页面操作',
      description: '打开网页、点击页面元素或截图等轻量浏览器自动化。',
      args: { url: '可选 URL', instruction: '页面操作说明' },
    },
    weather: {
      label: '查询天气',
      description: '查询城市天气、气温、降雨等当前天气或未来预报。',
      args: { city: '城市名', day: '可选：today/tomorrow/day_after_tomorrow，或中文 今天/明天/后天' },
    },
  },
  'writing-agent': {
    draft_text: {
      label: '撰写材料',
      description: '起草文字材料、汇报、说明、提纲、文案等。',
      args: { instruction: '写作要求' },
    },
    polish_text: {
      label: '润色材料',
      description: '润色、优化、调整文字表达。',
      args: { text: '可选原文', instruction: '润色要求' },
    },
    summarize_text: {
      label: '总结材料',
      description: '总结已有文字内容。',
      args: { text: '可选原文或上下文', instruction: '总结要求' },
    },
    minutes_from_audio: {
      label: '录音转纪要',
      description: '识别本地录音文件，生成转写稿和会议纪要。',
      args: { audioPath: '录音文件路径' },
    },
  },
  'app-agent': {
    open_file: {
      label: '打开本地文件',
      description: '用系统默认应用打开指定文件或最近保存文件。',
      args: { filePath: '可选，文件路径；不提供时尝试使用最近保存文件' },
    },
    open_app: {
      label: '打开本地应用',
      description: '打开用户明确指定的本机应用，执行前可能需要确认。',
      args: { appName: '应用名称' },
    },
  },
  'schedule-agent': {},
}

function publicCapabilityRegistry() {
  return Object.fromEntries(Object.entries(CAPABILITY_REGISTRY).map(([agentId, capabilities]) => [
    agentId,
    Object.fromEntries(Object.entries(capabilities)
      .filter(([, spec]) => !spec.deprecated)
      .map(([capability, spec]) => [
        capability,
        {
          label: spec.label,
          description: spec.description,
          args: spec.args,
        },
      ])),
  ]))
}

function agentName(agentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.name ?? agentId
}

function hasCapability(agentId, capability) {
  return Boolean(CAPABILITY_REGISTRY[agentId]?.[capability])
}

function describeCapability(agentId, capability) {
  const spec = CAPABILITY_REGISTRY[agentId]?.[capability]
  return spec ? `${spec.label}（${capability}）` : capability
}

const OPENCLAW_AGENT_MAP = {
  'writing-agent': {
    profile: process.env.VISUAL_BRIDGE_MEETING_PROFILE ?? 'meeting-assistant',
    runtimeAgentId: 'meeting-assistant',
    gatewayPort: Number.parseInt(process.env.VISUAL_BRIDGE_MEETING_GATEWAY_PORT ?? '18920', 10),
  },
  main: {
    profile: process.env.VISUAL_BRIDGE_MAIN_PROFILE ?? 'meeting-supervisor',
    runtimeAgentId: 'supervisor-main',
    gatewayPort: Number.parseInt(process.env.VISUAL_BRIDGE_MAIN_GATEWAY_PORT ?? '18910', 10),
  },
}

const clients = new Set()
const activeTasks = new Map()
const pendingActions = new Map()
const taskRecords = new Map()
let cachedFileIndex = null
let cachedResearchProxyUrl = undefined
let eventSequence = 0

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload, null, 2))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function emitEvent(event) {
  eventSequence += 1
  const taskContext = event.taskId ? activeTasks.get(event.taskId) : null
  const stampedEvent = {
    ...event,
    threadId: event.threadId ?? taskContext?.threadId,
    eventId: `${Date.now()}-${eventSequence}`,
    at: new Date().toISOString(),
  }
  updateTaskRecord(stampedEvent)
  persistHistoryEvent(stampedEvent)
  const payload = `data: ${JSON.stringify({
    ...stampedEvent,
  })}\n\n`
  for (const client of clients) {
    try {
      client.write(payload)
    } catch {
      clients.delete(client)
    }
  }
}

function summarizeResult(result, error) {
  if (error) return truncateAtBoundary(error, 220)
  if (!result) return ''
  if (typeof result === 'string') return truncateAtBoundary(result, 220)
  const answer = result.answer
    ?? result.meta?.finalAssistantVisibleText
    ?? result.meta?.finalAssistantRawText
    ?? result.raw
  if (answer) return truncateAtBoundary(String(answer).replace(/\s+/g, ' '), 220)
  if (result.screenshotPath) return `截图：${result.screenshotPath}`
  return truncateAtBoundary(JSON.stringify(result), 220)
}

function truncateAtBoundary(value, maxLength = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  const slice = text.slice(0, maxLength)
  const boundary = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('；'),
    slice.lastIndexOf(';'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('\n'),
  )
  if (boundary > maxLength * 0.45) return `${slice.slice(0, boundary + 1).trim()}`
  return `${slice.replace(/[，,、：:；;。\s]*$/, '').trim()}…`
}

function buildChatReportPreview(results) {
  const source = results.find((item) => !item.result?.savedPath && !item.result?.files?.length)
    ?? results.find((item) => item.result?.answer)
  const answer = source?.result?.answer ?? source?.summary ?? ''
  if (!answer) return ''
  return truncateAtBoundary(answer, 320)
}

function compactResultForClient(result) {
  if (!result || typeof result === 'string') return result
  const compact = { ...result }
  if (Array.isArray(result.results)) {
    compact.results = result.results.map((item) => ({
      agentId: item.agentId,
      agentName: item.agentName,
      message: item.message,
      summary: item.summary,
      result: item.result?.savedPath || item.result?.files
        ? {
            answer: item.result.answer,
            files: item.result.files,
            savedPath: item.result.savedPath,
            format: item.result.format,
          }
        : {
            answer: summarizeResult(item.result),
          },
    }))
  }
  return compact
}

function updateTaskRecord(event) {
  if (!event.taskId) return
  const existing = taskRecords.get(event.taskId) ?? {
    taskId: event.taskId,
    agentId: event.agentId,
    message: event.message ?? '',
    threadId: event.threadId,
    status: 'running',
    startedAt: event.at,
    finishedAt: null,
    summary: '',
    artifacts: [],
    pendingAction: null,
    steps: [],
  }

  const next = {
    ...existing,
    agentId: event.type === 'task_started'
      ? event.agentId ?? existing.agentId
      : existing.agentId ?? event.agentId,
    message: event.message ?? existing.message,
    threadId: event.threadId ?? existing.threadId,
  }

  if (event.type === 'task_started') {
    next.status = 'running'
    next.startedAt = event.at
  }

  if (event.type === 'task_log') {
    next.steps = [
      ...next.steps.filter((step) => step.id !== event.stepId),
      {
        id: event.stepId ?? `${event.taskId}-${event.at}`,
        status: event.status ?? 'running',
        title: event.title ?? '执行日志',
        detail: event.detail ?? '',
        metric: event.metric ?? '',
        at: event.at,
      },
    ]
    if (event.title?.includes('截图') && event.detail) {
      next.artifacts = [...new Set([...next.artifacts, event.detail])]
    }
  }

  if (event.type === 'action_required') {
    next.status = 'waiting_confirmation'
    next.pendingAction = {
      actionId: event.actionId,
      title: event.title,
      detail: event.detail,
    }
  }

  if (event.type === 'task_finished' || event.type === 'task_failed') {
    next.status = event.type === 'task_failed' ? 'failed' : 'done'
    next.finishedAt = event.at
    next.pendingAction = null
    next.summary = summarizeResult(event.result, event.error)
    if (event.result?.screenshotPath) {
      next.artifacts = [...new Set([...next.artifacts, event.result.screenshotPath])]
    }
  }

  taskRecords.set(event.taskId, next)
}

async function persistHistoryEvent(event) {
  if (!event.taskId) return
  await mkdir(ARTIFACT_ROOT, { recursive: true }).catch(() => {})
  await appendFile(HISTORY_LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8').catch((error) => {
    console.error(`[history] failed to append: ${error.message}`)
  })
}

async function readHistory(limit = 20) {
  const fromMemory = [...taskRecords.values()]
  if (fromMemory.length) {
    return fromMemory
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, limit)
  }

  const text = await readFile(HISTORY_LOG_PATH, 'utf8').catch(() => '')
  for (const line of text.trim().split('\n').filter(Boolean)) {
    try {
      updateTaskRecord(JSON.parse(line))
    } catch {
      // Ignore malformed partial lines.
    }
  }
  return [...taskRecords.values()]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, limit)
}

async function readHistoryEvents() {
  const text = await readFile(HISTORY_LOG_PATH, 'utf8').catch(() => '')
  return text.trim().split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  }).filter(Boolean)
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(650)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

async function runtimeSnapshot() {
  const openclawRuntime = OPENCLAW_AGENT_MAP['writing-agent'] ?? DEFAULT_RUNTIME
  const gatewayListening = await checkPort(openclawRuntime.gatewayPort)
  return {
    ok: true,
    profile: 'local-os-agent',
    message: '本地执行桥已连接',
    runtimeRoot: RUNTIME_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
    gateway: {
      port: openclawRuntime.gatewayPort,
      url: `ws://127.0.0.1:${openclawRuntime.gatewayPort}`,
      listening: gatewayListening,
    },
    activeTasks: [...activeTasks.values()],
    pendingActions: [...pendingActions.values()].map((action) => ({
      actionId: action.actionId,
      taskId: action.taskId,
      agentId: action.agentId,
      type: action.type,
      title: action.title,
      detail: action.detail,
    })),
    planner: {
      mode: PLANNER_MODE === 'llm' && PLANNER_API_KEY ? 'llm' : 'rules',
      requestedMode: PLANNER_MODE,
      provider: PLANNER_PROVIDER,
      model: PLANNER_MODEL,
      baseUrl: PLANNER_BASE_URL,
      configured: Boolean(PLANNER_API_KEY),
    },
    research: {
      provider: RESEARCH_PROVIDER,
      model: RESEARCH_MODEL,
      configured: Boolean(GEMINI_API_KEY),
    },
    fileIndex: cachedFileIndex
      ? {
          builtAt: cachedFileIndex.builtAt,
          fileCount: cachedFileIndex.files.length,
        }
      : null,
    agents: AGENTS,
  }
}

function classifyAgent(message, requestedAgentId) {
  if (requestedAgentId === 'browser-agent') return 'research-agent'
  if (requestedAgentId === 'meeting-agent') return 'writing-agent'
  if (requestedAgentId) return requestedAgentId
  return 'main'
}

function classifyCapability(message) {
  const text = message.toLowerCase()
  const fallbackIntent = inferFallbackIntent(message)
  if (fallbackIntent.agentId) return fallbackIntent.agentId
  if (/录音|音频|转写|听写|语音识别|transcribe|audio|mp3|m4a|wav/.test(text)) return 'writing-agent'
  if (/(本地|工作区|项目|代码|readme|文件|目录|repo|code|file|folder).*(搜索|查找|找出|列|读|看)|文件|目录|项目|readme|代码|file|folder|repo|code/.test(text)) return 'file-agent'
  if (/(开会|拜访|客户|银行|公司|机构).*(准备|背景|资料|信息|调研|研究)|浦发|背景信息|公开信息|资料|搜索|查一下|了解一下/.test(text)) return 'research-agent'
  if (/日程|排期|提醒|待办|calendar|schedule|reminder/.test(text) && !/打开|启动|open/.test(text)) return 'schedule-agent'
  if (/会议纪要|纪要|材料|文案|撰写|起草|改写|润色|总结成|minutes|draft|writing/.test(text)) return 'writing-agent'
  if (/应用|启动|系统|微信|邮件|日历|chrome|safari|finder|terminal|app|system|mail/.test(text)) return 'app-agent'
  if (/今天|最新|新闻|发布|实时|现在|recent|latest|news|today/.test(text)) return 'research-agent'
  if (/网页|浏览器|官网|新闻|browser|web|url|https?:\/\//.test(text)) return 'research-agent'
  return 'file-agent'
}

function splitTaskMessage(message) {
  const parts = message
    .split(/(?:然后|再|并且|，然后|，再|。|；|;|\n)+/u)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length ? parts : [message]
}

function buildRuleSupervisorPlan(message) {
  const fallbackIntent = inferFallbackIntent(message)
  if (fallbackIntent.answer) return []
  if (fallbackIntent.agentId) return [{ agentId: fallbackIntent.agentId, message }]
  if (isExternalMeetingPrep(message)) {
    return buildExternalMeetingResearchPlan(message)
  }

  const parts = splitTaskMessage(message)
  const steps = parts.map((part) => ({
    agentId: classifyCapability(part),
    message: part,
  }))

  if (steps.length === 1 && steps[0].message !== message) {
    steps[0].message = message
  }

  return steps.filter((step, index, array) => {
    const previous = array[index - 1]
    return !previous || previous.agentId !== step.agentId || previous.message !== step.message
  })
}

function normalizePlannerSteps(steps) {
  const allowedAgentIds = new Set(AGENTS.map((agent) => agent.id).filter((id) => id !== 'main'))
  const normalized = Array.isArray(steps)
    ? steps
        .map((step) => ({
          agentId: allowedAgentIds.has(step?.agentId) ? step.agentId : null,
          message: String(step?.message ?? '').trim(),
        }))
        .filter((step) => step.agentId && step.message)
    : []
  return normalized
}

function normalizeCapabilityWorkflow(workflow, originalMessage) {
  const allowedAgentIds = new Set(AGENTS.map((agent) => agent.id).filter((id) => id !== 'main'))
  return Array.isArray(workflow)
    ? workflow
        .map((step) => {
          const agentId = allowedAgentIds.has(step?.agentId) ? step.agentId : null
          const capability = String(step?.capability ?? '').trim()
          const message = String(step?.message ?? step?.instruction ?? originalMessage ?? '').trim()
          const args = step?.args && typeof step.args === 'object' && !Array.isArray(step.args)
            ? step.args
            : {}
          if (!agentId || !capability || !message) return null
          return {
            agentId,
            capability,
            args,
            message,
          }
        })
        .filter(Boolean)
    : []
}

function normalizeMissingCapabilities(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        agentId: typeof item?.agentId === 'string' ? item.agentId : null,
        capability: String(item?.capability ?? item?.name ?? '').trim(),
        reason: String(item?.reason ?? item?.description ?? '').trim(),
      })).filter((item) => item.capability)
    : []
}

function validateCapabilityWorkflow(workflow) {
  return workflow
    .filter((step) => !hasCapability(step.agentId, step.capability))
    .map((step) => ({
      agentId: step.agentId,
      capability: step.capability,
      reason: `${agentName(step.agentId)}当前没有注册 ${step.capability} 能力。`,
    }))
}

function formatMissingCapabilities(missingCapabilities) {
  const lines = missingCapabilities.map((item, index) => {
    const owner = item.agentId ? agentName(item.agentId) : '未定助手'
    const reason = item.reason ? `：${item.reason}` : ''
    return `${index + 1}. ${owner} / ${item.capability}${reason}`
  })
  return [
    '我已经识别出你要做的事，但当前能力清单里缺少对应执行能力，所以这次不会用别的能力硬凑。',
    '',
    '缺少的能力：',
    ...lines,
    '',
    '把这些能力补进对应助手后，再让主控从能力清单里选择执行。'
  ].join('\n')
}

function ensureReportSaveWorkflow(message, workflow) {
  if (!wantsReportFileOutput(message)) return workflow
  if (workflow.some((step) => step.agentId === 'file-agent' && (step.capability === 'write_file' || step.capability === 'save_report'))) return workflow
  const hasContentProducer = workflow.some((step) => step.agentId !== 'file-agent')
  if (!hasContentProducer) return workflow
  return [
    ...workflow,
    {
      agentId: 'file-agent',
      capability: 'write_file',
      args: {
        format: inferReportFormat(message),
        source: 'previous_result',
      },
      message: '将上一步输出写入合适命名的文件',
    },
  ]
}

function finalizeSupervisorWorkflow(message, workflow) {
  return ensureReportSaveWorkflow(message, normalizeCapabilityWorkflow(workflow, message))
}

function inferMandatoryCapabilityWorkflow(message) {
  if (isWeatherRequest(message)) {
    const city = extractWeatherCity(message)
    const day = extractWeatherDay(message)
    const dayArgMap = {
      今天: 'today',
      明天: 'tomorrow',
      后天: 'day_after_tomorrow',
    }
    return {
      intent: 'research',
      confidence: 0.96,
      needsTool: true,
      steps: [
        {
          agentId: 'research-agent',
          capability: 'weather',
          args: {
            city,
            day: dayArgMap[day.label] ?? 'today',
          },
          message,
        },
      ],
    }
  }
  return null
}

function isOpenFileRequest(message) {
  return /(?:打开|再打开|重新打开|\bopen\b).*(文件|报告|文档|docx?|pdf|md|txt|html)|\.(?:docx?|pdf|md|txt|html)\s*(这个|那个)?$/i
    .test(message)
}

function wantsReportFileOutput(message) {
  if (isOpenFileRequest(message)) return false
  return /(形成|生成|整理成|写成|保存|导出).*(报告|信息报告|文档|docx?|word|pdf|md|markdown|文件)|报告.*(保存|生成|形成|文档|文件|docx?|word|pdf|md|markdown)/i
    .test(message)
}

function parseIntentEnvelope(parsed) {
  const intent = typeof parsed.intent === 'string' ? parsed.intent : 'unspecified'
  const confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null
  const needsTool = typeof parsed.needsTool === 'boolean' ? parsed.needsTool : null
  return { intent, confidence, needsTool }
}

function buildSupervisorBrief(message, plan, source) {
  const routeLabel = source === 'llm'
    ? `${PLANNER_PROVIDER}/${PLANNER_MODEL}`
    : source === 'meeting-research'
      ? '研究助手先检索公开信息'
      : source
  if (source === 'meeting-research') {
    return [
      `收到，我先帮你把「去浦发开会」这件事铺一下底。`,
      '我会先让研究助手查浦发的公开背景和近期重点，再整理会前准备、切入角度，以及还需要问你的几个关键问题。',
      `执行方式：${routeLabel}`,
    ].join('\n')
  }

  const dispatchLines = plan.map((step, index) => {
    const agentName = AGENTS.find((agent) => agent.id === step.agentId)?.name ?? step.agentId
    const capability = step.capability ? ` / ${describeCapability(step.agentId, step.capability)}` : ''
    const visibleMessage = step.message.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? step.message
    return `${index + 1}. ${agentName}${capability}：${visibleMessage}`
  })
  if (plan.length === 1) {
    const agentName = AGENTS.find((agent) => agent.id === plan[0].agentId)?.name ?? plan[0].agentId
    const capability = plan[0].capability ? ` / ${describeCapability(plan[0].agentId, plan[0].capability)}` : ''
    const visibleMessage = plan[0].message.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? plan[0].message
    return [
      `收到，我先按「${message}」来处理。`,
      `我会调用${agentName}${capability}：${visibleMessage}`,
      `调度：${routeLabel}`,
    ].join('\n')
  }
  return [
    `收到，我先按「${message}」来处理。`,
    `这件事我会分 ${plan.length} 步走：`,
    ...dispatchLines,
    `调度：${routeLabel}`,
  ].join('\n')
}

function requiresResearch(message) {
  if (inferFallbackIntent(message).answer) return false
  return /天气|气温|温度|下雨|降雨|空气|今天|明天|后天|最新|新闻|发布|实时|现在|recent|latest|news|today|tomorrow|weather/i.test(message)
}

function isImplicitRecentDocumentSummary(message) {
  const text = message.trim()
  if (text.length > 36) return false
  return /^(主要内容是啥|主要内容是什么|讲了啥|讲了什么|说了啥|说了什么|总结一下|概括一下|摘要|内容呢)[？?。.\s]*$/.test(text)
    || /(主要内容|讲了啥|讲了什么|总结|概括|摘要)/.test(text)
}

function inferRuntimeFollowupIntent(message, runtimeContext = {}) {
  const recentSavedFile = runtimeContext.recentSavedFile
  const explicitFilePath = extractFirstFilePath(message)
  if (explicitFilePath && /(这个|那个|打开|再打开|重新打开|open)|\.(?:docx?|pdf|md|txt|html)\s*$/i.test(message)) {
    return {
      intent: 'open_referenced_file',
      confidence: 0.92,
      needsTool: true,
      steps: [
        {
          agentId: 'app-agent',
          capability: 'open_file',
          args: { filePath: explicitFilePath },
          message: `打开文件 ${explicitFilePath}`,
        },
      ],
    }
  }
  if (recentSavedFile?.relativePath && isImplicitRecentDocumentSummary(message)) {
    return {
      intent: 'read_saved_document',
      confidence: 0.9,
      needsTool: true,
      steps: [
        {
          agentId: 'file-agent',
          capability: 'read_file',
          args: { filePath: recentSavedFile.relativePath },
          message: `读取最近保存的报告 ${recentSavedFile.relativePath}，总结主要内容`,
        },
      ],
    }
  }
  return null
}

function inferFallbackIntent(message) {
  const text = message.trim()
  if (isSocialChat(text)) {
    return {
      intent: 'social_chat',
      confidence: 0.95,
      needsTool: false,
      answer: buildSocialChatAnswer(text),
    }
  }
  if (/(刚|最近|上一个|这个).*(报告|文档|文件).*(讲了啥|讲了什么|总结|摘要|内容)|读.*(报告|文档|文件)|总结.*(报告|文档|文件)/.test(text)) {
    return {
      intent: 'read_saved_document',
      confidence: 0.86,
      needsTool: true,
      agentId: 'file-agent',
    }
  }
  if (/(删除|删掉|移除|重命名|改名|移动|挪到|复制|拷贝).*(文件|报告|文档|artifacts\/notes|\.md|\.docx?|\.pdf|\.txt|\.html)/i.test(text)) {
    return {
      intent: 'file_management',
      confidence: 0.88,
      needsTool: true,
      agentId: 'file-agent',
    }
  }
  if (/(录音|音频|转写|听写|语音识别|会议录音|会议音频|transcribe|audio|mp3|m4a|wav)/i.test(text)) {
    return {
      intent: 'writing_audio',
      confidence: 0.9,
      needsTool: true,
      agentId: 'writing-agent',
    }
  }
  if (/(保存|生成|形成|写成).*(报告|文档|doc|文件).*(打开)?|打开.*(刚保存|已保存|报告|文档|文件)/.test(text)) {
    return {
      intent: 'document_workflow',
      confidence: 0.82,
      needsTool: true,
      agentId: null,
    }
  }
  return {
    intent: 'unknown',
    confidence: 0.2,
    needsTool: null,
    agentId: null,
    answer: null,
  }
}

function isSocialChat(message) {
  const text = message.trim().toLowerCase()
  return /^(hi|hello|hey|你好|您好|哈喽|嗨)[！!。.\s]*$/i.test(text)
    || /(你|主控|助手|你们).*(今天|现在|刚才)?(过得|过的|咋样|怎么样|还好吗|累不累|忙不忙|在干嘛|干啥|心情|状态)/.test(text)
    || /(今天|现在).*(过得|过的).*(咋样|怎么样)/.test(text)
}

function buildSocialChatAnswer(message) {
  if (/过得|过的/.test(message)) {
    return '还挺充实的。刚刚一直在陪你把这个多智能体工作台往顺手、靠谱的方向磨：路由、报告生成、文件读取、展示细节都修了一轮。现在感觉脑子热着，但状态不错。你今天怎么样？'
  }
  if (/在干嘛|干啥|忙不忙/.test(message)) {
    return '我在这儿待命，也顺手盯着这个工作台的运行状态。你抛目标过来，我先判断要不要派活；闲聊也可以，不需要每句话都进工具链。'
  }
  return '在呢。你直接说就好，闲聊我会直接接住；需要查资料、读文件、开应用时我再派给对应助手。'
}

function isExternalMeetingPrep(message) {
  return /(开会|拜访|客户会|见客户).*(准备|背景|资料|信息|调研|研究|问题)|浦发.*(开会|准备|背景|资料|信息|调研|研究)/.test(message)
}

function buildExternalMeetingResearchPlan(message) {
  return [
    {
      agentId: 'research-agent',
      capability: 'grounded_answer',
      args: { query: message },
      message: [
        message,
        '请先搜索公开信息，不要先追问。',
        '重点整理：机构背景、近期动态、业务重点、可能关心的议题、会前准备清单，以及仍需要向用户确认的少量关键问题。',
      ].join('\n'),
    },
  ]
}

function isSaveControlMessage(message) {
  return /保存|存起来|存一下|记下来|写成.*文件|落.*文件|导出|存成|保存成|刚才.*内容|刚才.*整理|你来定|你决定|随便|都行/.test(message)
}

function isSaveClarificationAnswer(answer) {
  return /保存哪部分|什么文件名|保存成什么文件名|保存到哪个文件夹|希望.*文件名|希望.*保存到/.test(answer)
}

function inferSaveFormat(message, context = []) {
  const text = [
    message,
    ...context.slice(-3).map((item) => item.user ?? ''),
  ].join('\n').toLowerCase()
  if (/\bdocx\b/.test(text)) return 'docx'
  if (/\bdoc\b|word|文档/.test(text)) return 'doc'
  if (/\btxt\b|纯文本|文本/.test(text)) return 'txt'
  if (/\bhtml?\b|网页/.test(text)) return 'html'
  if (/\bmd\b|markdown/.test(text)) return 'md'
  return 'md'
}

function saveFormatLabel(format) {
  const labels = {
    md: 'Markdown',
    txt: 'TXT',
    html: 'HTML',
    doc: 'Word 可打开的 DOC',
    docx: '原生 DOCX',
    pdf: 'PDF',
  }
  return labels[format] ?? format.toUpperCase()
}

function normalizeArtifactPath(value) {
  if (!value) return null
  const cleaned = String(value)
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’。]+$/g, '')
  if (!cleaned) return null
  return path.isAbsolute(cleaned)
    ? cleaned
    : path.resolve(WORKSPACE_ROOT, cleaned)
}

async function resolveExistingFileReference(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’。]+$/g, '')
  if (!cleaned) return null

  const direct = normalizeArtifactPath(cleaned)
  if (direct && existsSync(direct)) return direct

  const baseName = path.basename(cleaned)
  if (!baseName || baseName === '.' || !/\.[A-Za-z0-9]+$/.test(baseName)) return null

  const noteFiles = await readdir(NOTE_ARTIFACT_ROOT, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(noteFiles
    .filter((entry) => entry.isFile() && !entry.name.startsWith('~$'))
    .filter((entry) => {
      if (entry.name === baseName) return true
      if (entry.name.endsWith(`-${baseName}`)) return true
      const compactEntry = entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, '')
      return compactEntry === baseName
    })
    .map(async (entry) => {
      const filePath = path.join(NOTE_ARTIFACT_ROOT, entry.name)
      const fileStat = await stat(filePath).catch(() => null)
      return {
        filePath,
        score: entry.name === baseName ? 3 : entry.name.endsWith(`-${baseName}`) ? 2 : 1,
        mtimeMs: fileStat?.mtimeMs ?? 0,
      }
    }))

  return candidates
    .sort((a, b) => (b.score - a.score) || (b.mtimeMs - a.mtimeMs))[0]?.filePath ?? null
}

function inferReportFormat(message) {
  if (/\bdocx\b/i.test(message)) return 'docx'
  if (/\bpdf\b/i.test(message)) return 'pdf'
  if (/\bdoc\b|Word|文档/i.test(message)) return 'doc'
  if (/\bhtml?\b/i.test(message)) return 'html'
  if (/\btxt\b|纯文本|文本/i.test(message)) return 'txt'
  if (/\bmd\b|markdown/i.test(message)) return 'md'
  return 'doc'
}

function inferRequestedReportPath(message, fallbackTitle) {
  const format = inferReportFormat(message)
  const explicitPath = message.match(/((?:\/|artifacts\/notes\/)[^\s，。；;]+?\.(?:docx|doc|pdf|html|txt|md))/i)?.[1]
  if (explicitPath && !isGenericReportFileName(path.basename(explicitPath))) return normalizeArtifactPath(explicitPath)

  const namedFile = message.match(/文件名(?:为|是)?['"“”‘’]?([^'"“”‘’，。；;\s]+?\.(?:docx|doc|pdf|html|txt|md))['"“”‘’]?/i)?.[1]
    ?? message.match(/保存(?:为|成)?['"“”‘’]?([^'"“”‘’，。；;\s]+?\.(?:docx|doc|pdf|html|txt|md))['"“”‘’]?/i)?.[1]
  if (namedFile && !isGenericReportFileName(namedFile)) return path.join(NOTE_ARTIFACT_ROOT, namedFile)

  const date = new Date().toISOString().slice(0, 10)
  return path.join(NOTE_ARTIFACT_ROOT, `${date}-${slugifyFilename(fallbackTitle)}.${format}`)
}

function cleanInferredSubject(value) {
  return String(value ?? '')
    .replace(/^(一下|一些|有关|关于|围绕|搜索|搜搜|查查|调研|整理|给我|帮我|请|形成|生成|做个|做一份|一个|一份)+/, '')
    .replace(/(的信息|的资料|的背景|的相关介绍|相关介绍|信息报告|报告|财报|文档|文件|资料)$/g, '')
    .trim()
}

function isGenericReportTitle(value) {
  const compact = String(value ?? '')
    .replace(/\.(?:docx?|pdf|html|txt|md)$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/(给我|帮我|请|形成|生成|整理|保存|一个|一份|有关|关于|信息报告|报告|文档|文件|资料|内容|看看|打开)/g, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  return compact.length < 2
}

function isGenericReportFileName(fileName) {
  return isGenericReportTitle(path.basename(fileName, path.extname(fileName)))
}

function inferTitleFromAnswer(answer) {
  const text = String(answer ?? '').trim()
  if (!text) return ''

  const heading = text.match(/^#{1,3}\s+(.{2,50}?)(?:\n|$)/m)?.[1]
  if (heading && !isGenericReportTitle(heading)) return heading.replace(/[:：]\s*$/, '').trim()

  const namedReport = text.match(/(?:^|\n)\s*(?:#*\s*)?([\u4e00-\u9fa5A-Za-z0-9 .·（）()_-]{2,40}(?:对比|分析|介绍|信息|调研|研究|报告)[\u4e00-\u9fa5A-Za-z0-9 .·（）()_-]{0,18})(?:\n|$)/)?.[1]
  if (namedReport && !isGenericReportTitle(namedReport)) return namedReport.trim()

  const conclusionSubject = text.match(/(?:核心结论|结论)[:：]?\s*(?:\*\*)?([\u4e00-\u9fa5A-Za-z0-9 .·（）()_-]{2,28})(?:\*\*)?(?:（|\(|目前|是|为|，|,|：|:|\s)/)?.[1]
  const cleanedConclusion = cleanInferredSubject(conclusionSubject)
  if (cleanedConclusion && !isGenericReportTitle(cleanedConclusion)) return `${cleanedConclusion}信息报告`

  const entitySubject = text.match(/(?:^|\n)\s*(?:\*\*)?([\u4e00-\u9fa5A-Za-z0-9 .·（）()_-]{2,28})(?:\*\*)?(?:（[^）]+）)?(?:是一家|是中国|成立于|目前正|位于)/)?.[1]
  const cleanedEntity = cleanInferredSubject(entitySubject)
  if (cleanedEntity && !isGenericReportTitle(cleanedEntity)) return `${cleanedEntity}信息报告`

  return ''
}

function inferNoteTitle(sourceMessage, answer = '') {
  const subjectMatch = sourceMessage.match(/(?:有关|关于|围绕|搜索|搜搜|查查|调研|整理|参观|拜访|去)([\u4e00-\u9fa5A-Za-z0-9]{2,18})/)
    ?? sourceMessage.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,18})(?:的信息|的资料|的背景|报告|财报|开会|参观|拜访)/)
  if (subjectMatch?.[1]) {
    const subject = cleanInferredSubject(subjectMatch[1])
    if (subject && !isGenericReportTitle(subject)) {
      if (/会议|开会|参观|拜访/.test(sourceMessage)) return `${subject}会前准备`
      if (/报告|doc|文档|资料|信息|调研|搜索|搜搜|查查/.test(sourceMessage)) return `${subject}信息报告`
      return subject
    }
  }
  const answerTitle = inferTitleFromAnswer(answer)
  if (answerTitle) return answerTitle
  if (/会议|开会|参观|拜访/.test(sourceMessage)) return '会前准备'
  const compact = sourceMessage
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '')
    .slice(0, 18)
  return compact && !isGenericReportTitle(compact) ? compact : '保存内容'
}

function slugifyFilename(title) {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40) || '保存内容'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stripMarkdown(value) {
  return String(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/^\s*>+\s?/gm, '')
}

function markdownToBasicHtml(value) {
  const lines = String(value).split(/\r?\n/)
  return lines.map((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = Math.min(heading[1].length, 4)
      return `<h${level}>${escapeHtml(stripMarkdown(heading[2]))}</h${level}>`
    }
    if (/^\s*[-*]\s+/.test(line)) {
      return `<p>&bull; ${escapeHtml(stripMarkdown(line.replace(/^\s*[-*]\s+/, '')))}</p>`
    }
    if (/^-{3,}$/.test(line.trim())) return '<hr />'
    if (!line.trim()) return ''
    return `<p>${escapeHtml(stripMarkdown(line))}</p>`
  }).join('\n')
}

function buildSavedContent({ title, sourceMessage, answer, format }) {
  const savedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const markdown = [
    `# ${title}`,
    '',
    `- 保存时间：${savedAt}`,
    sourceMessage ? `- 来源问题：${sourceMessage}` : null,
    '',
    '---',
    '',
    answer.trim(),
    '',
  ].filter((line) => line !== null).join('\n')

  if (format === 'txt') return stripMarkdown(markdown)

  if (format === 'html' || format === 'doc') {
    return [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8">',
      `<title>${escapeHtml(title)}</title>`,
      '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65;color:#111827;padding:32px;}h1,h2,h3,h4{line-height:1.35;}hr{border:0;border-top:1px solid #d1d5db;margin:20px 0;}p{margin:8px 0;}</style>',
      '</head>',
      '<body>',
      markdownToBasicHtml(markdown),
      '</body>',
      '</html>',
      '',
    ].join('\n')
  }

  return markdown
}

async function writeDocxFile(filePath, { title, sourceMessage, answer }) {
  const payloadPath = path.join(ARTIFACT_ROOT, `docx-payload-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.json`)
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeFile(payloadPath, JSON.stringify({ title, sourceMessage, answer }), 'utf8')
  const script = String.raw`
import json, sys
from docx import Document

payload_path, output_path = sys.argv[1], sys.argv[2]
with open(payload_path, 'r', encoding='utf-8') as f:
    payload = json.load(f)

doc = Document()
doc.add_heading(payload.get('title') or '文档', 0)
if payload.get('sourceMessage'):
    doc.add_paragraph('来源：' + payload['sourceMessage'])
for block in str(payload.get('answer') or '').split('\n'):
    text = block.strip()
    if not text:
        continue
    if text.startswith('#'):
        doc.add_heading(text.lstrip('#').strip(), level=1)
    elif text.startswith(('- ', '* ')):
        doc.add_paragraph(text[2:].strip(), style='List Bullet')
    else:
        doc.add_paragraph(text)
doc.save(output_path)
`
  const result = runCommand('python3', ['-c', script, payloadPath, filePath], { timeout: 15000 })
  await rm(payloadPath, { force: true }).catch(() => {})
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '生成 DOCX 失败')
  }
}

async function writePdfFile(filePath, { title, sourceMessage, answer }) {
  const payloadPath = path.join(ARTIFACT_ROOT, `pdf-payload-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.json`)
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeFile(payloadPath, JSON.stringify({ title, sourceMessage, answer }), 'utf8')
  const script = String.raw`
import json, sys
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
except Exception:
    print('missing reportlab', file=sys.stderr)
    sys.exit(12)

payload_path, output_path = sys.argv[1], sys.argv[2]
with open(payload_path, 'r', encoding='utf-8') as f:
    payload = json.load(f)
c = canvas.Canvas(output_path, pagesize=A4)
width, height = A4
y = height - 48
for line in [payload.get('title') or '文档', payload.get('sourceMessage') or '', ''] + str(payload.get('answer') or '').split('\n'):
    safe = line.encode('latin-1', 'replace').decode('latin-1')
    c.drawString(48, y, safe[:95])
    y -= 16
    if y < 48:
        c.showPage()
        y = height - 48
c.save()
`
  const result = runCommand('python3', ['-c', script, payloadPath, filePath], { timeout: 15000 })
  await rm(payloadPath, { force: true }).catch(() => {})
  if (result.status === 12) {
    throw new Error('PDF 生成需要 reportlab 或 pandoc，目前本机未安装；我可以先保存成 docx/doc/html。')
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '生成 PDF 失败')
  }
}

async function writeSavedFile(filePath, { title, sourceMessage, answer, format }) {
  await mkdir(path.dirname(filePath), { recursive: true })
  if (format === 'docx') {
    await writeDocxFile(filePath, { title, sourceMessage, answer })
    return
  }
  if (format === 'pdf') {
    await writePdfFile(filePath, { title, sourceMessage, answer })
    return
  }
  await writeFile(filePath, buildSavedContent({ title, sourceMessage, answer, format }), 'utf8')
}

async function saveReportFromResult({ taskId, agentId, userMessage, stepMessage, previousResult, format: requestedFormat, title: requestedTitle }) {
  const answer = previousResult?.answer
    ?? previousResult?.summary
    ?? (typeof previousResult === 'string' ? previousResult : '')
  if (!answer || !String(answer).trim()) {
    return {
      answer: '前一步还没有可写入报告的内容，所以没有生成文件。',
    }
  }

  const pathHint = `${userMessage}\n${stepMessage}\n${requestedFormat ?? ''}\n${requestedTitle ?? ''}`
  const format = requestedFormat ?? inferReportFormat(pathHint)
  const title = (requestedTitle || inferNoteTitle(userMessage, answer)).replace(/参观准备$/, '信息报告')
  const filePath = inferRequestedReportPath(`${pathHint}\n保存为 ${slugifyFilename(title)}.${format}`, title)
  const relativePath = path.relative(WORKSPACE_ROOT, filePath)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-report`,
    status: 'running',
    title: '生成报告文件',
    detail: `准备写入 ${relativePath}`,
    metric: `写入 ${saveFormatLabel(format)}`,
    bubble: '保存',
  })

  await writeSavedFile(filePath, {
    title,
    sourceMessage: userMessage,
    answer: String(answer),
    format,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-report`,
    status: 'done',
    title: '生成报告文件',
    detail: `已写入 ${relativePath}`,
    metric: '报告已保存',
    bubble: '完成',
  })

  return {
    answer: `报告已生成：${relativePath}`,
    files: [relativePath],
    savedPath: filePath,
    format,
  }
}

async function findLastSaveableAnswer(currentTaskId, threadId) {
  const events = await readHistoryEvents()
  const startedMessages = new Map()
  const startedThreads = new Map()
  for (const event of events) {
    if (event.type === 'task_started' && event.taskId && event.message) {
      startedMessages.set(event.taskId, event.message)
      if (event.threadId) startedThreads.set(event.taskId, event.threadId)
    }
  }

  for (const event of [...events].reverse()) {
    if (event.taskId === currentTaskId) continue
    if (event.type !== 'task_finished') continue
    const eventThreadId = event.threadId ?? startedThreads.get(event.taskId)
    if (threadId && eventThreadId && eventThreadId !== threadId) continue
    const answer = event.result?.answer
    if (!answer || typeof answer !== 'string') continue
    const sourceMessage = startedMessages.get(event.taskId) ?? ''
    if (isSaveControlMessage(sourceMessage)) continue
    if (isSaveClarificationAnswer(answer)) continue
    return {
      taskId: event.taskId,
      sourceMessage,
      answer,
    }
  }
  return null
}

async function findRecentSavedFile(currentTaskId, threadId) {
  const files = await findRecentSavedFiles(currentTaskId, threadId, 1)
  return files[0] ?? null
}

function collectSavedFilesFromResult(result, bucket = []) {
  if (!result || typeof result !== 'object') return bucket
  if (Array.isArray(result.sourceFiles)) {
    for (const sourceFile of result.sourceFiles) {
      const candidatePath = normalizeArtifactPath(sourceFile)
      if (candidatePath && existsSync(candidatePath)) {
        bucket.push({
          path: candidatePath,
          relativePath: path.relative(WORKSPACE_ROOT, candidatePath),
          format: path.extname(candidatePath).replace(/^\./, ''),
        })
      }
    }
  }
  if (result.savedPath || result.files?.length) {
    const savedPath = result.savedPath
    const relativePath = result.files?.find((file) => String(file).startsWith('artifacts/notes/'))
    const candidatePath = savedPath ?? (relativePath ? path.resolve(WORKSPACE_ROOT, relativePath) : null)
    if (candidatePath && existsSync(candidatePath)) {
      bucket.push({
        path: candidatePath,
        relativePath: relativePath ?? path.relative(WORKSPACE_ROOT, candidatePath),
        format: result.format ?? path.extname(candidatePath).replace(/^\./, ''),
      })
    }
  }
  if (Array.isArray(result.results)) {
    for (const item of result.results) collectSavedFilesFromResult(item.result, bucket)
  }
  return bucket
}

async function findRecentSavedFiles(currentTaskId, threadId, limit = 6) {
  const events = await readHistoryEvents()
  const startedThreads = new Map()
  for (const event of events) {
    if (event.type === 'task_started' && event.taskId && event.threadId) {
      startedThreads.set(event.taskId, event.threadId)
    }
  }

  const collect = (strictThread) => {
    const seen = new Set()
    const matches = []
    for (const event of [...events].reverse()) {
      if (event.taskId === currentTaskId || event.type !== 'task_finished') continue
      const eventThreadId = event.threadId ?? startedThreads.get(event.taskId)
      if (threadId && strictThread && eventThreadId !== threadId) continue
      for (const file of collectSavedFilesFromResult(event.result)) {
        if (seen.has(file.path)) continue
        seen.add(file.path)
        matches.push(file)
        if (matches.length >= limit) return matches
      }
    }
    return matches
  }

  if (threadId) {
    const strictMatches = collect(true)
    if (strictMatches.length) return strictMatches
  }
  return collect(false)
}

async function buildSupervisorRuntimeContext(taskId, threadId) {
  const recentSavedFile = await findRecentSavedFile(taskId, threadId).catch(() => null)
  return {
    workspaceRoot: WORKSPACE_ROOT,
    defaultSaveDir: path.relative(WORKSPACE_ROOT, NOTE_ARTIFACT_ROOT),
    defaultSaveDirAbsolute: NOTE_ARTIFACT_ROOT,
    supportedSaveFormats: ['md', 'txt', 'html', 'doc', 'docx', 'pdf'],
    recentSavedFile: recentSavedFile
      ? {
          relativePath: recentSavedFile.relativePath,
          absolutePath: recentSavedFile.path,
          format: recentSavedFile.format,
        }
      : null,
  }
}

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

async function savePreviousAnswerAsNote({ taskId, agentId, threadId, format = 'md' }) {
  const target = await findLastSaveableAnswer(taskId, threadId)
  if (!target) {
    return {
      answer: '我没找到上一段可保存的完整内容。你可以先让我生成一段内容，再说“保存起来”。',
    }
  }
  const title = inferNoteTitle(target.sourceMessage, target.answer)
  const date = new Date().toISOString().slice(0, 10)
  const fileName = `${date}-${slugifyFilename(title)}.${format}`
  const filePath = path.join(NOTE_ARTIFACT_ROOT, fileName)
  const relativePath = path.relative(WORKSPACE_ROOT, filePath)
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-note`,
    status: 'running',
    title: '保存本地笔记',
    detail: `准备写入 ${relativePath}`,
    metric: `写入 ${saveFormatLabel(format)}`,
    bubble: '保存',
  })

  await writeSavedFile(filePath, {
    title,
    sourceMessage: target.sourceMessage,
    answer: target.answer,
    format,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-note`,
    status: 'done',
    title: '保存本地笔记',
    detail: `已写入 ${relativePath}`,
    metric: '保存完成',
    bubble: '完成',
  })

  return {
    answer: `保存好了。我把刚才那段内容存成了 ${saveFormatLabel(format)}：${relativePath}`,
    files: [relativePath],
    savedPath: filePath,
    format,
  }
}

function parsePlannerJson(content) {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  return JSON.parse(candidate)
}

async function buildConversationContext(currentTaskId, threadId) {
  const history = await readHistory(20)
  return history
    .filter((item) => item.taskId !== currentTaskId)
    .filter((item) => !threadId || !item.threadId || item.threadId === threadId)
    .filter((item) => item.status === 'done' || item.status === 'waiting_confirmation')
    .slice(0, 6)
    .reverse()
    .map((item) => ({
      user: item.message,
      status: item.status,
      summary: item.summary,
      pendingAction: item.pendingAction?.title ?? null,
    }))
}

async function buildLlmSupervisorPlan(message, context = [], runtimeContext = {}) {
  if (!PLANNER_API_KEY) throw new Error('planner API key is not configured')
  const response = await fetch(`${PLANNER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PLANNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are the planner for a local OS agent MVP.',
            `Current date: ${new Date().toISOString().slice(0, 10)}.`,
            'You are always the first responder. Understand and acknowledge the user naturally before deciding whether a specialist is needed.',
            'Return only JSON in this shape: {"intent":"social_chat|qa|research|file_read|file_write|writing|schedule|app_action|document_workflow|clarify|unsupported","confidence":0.0,"needsTool":false,"answer":null,"workflow":[{"agentId":"research-agent","capability":"grounded_answer","args":{"query":"..."},"message":"..."}],"missingCapabilities":[{"agentId":"schedule-agent","capability":"create_reminder","reason":"日程助手尚未接入创建提醒执行器"}]}',
            'First infer the user intent holistically from the whole utterance and conversation context. Do not route by keyword alone.',
            'You must choose tool actions only from capabilityRegistry. Do not invent an executable capability in workflow.',
            'If the required action is not in capabilityRegistry, return workflow: [] and put the missing action in missingCapabilities. Do not substitute another capability.',
            'Capability design principle: prefer general verb-object abilities with parameters, such as list_saved_files, count_files, write_file, delete_files, read_file. Do not create or request case-specific abilities named after a company, topic, report, date, or one-off user story.',
            'When a user mentions a domain object such as report, note, document, meeting material, or saved file, express it as args.scope, args.query, args.format, args.title, or args.source rather than a separate capability when a general capability exists.',
            'If it is a clear executable task supported by capabilityRegistry, set needsTool true, answer null, and fill workflow.',
            'If the user is greeting, only sends punctuation, asks what you can do, or gives no executable goal, return a short natural answer and workflow: []. Do not use a generic clarification template for greetings.',
            'If the user is making casual/social chat with you, such as asking how you are today, what you are doing, whether you are tired/busy, or your mood/status, answer directly as the supervisor and return workflow: []. Do not route these to research-agent even if the text contains today/now.',
            'If the user asks a general question that can be answered from model knowledge without current, private, local, or external data, answer directly and return workflow: [].',
            'If the user has an executable goal but misses required details and no safe default exists, ask one concise clarification question and return workflow: [].',
            'If the user only provides a short noun or ambiguous topic, ask what they want to do with it and return workflow: [].',
            'Use conversationContext to resolve follow-up references like 继续, 再查查, 刚才那个, 上一个, 它, 这个, and similar phrases.',
            'Use runtimeContext to resolve references to saved files, default save locations, workspace root, and previous outputs.',
            'If the previous user asked a count/list/statistics question and the current user says 直接告诉我 or similar, use file-agent count_files or list_saved_files with suitable scope/filter. Do not open a file and do not create a new file.',
            'If the user asks where files will be saved by default, answer using runtimeContext.defaultSaveDir and return workflow: [].',
            'If the user asks where the previous saved file is, answer using runtimeContext.recentSavedFile.relativePath and return workflow: [].',
            'If runtimeContext.recentSavedFile exists and the user asks a short follow-up such as 主要内容是啥, 讲了啥, 总结一下, 摘要, or 概括一下, use file-agent read_file with args.filePath = runtimeContext.recentSavedFile.relativePath.',
            'If the user asks to save previous content, use file-agent write_file with args.source="previous_answer" and include requested format if any.',
            'If the user asks to save the immediately previous produced report/content in a multi-step workflow, use file-agent write_file after the content-producing step.',
            'If the user asks to open something with explicit phrases like 帮我打开, 重新打开, 打开那个文件, 打开最近的文件, 对就是那个文件, and runtimeContext.recentSavedFile exists, use app-agent open_file with args.filePath = runtimeContext.recentSavedFile.relativePath.',
            'If a follow-up refers to a previous task, rewrite the workflow message with the resolved target and the new user instruction.',
            'If the user asks for current facts, weather, forecasts, news, latest releases, local files, websites, apps, meetings, or anything requiring execution, use workflow instead of answering from memory.',
            'Allowed agentId values: file-agent, research-agent, writing-agent, schedule-agent, app-agent.',
            'Use research-agent for current facts, latest news, releases, market/product updates, broad web questions, URLs, web search, page reading, clicking, screenshots, and anything that benefits from Google Search grounding or webpage access.',
            'For weather, forecast, temperature, rain, snow, or air-quality questions, use research-agent weather. Preserve the requested city and relative day such as 今天, 明天, 后天 in args and step message. Do not use grounded_answer for weather unless the weather capability is missing.',
            'For preparing a meeting with an external company, bank, client, or institution, route to research-agent first to gather public background, recent developments, business priorities, and suggested meeting preparation questions.',
            'Do not use file-agent for meeting preparation unless the user explicitly asks to inspect local project files or uploaded documents.',
            'Use file-agent for local files, project folders, code, README, documents.',
            'If the user asks about 工作区, 工区, 项目目录, 项目文件, source files, repo files, code files, or asks these files are for, use file-agent list_files or list_paths. Do not use list_saved_files for this.',
            'Use file-agent list_saved_files/count_files for listing or counting generated files, reports, notes, documents, or saved artifacts. Treat report as a scope/filter, not a separate capability.',
            'Use file-agent write_file for saving any previous answer, previous step result, report, note, document, or generated text to disk. Treat report/doc/md as format/title/scope arguments, not separate capabilities.',
            'Use file-agent delete_files when the user asks to delete one file, multiple files, old files, old reports, all reports except the latest one, clean generated files, or bulk remove local files. This capability requires confirmation.',
            'Use file-agent manage_file for rename, move, or copy local files. The file-agent will require user confirmation before destructive or state-changing operations.',
            'cleanup_reports is only a compatibility alias; prefer delete_files with args like {"scope":"reports","keep":"latest"} for report cleanup.',
            'Use writing-agent for writing materials, drafting, polishing, summaries, minutes, scripts, copy, and transcribing or recognizing meeting audio/recordings into minutes.',
            'Schedule-agent currently has no executable capabilities. For creating reminders, calendar events, or managing schedules, return missingCapabilities rather than workflow.',
            'Use app-agent only when the user explicitly asks to open, launch, or control a named local app. Do not invent an app from a generic topic.',
            'Do not route to app-agent for food, places, products, or generic searches unless the user explicitly says to open or use a specific app.',
            'For local food/place/product discovery, use research-agent or ask a clarification question if the intent is unclear.',
            'If the user gives an ambiguous request, route it to the most relevant specialist and preserve the missing information in the message.',
            'Only route because the user intends to use a tool or needs external/local/private/current information. Relative words like today/now/recent are not sufficient by themselves.',
            'Do not invent dates, names, URLs, or facts in step messages.',
            'Preserve relative time expressions like 今天, 明天, latest, today unless the user provided an exact date.',
            'Preserve the user language in every step message. If the user writes Chinese, write Chinese. Do not translate user instructions.',
            'When the user language is ambiguous, answer in concise Simplified Chinese.',
            'Preserve user intent and keep each step executable by one specialist.',
            `Capability registry: ${JSON.stringify(publicCapabilityRegistry())}`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            userMessage: message,
            conversationContext: context,
            runtimeContext,
          }),
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`planner HTTP ${response.status}: ${await response.text()}`)
  }
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('planner returned empty content')
  const parsed = parsePlannerJson(content)
  const intentEnvelope = parseIntentEnvelope(parsed)
  const answer = typeof parsed.answer === 'string' && parsed.answer.trim()
    ? parsed.answer.trim()
    : null
  const workflow = finalizeSupervisorWorkflow(message, parsed.workflow)
  const legacySteps = workflow.length
    ? []
    : normalizePlannerSteps(parsed.steps, message).map((step) => ({
        ...step,
        capability: 'legacy_unmapped_step',
        args: {},
      }))
  const steps = workflow.length ? workflow : legacySteps
  const missingCapabilities = [
    ...normalizeMissingCapabilities(parsed.missingCapabilities),
    ...validateCapabilityWorkflow(steps),
  ]
  if (missingCapabilities.length) {
    return {
      answer: formatMissingCapabilities(missingCapabilities),
      steps: [],
      missingCapabilities,
      ...intentEnvelope,
      needsTool: false,
    }
  }
  const mandatoryWorkflow = inferMandatoryCapabilityWorkflow(message)
  const hasMandatoryWeatherStep = steps.some((step) => step.agentId === 'research-agent' && step.capability === 'weather')
  if (mandatoryWorkflow && !hasMandatoryWeatherStep) {
    return {
      answer: null,
      steps: mandatoryWorkflow.steps,
      intent: mandatoryWorkflow.intent,
      confidence: Math.max(intentEnvelope.confidence ?? 0, mandatoryWorkflow.confidence),
      needsTool: true,
    }
  }
  const runtimeFollowup = inferRuntimeFollowupIntent(message, runtimeContext)
  if (runtimeFollowup && (steps.length === 0 || intentEnvelope.intent === 'clarify' || answer)) {
    return {
      answer: null,
      steps: finalizeSupervisorWorkflow(message, runtimeFollowup.steps),
      intent: runtimeFollowup.intent,
      confidence: Math.max(intentEnvelope.confidence ?? 0, runtimeFollowup.confidence),
      needsTool: true,
    }
  }
  const fallbackIntent = inferFallbackIntent(message)
  if (fallbackIntent.answer && (!intentEnvelope.needsTool || steps.length === 0)) {
    return {
      answer: answer ?? fallbackIntent.answer,
      steps: [],
      intent: fallbackIntent.intent,
      confidence: Math.max(intentEnvelope.confidence ?? 0, fallbackIntent.confidence),
    }
  }
  if (fallbackIntent.agentId && steps.length === 0 && fallbackIntent.confidence >= 0.8) {
    return {
      answer: formatMissingCapabilities([{
        agentId: fallbackIntent.agentId,
        capability: 'model_workflow_missing',
        reason: '主控识别到可能需要工具，但模型没有产出可校验的能力工作流。',
      }]),
      steps: [],
      intent: fallbackIntent.intent,
      confidence: fallbackIntent.confidence,
      needsTool: false,
    }
  }
  if (answer && steps.length === 0 && intentEnvelope.needsTool !== true) {
    return { answer, steps, ...intentEnvelope }
  }
  if (requiresResearch(message) && steps.length === 0 && intentEnvelope.needsTool === true) {
    return {
      answer: formatMissingCapabilities([{
        agentId: 'research-agent',
        capability: 'model_workflow_missing',
        reason: '主控判断需要研究能力，但模型没有返回 grounded_answer/read_url/browser_action/weather 之一。',
      }]),
      steps: [],
      ...intentEnvelope,
      needsTool: false,
    }
  }
  if (answer && steps.length === 0) return { answer, steps, ...intentEnvelope }
  return {
    answer: steps.length
      ? null
      : formatMissingCapabilities([{
          agentId: null,
          capability: 'model_workflow_missing',
          reason: '主控模型没有返回可执行能力工作流。',
        }]),
    steps,
    ...intentEnvelope,
  }
}

async function synthesizeWithPlannerModel({ message, sourceTitle, sourceText, results }) {
  if (!PLANNER_API_KEY) return null
  const response = await fetch(`${PLANNER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PLANNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You summarize browser retrieval results for a local OS agent.',
            'Return only JSON in this shape: {"answer":"..."}',
            'Answer in concise Simplified Chinese.',
            'Use only the provided retrieved text/results. Do not invent live data.',
            'If the retrieved data is insufficient for a direct answer, say what is missing and include the most relevant result names.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            userRequest: message,
            sourceTitle,
            sourceText: sourceText?.slice(0, 1800),
            results: results?.slice(0, 5),
          }),
        },
      ],
    }),
  })
  if (!response.ok) return null
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (!content) return null
  const parsed = JSON.parse(content)
  return typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : null
}

async function callPlannerJson({ system, payload, temperature = 0 }) {
  if (!PLANNER_API_KEY) throw new Error('planner API key is not configured')
  const response = await fetch(`${PLANNER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PLANNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: system,
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`planner HTTP ${response.status}: ${await response.text()}`)
  }
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('planner returned empty content')
  return parsePlannerJson(content)
}

async function buildSupervisorPlan(message, context = [], runtimeContext = {}) {
  if (PLANNER_MODE === 'llm') {
    try {
      return {
        source: 'llm',
        ...await buildLlmSupervisorPlan(message, context, runtimeContext),
      }
    } catch (error) {
      console.error(`[planner] failed: ${error.message}`)
      return {
        source: 'llm-error',
        answer: [
          '主控模型这次没有成功完成意图识别，所以我不会改用规则硬猜。',
          `错误信息：${error.message}`,
          '这类情况应该补齐模型调用稳定性或重试机制，而不是静默 fallback。',
        ].join('\n'),
        steps: [],
        error: error.message,
      }
    }
  }
  return {
    source: 'rules',
    steps: buildRuleSupervisorPlan(message),
  }
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? WORKSPACE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 12000,
  })
}

function runCommandAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? WORKSPACE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = options.timeout
      ? setTimeout(() => {
          child.kill('SIGTERM')
          stderr += `\n${command} timed out after ${options.timeout}ms`
        }, options.timeout)
      : null
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      resolve({ status: 1, stdout, stderr: stderr || error.message })
    })
    child.on('close', (status) => {
      if (timer) clearTimeout(timer)
      resolve({ status: status ?? 0, stdout, stderr })
    })
  })
}

function canConnectToPort(host, port, timeout = 650) {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function getResearchProxyUrl() {
  if (cachedResearchProxyUrl !== undefined) return cachedResearchProxyUrl
  if (RESEARCH_PROXY_URL) {
    cachedResearchProxyUrl = RESEARCH_PROXY_URL
    return cachedResearchProxyUrl
  }
  for (const port of [7897, 7890, 7891]) {
    if (await canConnectToPort('127.0.0.1', port)) {
      cachedResearchProxyUrl = `http://127.0.0.1:${port}`
      return cachedResearchProxyUrl
    }
  }
  cachedResearchProxyUrl = null
  return cachedResearchProxyUrl
}

async function postJsonWithOptionalProxy(url, { headers = {}, body, timeout = 60000 } = {}) {
  const proxyUrl = await getResearchProxyUrl()
  if (proxyUrl) {
    const args = [
      '-sS',
      '--max-time',
      String(Math.ceil(timeout / 1000)),
      '--proxy',
      proxyUrl,
      '-w',
      '\n__HTTP_STATUS__:%{http_code}',
      '-X',
      'POST',
      url,
    ]
    for (const [key, value] of Object.entries(headers)) {
      args.push('-H', `${key}: ${value}`)
    }
    if (body !== undefined) {
      args.push('--data-binary', body)
    }
    const result = runCommand('curl', args, { cwd: WORKSPACE_ROOT, timeout: timeout + 3000 })
    if (result.status !== 0) {
      throw new Error(`HTTP proxy request failed: ${result.stderr.trim() || `curl exited with ${result.status}`}`)
    }
    const marker = '\n__HTTP_STATUS__:'
    const markerIndex = result.stdout.lastIndexOf(marker)
    const bodyText = markerIndex >= 0 ? result.stdout.slice(0, markerIndex) : result.stdout
    const status = markerIndex >= 0 ? Number.parseInt(result.stdout.slice(markerIndex + marker.length).trim(), 10) : 200
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      throw new Error(`HTTP ${status}: ${bodyText}`)
    }
    return JSON.parse(bodyText)
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`)
  }
  return JSON.parse(text)
}

function listWorkspaceFiles() {
  const rg = runCommand('rg', ['--files', '-g', '!*node_modules*', '-g', '!dist/*', '-g', '!*.png', '-g', '!*.jpg'])
  if (rg.status === 0 && rg.stdout.trim()) {
    return rg.stdout.trim().split('\n').slice(0, 80)
  }
  const find = runCommand('find', ['.', '-maxdepth', '3', '-type', 'f'])
  if (find.status === 0 && find.stdout.trim()) {
    return find.stdout.trim().split('\n').map((file) => file.replace(/^\.\//, '')).slice(0, 80)
  }
  return []
}

function isIndexableTextFile(file) {
  return /\.(md|txt|js|jsx|mjs|json|css|html|ts|tsx|yml|yaml)$/i.test(file)
    && !file.includes('package-lock.json')
}

function tokenizeText(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fa5]+/u)
    .filter((word) => word.length >= 2 && word.length <= 32)
}

function topKeywords(text, limit = 16) {
  const counts = new Map()
  for (const token of tokenizeText(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}

function publicFileEntry(entry) {
  return {
    file: entry.file,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    preview: entry.preview,
    keywords: entry.keywords,
  }
}

function findSnippet(content, queryTokens) {
  const lower = content.toLowerCase()
  const matchIndex = queryTokens
    .map((token) => lower.indexOf(token.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  const start = Math.max(0, (matchIndex ?? 0) - 120)
  return content.slice(start, start + 360).replace(/\s+/g, ' ').trim()
}

async function buildFileIndex() {
  const files = listWorkspaceFiles().filter(isIndexableTextFile)
  const indexed = []
  for (const file of files) {
    const absolutePath = path.resolve(WORKSPACE_ROOT, file)
    if (!absolutePath.startsWith(WORKSPACE_ROOT)) continue
    const [content, fileStat] = await Promise.all([
      readFile(absolutePath, 'utf8').catch(() => ''),
      stat(absolutePath).catch(() => null),
    ])
    if (!content.trim()) continue
    indexed.push({
      file,
      size: fileStat?.size ?? content.length,
      mtimeMs: fileStat?.mtimeMs ?? null,
      preview: content.slice(0, 900).trim(),
      keywords: topKeywords(content),
      content,
    })
  }

  cachedFileIndex = {
    builtAt: new Date().toISOString(),
    root: WORKSPACE_ROOT,
    files: indexed,
  }

  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeFile(FILE_INDEX_PATH, JSON.stringify({
    ...cachedFileIndex,
    files: cachedFileIndex.files.map(publicFileEntry),
  }, null, 2), 'utf8')

  return cachedFileIndex
}

async function getFileIndex() {
  if (cachedFileIndex) return cachedFileIndex
  return buildFileIndex()
}

async function searchFileIndex(message, limit = 5) {
  const index = await getFileIndex()
  const queryTokens = tokenizeText(message)
  const scored = index.files.map((entry) => {
    const filename = entry.file.toLowerCase()
    const content = entry.content.toLowerCase()
    const keywordSet = new Set(entry.keywords.map((item) => item.term))
    const score = queryTokens.reduce((sum, token) => {
      const lower = token.toLowerCase()
      return sum
        + (filename.includes(lower) ? 8 : 0)
        + (keywordSet.has(lower) ? 5 : 0)
        + (content.includes(lower) ? 2 : 0)
    }, 0)
    return {
      file: entry.file,
      score,
      size: entry.size,
      keywords: entry.keywords.slice(0, 6),
      snippet: findSnippet(entry.content, queryTokens),
    }
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  return {
    builtAt: index.builtAt,
    totalFiles: index.files.length,
    matches: scored.slice(0, limit),
  }
}

function chooseReadableFiles(files, message) {
  const keywords = message
    .toLowerCase()
    .split(/[\s，。,.、/]+/)
    .filter((word) => word.length > 1)
  const textFilePattern = /\.(md|txt|js|jsx|mjs|json|css|html)$/i
  const scored = files
    .filter((file) => textFilePattern.test(file))
    .map((file) => {
      const lower = file.toLowerCase()
      const score = keywords.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 2 : 0), 0)
        + (/(readme|package|app|bridge|agents)/i.test(file) ? 1 : 0)
      return { file, score }
    })
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, 5).map((item) => item.file)
}

function wantsIndexedFileList(message) {
  return /((本地|当前|项目|工作区|索引).*)?文件.*(哪些|都有|列表|清单|列一下|列出|都是啥|是什么|10\s*个|十个)|列.*文件|file\s+list|list\s+files/i
    .test(message)
}

function wantsIndexedFileLocations(message) {
  return /(这些|这十个|10\s*个|十个|本地|索引|文件).*(地址|路径|位置|在哪|哪里|哪个文件夹|存在哪个文件夹|所在.*文件夹|完整路径|绝对路径)|文件.*(地址|路径|位置|在哪|哪里|文件夹|完整路径|绝对路径)|where.*files|file.*paths?/i
    .test(message)
}

function isReportCountRequest(message) {
  return /(之前|刚才|已经|总共|一共|都)?(生成|保存|整理)?了?几个报告|报告.*(几个|多少|数量|统计|一共|总共)|多少个.*报告/i
    .test(message)
}

function isReportListRequest(message) {
  return /(现在|之前|当前|已有|生成|保存|整理)?(都)?有(什么|哪些|多少)?报告|报告.*(有哪些|有什么|列表|清单|列出|列一下|都有什么|都有哪些)/i
    .test(message)
}

function wantsGeneratedFileSave(message) {
  if (isReportCountRequest(message) || isReportListRequest(message)) return false
  if (/保存目录|默认保存|报告保存目录|保存位置|保存路径/.test(message)) return false
  return /(保存|写入|整理成|生成|形成|另存|导出).*(md|markdown|txt|html|docx?|word|pdf|文件|文档|报告)|保存(?:为|成)?\s*[^\s，。；;]+?\.(?:md|txt|html|docx?|pdf)/i
    .test(message)
}

async function listSavedReportFiles() {
  return listSavedArtifactFiles({ scope: 'reports' })
}

function normalizeSavedFileScope(value, message = '') {
  const text = `${value ?? ''} ${message}`.toLowerCase()
  if (/报告|report/.test(text)) return 'reports'
  return 'notes'
}

async function listSavedArtifactFiles({ scope = 'notes', query = '', format = '' } = {}) {
  const entries = await readdir(NOTE_ARTIFACT_ROOT, { withFileTypes: true }).catch(() => [])
  const loweredQuery = String(query ?? '').trim().toLowerCase()
  const normalizedFormat = String(format ?? '').trim().replace(/^\./, '').toLowerCase()
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('~$'))
    .filter((entry) => /\.(docx?|pdf|html?|txt|md)$/i.test(entry.name))
    .filter((entry) => scope !== 'reports' || /报告/i.test(entry.name))
    .filter((entry) => !loweredQuery || entry.name.toLowerCase().includes(loweredQuery))
    .filter((entry) => !normalizedFormat || path.extname(entry.name).replace(/^\./, '').toLowerCase() === normalizedFormat)
    .map(async (entry) => {
      const filePath = path.join(NOTE_ARTIFACT_ROOT, entry.name)
      const fileStat = await stat(filePath).catch(() => null)
      return {
        name: entry.name,
        path: filePath,
        relativePath: path.relative(WORKSPACE_ROOT, filePath),
        mtimeMs: fileStat?.mtimeMs ?? 0,
      }
    }))
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function countSavedFiles({ taskId, agentId, scope = 'notes', query = '', format = '' }) {
  const normalizedScope = normalizeSavedFileScope(scope)
  const files = await listSavedArtifactFiles({ scope: normalizedScope, query, format })
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-count-saved-files`,
    status: 'done',
    title: '统计已保存文件',
    detail: `${NOTE_ARTIFACT_ROOT}`,
    metric: `${files.length} 个文件`,
    bubble: '统计',
  })
  const preview = files.slice(0, 8).map((file, index) => `${index + 1}. ${file.relativePath}`).join('\n')
  const scopeLabel = normalizedScope === 'reports' ? '报告文件' : '已保存文件'
  return {
    answer: [
      `按默认保存目录 artifacts/notes 来算，当前匹配到 ${files.length} 个${scopeLabel}。`,
      files.length ? `最近几个是：\n${preview}` : null,
    ].filter(Boolean).join('\n\n'),
    files: files.map((file) => file.relativePath),
    fileCount: files.length,
  }
}

async function listSavedFiles({ taskId, agentId, scope = 'notes', query = '', format = '' }) {
  const normalizedScope = normalizeSavedFileScope(scope)
  const files = await listSavedArtifactFiles({ scope: normalizedScope, query, format })
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-list-saved-files`,
    status: 'done',
    title: '列出已保存文件',
    detail: `${NOTE_ARTIFACT_ROOT}`,
    metric: `${files.length} 个文件`,
    bubble: '文件',
  })
  const scopeLabel = normalizedScope === 'reports' ? '报告文件' : '已保存文件'
  return {
    answer: files.length
      ? [
          `当前默认保存目录 artifacts/notes 里有 ${files.length} 个${scopeLabel}：`,
          files.map((file, index) => `${index + 1}. ${file.relativePath}`).join('\n'),
        ].join('\n\n')
      : `当前默认保存目录 artifacts/notes 里没有匹配的${scopeLabel}。`,
    files: files.map((file) => file.relativePath),
    fileCount: files.length,
  }
}

async function countSavedReports({ taskId, agentId }) {
  const reports = await listSavedReportFiles()
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-count-reports`,
    status: 'done',
    title: '统计已生成报告',
    detail: `${NOTE_ARTIFACT_ROOT}`,
    metric: `${reports.length} 个报告文件`,
    bubble: '统计',
  })
  const preview = reports.slice(0, 8).map((file, index) => `${index + 1}. ${file.relativePath}`).join('\n')
  return {
    answer: [
      `按默认保存目录 artifacts/notes 里“文件名包含「报告」”来算，你之前生成了 ${reports.length} 个报告文件。`,
      reports.length ? `最近几个是：\n${preview}` : null,
    ].filter(Boolean).join('\n\n'),
    files: reports.map((file) => file.relativePath),
    reportCount: reports.length,
  }
}

async function listSavedReports({ taskId, agentId }) {
  const reports = await listSavedReportFiles()
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-list-reports`,
    status: 'done',
    title: '列出已生成报告',
    detail: `${NOTE_ARTIFACT_ROOT}`,
    metric: `${reports.length} 个报告文件`,
    bubble: '报告',
  })
  return {
    answer: reports.length
      ? [
          `当前默认保存目录 artifacts/notes 里有 ${reports.length} 个报告文件：`,
          reports.map((file, index) => `${index + 1}. ${file.relativePath}`).join('\n'),
        ].join('\n\n')
      : '当前默认保存目录 artifacts/notes 里还没有文件名包含「报告」的报告文件。',
    files: reports.map((file) => file.relativePath),
    reportCount: reports.length,
  }
}

async function saveIndexedFileList({ taskId, agentId, message, index }) {
  const wantsLocations = wantsIndexedFileLocations(message)
  const format = inferReportFormat(message)
  const title = wantsLocations ? '工作区索引文件路径' : '工作区可索引文件列表'
  const filePath = inferRequestedReportPath(message, title)
  const relativePath = path.relative(WORKSPACE_ROOT, filePath)
  const body = wantsLocations
    ? [
        `工作区根目录：${WORKSPACE_ROOT}`,
        '',
        '完整路径：',
        formatIndexedFileLocations(index.files),
      ].join('\n')
    : [
        `文件助手当前索引到 ${index.files.length} 个可读取文本文件：`,
        '',
        formatIndexedFileList(index.files),
      ].join('\n')

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-indexed-files`,
    status: 'running',
    title: '保存文件清单',
    detail: `准备写入 ${relativePath}`,
    metric: `写入 ${saveFormatLabel(format)}`,
    bubble: '保存',
  })

  await writeSavedFile(filePath, {
    title,
    sourceMessage: message,
    answer: body,
    format,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-indexed-files`,
    status: 'done',
    title: '保存文件清单',
    detail: `已写入 ${relativePath}`,
    metric: '保存完成',
    bubble: '完成',
  })

  return {
    answer: `文件清单已保存：${relativePath}`,
    files: [relativePath],
    savedPath: filePath,
    format,
    search: {
      builtAt: index.builtAt,
      totalFiles: index.files.length,
      matches: [],
    },
    indexPath: FILE_INDEX_PATH,
  }
}

function describeFileKind(file) {
  if (/\.jsx$/i.test(file)) return 'React 组件'
  if (/\.css$/i.test(file)) return '样式表'
  if (/\.mjs$/i.test(file)) return 'Node 脚本'
  if (/\.js$/i.test(file)) return 'JavaScript'
  if (/\.json$/i.test(file)) return 'JSON 配置'
  if (/\.md$/i.test(file)) return 'Markdown 文档'
  if (/\.html$/i.test(file)) return 'HTML 入口'
  return '文本文件'
}

function describeIndexedFilePurpose(file) {
  if (file === 'src/App.jsx') return '主界面组件，负责工作区、对话、任务时间线和多助手交互。'
  if (file === 'src/main.jsx') return 'React 应用入口，把 App 挂载到页面。'
  if (file === 'src/styles.css') return '全局样式，控制办公室大屏、左右分栏、聊天区和助手卡片视觉。'
  if (file === 'src/agents.js') return '前端助手目录，定义主控、文件、研究、文书、日程、应用等工位信息。'
  if (file === 'scripts/openclaw-visual-bridge.mjs') return '本地后端桥接服务，负责主控规划、能力路由、文件/联网/应用执行和 SSE 事件。'
  if (file === 'package.json') return '项目依赖和 npm 脚本配置。'
  if (file === 'package-lock.json') return '依赖版本锁定文件。'
  if (file === 'README.md') return '项目说明和运行方式。'
  if (file === 'CODE_REVIEW.md') return '代码审查记录或改造建议。'
  if (file === 'vite.config.js') return 'Vite 构建配置。'
  if (file === 'eslint.config.js') return 'ESLint 代码规范配置。'
  if (file === 'index.html') return '浏览器 HTML 入口，加载前端脚本。'
  if (/^artifacts\//.test(file)) return '运行时生成物或任务产物。'
  if (/\.md$/i.test(file)) return 'Markdown 文档。'
  if (/\.json$/i.test(file)) return '结构化配置或数据文件。'
  if (/\.css$/i.test(file)) return '样式文件。'
  if (/\.(jsx?|mjs)$/i.test(file)) return 'JavaScript 逻辑文件。'
  return '可读取文本文件。'
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) return '未知大小'
  if (size < 1024) return `${size} B`
  return `${(size / 1024).toFixed(size > 10 * 1024 ? 1 : 2)} KB`
}

function formatIndexedFileList(files) {
  return files
    .map((entry, index) => `${index + 1}. ${entry.file}（${describeFileKind(entry.file)}，${formatFileSize(entry.size)}）：${describeIndexedFilePurpose(entry.file)}`)
    .join('\n')
}

function formatIndexedFileLocations(files) {
  return files
    .map((entry, index) => `${index + 1}. ${path.join(WORKSPACE_ROOT, entry.file)}`)
    .join('\n')
}

function isFileSummaryRequest(message) {
  return /(读取|读一下|看看|总结|概括|识别|ocr|主要讲了啥|讲了什么|内容|摘要).*(文件|报告|docx?|pdf|excel|xlsx?|pptx?|图片|图像|文档)|文件.*(主要讲了啥|讲了什么|总结|摘要|内容)|报告.*(主要讲了啥|讲了什么|总结|摘要|内容)/i.test(message)
}

function isDocumentConversionRequest(message) {
  return /(另存|转成|转换|导出|保存为|保存成|整理成).*(word|docx|doc|pdf|html|txt|md|markdown|文档|纯文本)|word.*(另存|转换|保存)|pdf.*(另存|转换|保存)|扩展名.*(改为|换成)/i
    .test(message)
}

function isFileManagementRequest(message) {
  return /(删除|删掉|移除|重命名|改名|移动|挪到|复制|拷贝).*(文件|报告|文档|artifacts\/notes|\.md|\.docx?|\.pdf|\.txt|\.html)|^(删除|删掉|重命名|改名|移动|复制|拷贝)/i
    .test(message)
}

function ensureWorkspaceFile(filePath) {
  const absolute = normalizeArtifactPath(filePath)
  if (!absolute) return null
  const relative = path.relative(WORKSPACE_ROOT, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('出于安全考虑，文件管理动作只能操作当前工作区内的文件。')
  }
  return absolute
}

function parseFileManagementAction(message) {
  const source = extractFirstFilePath(message)
  if (!source) return null
  const sourcePath = ensureWorkspaceFile(source)
  if (/删除|删掉|移除/i.test(message)) {
    return {
      type: 'delete_file',
      sourcePath,
      title: `删除 ${path.basename(sourcePath)}`,
      detail: `将删除 ${path.relative(WORKSPACE_ROOT, sourcePath)}。`,
    }
  }

  const targetName = message.match(/(?:重命名为|改名为|命名为|另命名为)[：:\s'“”‘’"]*([^'"“”‘’，。；;\s]+)/i)?.[1]
  if ((/重命名|改名/i.test(message)) && targetName) {
    const targetPath = ensureWorkspaceFile(path.join(path.dirname(sourcePath), targetName))
    return {
      type: 'rename_file',
      sourcePath,
      targetPath,
      title: `重命名 ${path.basename(sourcePath)}`,
      detail: `将 ${path.relative(WORKSPACE_ROOT, sourcePath)} 重命名为 ${path.relative(WORKSPACE_ROOT, targetPath)}。`,
    }
  }

  const target = message.match(/(?:移动到|挪到|复制到|拷贝到)[：:\s'“”‘’"]*([^'"“”‘’，。；;\s]+)/i)?.[1]
  if (target && /移动|挪到|复制|拷贝/i.test(message)) {
    const normalizedTarget = target.includes('.') && !target.endsWith('/')
      ? target
      : path.join(target, path.basename(sourcePath))
    const targetPath = ensureWorkspaceFile(normalizedTarget)
    return {
      type: /复制|拷贝/i.test(message) ? 'copy_file' : 'move_file',
      sourcePath,
      targetPath,
      title: `${/复制|拷贝/i.test(message) ? '复制' : '移动'} ${path.basename(sourcePath)}`,
      detail: `将 ${path.relative(WORKSPACE_ROOT, sourcePath)} ${/复制|拷贝/i.test(message) ? '复制' : '移动'}到 ${path.relative(WORKSPACE_ROOT, targetPath)}。`,
    }
  }
  return null
}

function prepareFileManagementAction({ taskId, agentId, message }) {
  const parsed = parseFileManagementAction(message)
  if (!parsed) {
    return { answer: '我还没识别出要管理的具体文件和目标。请给出文件路径，以及要删除、重命名、移动还是复制。' }
  }
  if (!existsSync(parsed.sourcePath)) {
    return { answer: `源文件不存在：${path.relative(WORKSPACE_ROOT, parsed.sourcePath)}` }
  }
  const actionId = `action-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const action = {
    actionId,
    taskId,
    agentId,
    ownerAgentId: agentId,
    ...parsed,
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
    answer: `已准备动作：${action.title}。请确认后执行。`,
  }
}

function normalizeDeleteScope(value, message = '') {
  const text = `${value ?? ''} ${message}`.toLowerCase()
  if (/报告|report/.test(text)) return 'reports'
  if (/笔记|notes?|artifacts\/notes|生成|保存/.test(text)) return 'notes'
  if (/工作区|workspace|项目/.test(text)) return 'workspace'
  return 'notes'
}

function pathLooksSafeForBulkDelete(filePath, scope) {
  const absolute = ensureWorkspaceFile(filePath)
  const relative = path.relative(WORKSPACE_ROOT, absolute)
  if (scope === 'workspace') return false
  if (scope === 'reports' || scope === 'notes') {
    return !relative.startsWith('..')
      && !path.isAbsolute(relative)
      && relative.startsWith(`artifacts${path.sep}notes${path.sep}`)
  }
  return false
}

async function listNoteFilesForDelete({ scope, query }) {
  const entries = await readdir(NOTE_ARTIFACT_ROOT, { withFileTypes: true }).catch(() => [])
  const loweredQuery = String(query ?? '').trim().toLowerCase()
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('~$'))
    .filter((entry) => /\.(docx?|pdf|html?|txt|md)$/i.test(entry.name))
    .filter((entry) => scope !== 'reports' || /报告/i.test(entry.name))
    .filter((entry) => !loweredQuery || entry.name.toLowerCase().includes(loweredQuery))
    .map(async (entry) => {
      const filePath = path.join(NOTE_ARTIFACT_ROOT, entry.name)
      const fileStat = await stat(filePath).catch(() => null)
      return {
        path: filePath,
        relativePath: path.relative(WORKSPACE_ROOT, filePath),
        mtimeMs: fileStat?.mtimeMs ?? 0,
      }
    }))
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function resolveDeleteCandidates({ message, args = {} }) {
  const explicitPaths = [
    ...arrayArg(args, 'filePaths'),
    ...arrayArg(args, 'files'),
    ...arrayArg(args, 'paths'),
    stringArg(args, 'filePath'),
    stringArg(args, 'path'),
  ].filter(Boolean)
  const scope = normalizeDeleteScope(stringArg(args, 'scope'), message)
  const keep = stringArg(args, 'keep')
  const query = stringArg(args, 'query')

  let candidates = []
  if (explicitPaths.length) {
    const resolved = await resolveFileReferences(explicitPaths)
    candidates = resolved.map((filePath) => ({
      path: ensureWorkspaceFile(filePath),
      relativePath: path.relative(WORKSPACE_ROOT, ensureWorkspaceFile(filePath)),
      mtimeMs: 0,
    }))
  } else {
    candidates = await listNoteFilesForDelete({ scope, query })
  }

  const unique = [...new Map(candidates.map((file) => [file.path, file])).values()]
    .filter((file) => existsSync(file.path))
    .filter((file) => explicitPaths.length || pathLooksSafeForBulkDelete(file.path, scope))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const keepFile = keep === 'latest' ? unique[0] : null
  const deleteFiles = keepFile ? unique.slice(1) : unique
  return { scope, keep, keepFile, deleteFiles, totalMatched: unique.length }
}

async function prepareDeleteFilesAction({ taskId, agentId, message, args = {} }) {
  const { scope, keep, keepFile, deleteFiles, totalMatched } = await resolveDeleteCandidates({ message, args })
  if (!deleteFiles.length) {
    return {
      answer: keepFile
        ? `当前只匹配到 1 个文件，不需要删除：${keepFile.relativePath}`
        : `没有找到可删除的匹配文件。范围：${scope}`,
      files: keepFile ? [keepFile.relativePath] : [],
      matchedCount: totalMatched,
    }
  }

  const actionId = `action-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const action = {
    actionId,
    taskId,
    agentId,
    ownerAgentId: agentId,
    type: 'delete_files',
    title: keepFile
      ? `删除 ${deleteFiles.length} 个文件，保留 ${path.basename(keepFile.path)}`
      : `删除 ${deleteFiles.length} 个文件`,
    detail: [
      keepFile ? `将保留：${keepFile.relativePath}` : null,
      `将删除 ${deleteFiles.length} 个文件：`,
      ...deleteFiles.slice(0, 12).map((file, index) => `${index + 1}. ${file.relativePath}`),
      deleteFiles.length > 12 ? `...还有 ${deleteFiles.length - 12} 个` : null,
    ].filter(Boolean).join('\n'),
    scope,
    keep,
    keepPath: keepFile?.path,
    deletePaths: deleteFiles.map((file) => file.path),
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
    answer: [
      '已准备删除文件，执行前需要你确认。',
      action.detail,
    ].join('\n'),
  }
}

async function prepareReportCleanupAction({ taskId, agentId, keep = 'latest' }) {
  return prepareDeleteFilesAction({
    taskId,
    agentId,
    message: '删除旧报告，保留最新报告',
    args: { scope: 'reports', keep },
  })
}

async function resolveReadableFileFromMessage(taskId, message, threadId) {
  const explicitFilePath = extractFirstFilePath(message)
  if (explicitFilePath) {
    const absolutePath = await resolveExistingFileReference(explicitFilePath)
    if (absolutePath && existsSync(absolutePath)) return absolutePath
  }

  const recentSaved = await findRecentSavedFile(taskId, threadId).catch(() => null)
  if (recentSaved?.path && existsSync(recentSaved.path)) return recentSaved.path

  const fileNameMatch = message.match(/([^\s，。；;]+?\.(?:docx|doc|pdf|xlsx|xls|pptx|ppt|html|txt|md|png|jpg|jpeg|webp|tif|tiff))/i)?.[1]
  if (fileNameMatch) {
    const candidate = path.join(NOTE_ARTIFACT_ROOT, fileNameMatch)
    if (existsSync(candidate)) return candidate
  }

  const noteFiles = await readdir(NOTE_ARTIFACT_ROOT, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(noteFiles
    .filter((entry) => entry.isFile() && /\.(docx|doc|pdf|xlsx|xls|pptx|ppt|html?|txt|md|png|jpe?g|webp|tiff?)$/i.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(NOTE_ARTIFACT_ROOT, entry.name)
      const fileStat = await stat(filePath).catch(() => null)
      const nameScore = tokenizeText(message).reduce((score, token) => {
        return score + (entry.name.toLowerCase().includes(token.toLowerCase()) ? 6 : 0)
      }, 0)
      const reportScore = /报告|文档|doc|文件/.test(message) && /报告|文档|doc/i.test(entry.name) ? 4 : 0
      return {
        filePath,
        score: nameScore + reportScore,
        mtimeMs: fileStat?.mtimeMs ?? 0,
      }
    }))

  const sorted = candidates
    .filter((candidate) => candidate.score > 0 || /刚|最近|上一个|这个|形成|生成|报告|文档|doc|文件/.test(message))
    .sort((a, b) => (b.score - a.score) || (b.mtimeMs - a.mtimeMs))

  return sorted[0]?.filePath ?? null
}

function inferConvertedFilePath(sourceFile, message, format) {
  const explicitTarget = message.match(/(?:另存为|保存为|保存成|转成|转换成|导出为|文件名(?:为|是)?)[\s\S]{0,18}?[：:\s'“”‘’"]*([^'"“”‘’，。；;\s]+?\.(?:docx|doc|pdf|html|txt|md))/i)?.[1]
  if (explicitTarget) {
    return path.isAbsolute(explicitTarget)
      ? explicitTarget
      : path.join(path.dirname(sourceFile), explicitTarget)
  }

  const parsed = path.parse(sourceFile)
  const ext = `.${format}`
  const baseName = parsed.ext.toLowerCase() === ext.toLowerCase()
    ? `${parsed.name}-副本`
    : parsed.name
  return path.join(parsed.dir, `${baseName}${ext}`)
}

function inferRewriteTargetPath(sourceFile, message, format) {
  const explicitTargets = extractFilePathReferences(message)
    .filter((filePath) => filePath !== extractFirstFilePath(message))
  const target = explicitTargets.at(-1)
    ?? message.match(/(?:保存为|保存成|另存为|文件名(?:为|是)?)[\s\S]{0,18}?[：:\s'“”‘’"]*([^'"“”‘’，。；;\s]+?\.(?:docx|doc|pdf|html|txt|md))/i)?.[1]
  if (target) return path.isAbsolute(target) ? target : path.join(path.dirname(sourceFile), target)

  const parsed = path.parse(sourceFile)
  return path.join(parsed.dir, `${parsed.name}_精炼.${format}`)
}

function normalizeFileAgentAction(action) {
  const allowed = new Set(['read', 'convert', 'rewrite', 'compare', 'save_previous', 'write_file', 'list_files', 'list_paths', 'list_saved_files', 'count_files', 'count_reports', 'list_reports', 'delete_files', 'cleanup_reports', 'search', 'manage', 'unknown'])
  const normalized = String(action ?? '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'unknown'
}

async function resolveFileReferences(references = []) {
  const resolved = []
  for (const reference of references) {
    const filePath = await resolveExistingFileReference(reference).catch(() => null)
    if (filePath && existsSync(filePath) && !resolved.includes(filePath)) resolved.push(filePath)
  }
  return resolved
}

function normalizeTargetFilePath(value, fallbackDir = NOTE_ARTIFACT_ROOT) {
  if (!value) return null
  const cleaned = String(value).trim().replace(/^['"“”‘’]+|['"“”‘’。]+$/g, '')
  if (!cleaned || !/\.(?:docx?|pdf|html|txt|md)$/i.test(cleaned)) return null
  return path.isAbsolute(cleaned)
    ? cleaned
    : cleaned.startsWith('artifacts/')
      ? path.resolve(WORKSPACE_ROOT, cleaned)
      : path.join(fallbackDir, cleaned)
}

function inferCommonDocumentTitle(files, fallback = '文档版本比较报告') {
  const names = files
    .map((file) => path.basename(file, path.extname(file)))
    .map((name) => name
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')
      .replace(/[_-]?(精炼|副本|修改版|新版|原版|版本\d+)$/i, '')
      .trim())
    .filter(Boolean)
  if (!names.length) return fallback
  let common = names[0]
  for (const name of names.slice(1)) {
    while (common && !name.includes(common)) common = common.slice(0, -1)
  }
  common = common.replace(/[_-]+$/g, '').trim()
  return common.length >= 2 ? `${common}版本比较报告` : fallback
}

function isGeneratedComparisonFile(filePath) {
  const name = path.basename(filePath, path.extname(filePath))
  return /(版本比较报告|比较结果|对比结果|差异报告|文档版本比较报告)$/i.test(name)
}

function normalizedComparableName(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/[_-]?(精炼|副本|修改版|新版|原版|简版|详细版|版本\d+)$/i, '')
    .replace(/(版本比较报告|比较结果|对比结果|差异报告)$/i, '')
    .trim()
}

function commonPrefixLength(a, b) {
  let length = 0
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1
  return length
}

function selectRecentFilesForComparison(recentFiles, { allowGeneratedComparisonFiles = false } = {}) {
  const candidates = recentFiles
    .filter((file) => allowGeneratedComparisonFiles || !isGeneratedComparisonFile(file.path))
    .slice(0, 8)
  if (candidates.length < 2) return candidates.map((file) => file.path)

  let best = null
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = normalizedComparableName(candidates[i].path)
      const right = normalizedComparableName(candidates[j].path)
      const sameName = left && right && left === right ? 100 : 0
      const contains = left && right && (left.includes(right) || right.includes(left)) ? 30 : 0
      const common = commonPrefixLength(left, right)
      const score = sameName + contains + common * 2 - i - j
      if (!best || score > best.score) {
        best = { score, pair: [candidates[i].path, candidates[j].path] }
      }
    }
  }
  return best?.pair ?? candidates.slice(0, 2).map((file) => file.path)
}

async function buildFileAgentIntent({ taskId, message, threadId, index }) {
  if (!PLANNER_API_KEY || PLANNER_MODE !== 'llm') return null
  const recentSavedFiles = await findRecentSavedFiles(taskId, threadId, 8).catch(() => [])
  const explicitReferences = extractFilePathReferences(message)
  const resolvedExplicitReferences = await resolveFileReferences(explicitReferences)
  const system = [
    'You are the embedded intent model inside a local file assistant.',
    'Your job is not to answer the user. Your job is to decide the local file operation to execute.',
    'Infer intent holistically from the user message, recent saved files, and explicit file references. Do not route by keyword alone.',
    'Return only JSON in this shape: {"action":"read|convert|rewrite|compare|save_previous|write_file|list_files|list_paths|list_saved_files|count_files|delete_files|search|manage|unknown","confidence":0.0,"sourceFiles":["..."],"targetFile":null,"format":null,"instruction":"...","shouldSave":false,"answer":null}',
    'Use rewrite when the user asks to refine, shorten, polish, rewrite, edit, make more concise, or change report content.',
    'Use compare when the user asks to compare two files, two versions, differences, whether the refined version changed, or similar follow-ups.',
    'Use convert only when the main goal is format conversion, such as md to doc or doc to pdf.',
    'Use save_previous when the user asks to save the previous answer/content as a file.',
    'Use read when the user asks to summarize, inspect, or tell the content of a file.',
    'Use list_files/list_paths for project workspace, 工区, 工作区, repo, source files, code files, indexed file lists or paths, especially when the user asks what files are for.',
    'Use count_files when the user asks how many reports/files were previously generated or saved. This is a direct answer task, not a save task.',
    'Use list_saved_files only when the user asks what saved/generated/artifacts/notes/reports exist. Do not use it for project workspace/source file lists.',
    'Use write_file when the user asks to save previous output/content as a file.',
    'Use delete_files when the user asks to delete one file, multiple files, old files, old reports, all reports except the latest one, clean report history, or bulk remove generated files. This requires confirmation.',
    'Use cleanup_reports only as a compatibility alias for deleting old reports while keeping latest.',
    'If the user says "这两个版本" or similar, choose compare and rely on recentSavedFiles.',
    'If the user says "这个报告" or similar, choose the most recent saved file as the source.',
    'For targetFile, only include a path if the user explicitly gave one or the operation naturally creates a new file.',
    'For format, use doc, docx, pdf, md, txt, or html when requested; otherwise null.',
    'Use Simplified Chinese in instruction.',
  ].join('\n')
  const parsed = await callPlannerJson({
    system,
    payload: {
      userMessage: message,
      workspaceRoot: WORKSPACE_ROOT,
      defaultSaveDir: path.relative(WORKSPACE_ROOT, NOTE_ARTIFACT_ROOT),
      explicitReferences,
      resolvedExplicitReferences: resolvedExplicitReferences.map((file) => path.relative(WORKSPACE_ROOT, file)),
      recentSavedFiles: recentSavedFiles.map((file) => ({
        relativePath: file.relativePath,
        format: file.format,
      })),
      indexedFiles: index.files.map((entry) => entry.file).slice(0, 30),
    },
  })

  const action = normalizeFileAgentAction(parsed.action)
  const confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0
  const modelSourceFiles = Array.isArray(parsed.sourceFiles) ? parsed.sourceFiles : []
  let sourceFiles = await resolveFileReferences([
    ...resolvedExplicitReferences,
    ...modelSourceFiles,
  ])
  const format = inferReportFormat(`${message} ${parsed.format ?? ''}`)
  if (action === 'compare' && explicitReferences.length === 0) {
    sourceFiles = sourceFiles.filter((filePath) => !isGeneratedComparisonFile(filePath))
  }

  if ((action === 'read' || action === 'convert' || action === 'rewrite') && !sourceFiles.length) {
    const recent = await findRecentSavedFile(taskId, threadId).catch(() => null)
    if (recent?.path) sourceFiles = [recent.path]
  }
  if (action === 'compare' && sourceFiles.length < 2) {
    const recent = await findRecentSavedFiles(taskId, threadId, 8).catch(() => [])
    const selected = explicitReferences.length
      ? recent.map((file) => file.path)
      : selectRecentFilesForComparison(recent)
    for (const filePath of selected) {
      if (!sourceFiles.includes(filePath)) sourceFiles.push(filePath)
      if (sourceFiles.length >= 2) break
    }
  }

  return {
    action,
    confidence,
    sourceFiles,
    targetFile: normalizeTargetFilePath(parsed.targetFile),
    format,
    instruction: typeof parsed.instruction === 'string' && parsed.instruction.trim()
      ? parsed.instruction.trim()
      : message,
    shouldSave: Boolean(parsed.shouldSave),
  }
}

async function transformDocumentWithPlanner({ message, instruction, sourceText, relativeSource }) {
  const parsed = await callPlannerJson({
    system: [
      'You rewrite local document content for a file assistant.',
      'Return only JSON in this shape: {"answer":"..."}',
      'Use only the provided source document. Do not add new facts, numbers, dates, or citations.',
      'If the instruction asks for a more concise version, preserve the key conclusion, important data, and comparisons, while removing repetition and verbose phrasing.',
      'Keep the output well structured with short headings and bullets when useful.',
      'Answer in Simplified Chinese.',
    ].join('\n'),
    payload: {
      userMessage: message,
      instruction,
      relativeSource,
      sourceText: sourceText.slice(0, 12000),
    },
  })
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
  if (!answer) throw new Error('文件助手模型没有返回可保存的改写内容。')
  return answer
}

async function compareDocumentsWithPlanner({ message, files }) {
  const parsed = await callPlannerJson({
    system: [
      'You compare two local documents for a file assistant.',
      'Return only JSON in this shape: {"answer":"..."}',
      'Compare only the provided document texts. Do not invent external facts.',
      'Include: overall verdict, main content differences, structure/length differences, whether the second file is actually more concise, and recommended next action.',
      'Answer in concise Simplified Chinese.',
    ].join('\n'),
    payload: {
      userMessage: message,
      files: files.map((file) => ({
        relativePath: file.relativePath,
        text: file.text.slice(0, 9000),
        characters: file.text.length,
      })),
    },
  })
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
  if (!answer) throw new Error('文件助手模型没有返回比较结果。')
  return answer
}

async function rewriteDocumentFile({ taskId, agentId, sourceFile, targetFile, format, message, instruction }) {
  const raw = await readFile(sourceFile, 'utf8')
  const text = await readableDocumentText(raw, sourceFile)
  const relativeSource = path.relative(WORKSPACE_ROOT, sourceFile)
  const finalFormat = format ?? inferReportFormat(message)
  const finalTarget = targetFile ?? inferRewriteTargetPath(sourceFile, message, finalFormat)
  const relativeTarget = path.relative(WORKSPACE_ROOT, finalTarget)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-rewrite-document`,
    status: 'running',
    title: '改写文档内容',
    detail: `${relativeSource} → ${relativeTarget}`,
    metric: `写入 ${saveFormatLabel(finalFormat)}`,
    bubble: '改写',
  })

  const rewritten = await transformDocumentWithPlanner({
    message,
    instruction,
    sourceText: text,
    relativeSource,
  })
  await writeSavedFile(finalTarget, {
    title: path.basename(finalTarget, path.extname(finalTarget)),
    sourceMessage: `基于 ${relativeSource} 改写：${instruction}`,
    answer: rewritten,
    format: finalFormat,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-rewrite-document`,
    status: 'done',
    title: '改写文档内容',
    detail: `已写入 ${relativeTarget}`,
    metric: '改写完成',
    bubble: '完成',
  })

  return {
    answer: `已按要求改写并保存：${relativeTarget}`,
    files: [relativeTarget],
    savedPath: finalTarget,
    sourceFiles: [relativeSource],
    format: finalFormat,
    text: rewritten,
  }
}

async function compareDocumentFiles({ taskId, agentId, sourceFiles, targetFile, format, message }) {
  const selected = sourceFiles.slice(0, 2)
  if (selected.length < 2) {
    return { answer: '我还没找到两份可比较的文件。请告诉我两个文件名，或先生成/保存两个版本。' }
  }
  const files = []
  for (const filePath of selected) {
    const raw = await readFile(filePath, 'utf8')
    const text = await readableDocumentText(raw, filePath)
    files.push({
      filePath,
      relativePath: path.relative(WORKSPACE_ROOT, filePath),
      text,
    })
  }
  const finalFormat = format ?? 'doc'
  const finalTarget = targetFile ?? path.join(
    NOTE_ARTIFACT_ROOT,
    `${slugifyFilename(inferCommonDocumentTitle(selected))}.${finalFormat}`,
  )
  const relativeTarget = path.relative(WORKSPACE_ROOT, finalTarget)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-compare-documents`,
    status: 'running',
    title: '比较两个文档版本',
    detail: files.map((file) => file.relativePath).join(' ↔ '),
    metric: `写入 ${saveFormatLabel(finalFormat)}`,
    bubble: '比较',
  })

  const comparison = await compareDocumentsWithPlanner({ message, files })
  await writeSavedFile(finalTarget, {
    title: path.basename(finalTarget, path.extname(finalTarget)),
    sourceMessage: `比较：${files.map((file) => file.relativePath).join(' 与 ')}`,
    answer: comparison,
    format: finalFormat,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-compare-documents`,
    status: 'done',
    title: '比较两个文档版本',
    detail: `比较结果已写入 ${relativeTarget}`,
    metric: '比较完成',
    bubble: '完成',
  })

  return {
    answer: comparison,
    files: [relativeTarget],
    savedPath: finalTarget,
    format: finalFormat,
    comparedFiles: files.map((file) => file.relativePath),
  }
}

function unsupportedCapabilityResult(agentName, capability, detail = '') {
  return {
    answer: [
      `${agentName}已经识别出你要做的是「${capability}」，但当前还没有接入能稳定执行这个动作的能力。`,
      detail || null,
      '我不会改用其它能力硬凑结果。需要补齐对应执行器后再做。',
    ].filter(Boolean).join('\n'),
    unsupportedCapability: capability,
  }
}

function buildIndexedFileLocationsResult({ taskId, agentId, index }) {
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-paths`,
    status: 'done',
    title: '列出文件位置',
    detail: `工作区根目录：${WORKSPACE_ROOT}`,
    metric: '已列出路径',
    bubble: '路径',
  })

  const answer = [
    `这些索引文件都在这个项目工作区下面：`,
    WORKSPACE_ROOT,
    '',
    `完整路径如下：`,
    formatIndexedFileLocations(index.files),
  ].join('\n')

  return {
    answer,
    root: WORKSPACE_ROOT,
    files: index.files.map((entry) => entry.file),
    paths: index.files.map((entry) => path.join(WORKSPACE_ROOT, entry.file)),
    snippets: [],
    search: {
      builtAt: index.builtAt,
      totalFiles: index.files.length,
      matches: [],
    },
    indexPath: FILE_INDEX_PATH,
  }
}

function buildIndexedFileListResult({ taskId, agentId, index }) {
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-read`,
    status: 'done',
    title: '列出文件索引',
    detail: `返回 ${index.files.length} 个已索引文本文件。`,
    metric: '已列出文件',
    bubble: '清单',
  })

  const answer = [
    `文件助手当前索引到 ${index.files.length} 个可读取文本文件：`,
    formatIndexedFileList(index.files),
  ].join('\n\n')

  return {
    answer,
    files: index.files.map((entry) => entry.file),
    snippets: [],
    search: {
      builtAt: index.builtAt,
      totalFiles: index.files.length,
      matches: [],
    },
    indexPath: FILE_INDEX_PATH,
  }
}

async function buildFileSearchResult({ taskId, agentId, message, index }) {
  const files = index.files.map((entry) => entry.file)
  const search = await searchFileIndex(message)
  const readable = search.matches.length
    ? search.matches.map((match) => match.file)
    : chooseReadableFiles(files, message)
  const snippets = readable.map((file) => ({
    file,
    preview: (index.files.find((entry) => entry.file === file)?.content ?? '').slice(0, 900).trim(),
  }))

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-read`,
    status: 'done',
    title: '索引与检索',
    detail: `索引 ${search.totalFiles} 个文本文件，命中 ${search.matches.length} 个结果。`,
    metric: '已读取文件',
    bubble: '读取',
  })

  const answer = [
    `已建立本地文件索引：${search.totalFiles} 个文本文件。`,
    search.matches.length
      ? `命中结果：\n${search.matches.map((match, index) => `${index + 1}. ${match.file}（score ${match.score}）：${match.snippet}`).join('\n')}`
      : readable.length
        ? `未找到明确内容命中，优先查看：${readable.join('、')}。`
        : '没有找到可直接读取的文本文件。',
  ].join('\n')

  return {
    answer,
    files: files.slice(0, 24),
    snippets,
    search,
    indexPath: FILE_INDEX_PATH,
  }
}

async function executeFileAgentIntent({ taskId, agentId, message, intent, index, threadId }) {
  if (!intent) return null
  if (intent.confidence < 0.55 || intent.action === 'unknown') {
    return unsupportedCapabilityResult('文件助手', '未能可靠识别文件动作', '可以补齐更明确的文件意图提示或让用户指定文件/动作。')
  }
  if (intent.action === 'manage') return prepareFileManagementAction({ taskId, agentId, message })
  if (intent.action === 'list_files' && wantsGeneratedFileSave(message)) {
    return saveIndexedFileList({ taskId, agentId, message, index })
  }
  if (intent.action === 'list_files') return buildIndexedFileListResult({ taskId, agentId, index })
  if (intent.action === 'list_paths' && wantsGeneratedFileSave(message)) {
    return saveIndexedFileList({ taskId, agentId, message, index })
  }
  if (intent.action === 'list_paths') return buildIndexedFileLocationsResult({ taskId, agentId, index })
  if (intent.action === 'count_reports') {
    return countSavedReports({ taskId, agentId })
  }
  if (intent.action === 'list_reports') {
    return listSavedReports({ taskId, agentId })
  }
  if (intent.action === 'list_saved_files') {
    return listSavedFiles({
      taskId,
      agentId,
      scope: /报告|report/i.test(message) ? 'reports' : 'notes',
    })
  }
  if (intent.action === 'count_files') {
    return countSavedFiles({
      taskId,
      agentId,
      scope: /报告|report/i.test(message) ? 'reports' : 'notes',
    })
  }
  if (intent.action === 'cleanup_reports') {
    return prepareReportCleanupAction({ taskId, agentId })
  }
  if (intent.action === 'delete_files') {
    return prepareDeleteFilesAction({
      taskId,
      agentId,
      message,
      args: {
        filePaths: intent.sourceFiles,
        scope: /报告|report/i.test(message) ? 'reports' : 'notes',
        keep: /保留.*最新|除了最新|除最新|keep.*latest/i.test(message) ? 'latest' : null,
      },
    })
  }
  if (intent.action === 'save_previous') {
    return savePreviousAnswerAsNote({
      taskId,
      agentId,
      threadId,
      format: intent.format ?? inferSaveFormat(message),
    })
  }
  if (intent.action === 'write_file') {
    return savePreviousAnswerAsNote({
      taskId,
      agentId,
      threadId,
      format: intent.format ?? inferSaveFormat(message),
    })
  }
  if (intent.action === 'rewrite') {
    if (!intent.sourceFiles.length) return { answer: '我没找到要改写的源文件。请告诉我文件名，或者先让我保存一份内容。' }
    return rewriteDocumentFile({
      taskId,
      agentId,
      sourceFile: intent.sourceFiles[0],
      targetFile: intent.targetFile,
      format: intent.format,
      message,
      instruction: intent.instruction,
    })
  }
  if (intent.action === 'compare') {
    return compareDocumentFiles({
      taskId,
      agentId,
      sourceFiles: intent.sourceFiles,
      targetFile: intent.targetFile,
      format: intent.format,
      message,
    })
  }
  if (intent.action === 'convert') {
    if (!intent.sourceFiles.length) return { answer: '我没找到要转换的源文件。你可以告诉我具体文件名，或者先让我保存一份内容。' }
    return convertReadableDocumentFile({
      taskId,
      agentId,
      sourceFile: intent.sourceFiles[0],
      message,
    })
  }
  if (intent.action === 'read' && intent.sourceFiles.length) {
    const targetFile = intent.sourceFiles[0]
    const raw = await readFile(targetFile, 'utf8')
    const text = await readableDocumentText(raw, targetFile)
    const relativePath = path.relative(WORKSPACE_ROOT, targetFile)
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-read-document`,
      status: 'done',
      title: '读取报告文件',
      detail: relativePath,
      metric: '已读取报告',
      bubble: '读取',
    })
    return {
      answer: summarizeReadableDocument(text, targetFile),
      files: [relativePath],
      snippets: [{ file: relativePath, preview: text.slice(0, 1200) }],
      text,
    }
  }
  if (intent.action === 'read' && !intent.sourceFiles.length) {
    return unsupportedCapabilityResult('文件助手', '读取文件', '我已经识别到要读取文件，但没有解析到可读取的具体文件。需要补齐文件定位能力或请用户指定文件。')
  }
  if (intent.action === 'search') return buildFileSearchResult({ taskId, agentId, message, index })
  return unsupportedCapabilityResult('文件助手', intent.action)
}

async function readableDocumentText(raw, filePath) {
  if (/\.docx$/i.test(filePath)) return extractDocxText(filePath)
  if (/\.pdf$/i.test(filePath)) return extractPdfText(filePath)
  if (/\.xlsx?$/i.test(filePath)) return extractSpreadsheetText(filePath)
  if (/\.pptx?$/i.test(filePath)) return extractPresentationText(filePath)
  if (/\.(png|jpe?g|webp|tiff?)$/i.test(filePath)) return extractImageText(filePath)
  if (/\.(doc|html?)$/i.test(filePath)) {
    return htmlToStructuredText(raw)
      .trim()
  }
  return stripMarkdown(raw).replace(/\n{3,}/g, '\n\n').trim()
}

async function extractDocxText(filePath) {
  const script = String.raw`
import sys
from docx import Document
doc = Document(sys.argv[1])
print('\n'.join(p.text for p in doc.paragraphs if p.text.strip()))
`
  const result = runCommand('python3', ['-c', script, filePath], { timeout: 12000 })
  if (result.status !== 0) throw new Error(result.stderr.trim() || '读取 DOCX 失败')
  return result.stdout.trim()
}

async function extractPdfText(filePath) {
  const result = runCommand('pdftotext', ['-layout', filePath, '-'], { timeout: 15000 })
  if (result.status !== 0) throw new Error(result.stderr.trim() || '读取 PDF 失败')
  return result.stdout.trim()
}

async function extractSpreadsheetText(filePath) {
  const script = String.raw`
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
out = []
for ws in wb.worksheets[:5]:
    out.append('工作表：' + ws.title)
    for row in ws.iter_rows(max_row=30, values_only=True):
        values = [str(v) for v in row if v is not None]
        if values:
            out.append(' | '.join(values))
print('\n'.join(out))
`
  const result = runCommand('python3', ['-c', script, filePath], { timeout: 15000 })
  if (result.status !== 0) throw new Error(result.stderr.trim() || '读取 Excel 失败')
  return result.stdout.trim()
}

async function extractPresentationText(filePath) {
  if (/\.ppt$/i.test(filePath)) {
    throw new Error('旧版 .ppt 暂不支持读取，请先转换为 .pptx。')
  }
  const list = runCommand('unzip', ['-Z1', filePath], { timeout: 8000 })
  if (list.status !== 0) throw new Error(list.stderr.trim() || '读取 PPTX 失败')
  const slideNames = list.stdout.split(/\r?\n/).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  const lines = []
  for (const slideName of slideNames.slice(0, 30)) {
    const result = runCommand('unzip', ['-p', filePath, slideName], { timeout: 8000 })
    if (result.status !== 0) continue
    const text = result.stdout
      .replace(/<a:t>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) lines.push(`${path.basename(slideName, '.xml')}：${text}`)
  }
  return lines.join('\n')
}

async function extractImageText(filePath) {
  const result = runCommand('tesseract', [filePath, 'stdout', '-l', 'chi_sim+eng'], { timeout: 20000 })
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'OCR 失败，请确认本机安装了 tesseract 和中文语言包。')
  return result.stdout.trim() || 'OCR 没识别出文字。'
}

async function convertReadableDocumentFile({ taskId, agentId, sourceFile, message }) {
  const format = inferReportFormat(message)

  const raw = await readFile(sourceFile, 'utf8')
  const text = await readableDocumentText(raw, sourceFile)
  const title = path.basename(sourceFile, path.extname(sourceFile))
  const targetFile = inferConvertedFilePath(sourceFile, message, format)
  const relativeSource = path.relative(WORKSPACE_ROOT, sourceFile)
  const relativeTarget = path.relative(WORKSPACE_ROOT, targetFile)
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-convert-document`,
    status: 'running',
    title: '转换文档格式',
    detail: `${relativeSource} → ${relativeTarget}`,
    metric: `写入 ${saveFormatLabel(format)}`,
    bubble: '转换',
  })

  await writeSavedFile(targetFile, {
    title,
    sourceMessage: `由 ${relativeSource} 转换生成`,
    answer: text,
    format,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-convert-document`,
    status: 'done',
    title: '转换文档格式',
    detail: `已写入 ${relativeTarget}`,
    metric: '转换完成',
    bubble: '完成',
  })

  return {
    answer: `已转换并保存为 ${saveFormatLabel(format)}：${relativeTarget}`,
    files: [relativeTarget],
    savedPath: targetFile,
    format,
  }
}

function summarizeReadableDocument(text, filePath) {
  const compact = text.replace(/[ \t]+/g, ' ').trim()
  const title = path.basename(filePath)
  const lines = []
  const core = compact.match(/核心结论\s*\n?([\s\S]+?)(?:\n\s*报告要点|\n\s*一、|\n\s*来源：|$)/)?.[1]?.trim()
  if (core) {
    lines.push('核心结论：')
    lines.push(...core.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5))
  }

  const sections = [...compact.matchAll(/(^|\n)([一二三四五六七八九十]、\s*[^\n]+)([\s\S]*?)(?=\n[一二三四五六七八九十]、|\n来源：|$)/g)]
    .map((match) => match[2].trim())
    .slice(0, 4)
  if (sections.length) {
    if (lines.length) lines.push('')
    lines.push('主要内容：')
    lines.push(...sections.map((section) => section.slice(0, 260)))
  }

  if (!lines.length) {
    lines.push(`${title} 的主要内容：`)
    lines.push(...compact.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 10))
  }

  return [
    `我读了 ${path.relative(WORKSPACE_ROOT, filePath)}。`,
    '',
    ...lines,
  ].join('\n')
}

async function executeFileAgent({ taskId, agentId, message }) {
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-scan`,
    status: 'running',
    title: '扫描工作区',
    detail: WORKSPACE_ROOT,
    metric: '正在扫描文件',
    bubble: '扫描',
  })
  const index = await buildFileIndex()
  const files = index.files.map((entry) => entry.file)
  const threadId = activeTasks.get(taskId)?.threadId
  const modelIntent = await buildFileAgentIntent({ taskId, message, threadId, index })
  const modelHandled = await executeFileAgentIntent({
    taskId,
    agentId,
    message,
    intent: modelIntent,
    index,
    threadId,
  })
  if (modelHandled) return modelHandled

  if (isFileManagementRequest(message)) {
    return prepareFileManagementAction({ taskId, agentId, message })
  }

  if (isReportCountRequest(message)) {
    return countSavedReports({ taskId, agentId })
  }
  if (isReportListRequest(message)) {
    return listSavedReports({ taskId, agentId })
  }

  if ((wantsIndexedFileList(message) || wantsIndexedFileLocations(message)) && wantsGeneratedFileSave(message)) {
    return saveIndexedFileList({ taskId, agentId, message, index })
  }

  const sourceFileForConversion = isDocumentConversionRequest(message)
    ? await resolveReadableFileFromMessage(taskId, message, threadId)
    : null
  if (sourceFileForConversion) {
    return convertReadableDocumentFile({
      taskId,
      agentId,
      sourceFile: sourceFileForConversion,
      message,
    })
  }
  if (isDocumentConversionRequest(message)) {
    return {
      answer: '我没找到要转换的源文件。你可以告诉我具体文件名，或者先让我保存一份内容。',
    }
  }

  const targetFile = isFileSummaryRequest(message)
    ? await resolveReadableFileFromMessage(taskId, message, threadId)
    : null
  if (targetFile) {
    const raw = await readFile(targetFile, 'utf8')
    const text = await readableDocumentText(raw, targetFile)
    const relativePath = path.relative(WORKSPACE_ROOT, targetFile)
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-read-document`,
      status: 'done',
      title: '读取报告文件',
      detail: relativePath,
      metric: '已读取报告',
      bubble: '读取',
    })
    return {
      answer: summarizeReadableDocument(text, targetFile),
      files: [relativePath],
      snippets: [{ file: relativePath, preview: text.slice(0, 1200) }],
      text,
    }
  }

  if (wantsIndexedFileLocations(message)) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-paths`,
      status: 'done',
      title: '列出文件位置',
      detail: `工作区根目录：${WORKSPACE_ROOT}`,
      metric: '已列出路径',
      bubble: '路径',
    })

    const answer = [
      `这些索引文件都在这个项目工作区下面：`,
      WORKSPACE_ROOT,
      '',
      `完整路径如下：`,
      formatIndexedFileLocations(index.files),
    ].join('\n')

    return {
      answer,
      root: WORKSPACE_ROOT,
      files,
      paths: index.files.map((entry) => path.join(WORKSPACE_ROOT, entry.file)),
      snippets: [],
      search: {
        builtAt: index.builtAt,
        totalFiles: index.files.length,
        matches: [],
      },
      indexPath: FILE_INDEX_PATH,
    }
  }

  if (wantsIndexedFileList(message)) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-read`,
      status: 'done',
      title: '列出文件索引',
      detail: `返回 ${index.files.length} 个已索引文本文件。`,
      metric: '已列出文件',
      bubble: '清单',
    })

    const answer = [
      `文件助手当前索引到 ${index.files.length} 个可读取文本文件：`,
      formatIndexedFileList(index.files),
    ].join('\n\n')

    return {
      answer,
      files,
      snippets: [],
      search: {
        builtAt: index.builtAt,
        totalFiles: index.files.length,
        matches: [],
      },
      indexPath: FILE_INDEX_PATH,
    }
  }

  const search = await searchFileIndex(message)
  const readable = search.matches.length
    ? search.matches.map((match) => match.file)
    : chooseReadableFiles(files, message)
  const snippets = []

  for (const file of readable) {
    const content = index.files.find((entry) => entry.file === file)?.content ?? ''
    snippets.push({
      file,
      preview: content.slice(0, 900).trim(),
    })
  }

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-read`,
    status: 'done',
    title: '索引与检索',
    detail: `索引 ${search.totalFiles} 个文本文件，命中 ${search.matches.length} 个结果。`,
    metric: '已读取文件',
    bubble: '读取',
  })

  const answer = [
    `已建立本地文件索引：${search.totalFiles} 个文本文件。`,
    search.matches.length
      ? `命中结果：\n${search.matches.map((match, index) => `${index + 1}. ${match.file}（score ${match.score}）：${match.snippet}`).join('\n')}`
      : readable.length
        ? `未找到明确内容命中，优先查看：${readable.join('、')}。`
        : '没有找到可直接读取的文本文件。',
  ].join('\n')

  return {
    answer,
    files: files.slice(0, 24),
    snippets,
    search,
    indexPath: FILE_INDEX_PATH,
  }
}

function extractFirstUrl(message) {
  const match = message.match(/https?:\/\/[^\s，。),）]+/i)
  return match?.[0] ?? null
}

function extractFirstFilePath(message) {
  return message.match(/((?:\/|artifacts\/notes\/)?[^\s，。；;:：'"“”‘’]+?\.(?:docx|doc|xlsx|xls|pptx|ppt|html|txt|md|pdf|png|jpg|jpeg|webp|tif|tiff|mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|mkv))/i)?.[1] ?? null
}

function extractFilePathReferences(message) {
  return [...String(message ?? '').matchAll(/((?:\/|artifacts\/notes\/)?[^\s，。；;:：'"“”‘’]+?\.(?:docx|doc|xlsx|xls|pptx|ppt|html|txt|md|pdf|png|jpg|jpeg|webp|tif|tiff|mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|mkv))/gi)]
    .map((match) => match[1])
    .filter((filePath, index, array) => array.indexOf(filePath) === index)
}

function extractAudioFilePath(message) {
  const filePath = extractFirstFilePath(message)
  if (filePath && /\.(mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|mkv)$/i.test(filePath)) return filePath
  return message.match(/((?:\/|artifacts\/notes\/)[^\s，。；;]+?\.(?:mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|mkv))/i)?.[1] ?? null
}

function wantsScreenshot(message) {
  return /截图|截屏|screenshot|screen shot/i.test(message)
}

function extractClickText(message) {
  const match = message.match(/点击\s*[“"']?([^”"',，。]+)[”"']?/u)
    ?? message.match(/click\s+["']?([^"',.]+)["']?/i)
  return match?.[1]
    ?.replace(/\s*(并|然后|后)\s*(截图|截屏|screenshot).*$/iu, '')
    .trim() ?? null
}

function extractTranscriptText(raw) {
  return String(raw ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^\s*(Detected language|ETA|Loading model|Transcribing|Processing|Progress)/i.test(line))
    .join('\n')
    .trim()
}

function buildSimpleMeetingMinutes(transcript, sourceName) {
  const lines = transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const preview = lines.slice(0, 12)
  return [
    `# ${sourceName} 会议纪要`,
    '',
    `- 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    `- 来源录音：${sourceName}`,
    '',
    '## 摘要',
    preview.length ? preview.join('\n') : '转写稿为空，未能提取摘要。',
    '',
    '## 行动项',
    '- 暂未自动识别到明确行动项，请结合转写稿复核。',
    '',
    '## 转写稿',
    transcript || '未识别到文字。',
    '',
  ].join('\n')
}

async function synthesizeMeetingMinutes({ transcript, sourceName }) {
  if (!PLANNER_API_KEY || !transcript.trim()) return null
  const response = await fetch(`${PLANNER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PLANNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你是文书助手，擅长整理录音转写稿和会议纪要。',
            '请根据转写稿生成简体中文纪要。',
            'Return only JSON: {"minutes":"..."}',
            '结构必须包含：会议摘要、关键讨论、结论/决定、行动项（负责人未知则写待确认）、风险/待补充。',
            '不要编造转写稿没有的信息。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            sourceName,
            transcript: transcript.slice(0, 18000),
          }),
        },
      ],
    }),
  })
  if (!response.ok) return null
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (!content) return null
  const parsed = parsePlannerJson(content)
  return typeof parsed.minutes === 'string' && parsed.minutes.trim() ? parsed.minutes.trim() : null
}

async function transcribeMeetingAudio({ taskId, agentId, message }) {
  const rawPath = extractAudioFilePath(message)
  if (!rawPath) {
    return {
      answer: [
        '可以，文书助手已经准备好接录音识别和纪要整理能力。',
        '请给我一个本地录音文件路径，例如：',
        '识别 /Users/you/meeting.m4a 并整理会议纪要',
        '',
        '支持常见格式：mp3、m4a、wav、aac、flac、ogg、mp4、mov。',
      ].join('\n'),
    }
  }

  const audioPath = normalizeArtifactPath(rawPath)
  if (!audioPath || !existsSync(audioPath)) {
    return { answer: `我没找到录音文件：${rawPath}` }
  }
  if (!existsSync(FASTER_WHISPER_TRANSCRIBE)) {
    return { answer: `本地转写脚本不存在：${FASTER_WHISPER_TRANSCRIBE}` }
  }

  const stem = slugifyFilename(path.basename(audioPath, path.extname(audioPath)))
  const date = new Date().toISOString().slice(0, 10)
  const transcriptPath = path.join(NOTE_ARTIFACT_ROOT, `${date}-${stem}-转写稿.txt`)
  const minutesPath = path.join(NOTE_ARTIFACT_ROOT, `${date}-${stem}-会议纪要.md`)
  const relativeAudio = path.relative(WORKSPACE_ROOT, audioPath)
  const relativeTranscript = path.relative(WORKSPACE_ROOT, transcriptPath)
  const relativeMinutes = path.relative(WORKSPACE_ROOT, minutesPath)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-audio-transcribe`,
    status: 'running',
    title: '识别会议录音',
    detail: relativeAudio,
    metric: '本地 Whisper 转写中',
    bubble: '转写',
  })

  await mkdir(NOTE_ARTIFACT_ROOT, { recursive: true })
  const transcribeResult = await runCommandAsync(FASTER_WHISPER_TRANSCRIBE, [
    audioPath,
    '--format', 'text',
    '--detect-paragraphs',
    '-o', transcriptPath,
  ], { timeout: 30 * 60 * 1000 })
  if (transcribeResult.status !== 0) {
    throw new Error(transcribeResult.stderr.trim() || '录音转写失败')
  }

  const transcript = existsSync(transcriptPath)
    ? extractTranscriptText(await readFile(transcriptPath, 'utf8'))
    : extractTranscriptText(transcribeResult.stdout)
  await writeFile(transcriptPath, transcript, 'utf8')

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-audio-transcribe`,
    status: 'done',
    title: '识别会议录音',
    detail: `已写入 ${relativeTranscript}`,
    metric: '转写完成',
    bubble: '完成',
  })

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-minutes-build`,
    status: 'running',
    title: '整理会议纪要',
    detail: '根据转写稿生成纪要',
    metric: '纪要生成中',
    bubble: '纪要',
  })

  const llmMinutes = await synthesizeMeetingMinutes({
    transcript,
    sourceName: path.basename(audioPath),
  }).catch((error) => {
    console.error(`[writing-agent] minutes synthesis skipped: ${error.message}`)
    return null
  })
  const minutes = llmMinutes ?? buildSimpleMeetingMinutes(transcript, path.basename(audioPath))
  await writeFile(minutesPath, minutes, 'utf8')
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-minutes-build`,
    status: 'done',
    title: '整理会议纪要',
    detail: `已写入 ${relativeMinutes}`,
    metric: '纪要完成',
    bubble: '完成',
  })

  return {
    answer: [
      '录音已识别，并整理成纪要。',
      `转写稿：${relativeTranscript}`,
      `纪要文件：${relativeMinutes}`,
      '',
      `纪要预览：${truncateAtBoundary(minutes, 420)}`,
    ].join('\n'),
    transcriptPath,
    minutesPath,
    files: [relativeTranscript, relativeMinutes],
    transcriptPreview: transcript.slice(0, 1200),
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function htmlToStructuredText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>\s*(?:&bull;|•)\s*/gi, '\n- ')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function extractTitle(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return title ? stripHtml(title).slice(0, 120) : '未读取到标题'
}

function extractMetaDescription(html) {
  const meta = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i)
  return meta?.[1] ? stripHtml(meta[1]).slice(0, 260) : ''
}

function buildSearchUrl(message) {
  const query = buildSearchQuery(message)
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query || message)}`
}

function buildSearchQuery(message) {
  const cleaned = message
    .replace(/搜索|检索|查一下|帮我查|浏览器|网页|打开/gu, ' ')
    .trim()
  const currentDate = new Date().toISOString().slice(0, 10)
  if (/今天|最新|刚刚|发布|新闻|动态|release|launch|announc/i.test(cleaned)) {
    return `${cleaned} ${currentDate}`
  }
  return cleaned
}

function isWeatherRequest(message) {
  return /天气|气温|温度|下雨|降雨|空气|weather/i.test(message)
}

function extractWeatherCity(message) {
  const cityMatch = message.match(/(?:今天|明天|后天|查询|查一下|帮我查|看看|的|天气|气温|温度|\s)*(北京|上海|广州|深圳|杭州|南京|成都|重庆|武汉|西安|天津|苏州|长沙|郑州|青岛|厦门|香港|台北)/u)
  if (cityMatch?.[1]) return cityMatch[1]
  const englishMatch = message.match(/weather\s+(?:in\s+)?([a-zA-Z\s-]+)/i)
  return englishMatch?.[1]?.trim() || '北京'
}

function extractWeatherDay(message) {
  const text = String(message ?? '').toLowerCase()
  if (/day_after_tomorrow|day after tomorrow|后天/u.test(text)) {
    return { offset: 2, label: '后天' }
  }
  if (/tomorrow|明天/u.test(text)) {
    return { offset: 1, label: '明天' }
  }
  if (/today|今天/u.test(text)) {
    return { offset: 0, label: '今天' }
  }
  return { offset: 0, label: '今天' }
}

function weatherTextFromCondition(condition) {
  const raw = condition?.lang_zh?.[0]?.value ?? condition?.weatherDesc?.[0]?.value ?? '未知'
  const normalized = String(raw).trim()
  const commonMap = {
    Sunny: '晴',
    Clear: '晴',
    'Partly cloudy': '局部多云',
    Cloudy: '多云',
    Overcast: '阴',
    Mist: '薄雾',
    Fog: '雾',
    'Patchy rain nearby': '附近有零星降雨',
    'Light rain': '小雨',
    'Moderate rain': '中雨',
    'Heavy rain': '大雨',
    'Light snow': '小雪',
    'Moderate snow': '中雪',
    'Heavy snow': '大雪',
  }
  return commonMap[normalized] ?? normalized
}

function pickForecastHour(forecast) {
  const hourly = Array.isArray(forecast?.hourly) ? forecast.hourly : []
  return hourly.find((item) => item.time === '1200')
    ?? hourly.find((item) => item.time === '1500')
    ?? hourly[Math.floor(hourly.length / 2)]
    ?? null
}

function maxHourlyValue(forecast, key) {
  const values = (forecast?.hourly ?? [])
    .map((item) => Number.parseFloat(item?.[key]))
    .filter((value) => Number.isFinite(value))
  return values.length ? Math.max(...values) : null
}

function buildWeatherAnswer(weather) {
  const forecast = weather.forecast
  const dateText = forecast.date ? `（${forecast.date}）` : ''
  if (weather.dayOffset === 0) {
    return [
      `${weather.city}今天${dateText}天气：${weather.current.condition}，当前 ${weather.current.tempC}°C，体感 ${weather.current.feelsLikeC}°C。`,
      `今日预报：${forecast.condition}，气温 ${forecast.minTempC ?? '-'}-${forecast.maxTempC ?? '-'}°C；降雨概率最高 ${forecast.chanceOfRain ?? '-'}%；湿度 ${forecast.humidity ?? '-'}%；风速 ${forecast.windKmph ?? '-'} km/h；紫外线 ${forecast.uvIndex ?? '-'}。`,
      `来源：wttr.in，观测时间 UTC ${weather.current.observedAtUtc ?? '-'}`,
    ].join('\n')
  }
  return [
    `${weather.city}${weather.dayLabel}${dateText}天气预报：${forecast.condition}，气温 ${forecast.minTempC ?? '-'}-${forecast.maxTempC ?? '-'}°C。`,
    `平均气温 ${forecast.avgTempC ?? '-'}°C；降雨概率最高 ${forecast.chanceOfRain ?? '-'}%；湿度 ${forecast.humidity ?? '-'}%；风速 ${forecast.windKmph ?? '-'} km/h；紫外线 ${forecast.uvIndex ?? '-'}。`,
    '来源：wttr.in 预报数据。',
  ].join('\n')
}

async function fetchWeather(city, day = { offset: 0, label: '今天' }) {
  const cityMap = {
    北京: 'Beijing',
    上海: 'Shanghai',
    广州: 'Guangzhou',
    深圳: 'Shenzhen',
    杭州: 'Hangzhou',
    南京: 'Nanjing',
    成都: 'Chengdu',
    重庆: 'Chongqing',
    武汉: 'Wuhan',
    西安: 'Xian',
    天津: 'Tianjin',
    苏州: 'Suzhou',
    长沙: 'Changsha',
    郑州: 'Zhengzhou',
    青岛: 'Qingdao',
    厦门: 'Xiamen',
    香港: 'Hong Kong',
    台北: 'Taipei',
  }
  const query = cityMap[city] ?? city
  const page = await fetchTextPage(`https://wttr.in/${encodeURIComponent(query)}?format=j1&lang=zh`)
  const data = JSON.parse(page.body)
  const current = data.current_condition?.[0]
  const forecasts = Array.isArray(data.weather) ? data.weather : []
  const forecast = forecasts[Math.min(day.offset, Math.max(forecasts.length - 1, 0))]
  const forecastHour = pickForecastHour(forecast)
  if (!current) throw new Error('weather payload missing current condition')
  if (!forecast) throw new Error('weather payload missing forecast')
  return {
    city,
    dayOffset: day.offset,
    dayLabel: day.label,
    sourceUrl: `https://wttr.in/${encodeURIComponent(query)}?format=j1&lang=zh`,
    current: {
      observedAtUtc: current.observation_time,
      condition: weatherTextFromCondition(current),
      tempC: current.temp_C,
      feelsLikeC: current.FeelsLikeC,
      humidity: current.humidity,
      windKmph: current.windspeedKmph,
      precipitationMm: current.precipMM,
      uvIndex: current.uvIndex,
    },
    forecast: {
      date: forecast.date,
      condition: weatherTextFromCondition(forecastHour),
      minTempC: forecast.mintempC,
      maxTempC: forecast.maxtempC,
      avgTempC: forecast.avgtempC,
      chanceOfRain: maxHourlyValue(forecast, 'chanceofrain'),
      chanceOfSnow: maxHourlyValue(forecast, 'chanceofsnow'),
      humidity: forecastHour?.humidity,
      windKmph: forecastHour?.windspeedKmph,
      windDirection: forecastHour?.winddir16Point,
      precipitationMm: forecastHour?.precipMM,
      uvIndex: forecastHour?.uvIndex,
    },
  }
}

async function fetchTextPage(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 Local OS Agent MVP',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    const contentType = response.headers.get('content-type') ?? ''
    const body = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      contentType,
      body,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchSearchResultPages(results, limit = 3) {
  const pages = []
  for (const result of results.slice(0, limit)) {
    if (!/^https?:\/\//i.test(result.url)) continue
    try {
      const page = await fetchTextPage(result.url)
      pages.push({
        title: extractTitle(page.body) || result.title,
        url: page.url,
        text: stripHtml(page.body).slice(0, 2200),
      })
    } catch (error) {
      pages.push({
        title: result.title,
        url: result.url,
        text: `读取失败：${error.message}`,
      })
    }
  }
  return pages
}

async function runBrowserAutomation({ taskId, agentId, message, url }) {
  const { chromium } = await import('playwright')
  const headless = process.env.VISUAL_BRIDGE_BROWSER_HEADLESS !== 'false'
  const clickText = extractClickText(message)
  const shouldScreenshot = wantsScreenshot(message) || Boolean(clickText)
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
  })
  const page = await browser.newPage({
    viewport: { width: 1365, height: 768 },
  })

  try {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-browser-open`,
      status: 'running',
      title: '打开页面',
      detail: url,
      metric: 'Chrome 自动化',
      bubble: '打开',
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})

    let clicked = null
    let clickError = null
    if (clickText) {
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-browser-click`,
        status: 'running',
        title: '点击页面元素',
        detail: clickText,
        metric: '正在点击',
        bubble: '点击',
      })
      try {
        await page.getByText(clickText, { exact: false }).first().click({ timeout: 6000 })
        await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {})
        clicked = clickText
      } catch (error) {
        clickError = error.message
        emitEvent({
          type: 'task_log',
          taskId,
          agentId,
          stepId: `${taskId}-browser-click-failed`,
          status: 'failed',
          title: '点击未完成',
          detail: error.message,
          metric: '点击失败，保留现场',
          bubble: '受阻',
        })
      }
    }

    const title = await page.title()
    const currentUrl = page.url()
    const visibleText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
    let screenshotPath = null

    if (shouldScreenshot) {
      await mkdir(BROWSER_ARTIFACT_ROOT, { recursive: true })
      screenshotPath = path.join(BROWSER_ARTIFACT_ROOT, `${taskId}.png`)
      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
          timeout: 8000,
        })
      } catch {
        const cdp = await page.context().newCDPSession(page)
        const shot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
        })
        await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'))
      }
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-browser-screenshot`,
        status: 'done',
        title: '保存截图',
        detail: screenshotPath,
        metric: '截图已保存',
        bubble: '截图',
      })
    }

    return {
      title,
      url: currentUrl,
      text: visibleText.slice(0, 1400),
      clicked,
      clickError,
      screenshotPath,
      mode: 'playwright',
    }
  } finally {
    await browser.close()
  }
}

function extractSearchResults(html) {
  const results = []
  const linkPattern = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match = linkPattern.exec(html)
  while (match && results.length < 5) {
    results.push({
      title: stripHtml(match[2]).slice(0, 120),
      url: normalizeSearchResultUrl(match[1]),
      snippet: '',
    })
    match = linkPattern.exec(html)
  }
  return results
}

function normalizeSearchResultUrl(rawUrl) {
  const cleaned = rawUrl.replaceAll('&amp;', '&')
  try {
    const absolute = cleaned.startsWith('//')
      ? `https:${cleaned}`
      : cleaned.startsWith('/')
        ? `https://duckduckgo.com${cleaned}`
        : cleaned
    const parsed = new URL(absolute)
    const redirected = parsed.searchParams.get('uddg')
    return redirected ? decodeURIComponent(redirected) : absolute
  } catch {
    return cleaned
  }
}

async function executeBrowserAgent({ taskId, agentId, message }) {
  if (isWeatherRequest(message)) {
    const city = extractWeatherCity(message)
    const day = extractWeatherDay(message)
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-weather-fetch`,
      status: 'running',
      title: '查询天气',
      detail: `${city}${day.label}`,
      metric: `正在获取${day.label}天气`,
      bubble: '天气',
    })
    try {
      const weather = await fetchWeather(city, day)
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-weather-fetch`,
        status: 'done',
        title: '查询天气',
        detail: `${city}${day.label} ${weather.forecast.condition} ${weather.forecast.minTempC ?? '-'}-${weather.forecast.maxTempC ?? '-'}°C`,
        metric: '天气已获取',
        bubble: '完成',
      })
      return {
        answer: buildWeatherAnswer(weather),
        weather,
        url: weather.sourceUrl,
      }
    } catch (error) {
      console.error(`[research-agent] weather failed: ${error.message}`)
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-weather-fetch`,
        status: 'failed',
        title: '天气查询失败',
        detail: error.message,
        metric: '天气能力失败',
        bubble: '失败',
      })
      throw new Error(`天气查询失败：${error.message}`)
    }
  }

  const requestedUrl = extractFirstUrl(message)
  const url = requestedUrl ?? buildSearchUrl(message)
  const needsBrowserOperation = wantsScreenshot(message) || Boolean(extractClickText(message))

  if (needsBrowserOperation) {
    try {
      const automated = await runBrowserAutomation({ taskId, agentId, message, url })
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-browser-automation-done`,
        status: 'done',
        title: '浏览器操作完成',
        detail: automated.clicked ? `已点击：${automated.clicked}` : '已打开并读取页面',
        metric: '浏览器已操作',
        bubble: '完成',
      })
      return {
        answer: [
          `已用 Chrome 自动化打开：${automated.url}`,
          `标题：${automated.title || '未读取到标题'}`,
          automated.clicked ? `已点击：${automated.clicked}` : '',
          automated.clickError ? `点击未完成：${automated.clickError}` : '',
          automated.screenshotPath ? `截图：${automated.screenshotPath}` : '',
          '',
          `页面文本预览：${automated.text}`,
        ].filter(Boolean).join('\n'),
        ...automated,
      }
    } catch (error) {
      console.error(`[research-agent] automation fallback: ${error.message}`)
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-browser-automation-fallback`,
        status: 'failed',
        title: '浏览器自动化失败',
        detail: `${error.message}；改用静态读取。`,
        metric: '改用静态读取',
        bubble: '降级',
      })
    }
  }

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-browser-fetch`,
    status: 'running',
    title: requestedUrl ? '读取网页' : '联网搜索',
    detail: url,
    metric: requestedUrl ? '正在读取网页' : '正在搜索网页',
    bubble: '联网',
  })

  const page = await fetchTextPage(url)
  const title = extractTitle(page.body)
  const description = extractMetaDescription(page.body)
  const text = stripHtml(page.body).slice(0, 1200)
  const results = requestedUrl ? [] : extractSearchResults(page.body)
  const resultPages = requestedUrl ? [] : await fetchSearchResultPages(results)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-browser-parse`,
    status: 'done',
    title: '整理页面信息',
    detail: `HTTP ${page.status} / ${page.contentType || 'unknown content-type'}`,
    metric: '已整理网页',
    bubble: '整理',
  })

  if (resultPages.length) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-browser-source-pages`,
      status: 'done',
      title: '读取来源页',
      detail: `已读取 ${resultPages.length} 个搜索结果来源。`,
      metric: '已补充来源',
      bubble: '来源',
    })
  }

  const synthesizedAnswer = await synthesizeWithPlannerModel({
    message,
    sourceTitle: title,
    sourceText: [
      text,
      ...resultPages.map((item, index) => [
        `来源 ${index + 1}: ${item.title}`,
        `URL: ${item.url}`,
        item.text,
      ].join('\n')),
    ].join('\n\n'),
    results: results.map((item, index) => ({
      ...item,
      pageTextPreview: resultPages[index]?.text?.slice(0, 600) ?? '',
    })),
  }).catch((error) => {
    console.error(`[research-agent] synthesis skipped: ${error.message}`)
    return null
  })

  const answer = synthesizedAnswer
    ? [
        synthesizedAnswer,
        requestedUrl ? `来源：${page.url}` : `依据：${results.length ? results.map((item) => item.title).join('、') : title}`,
      ].join('\n')
    : requestedUrl
    ? [
        `已读取：${page.url}`,
        `标题：${title}`,
        description ? `摘要：${description}` : '',
        '',
        `正文预览：${text}`,
      ].filter(Boolean).join('\n')
    : [
        `已搜索：${message}`,
        `搜索页标题：${title}`,
        results.length
          ? `前 ${results.length} 条结果：\n${results.map((item, index) => `${index + 1}. ${item.title}${item.snippet ? `：${item.snippet}` : ''}`).join('\n')}`
          : `未解析到标准结果，页面预览：${text.slice(0, 600)}`,
      ].join('\n')

  return {
    answer,
    url: page.url,
    title,
    description,
    results,
    resultPages,
  }
}

function normalizeResearchAction(action) {
  const allowed = new Set(['grounded_answer', 'read_url', 'browser_action', 'weather', 'unknown'])
  const normalized = String(action ?? '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'unknown'
}

async function buildResearchAgentIntent({ message }) {
  if (!PLANNER_API_KEY || PLANNER_MODE !== 'llm') {
    return {
      action: extractFirstUrl(message) ? 'read_url' : isWeatherRequest(message) ? 'weather' : 'grounded_answer',
      confidence: 0.6,
      instruction: message,
    }
  }
  const parsed = await callPlannerJson({
    system: [
      'You are the embedded intent model inside a unified research/web assistant.',
      'Decide what web capability should be used. Do not answer the user.',
      'Return only JSON: {"action":"grounded_answer|read_url|browser_action|weather|unknown","confidence":0.0,"instruction":"..."}',
      'Use grounded_answer for general web research, latest facts, news, company background, comparisons, and broad search questions.',
      'Use read_url when the user gives a URL and wants it read or summarized.',
      'Use browser_action when the user asks to click, screenshot, operate a page, or perform visual browser automation.',
      'Use weather for weather questions.',
      'Preserve the user language in instruction.',
    ].join('\n'),
    payload: {
      userMessage: message,
      url: extractFirstUrl(message),
      wantsScreenshot: wantsScreenshot(message),
      clickText: extractClickText(message),
    },
  })
  return {
    action: normalizeResearchAction(parsed.action),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
    instruction: typeof parsed.instruction === 'string' && parsed.instruction.trim() ? parsed.instruction.trim() : message,
  }
}

function extractGeminiText(payload) {
  return payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim() ?? ''
}

function extractGeminiSources(payload) {
  const chunks = payload.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  return chunks
    .map((chunk) => chunk.web)
    .filter((web) => web?.uri || web?.title)
    .map((web) => ({
      title: web.title ?? web.uri,
      url: web.uri,
    }))
    .filter((source, index, array) => source.url && array.findIndex((item) => item.url === source.url) === index)
    .slice(0, 6)
}

async function executeResearchAgent({ taskId, agentId, message }) {
  const intent = await buildResearchAgentIntent({ message })
  if (intent.action === 'read_url' || intent.action === 'browser_action' || intent.action === 'weather') {
    return executeBrowserAgent({ taskId, agentId, message: intent.instruction })
  }
  if (intent.action === 'unknown' || intent.confidence < 0.45) {
    return {
      answer: '我还没判断清楚这个研究任务要怎么查。你可以补一句：要搜索资料、读取网页、截图，还是做对比研究。',
    }
  }
  if (RESEARCH_PROVIDER !== 'gemini' || !GEMINI_API_KEY) {
    throw new Error('研究助手需要 Gemini Google Search grounding，但当前没有配置 GEMINI_API_KEY。')
  }

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-research-grounded`,
    status: 'running',
    title: '联网研究',
    detail: `${RESEARCH_PROVIDER}/${RESEARCH_MODEL}`,
    metric: 'Google Search grounding',
    bubble: '研究',
  })

  const payload = await postJsonWithOptionalProxy(
    `https://generativelanguage.googleapis.com/v1beta/models/${RESEARCH_MODEL}:generateContent`,
    {
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  `当前日期：${new Date().toISOString().slice(0, 10)}。`,
                  '请用简体中文回答。优先给结论，再给必要要点。',
                  '如果是最新/今天/实时问题，请使用联网结果，不要凭记忆补事实。',
                  `用户问题：${intent.instruction}`,
                ].join('\n'),
              },
            ],
          },
        ],
        tools: [
          {
            google_search: {},
          },
        ],
      generationConfig: {
        temperature: 0,
      },
      }),
      timeout: 60000,
    },
  )

  const text = extractGeminiText(payload)
  if (!text) throw new Error('Gemini research returned empty content')
  const sources = extractGeminiSources(payload)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-research-grounded`,
    status: 'done',
    title: '联网研究',
    detail: sources.length ? `已返回 ${sources.length} 个来源` : '已返回联网答案',
    metric: '研究完成',
    bubble: '完成',
  })

  return {
    answer: [
      text,
      sources.length
        ? `\n来源：\n${sources.map((source, index) => `${index + 1}. ${source.title} - ${source.url}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n'),
    sources,
    provider: RESEARCH_PROVIDER,
    model: RESEARCH_MODEL,
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

function normalizeWritingAction(action) {
  const allowed = new Set(['draft', 'polish', 'summarize', 'minutes_from_audio', 'unknown'])
  const normalized = String(action ?? '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'unknown'
}

async function buildWritingAgentIntent({ message }) {
  if (!PLANNER_API_KEY || PLANNER_MODE !== 'llm') {
    return {
      action: extractAudioFilePath(message) ? 'minutes_from_audio' : 'draft',
      confidence: 0.6,
      instruction: message,
    }
  }
  const parsed = await callPlannerJson({
    system: [
      'You are the embedded intent model inside a writing/document assistant.',
      'Decide the writing operation. Do not perform the writing in this step.',
      'Return only JSON: {"action":"draft|polish|summarize|minutes_from_audio|unknown","confidence":0.0,"instruction":"..."}',
      'Use draft for writing reports, briefs, copy, scripts, meeting materials, summaries to be written from given context, and general text material creation.',
      'Use polish for rewriting, improving wording, making text more formal, more concise, or more human.',
      'Use summarize for summarizing pasted text or provided material when no local file operation is requested.',
      'Use minutes_from_audio for audio transcription, recording recognition, or generating minutes from audio/video files.',
      'Preserve the user language in instruction.',
    ].join('\n'),
    payload: {
      userMessage: message,
      audioPath: extractAudioFilePath(message),
    },
  })
  return {
    action: normalizeWritingAction(parsed.action),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
    instruction: typeof parsed.instruction === 'string' && parsed.instruction.trim() ? parsed.instruction.trim() : message,
  }
}

async function generateWritingMaterial({ taskId, agentId, message, intent }) {
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-writing-draft`,
    status: 'running',
    title: '撰写文字材料',
    detail: intent.action,
    metric: '模型撰写中',
    bubble: '撰写',
  })

  const parsed = await callPlannerJson({
    system: [
      'You are a professional Chinese writing assistant for office materials.',
      'Return only JSON: {"answer":"..."}',
      'Write concise, useful, well-structured Simplified Chinese.',
      'If the user asked for polishing or summarizing, only use the supplied user text and do not invent missing facts.',
      'If key context is missing, produce a useful draft and clearly mark assumptions or questions at the end.',
    ].join('\n'),
    payload: {
      action: intent.action,
      userMessage: message,
      instruction: intent.instruction,
    },
  })
  const answer = typeof parsed.answer === 'string' && parsed.answer.trim()
    ? parsed.answer.trim()
    : '我没有生成出可用的文字材料。'

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-writing-draft`,
    status: 'done',
    title: '撰写文字材料',
    detail: truncateAtBoundary(answer, 180),
    metric: '撰写完成',
    bubble: '完成',
  })

  return { answer }
}

async function executeWritingAgent({ taskId, agentId, message }) {
  const intent = await buildWritingAgentIntent({ message })
  if (intent.action === 'minutes_from_audio') {
    return transcribeMeetingAudio({ taskId, agentId, message: intent.instruction })
  }
  if (intent.action === 'unknown' || intent.confidence < 0.45) {
    return {
      answer: '我还没判断清楚要写哪类材料。你可以直接说：写一份会议纪要、起草邮件、润色这段话、整理成汇报稿。',
    }
  }
  return generateWritingMaterial({ taskId, agentId, message, intent })
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

function stringArg(args, key) {
  const value = args?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function arrayArg(args, key) {
  const value = args?.[key]
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
}

async function resolveCapabilityFilePath({ taskId, threadId, message, args }) {
  const explicit = stringArg(args, 'filePath')
    ?? stringArg(args, 'path')
    ?? stringArg(args, 'sourceFile')
  if (explicit) {
    const resolved = await resolveExistingFileReference(explicit).catch(() => null)
    if (resolved && existsSync(resolved)) return resolved
  }
  return resolveReadableFileFromMessage(taskId, message, threadId)
}

async function executeFileCapability({ taskId, agentId, step, previousResult, userMessage, threadId }) {
  const args = step.args ?? {}
  if (step.capability === 'list_reports') return listSavedReports({ taskId, agentId })
  if (step.capability === 'count_reports') return countSavedReports({ taskId, agentId })
  if (step.capability === 'list_saved_files') {
    return listSavedFiles({
      taskId,
      agentId,
      scope: stringArg(args, 'scope') ?? normalizeSavedFileScope(null, step.message),
      query: stringArg(args, 'query') ?? '',
      format: stringArg(args, 'format') ?? '',
    })
  }
  if (step.capability === 'count_files') {
    return countSavedFiles({
      taskId,
      agentId,
      scope: stringArg(args, 'scope') ?? normalizeSavedFileScope(null, step.message),
      query: stringArg(args, 'query') ?? '',
      format: stringArg(args, 'format') ?? '',
    })
  }

  const index = await buildFileIndex()
  if (step.capability === 'list_files') return buildIndexedFileListResult({ taskId, agentId, index })
  if (step.capability === 'list_paths') return buildIndexedFileLocationsResult({ taskId, agentId, index })
  if (step.capability === 'search_files') {
    const query = stringArg(args, 'query') ?? step.message
    return buildFileSearchResult({ taskId, agentId, message: query, index })
  }
  if (step.capability === 'save_report') {
    if (!previousResult) {
      return unsupportedCapabilityResult('文件助手', '保存上一步报告', '当前工作流里没有可保存的上一步结果。')
    }
    return saveReportFromResult({
      taskId,
      agentId,
      userMessage,
      stepMessage: step.message,
      previousResult,
      format: stringArg(args, 'format') ?? inferReportFormat(`${userMessage}\n${step.message}`),
      title: stringArg(args, 'title'),
    })
  }
  if (step.capability === 'write_file') {
    const source = stringArg(args, 'source') ?? 'previous_result'
    if (source === 'previous_answer' || !previousResult) {
      return savePreviousAnswerAsNote({
        taskId,
        agentId,
        threadId,
        format: stringArg(args, 'format') ?? inferSaveFormat(`${userMessage}\n${step.message}`),
      })
    }
    return saveReportFromResult({
      taskId,
      agentId,
      userMessage,
      stepMessage: step.message,
      previousResult,
      format: stringArg(args, 'format') ?? inferReportFormat(`${userMessage}\n${step.message}`),
      title: stringArg(args, 'title'),
    })
  }
  if (step.capability === 'save_previous_answer') {
    return savePreviousAnswerAsNote({
      taskId,
      agentId,
      threadId,
      format: stringArg(args, 'format') ?? inferSaveFormat(`${userMessage}\n${step.message}`),
    })
  }
  if (step.capability === 'read_file') {
    const sourceFile = await resolveCapabilityFilePath({ taskId, threadId, message: step.message, args })
    if (!sourceFile) {
      return unsupportedCapabilityResult('文件助手', '读取文件', '我已经识别到要读取文件，但没有解析到可读取的具体文件。')
    }
    const raw = await readFile(sourceFile, 'utf8')
    const text = await readableDocumentText(raw, sourceFile)
    const relativePath = path.relative(WORKSPACE_ROOT, sourceFile)
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-read-document`,
      status: 'done',
      title: '读取报告文件',
      detail: relativePath,
      metric: '已读取报告',
      bubble: '读取',
    })
    return {
      answer: summarizeReadableDocument(text, sourceFile),
      files: [relativePath],
      snippets: [{ file: relativePath, preview: text.slice(0, 1200) }],
      text,
    }
  }
  if (step.capability === 'convert_file') {
    const sourceFile = await resolveCapabilityFilePath({ taskId, threadId, message: step.message, args })
    if (!sourceFile) return unsupportedCapabilityResult('文件助手', '转换文件格式', '没有找到要转换的源文件。')
    const format = stringArg(args, 'format')
    const message = format ? `${step.message}\n转换成 ${format}` : step.message
    return convertReadableDocumentFile({ taskId, agentId, sourceFile, message })
  }
  if (step.capability === 'rewrite_file') {
    const sourceFile = await resolveCapabilityFilePath({ taskId, threadId, message: step.message, args })
    if (!sourceFile) return unsupportedCapabilityResult('文件助手', '改写文件', '没有找到要改写的源文件。')
    return rewriteDocumentFile({
      taskId,
      agentId,
      sourceFile,
      targetFile: normalizeTargetFilePath(stringArg(args, 'targetFile') ?? stringArg(args, 'targetPath')),
      format: stringArg(args, 'format') ?? inferReportFormat(step.message),
      message: step.message,
      instruction: stringArg(args, 'instruction') ?? step.message,
    })
  }
  if (step.capability === 'compare_files') {
    const explicit = arrayArg(args, 'filePaths')
      .concat(arrayArg(args, 'sourceFiles'))
      .concat(arrayArg(args, 'files'))
    const sourceFiles = explicit.length
      ? await resolveFileReferences(explicit)
      : selectRecentFilesForComparison(await findRecentSavedFiles(taskId, threadId, 8).catch(() => [])).filter(Boolean)
    return compareDocumentFiles({
      taskId,
      agentId,
      sourceFiles,
      targetFile: normalizeTargetFilePath(stringArg(args, 'targetFile') ?? stringArg(args, 'targetPath')),
      format: stringArg(args, 'format') ?? inferReportFormat(step.message),
      message: step.message,
    })
  }
  if (step.capability === 'manage_file') return prepareFileManagementAction({ taskId, agentId, message: step.message })
  if (step.capability === 'delete_files') return prepareDeleteFilesAction({ taskId, agentId, message: step.message, args })
  if (step.capability === 'cleanup_reports') return prepareReportCleanupAction({ taskId, agentId, keep: stringArg(args, 'keep') ?? 'latest' })
  return unsupportedCapabilityResult('文件助手', step.capability)
}

async function executeResearchCapability({ taskId, agentId, step }) {
  const args = step.args ?? {}
  if (step.capability === 'weather') {
    const city = stringArg(args, 'city')
    const day = stringArg(args, 'day')
    const dayLabelMap = {
      today: '今天',
      tomorrow: '明天',
      day_after_tomorrow: '后天',
    }
    const normalizedDay = dayLabelMap[day] ?? day
    const parts = [step.message]
    if (city && !String(step.message).includes(city)) parts.push(`城市：${city}`)
    if (normalizedDay && !/(今天|明天|后天|today|tomorrow|day_after_tomorrow|day after tomorrow)/iu.test(step.message)) {
      parts.push(`时间：${normalizedDay}`)
    }
    return executeBrowserAgent({ taskId, agentId, message: parts.filter(Boolean).join('\n') })
  }
  if (step.capability === 'read_url') {
    const url = stringArg(args, 'url') ?? extractFirstUrl(step.message)
    if (!url) return unsupportedCapabilityResult('研究助手', '读取网页', '没有解析到 URL。')
    return executeBrowserAgent({ taskId, agentId, message: `读取 ${url}\n${step.message}` })
  }
  if (step.capability === 'browser_action') return executeBrowserAgent({ taskId, agentId, message: step.message })
  if (step.capability === 'grounded_answer') {
    const query = stringArg(args, 'query') ?? step.message
    return executeResearchAgent({ taskId, agentId, message: query })
  }
  return unsupportedCapabilityResult('研究助手', step.capability)
}

async function executeWritingCapability({ taskId, agentId, step, previousResult }) {
  const args = step.args ?? {}
  const priorText = previousResult?.answer || previousResult?.text || previousResult?.raw || ''
  const messageWithContext = priorText
    ? [
        step.message,
        '',
        '上一步助手结果：',
        String(priorText).slice(0, 12000),
      ].join('\n')
    : step.message
  if (step.capability === 'minutes_from_audio') {
    const audioPath = stringArg(args, 'audioPath')
    const message = audioPath ? `${messageWithContext}\n录音文件：${audioPath}` : messageWithContext
    return transcribeMeetingAudio({ taskId, agentId, message })
  }
  if (step.capability === 'draft_text') {
    return generateWritingMaterial({ taskId, agentId, message: messageWithContext, intent: { action: 'draft', instruction: stringArg(args, 'instruction') ?? step.message } })
  }
  if (step.capability === 'polish_text') {
    return generateWritingMaterial({ taskId, agentId, message: messageWithContext, intent: { action: 'polish', instruction: stringArg(args, 'instruction') ?? step.message } })
  }
  if (step.capability === 'summarize_text') {
    return generateWritingMaterial({ taskId, agentId, message: messageWithContext, intent: { action: 'summarize', instruction: stringArg(args, 'instruction') ?? step.message } })
  }
  return unsupportedCapabilityResult('文书助手', step.capability)
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

async function executeCapabilityStep({ taskId, step, previousResult, userMessage, threadId }) {
  if (!hasCapability(step.agentId, step.capability)) {
    return unsupportedCapabilityResult(agentName(step.agentId), step.capability)
  }
  if (step.agentId === 'file-agent') {
    return executeFileCapability({
      taskId,
      agentId: step.agentId,
      step,
      previousResult,
      userMessage,
      threadId,
    })
  }
  if (step.agentId === 'research-agent') return executeResearchCapability({ taskId, agentId: step.agentId, step })
  if (step.agentId === 'writing-agent') return executeWritingCapability({ taskId, agentId: step.agentId, step, previousResult })
  if (step.agentId === 'app-agent') return executeAppCapability({ taskId, agentId: step.agentId, step, previousResult, threadId })
  return unsupportedCapabilityResult(agentName(step.agentId), step.capability)
}

async function executeTask({ taskId, agentId, message }) {
  if (agentId === 'main') return executeSupervisorTask({ taskId, agentId, message })
  if (agentId === 'file-agent') return executeFileAgent({ taskId, agentId, message })
  if (agentId === 'research-agent') return executeResearchAgent({ taskId, agentId, message })
  if (agentId === 'browser-agent') return executeResearchAgent({ taskId, agentId: 'research-agent', message })
  if (agentId === 'writing-agent' || agentId === 'meeting-agent') return executeWritingAgent({ taskId, agentId: 'writing-agent', message })
  if (agentId === 'schedule-agent') return executeScheduleAgent({ taskId, agentId, message })
  if (agentId === 'app-agent') return executeSystemAgent({ taskId, agentId, message })
  return executeFileAgent({ taskId, agentId: 'file-agent', message })
}

async function executeSupervisorTask({ taskId, agentId, message }) {
  const threadId = activeTasks.get(taskId)?.threadId
  const context = await buildConversationContext(taskId, threadId)
  const runtimeContext = await buildSupervisorRuntimeContext(taskId, threadId)
  const planResult = await buildSupervisorPlan(message, context, runtimeContext)
  const plan = planResult.steps
  if (planResult.answer && plan.length === 0) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-supervisor-clarify`,
      status: 'done',
      title: '主控澄清',
      detail: planResult.answer,
      metric: `无需派活 / ${planResult.source}`,
      bubble: '澄清',
      announce: true,
    })
    return {
      answer: planResult.answer,
      plan,
      results: [],
    }
  }
  const supervisorBrief = buildSupervisorBrief(message, plan, planResult.source)
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-supervisor-plan`,
    status: 'done',
    title: '主控理解与派活',
    detail: supervisorBrief,
    metric: `${plan.length} 个步骤 / ${planResult.source}`,
    bubble: '计划',
    announce: true,
  })

  const results = []
  for (const [index, step] of plan.entries()) {
    const agentName = AGENTS.find((agent) => agent.id === step.agentId)?.name ?? step.agentId
    const previousResult = results.at(-1)
    const fromAgentId = previousResult?.agentId ?? 'main'
    const handoffText = previousResult
      ? [
          `${previousResult.agentName} 已完成上一步。`,
          `结果摘要：${previousResult.summary || '已完成'}`,
          `请继续处理：${step.message}`,
        ].join('\n')
      : step.message
    if (fromAgentId !== step.agentId) {
      emitEvent({
        type: 'agent_message',
        taskId,
        fromAgentId,
        toAgentId: step.agentId,
        title: previousResult ? '交付下一步' : '任务指派',
        text: handoffText,
      })
    }
    emitEvent({
      type: 'task_log',
      taskId,
      agentId: step.agentId,
      stepId: `${taskId}-supervisor-step-${index + 1}`,
      status: 'running',
      title: `执行步骤 ${index + 1}`,
      detail: `${agentName}: ${step.capability ? `${describeCapability(step.agentId, step.capability)} / ` : ''}${step.message}`,
      metric: `步骤 ${index + 1}/${plan.length}`,
      bubble: '执行',
    })

    const result = step.capability
      ? await executeCapabilityStep({
          taskId,
          step,
          previousResult: previousResult?.result,
          userMessage: message,
          threadId,
        })
      : await executeTask({
          taskId,
          agentId: step.agentId,
          message: step.message,
        })

    if (result?.pendingAction) {
      return result
    }

    results.push({
      agentId: step.agentId,
      agentName,
      message: step.message,
      summary: summarizeResult(result),
      result,
    })
    const nextStep = plan[index + 1]
    if (!nextStep) {
      emitEvent({
        type: 'agent_message',
        taskId,
        fromAgentId: step.agentId,
        toAgentId: 'main',
        title: '回报主控',
        text: summarizeResult(result) || '已完成',
      })
    }
    emitEvent({
      type: 'task_log',
      taskId,
      agentId: step.agentId,
      stepId: `${taskId}-supervisor-step-${index + 1}`,
      status: 'done',
      title: `完成步骤 ${index + 1}`,
      detail: `${agentName}: ${summarizeResult(result) || '已完成'}`,
      metric: `步骤 ${index + 1}/${plan.length} 完成`,
      bubble: '完成',
    })
  }

  const savedResults = results.filter((item) => item.result?.savedPath)
  const reportPreview = savedResults.length ? buildChatReportPreview(results) : ''
  const finalAnswer = savedResults.length
    ? [
        '完成了，报告已整理并保存。',
        ...savedResults.flatMap((item) => (item.result?.files ?? []).map((file) => `文件：${file}`)),
        '完整内容已写入文件，聊天里先放简版摘要。',
        reportPreview ? `摘要：${reportPreview}` : null,
      ].filter(Boolean).join('\n')
    : results.length === 1
    ? results[0].result?.answer ?? `${results[0].agentName}: ${results[0].summary || '已完成'}`
    : [
        `主控已完成 ${results.length} 个步骤：`,
        ...results.map((item, index) => `${index + 1}. ${item.agentName}: ${item.summary || '已完成'}`),
      ].join('\n')

  return {
    answer: finalAnswer,
    plan,
    results,
  }
}

async function startTask({ message, requestedAgentId, threadId }) {
  const agentId = classifyAgent(message, requestedAgentId)
  const agent = AGENTS.find((item) => item.id === agentId)
  if (!agent) throw new Error(`Unknown agent: ${agentId}`)

  const taskId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  activeTasks.set(taskId, {
    taskId,
    agentId,
    message,
    threadId,
    startedAt: new Date().toISOString(),
  })
  emitEvent({
    type: 'task_started',
    taskId,
    agentId,
    threadId,
    message,
    metric: `${agent.name} 已接管`,
    bubble: agent.executor,
  })

  executeTask({ taskId, agentId, message })
    .then((result) => {
      if (result?.pendingAction) return
      activeTasks.delete(taskId)
      emitEvent({
        type: 'task_finished',
        taskId,
        agentId,
        threadId,
        result: compactResultForClient(result),
        metric: '任务已完成',
        bubble: '完成',
      })
    })
    .catch((error) => {
      activeTasks.delete(taskId)
      emitEvent({
        type: 'task_failed',
        taskId,
        agentId,
        threadId,
        error: error.message,
        metric: '执行失败',
        bubble: '异常',
      })
    })

  return { ok: true, taskId, agentId, threadId, status: 'running' }
}

async function confirmAction(actionId) {
  const action = pendingActions.get(actionId)
  if (!action) throw new Error(`Unknown pending action: ${actionId}`)

  if (action.type === 'open_app') {
    const result = runCommand('open', ['-a', action.appName], { cwd: '/', timeout: 8000 })
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `open -a ${action.appName} failed`)
    }
  }

  if (action.type === 'open_file') {
    const result = runCommand('open', [action.filePath], { cwd: '/', timeout: 8000 })
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `open ${action.filePath} failed`)
    }
  }

  if (action.type === 'delete_file') {
    await rm(action.sourcePath, { force: false })
    cachedFileIndex = null
  }

  if (action.type === 'rename_file' || action.type === 'move_file') {
    await mkdir(path.dirname(action.targetPath), { recursive: true })
    await rename(action.sourcePath, action.targetPath)
    cachedFileIndex = null
  }

  if (action.type === 'copy_file') {
    await mkdir(path.dirname(action.targetPath), { recursive: true })
    await copyFile(action.sourcePath, action.targetPath)
    cachedFileIndex = null
  }

  if (action.type === 'cleanup_reports' || action.type === 'delete_files') {
    for (const filePath of action.deletePaths ?? []) {
      await rm(filePath, { force: true }).catch(() => {})
    }
    cachedFileIndex = null
  }

  pendingActions.delete(actionId)
  const result = {
    answer: `已确认并执行：${action.title}`,
  }
  if (action.type === 'open_file') {
    result.files = [action.relativePath]
    result.savedPath = action.filePath
    result.format = path.extname(action.filePath).replace(/^\./, '')
  }
  if (action.type === 'cleanup_reports' || action.type === 'delete_files') {
    result.answer = [
      `已删除 ${action.deletePaths?.length ?? 0} 个文件。`,
      action.keepPath ? `保留：${path.relative(WORKSPACE_ROOT, action.keepPath)}` : null,
    ].filter(Boolean).join('\n')
    result.files = action.keepPath ? [path.relative(WORKSPACE_ROOT, action.keepPath)] : []
  }
  emitEvent({
    type: 'task_finished',
    taskId: action.taskId,
    agentId: action.ownerAgentId ?? action.agentId,
    threadId: action.threadId,
    result,
    metric: '已执行确认动作',
    bubble: '完成',
  })
  activeTasks.delete(action.taskId)
  return { ok: true, actionId }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/runtime') {
      sendJson(response, 200, await runtimeSnapshot())
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/history') {
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10)
      sendJson(response, 200, {
        ok: true,
        history: await readHistory(Number.isFinite(limit) ? limit : 20),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/file-index') {
      const rebuild = url.searchParams.get('rebuild') === '1'
      const index = rebuild ? await buildFileIndex() : await getFileIndex()
      sendJson(response, 200, {
        ok: true,
        builtAt: index.builtAt,
        root: index.root,
        fileCount: index.files.length,
        files: index.files.map(publicFileEntry),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
      })
      response.write('\n')
      clients.add(response)
      response.on('error', () => clients.delete(response))
      request.on('close', () => clients.delete(response))
      return
    }

    if (request.method === 'POST' && (url.pathname === '/api/tasks' || url.pathname === '/api/probe')) {
      const body = await readJson(request)
      const message = body.message || '只回复 OK'
      const result = await startTask({
        message,
        requestedAgentId: body.agentId,
        threadId: body.threadId,
      })
      sendJson(response, 202, result)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/actions/confirm') {
      const body = await readJson(request)
      sendJson(response, 200, await confirmAction(body.actionId))
      return
    }

    sendJson(response, 404, { ok: false, error: 'Not found' })
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Local OS Agent bridge listening at http://${HOST}:${PORT}`)
  console.log(`workspace=${WORKSPACE_ROOT}`)
  console.log(`writing gateway=ws://127.0.0.1:${OPENCLAW_AGENT_MAP['writing-agent'].gatewayPort}`)
})
