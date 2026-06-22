// pocket.mjs — 便携墨水屏 MVP：本机 AI 工具探测、用量摘要和三按钮指令入口。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, chmod, mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ARTIFACT_ROOT, WORKSPACE_ROOT } from './config.mjs'
import { activeTasks, emitEvent, pendingActions, readHistory } from './events.mjs'
import { checkPort, runCommandAsync, truncateAtBoundary } from './lib.mjs'

const POCKET_ROOT = path.join(ARTIFACT_ROOT, 'pocket')
const POCKET_COMMAND_LOG = path.join(POCKET_ROOT, 'commands.jsonl')
const POCKET_LAST_COMMAND = path.join(POCKET_ROOT, 'last-command.txt')
const CLAUDE_LOGIN_COMMAND = path.join(POCKET_ROOT, 'claude-code-login.command')
const STATUS_TTL_MS = 5000
const LOCAL_USAGE_WINDOW_DAYS = 7
const LOCAL_SESSION_WINDOW_DAYS = 30
const MAX_TOOL_SESSION_FILES = 1800
const MAX_TOOL_SESSIONS_PER_TOOL = 500
const MAX_HISTORY_ITEMS = 1100
const TOOL_SESSION_TTL_MS = 30000
const SESSION_HEAD_BYTES = 64 * 1024
const SESSION_TAIL_BYTES = 2 * 1024 * 1024
const SESSION_MAX_TAIL_BYTES = 8 * 1024 * 1024
const SESSION_MIN_TAIL_LINES = 400
const MAX_SESSION_MESSAGES = 28
const MAX_SESSION_MESSAGE_CHARS = 900
const HOME_DIR = process.env.HOME ?? ''
const CODEX_DESKTOP_BINARY = '/Applications/Codex.app/Contents/Resources/codex'
const SYNC_CODEX_DESKTOP_UI = process.env.POCKET_SYNC_CODEX_DESKTOP_UI !== '0'

const TOOL_SPECS = [
  {
    id: 'codex',
    name: 'Codex',
    shortName: 'CDX',
    glyph: '>_',
    kind: 'cli',
    command: 'codex',
    knownPaths: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
    processMatch: /\/Codex\.app\/|\/codex(\s|$)|codex app-server/i,
    station: { x: 132, y: 258 },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    shortName: 'CLAUDE',
    glyph: 'C',
    kind: 'desktop',
    command: 'claude',
    knownPaths: ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
    appPath: '/Applications/Claude.app',
    processMatch: /\/Claude\.app\//i,
    station: { x: 286, y: 258 },
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    shortName: 'CLAW',
    glyph: 'OC',
    kind: 'gateway',
    command: 'openclaw',
    knownPaths: ['/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw'],
    processMatch: /openclaw|\.openclaw/i,
    station: { x: 536, y: 258 },
  },
]

let cachedStatus = null
let cachedStatusAt = 0
let lastOpenClawStatus = null
let lastOpenClawUsage = null
let lastClaudeCliUsage = null
let cachedLocalUsage = null
let cachedLocalUsageAt = 0
let cachedToolSessions = null
let cachedToolSessionsAt = 0

function codexDesktopReplyState() {
  const executable = existsSync(CODEX_DESKTOP_BINARY)
    ? CODEX_DESKTOP_BINARY
    : findExecutable(TOOL_SPECS.find((tool) => tool.id === 'codex'))
  const available = Boolean(executable)
  return {
    available,
    executable,
    mode: available ? 'codex app-server thread/resume + turn/start' : 'codex cli required',
    reason: available
      ? null
      : '未发现 codex CLI；pocket 可以读取这个真实 session，但不能启动本地 app-server 原地回复。',
  }
}

async function refreshCodexDesktopThread(threadId) {
  if (!SYNC_CODEX_DESKTOP_UI || !threadId) return null
  const result = await runCommandAsync('open', [`codex://threads/${encodeURIComponent(threadId)}`], {
    cwd: '/',
    timeout: 1500,
  })
  return result.status === 0
    ? null
    : truncateAtBoundary(result.stderr || result.stdout || 'Codex Desktop refresh failed', 180)
}

function invalidateToolSessionCache() {
  cachedToolSessions = null
  cachedToolSessionsAt = 0
}

function findExecutable(spec) {
  return spec.knownPaths.find((candidate) => existsSync(candidate)) ?? null
}

function parseVersion(toolId, stdout) {
  const line = stdout.trim().split('\n').find(Boolean) ?? ''
  if (toolId === 'codex') return line.replace(/^codex-cli\s*/i, '').trim() || line
  if (toolId === 'claude-code') return line.replace(/\s*\(Claude Code\)\s*$/i, '').trim() || line
  if (toolId === 'openclaw') return line.replace(/^OpenClaw\s*/i, '').split(/\s+/)[0] || line
  return line
}

async function readProcessList() {
  const result = await runCommandAsync('ps', ['axo', 'pid=,pcpu=,pmem=,args='], { timeout: 2000 })
  if (result.status !== 0) return []
  return result.stdout.split('\n').map((line) => {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/)
    if (!match) return null
    return {
      pid: Number.parseInt(match[1], 10),
      cpu: Number.parseFloat(match[2]),
      mem: Number.parseFloat(match[3]),
      args: match[4],
    }
  }).filter(Boolean)
}

function summarizeProcesses(spec, processes) {
  const matches = processes.filter((process) => spec.processMatch.test(process.args))
  const cpu = matches.reduce((sum, process) => sum + (Number.isFinite(process.cpu) ? process.cpu : 0), 0)
  const mem = matches.reduce((sum, process) => sum + (Number.isFinite(process.mem) ? process.mem : 0), 0)
  return {
    count: matches.length,
    pids: matches.slice(0, 6).map((process) => process.pid),
    cpu: Math.round(cpu * 10) / 10,
    mem: Math.round(mem * 10) / 10,
  }
}

async function readOpenClawStatus() {
  const result = await runCommandAsync('openclaw', ['status', '--no-color'], { timeout: 12000 })
  if (result.status !== 0) return lastOpenClawStatus ? { ...lastOpenClawStatus, stale: true } : null
  const dashboard = result.stdout.match(/Dashboard\s+│\s+(http:\/\/[^\s│]+)/)?.[1]
  const gateway = result.stdout.match(/Gateway\s+│\s+([^\n]+)/)?.[1]?.replace(/\s+│$/, '').trim()
  const tasks = result.stdout.match(/Tasks\s+│\s+([^\n]+)/)?.[1]?.replace(/\s+│$/, '').trim()
  const sessions = result.stdout.match(/Sessions\s+│\s+([^\n]+)/)?.[1]?.replace(/\s+│$/, '').trim()
  const tokenLines = result.stdout
    .split('\n')
    .filter((line) => /Tokens|\/\d+k|\/\d+/.test(line))
    .slice(1, 4)
    .map((line) => line.replace(/[│┌┐└┘├┤─]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const status = {
    dashboard,
    gateway: gateway ? truncateAtBoundary(gateway, 120) : '',
    tasks: tasks ? truncateAtBoundary(tasks, 110) : '',
    sessions: sessions ? truncateAtBoundary(sessions, 110) : '',
    tokenSummary: tokenLines,
  }
  lastOpenClawStatus = status
  return status
}

function parseJsonFromOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1))
    throw new Error('No JSON object found')
  }
}

async function readOpenClawUsage() {
  const result = await runCommandAsync('openclaw', ['gateway', 'usage-cost', '--days', '7', '--json', '--timeout', '8000'], { timeout: 12000 })
  if (result.status !== 0 || !result.stdout.trim()) {
    return lastOpenClawUsage ? { ...lastOpenClawUsage, stale: true } : null
  }
  try {
    const usage = parseJsonFromOutput(result.stdout)
    if (usage?.totals) {
      lastOpenClawUsage = usage
      return usage
    }
    return usage
  } catch {
    return lastOpenClawUsage
      ? { ...lastOpenClawUsage, stale: true }
      : { raw: truncateAtBoundary(result.stdout, 120) }
  }
}

async function readClaudeAuthStatus() {
  const result = await runCommandAsync('claude', ['auth', 'status'], { timeout: 3000 })
  if (!result.stdout.trim()) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    return {
      loggedIn: result.status === 0 && /logged\s*in/i.test(result.stdout),
      raw: truncateAtBoundary(result.stdout || result.stderr, 120),
    }
  }
}

async function readRecentPocketCommands(limit = 6) {
  const text = await readFile(POCKET_COMMAND_LOG, 'utf8').catch(() => '')
  return text.trim().split('\n').filter(Boolean).slice(-limit).reverse().map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  }).filter(Boolean)
}

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((item) => item?.text ?? item?.content ?? '').filter(Boolean).join('\n')
  }
  return ''
}

async function listRecentFiles(root, { extensions = ['.jsonl'], sinceMs, maxFiles = 80 } = {}) {
  if (!root || !existsSync(root)) return []
  const files = []
  async function walk(dir, depth = 0) {
    if (depth > 6 || files.length > maxFiles * 3) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (entry) => {
      const filePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(filePath, depth + 1)
        return
      }
      if (!entry.isFile() || !extensions.some((extension) => entry.name.endsWith(extension))) return
      const fileStat = await stat(filePath).catch(() => null)
      if (!fileStat || fileStat.mtimeMs < sinceMs) return
      files.push({ filePath, mtimeMs: fileStat.mtimeMs })
    }))
  }
  await walk(root)
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((file) => file.filePath)
}

async function readSessionSnippet(filePath) {
  const fileStat = await stat(filePath).catch(() => null)
  if (!fileStat) return ''
  const maxBytes = SESSION_HEAD_BYTES + SESSION_TAIL_BYTES
  if (fileStat.size <= maxBytes) return readFile(filePath, 'utf8').catch(() => '')

  const handle = await open(filePath, 'r').catch(() => null)
  if (!handle) return ''
  try {
    const head = Buffer.alloc(SESSION_HEAD_BYTES)
    const headRead = await handle.read(head, 0, SESSION_HEAD_BYTES, 0)
    let tailText = ''
    for (let tailBytes = SESSION_TAIL_BYTES; tailBytes <= SESSION_MAX_TAIL_BYTES; tailBytes *= 2) {
      const effectiveTailBytes = Math.min(tailBytes, fileStat.size)
      const tail = Buffer.alloc(effectiveTailBytes)
      const tailStart = Math.max(0, fileStat.size - effectiveTailBytes)
      const tailRead = await handle.read(tail, 0, effectiveTailBytes, tailStart)
      const rawTail = tail.subarray(0, tailRead.bytesRead).toString('utf8')
      const firstLineBreak = rawTail.indexOf('\n')
      tailText = tailStart > 0 && firstLineBreak >= 0
        ? rawTail.slice(firstLineBreak + 1)
        : rawTail
      const lineCount = tailText.split('\n').filter((line) => line.trim()).length
      if (tailStart === 0 || lineCount >= SESSION_MIN_TAIL_LINES) break
    }
    return [
      head.subarray(0, headRead.bytesRead).toString('utf8'),
      tailText,
    ].join('\n')
  } finally {
    await handle.close().catch(() => {})
  }
}

function addTokenUsage(target, usage = {}) {
  const input = Number(usage.input_tokens ?? usage.input ?? 0)
  const output = Number(usage.output_tokens ?? usage.output ?? 0)
  const cacheRead = Number(usage.cache_read_input_tokens ?? usage.cached_input_tokens ?? usage.cacheRead ?? 0)
  const cacheCreate = Number(usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens ?? usage.cacheWrite ?? 0)
  const reasoning = Number(usage.reasoning_output_tokens ?? 0)
  target.input += Number.isFinite(input) ? input : 0
  target.output += Number.isFinite(output) ? output : 0
  target.cacheRead += Number.isFinite(cacheRead) ? cacheRead : 0
  target.cacheWrite += Number.isFinite(cacheCreate) ? cacheCreate : 0
  target.reasoning += Number.isFinite(reasoning) ? reasoning : 0
}

function totalTokens(usage) {
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite + usage.reasoning
}

function projectLabelFromCwd(cwd) {
  if (!cwd) return '未知项目'
  return path.basename(cwd) || cwd
}

function isClaudeUsageCommand(message) {
  return /<command-name>\/usage(?:[-\w]*)?<\/command-name>|^\/usage(?:\b|-)/i.test(String(message ?? '').trim())
}

function resolveCommandCwd(candidate) {
  const cwd = String(candidate ?? '').trim()
  return cwd && path.isAbsolute(cwd) && existsSync(cwd) ? cwd : WORKSPACE_ROOT
}

function truncatePreservingLineBreaks(value, maxLength = 900) {
  const text = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
  if (text.length <= maxLength) return text
  const slice = text.slice(0, maxLength)
  const boundary = Math.max(
    slice.lastIndexOf('\n\n'),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf('。'),
    slice.lastIndexOf('；'),
    slice.lastIndexOf(';'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
  )
  if (boundary > maxLength * 0.45) return slice.slice(0, boundary + 1).trim()
  return `${slice.replace(/[，,、：:；;。\s]*$/, '').trim()}…`
}

function pushSessionMessage(messages, { role, text, at }) {
  const cleanText = String(text ?? '').trim()
  if (!cleanText) return
  if (/^<environment_context>/i.test(cleanText)) return
  const normalizedRole = role === 'assistant' || role === 'ai' ? 'assistant' : 'user'
  const duplicate = messages.slice(-4).some((item) => (
    item.role === normalizedRole && item.text === cleanText
  ))
  if (duplicate) return
  messages.push({
    role: normalizedRole,
    text: truncatePreservingLineBreaks(cleanText, MAX_SESSION_MESSAGE_CHARS),
    at,
  })
}

function sessionRecord({ toolId, sessionId, message, summary, conversation = [], startedAt, finishedAt, sourcePath, model, toolSource, workspaceRoot, canReply, replyMode, replyBlockedReason }) {
  const workspaceLabel = projectLabelFromCwd(workspaceRoot)
  return {
    taskId: `${toolId}:${sessionId}`,
    agentId: toolId,
    toolSessionId: sessionId,
    toolSessionCwd: workspaceRoot,
    workspaceRoot,
    workspaceLabel,
    source: 'tool-session',
    toolSource,
    canReply: Boolean(canReply),
    replyMode: replyMode ?? 'view-only',
    replyBlockedReason: canReply ? null : replyBlockedReason ?? null,
    message: truncateAtBoundary(message || '最近会话', 500),
    status: 'done',
    startedAt,
    finishedAt: finishedAt ?? startedAt,
    summary: truncateAtBoundary(summary || message || '暂无回复摘要', 500),
    conversation: conversation.slice(-MAX_SESSION_MESSAGES),
    model,
    artifacts: [],
    steps: sourcePath ? [{
      id: `${toolId}-${sessionId}-source`,
      status: 'done',
      title: '真实工具会话',
      detail: [
        workspaceLabel ? `项目：${workspaceLabel}` : null,
        workspaceRoot ? `目录：${workspaceRoot}` : null,
        toolSource ? `来源：${toolSource}` : null,
        canReply ? `回复：${replyMode ?? 'resume'}` : `回复：${replyBlockedReason ?? '只读'}`,
        sourcePath,
      ].filter(Boolean).join('\n'),
      at: finishedAt ?? startedAt,
    }] : [],
  }
}

function formatWindowLabel(minutes) {
  if (!Number.isFinite(minutes)) return ''
  if (minutes >= 10080) return '7d'
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`
  return `${minutes}m`
}

function formatResetTime(seconds, { includeDate = false } = {}) {
  if (!Number.isFinite(seconds)) return null
  try {
    const date = new Date(seconds * 1000)
    return formatResetDate(date, { includeDate })
  } catch {
    return null
  }
}

function formatResetDate(date, { includeDate = false } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  try {
    if (includeDate) {
      return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace(/\//g, '/')
        + ' '
        + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return null
  }
}

function parseEnglishResetDate(monthLabel, dayLabel, timeLabel) {
  const monthIndex = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  }[String(monthLabel ?? '').slice(0, 3).toLowerCase()]
  const day = Number.parseInt(dayLabel, 10)
  const timeMatch = String(timeLabel ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!Number.isFinite(monthIndex) || !Number.isFinite(day) || !timeMatch) return null
  let hour = Number.parseInt(timeMatch[1], 10)
  const minute = Number.parseInt(timeMatch[2] ?? '0', 10)
  const meridiem = timeMatch[3]?.toLowerCase()
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  const now = new Date()
  let date = new Date(now.getFullYear(), monthIndex, day, hour, minute)
  if (date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    date = new Date(now.getFullYear() + 1, monthIndex, day, hour, minute)
  }
  return date
}

function compactResetLabel(value, { includeDate = false } = {}) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const dateTimeMatch = text.match(/\b([A-Z][a-z]{2})\s+(\d{1,2})\s+at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/)
  if (dateTimeMatch?.[1] && dateTimeMatch?.[2] && dateTimeMatch?.[3]) {
    return formatResetDate(parseEnglishResetDate(dateTimeMatch[1], dateTimeMatch[2], dateTimeMatch[3]), { includeDate })
      ?? truncateAtBoundary(text, 12)
  }
  const clockMatch = text.match(/\bat\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i)
  if (clockMatch?.[1]) {
    const date = parseEnglishResetDate(new Date().toLocaleString('en-US', { month: 'short' }), String(new Date().getDate()), clockMatch[1])
    return formatResetDate(date, { includeDate: false }) ?? clockMatch[1].replace(/\s+/g, '')
  }
  const timeMatch = text.match(/([0-9]{1,2}:[0-9]{2})/)
  if (timeMatch?.[1]) return timeMatch[1]
  return truncateAtBoundary(text, 12)
}

async function readCodexLocalUsage(sinceMs) {
  const root = path.join(HOME_DIR, '.codex', 'sessions')
  const files = await listRecentFiles(root, { sinceMs, maxFiles: 120 })
  let latest = null
  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8').catch(() => '')
    for (const line of text.split('\n')) {
      if (!line.includes('"token_count"')) continue
      try {
        const event = JSON.parse(line)
        if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue
        const timestampMs = Date.parse(event.timestamp)
        if (!Number.isFinite(timestampMs) || timestampMs < sinceMs) continue
        if (!latest || timestampMs > latest.timestampMs) {
          latest = {
            timestampMs,
            rateLimits: event.payload.rate_limits ?? null,
            lastTokenUsage: event.payload.info?.last_token_usage ?? null,
          }
        }
      } catch {
        // Ignore malformed log lines.
      }
    }
  }
  const primary = latest?.rateLimits?.primary
  const secondary = latest?.rateLimits?.secondary
  const primaryLabel = formatWindowLabel(primary?.window_minutes)
  const secondaryLabel = formatWindowLabel(secondary?.window_minutes)
  const primaryPercent = Number(primary?.used_percent)
  const secondaryPercent = Number(secondary?.used_percent)
  return {
    available: Boolean(latest?.rateLimits),
    label: 'limits',
    value: latest?.rateLimits
      ? `${primaryLabel || '5h'} ${Number.isFinite(primaryPercent) ? `${primaryPercent}%` : '--'} / ${secondaryLabel || '7d'} ${Number.isFinite(secondaryPercent) ? `${secondaryPercent}%` : '--'}`
      : '读取中',
    percent: Number.isFinite(primaryPercent) ? Math.max(0, Math.min(100, primaryPercent)) : null,
    reset: formatResetTime(primary?.resets_at) ?? 'local logs',
    updatedAt: latest?.timestampMs,
    rateLimits: latest?.rateLimits ?? null,
    tokens: latest?.lastTokenUsage ? {
      input: latest.lastTokenUsage.input_tokens,
      output: latest.lastTokenUsage.output_tokens,
      cacheRead: latest.lastTokenUsage.cached_input_tokens,
      reasoning: latest.lastTokenUsage.reasoning_output_tokens,
      total: latest.lastTokenUsage.total_tokens,
    } : null,
  }
}

async function readClaudeLocalUsage(sinceMs) {
  const root = path.join(HOME_DIR, '.claude', 'projects')
  const files = await listRecentFiles(root, { sinceMs, maxFiles: 120 })
  const cliUsage = await readClaudeCliUsage().catch(() => null)
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  const fiveHourTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  const fiveHourSinceMs = Date.now() - 5 * 60 * 60 * 1000
  let count = 0
  let fiveHourCount = 0
  let latestAt = 0
  let latestRateLimits = null
  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8').catch(() => '')
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue
      try {
        const event = JSON.parse(line)
        const timestampMs = Date.parse(event.timestamp)
        const usage = event.message?.usage
        if (!usage || !Number.isFinite(timestampMs) || timestampMs < sinceMs) continue
        addTokenUsage(totals, usage)
        if (timestampMs >= fiveHourSinceMs) {
          addTokenUsage(fiveHourTotals, usage)
          fiveHourCount += 1
        }
        count += 1
        latestAt = Math.max(latestAt, timestampMs)
        const rateLimits = usage.rate_limits ?? usage.rateLimits ?? event.rate_limits ?? event.rateLimits ?? event.payload?.rate_limits
        if (rateLimits) latestRateLimits = rateLimits
      } catch {
        // Ignore malformed log lines.
      }
    }
  }
  const total = totalTokens(totals)
  const rateLimits = cliUsage?.rateLimits ?? latestRateLimits
  return {
    available: total > 0 || Boolean(rateLimits),
    label: rateLimits ? 'limits' : 'limits unavailable',
    value: rateLimits ? cliUsage?.value ?? 'local limits' : '未读到百分比',
    percent: cliUsage?.percent ?? null,
    reset: cliUsage?.reset ?? (rateLimits ? 'local logs' : 'no limit field'),
    updatedAt: cliUsage?.updatedAt ?? (latestAt || null),
    messageCount: count,
    rateLimits,
    tokens: {
      ...totals,
      total,
    },
    windows: {
      fiveHour: {
        messageCount: fiveHourCount,
        tokens: {
          ...fiveHourTotals,
          total: totalTokens(fiveHourTotals),
        },
      },
      sevenDay: {
        messageCount: count,
        tokens: {
          ...totals,
          total,
        },
      },
    },
  }
}

async function readCodexRecentSessions(sinceMs) {
  const root = path.join(HOME_DIR, '.codex', 'sessions')
  const files = await listRecentFiles(root, { sinceMs, maxFiles: MAX_TOOL_SESSION_FILES })
  const sessions = []
  for (const filePath of files) {
    const text = await readSessionSnippet(filePath)
    let meta = null
    let lastUser = ''
    let lastAssistant = ''
    let lastAt = 0
    const conversation = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === 'session_meta') {
          meta = event.payload
          continue
        }
        const timestampMs = Date.parse(event.timestamp)
        if (Number.isFinite(timestampMs)) lastAt = Math.max(lastAt, timestampMs)
        if (event.type === 'response_item' && event.payload?.type === 'message') {
          if (event.payload.role === 'user' && !lastUser) lastUser = textFromContent(event.payload.content) || lastUser
          if (event.payload.role === 'assistant' && !lastAssistant) lastAssistant = textFromContent(event.payload.content) || lastAssistant
        }
        if (event.type === 'event_msg') {
          if (event.payload?.type === 'user_message') {
            lastUser = event.payload.message || lastUser
            pushSessionMessage(conversation, {
              role: 'user',
              text: event.payload.message,
              at: event.timestamp,
            })
          }
          if (event.payload?.type === 'agent_message' && event.payload.phase === 'final_answer') {
            lastAssistant = event.payload.message || lastAssistant
            pushSessionMessage(conversation, {
              role: 'assistant',
              text: event.payload.message,
              at: event.timestamp,
            })
          }
        }
      } catch {
        // Ignore malformed session lines.
      }
    }
    if (
      !meta?.id
      || lastAt < sinceMs
      || (!lastUser && !lastAssistant)
    ) continue
    const toolSource = meta.source ?? meta.originator ?? 'codex'
    const isExecSession = toolSource === 'exec'
    const desktopReplyState = codexDesktopReplyState()
    const canReply = isExecSession || desktopReplyState.available
    sessions.push(sessionRecord({
      toolId: 'codex',
      sessionId: meta.id,
      message: lastUser,
      summary: lastAssistant,
      conversation,
      startedAt: meta.timestamp ?? new Date(lastAt).toISOString(),
      finishedAt: new Date(lastAt).toISOString(),
      sourcePath: filePath,
      model: meta.model ?? meta.model_provider,
      toolSource,
      workspaceRoot: meta.cwd,
      canReply,
      replyMode: isExecSession ? 'codex exec resume' : desktopReplyState.mode,
      replyBlockedReason: canReply ? null : desktopReplyState.reason,
    }))
  }
  return sessions.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, MAX_TOOL_SESSIONS_PER_TOOL)
}

async function readClaudeRecentSessions(sinceMs) {
  const root = path.join(HOME_DIR, '.claude', 'projects')
  const files = await listRecentFiles(root, { sinceMs, maxFiles: MAX_TOOL_SESSION_FILES })
  const sessions = []
  for (const filePath of files) {
    const text = await readSessionSnippet(filePath)
    let sessionId = null
    let cwd = null
    let lastUser = ''
    let lastAssistant = ''
    let model = null
    let firstAt = null
    let lastAt = 0
    const conversation = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.cwd && !cwd) cwd = event.cwd
        if (event.sessionId) sessionId = event.sessionId
        const timestampMs = Date.parse(event.timestamp)
        if (Number.isFinite(timestampMs)) {
          if (!firstAt) firstAt = event.timestamp
          lastAt = Math.max(lastAt, timestampMs)
        }
        if (event.type === 'user') {
          lastUser = textFromContent(event.message?.content) || lastUser
          pushSessionMessage(conversation, {
            role: 'user',
            text: lastUser,
            at: event.timestamp,
          })
        }
        if (event.type === 'assistant' && event.message?.role === 'assistant') {
          model = event.message.model ?? model
          const textContent = (event.message.content ?? [])
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('\n')
          if (textContent) {
            lastAssistant = textContent
            pushSessionMessage(conversation, {
              role: 'assistant',
              text: textContent,
              at: event.timestamp,
            })
          }
        }
        if (event.type === 'last-prompt') lastUser = event.lastPrompt || lastUser
      } catch {
        // Ignore malformed session lines.
      }
    }
    if (
      !sessionId
      || lastAt < sinceMs
      || (!lastUser && !lastAssistant)
      || isClaudeUsageCommand(lastUser)
    ) continue
    sessions.push(sessionRecord({
      toolId: 'claude-code',
      sessionId,
      message: lastUser,
      summary: lastAssistant,
      conversation,
      startedAt: firstAt ?? new Date(lastAt).toISOString(),
      finishedAt: new Date(lastAt).toISOString(),
      sourcePath: filePath,
      model,
      toolSource: 'claude-code',
      workspaceRoot: cwd,
      canReply: true,
      replyMode: 'claude --resume',
    }))
  }
  return sessions.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, MAX_TOOL_SESSIONS_PER_TOOL)
}

async function readToolSessions(sinceMs) {
  const [codex, claude] = await Promise.all([
    readCodexRecentSessions(sinceMs).catch(() => []),
    readClaudeRecentSessions(sinceMs).catch(() => []),
  ])
  return { codex, claude }
}

async function readCachedToolSessions(sinceMs, { force = false } = {}) {
  const now = Date.now()
  if (!force && cachedToolSessions && now - cachedToolSessionsAt < TOOL_SESSION_TTL_MS) {
    return cachedToolSessions
  }
  cachedToolSessions = await readToolSessions(sinceMs)
  cachedToolSessionsAt = now
  return cachedToolSessions
}

function parseClaudeUsageLine(text, pattern) {
  const match = text.match(pattern)
  if (!match) return null
  return {
    used_percent: Number.parseInt(match[1], 10),
    reset_label: match[2]?.trim() ?? '',
  }
}

async function readClaudeCliUsage() {
  let session = null
  let week = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300))
    const result = await runCommandAsync('claude', ['-p', '/usage', '--output-format', 'text'], { timeout: 8000 })
    if (result.status !== 0 || !result.stdout.trim()) continue
    const text = String(result.stdout ?? '')
    session = parseClaudeUsageLine(text, /Current session:\s*(\d+)%\s*used\s*·\s*resets\s*([^\n]+)/i)
    week = parseClaudeUsageLine(text, /Current week(?:\s*\([^)]*\))?:\s*(\d+)%\s*used\s*·\s*resets\s*([^\n]+)/i)
    if (session || week) break
  }
  if (!session && !week) return lastClaudeCliUsage ? { ...lastClaudeCliUsage, stale: true } : null
  const usage = {
    available: true,
    label: 'limits',
    value: `${session ? `5h ${session.used_percent}%` : '5h --'} / ${week ? `7d ${week.used_percent}%` : '7d --'}`,
    percent: Number.isFinite(session?.used_percent) ? session.used_percent : null,
    reset: session?.reset_label ?? week?.reset_label ?? 'claude /usage',
    updatedAt: Date.now(),
    rateLimits: {
      primary: {
        window_minutes: 300,
        used_percent: session?.used_percent,
        reset_label: session?.reset_label,
      },
      secondary: {
        window_minutes: 10080,
        used_percent: week?.used_percent,
        reset_label: week?.reset_label,
      },
      source: 'claude /usage',
    },
  }
  lastClaudeCliUsage = usage
  return usage
}

async function readLocalUsage({ force = false } = {}) {
  const now = Date.now()
  if (!force && cachedLocalUsage && now - cachedLocalUsageAt < 30000) return cachedLocalUsage
  const sinceMs = now - LOCAL_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const [codex, claude] = await Promise.all([
    readCodexLocalUsage(sinceMs).catch(() => null),
    readClaudeLocalUsage(sinceMs).catch(() => null),
  ])
  cachedLocalUsage = { codex, claude }
  cachedLocalUsageAt = now
  return cachedLocalUsage
}

function formatTokenCount(value) {
  if (!Number.isFinite(value)) return 'N/A'
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M tok`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k tok`
  return `${value} tok`
}

function formatCompactCount(value) {
  if (!Number.isFinite(value)) return '--'
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return String(value)
}

function clampPercent(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(100, Math.round(number)))
}

function resetForLimit(limit) {
  const includeDate = Number(limit?.window_minutes) >= 1440
  return formatResetTime(limit?.resets_at, { includeDate }) ?? compactResetLabel(limit?.reset_label, { includeDate })
}

function usageBarRow(label, usedPercent, limit = null) {
  const safeUsedPercent = clampPercent(usedPercent)
  const remainingPercent = safeUsedPercent === null ? null : Math.max(0, 100 - safeUsedPercent)
  return {
    label,
    value: remainingPercent === null ? '--' : `${remainingPercent}%`,
    percent: remainingPercent,
    usedPercent: safeUsedPercent,
    reset: resetForLimit(limit),
    mode: 'remaining',
  }
}

function buildLimitDisplay(usage) {
  const primary = usage?.rateLimits?.primary
  const secondary = usage?.rateLimits?.secondary
  const primaryLabel = (formatWindowLabel(primary?.window_minutes) || '5h').toUpperCase()
  const secondaryLabel = (formatWindowLabel(secondary?.window_minutes) || '7d').toUpperCase()
  const primaryRow = usageBarRow(primaryLabel, primary?.used_percent, primary)
  const secondaryRow = usageBarRow(secondaryLabel, secondary?.used_percent, secondary)
  return {
    type: 'limits',
    mode: 'remaining',
    rows: [primaryRow, secondaryRow],
    primary: primaryRow,
    secondary: secondaryRow,
  }
}

function buildTokenDisplay(total, source = 'local logs') {
  const row = {
    label: '7D TOK',
    value: formatCompactCount(total),
    percent: null,
    reset: source,
  }
  return {
    type: 'tokens',
    rows: [row],
    primary: row,
    secondary: {
      label: source,
      value: '',
      percent: null,
    },
  }
}

function buildUsageSummary(spec, needsLogin, openclawUsage, localUsage) {
  if (spec.id === 'codex') {
    return localUsage?.codex?.available
      ? {
          ...localUsage.codex,
          display: buildLimitDisplay(localUsage.codex),
        }
      : {
          label: 'limits',
          value: '读取中',
          percent: null,
          reset: 'local logs',
          available: false,
          display: {
            type: 'limits',
            rows: [usageBarRow('5H', null), usageBarRow('7D', null)],
            primary: usageBarRow('5H', null),
            secondary: usageBarRow('7D', null),
          },
        }
  }
  if (spec.id === 'claude-code') {
    if (needsLogin) {
      return {
        label: 'usage',
        value: 'login required',
        percent: null,
        reset: 'login required',
        available: false,
        display: {
          type: 'setup',
          primary: { label: 'LOGIN', value: 'REQ' },
          secondary: { label: '', value: '' },
        },
      }
    }
    return localUsage?.claude?.available
      ? {
          ...localUsage.claude,
          display: buildLimitDisplay(localUsage.claude),
        }
      : {
          label: 'limits',
          value: '读取中',
          percent: null,
          reset: 'local logs',
          available: false,
          display: {
            type: 'limits',
            rows: [usageBarRow('5H', null), usageBarRow('7D', null)],
            primary: usageBarRow('5H', null),
            secondary: usageBarRow('7D', null),
          },
        }
  }
  if (spec.id === 'openclaw') {
    const totals = openclawUsage?.totals
    return {
      label: '7d tokens',
      value: totals ? `${formatTokenCount(totals.totalTokens)} / 7d` : '读取中',
      percent: null,
      reset: openclawUsage?.stale ? 'cached logs' : 'session logs',
      available: Boolean(totals),
      display: buildTokenDisplay(totals?.totalTokens, openclawUsage?.stale ? 'CACHED' : 'LOGS'),
      stale: Boolean(openclawUsage?.stale),
      updatedAt: openclawUsage?.updatedAt,
      tokens: totals ? {
        input: totals.input,
        output: totals.output,
        cacheRead: totals.cacheRead,
        total: totals.totalTokens,
      } : null,
      cost: totals ? {
        total: totals.totalCost,
        missingCostEntries: totals.missingCostEntries,
      } : null,
    }
  }
  return { label: 'usage', value: '读取中', percent: null, reset: 'local logs', available: false }
}

function toolStatusFromEvidence(spec, executable, version, processInfo, openclawInfo, openclawUsage, claudeAuthStatus, localUsage) {
  const online = Boolean(executable || (spec.appPath && existsSync(spec.appPath)) || processInfo.count)
  const running = processInfo.count > 0
  const needsSetup = spec.id === 'claude-code' && !executable
  const needsLogin = spec.id === 'claude-code' && executable && claudeAuthStatus?.loggedIn === false
  let status = online ? 'idle' : 'offline'
  let detail = online ? '已连接本机工具' : '未发现本机入口'
  if (running) {
    status = 'online'
    detail = `${processInfo.count} 个进程在线`
  }
  if (needsSetup) {
    status = running ? 'limited' : 'setup'
    detail = 'Claude Desktop 在线；Claude Code CLI 未在 PATH'
  }
  if (needsLogin) {
    status = 'setup'
    detail = `Claude Code ${version ?? 'CLI'} 已安装；未登录`
  }
  if (spec.id === 'openclaw' && openclawInfo?.tasks?.includes('0 active')) {
    detail = 'Gateway 在线；当前无活动任务'
  }
  return {
    id: spec.id,
    name: spec.name,
    shortName: spec.shortName,
    glyph: spec.glyph,
    kind: spec.kind,
    status,
    detail,
    executable,
    version,
    auth: spec.id === 'claude-code' ? claudeAuthStatus : undefined,
    station: spec.station,
    process: processInfo,
    usage: buildUsageSummary(spec, needsLogin, openclawUsage, localUsage),
  }
}

function buildReadiness(tools) {
  const checks = tools.map((tool) => {
    if (tool.id === 'claude-code') {
      const ready = Boolean(tool.executable && tool.auth?.loggedIn)
      return {
        id: tool.id,
        label: tool.shortName,
        ready,
        status: ready ? 'ready' : 'setup',
        detail: ready ? 'Claude Code CLI 可执行' : 'Claude Code 需登录',
      }
    }
    if (tool.id === 'openclaw') {
      const ready = Boolean(tool.executable && tool.status === 'online')
      return {
        id: tool.id,
        label: tool.shortName,
        ready,
        status: ready ? 'ready' : 'degraded',
        detail: ready ? 'OpenClaw Gateway 可执行' : 'OpenClaw Gateway 不可用',
      }
    }
    const ready = Boolean(tool.executable && tool.status !== 'offline' && tool.status !== 'setup')
    return {
      id: tool.id,
      label: tool.shortName,
      ready,
      status: ready ? 'ready' : 'degraded',
      detail: ready ? `${tool.name} CLI 可执行` : `${tool.name} 不可执行`,
    }
  })
  const readyCount = checks.filter((check) => check.ready).length
  const blockers = checks.filter((check) => !check.ready)
  return {
    readyCount,
    total: checks.length,
    status: readyCount === checks.length ? 'ready' : blockers.some((check) => check.status === 'setup') ? 'setup' : 'degraded',
    headline: readyCount === checks.length
      ? '全部 AI 工具已就绪'
      : `READY ${readyCount}/${checks.length} · ${blockers.map((check) => check.label).join(', ')} 待处理`,
    checks,
    blockers,
  }
}

async function buildPocketStatus({ force = false } = {}) {
  const now = Date.now()
  if (!force && cachedStatus && now - cachedStatusAt < STATUS_TTL_MS) return cachedStatus
  const sessionSinceMs = now - LOCAL_SESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000

  const processes = await readProcessList()
  const [codexVersionResult, claudeVersionResult, claudeAuthStatus, openclawVersionResult, openclawStatus, openclawUsage, localUsage, toolSessions, history, recentCommands] = await Promise.all([
    runCommandAsync('codex', ['--version'], { timeout: 2000 }).catch(() => null),
    runCommandAsync('claude', ['--version'], { timeout: 4000 }).catch(() => null),
    readClaudeAuthStatus().catch(() => null),
    runCommandAsync('openclaw', ['--version'], { timeout: 2000 }).catch(() => null),
    readOpenClawStatus().catch(() => null),
    readOpenClawUsage().catch(() => null),
    readLocalUsage({ force }).catch(() => null),
    readCachedToolSessions(sessionSinceMs, { force }).catch(() => ({ codex: [], claude: [] })),
    readHistory(MAX_HISTORY_ITEMS).catch(() => []),
    readRecentPocketCommands(12).catch(() => []),
  ])

  const versions = {
    codex: codexVersionResult?.status === 0 ? parseVersion('codex', codexVersionResult.stdout) : null,
    'claude-code': claudeVersionResult?.status === 0 ? parseVersion('claude-code', claudeVersionResult.stdout) : null,
    openclaw: openclawVersionResult?.status === 0 ? parseVersion('openclaw', openclawVersionResult.stdout) : null,
  }

  const tools = TOOL_SPECS.map((spec) => toolStatusFromEvidence(
    spec,
    findExecutable(spec),
    versions[spec.id] ?? null,
    summarizeProcesses(spec, processes),
    spec.id === 'openclaw' ? openclawStatus : null,
    spec.id === 'openclaw' ? openclawUsage : null,
    spec.id === 'claude-code' ? claudeAuthStatus : null,
    localUsage,
  ))

  const active = [...activeTasks.values()]
  const pending = [...pendingActions.values()].map((action) => ({
    actionId: action.actionId,
    taskId: action.taskId,
    agentId: action.agentId,
    title: action.title,
    detail: action.detail,
  }))
  const readiness = buildReadiness(tools)
  const nativeSessions = [
    ...(toolSessions.codex ?? []),
    ...(toolSessions.claude ?? []),
  ]
  const nativeSessionKeys = new Set(nativeSessions.map((item) => {
    const at = Date.parse(item.finishedAt ?? item.startedAt)
    return `${item.agentId}:${item.message}:${Number.isFinite(at) ? Math.round(at / 300000) : ''}`
  }))
  const pocketOnlyHistory = history.filter((item) => {
    if (['codex', 'claude-code'].includes(item.agentId)) return false
    const at = Date.parse(item.finishedAt ?? item.startedAt)
    const key = `${item.agentId}:${item.message}:${Number.isFinite(at) ? Math.round(at / 300000) : ''}`
    return !nativeSessionKeys.has(key)
  })
  const mergedHistory = [
    ...nativeSessions,
    ...pocketOnlyHistory,
  ]
  const seenHistoryIds = new Set()
  const uniqueHistory = mergedHistory
    .filter((item) => {
      const id = item.taskId ?? `${item.agentId}-${item.startedAt}-${item.message}`
      if (seenHistoryIds.has(id)) return false
      seenHistoryIds.add(id)
      return true
    })
    .sort((a, b) => String(b.finishedAt ?? b.startedAt).localeCompare(String(a.finishedAt ?? a.startedAt)))

  cachedStatus = {
    ok: true,
    profile: 'pocket-ai-company',
    refreshedAt: new Date().toISOString(),
    device: {
      name: 'Pocket AI Company',
      controls: ['side-up', 'side-down', 'front-action'],
      voice: 'hold-front-button',
      viewport: { width: 800, height: 480 },
    },
    readiness,
    tools,
    openclaw: {
      gatewayListening: await checkPort(18789),
      status: openclawStatus,
      usage: openclawUsage,
    },
    tasks: {
      active,
      pending,
      history: uniqueHistory.slice(0, MAX_HISTORY_ITEMS),
      recentCommands: recentCommands.filter((command) => !['codex', 'claude-code'].includes(command.target)),
    },
    assets: {
      root: ARTIFACT_ROOT,
      recentCount: uniqueHistory.filter((item) => item.artifacts?.length || item.summary).length,
    },
  }
  cachedStatusAt = now
  return cachedStatus
}

async function logPocketCommand(entry) {
  await mkdir(POCKET_ROOT, { recursive: true })
  await appendFile(POCKET_COMMAND_LOG, `${JSON.stringify(entry)}\n`, 'utf8')
  await writeFile(POCKET_LAST_COMMAND, entry.message ?? '', 'utf8')
}

async function writeClaudeLoginCommand(executable) {
  const script = [
    '#!/bin/zsh',
    'echo "Pocket AI Company: Claude Code login"',
    'echo "This terminal was opened by the pocket screen setup action."',
    `cd ${JSON.stringify(WORKSPACE_ROOT)}`,
    `${JSON.stringify(executable)} auth login --claudeai`,
    'echo ""',
    'echo "Claude auth status:"',
    `${JSON.stringify(executable)} auth status`,
    'echo ""',
    'echo "You can close this window after login completes."',
    'read -r "?Press Enter to close..."',
    '',
  ].join('\n')
  await mkdir(POCKET_ROOT, { recursive: true })
  await writeFile(CLAUDE_LOGIN_COMMAND, script, 'utf8')
  await chmod(CLAUDE_LOGIN_COMMAND, 0o755)
  return CLAUDE_LOGIN_COMMAND
}

async function startPocketSetup({ target = '', mode = 'open' } = {}) {
  if (target !== 'claude-code') {
    return {
      ok: false,
      target,
      status: 'unsupported',
      message: `Unknown setup target: ${target}`,
    }
  }

  const spec = TOOL_SPECS.find((tool) => tool.id === 'claude-code')
  const executable = findExecutable(spec)
  if (!executable) {
    if (mode === 'prepare') {
      return {
        ok: false,
        target,
        status: 'setup_required',
        message: '未发现 Claude Code CLI，无法准备登录脚本。',
      }
    }
    const openResult = await runCommandAsync('open', ['-a', 'Claude'], { cwd: '/', timeout: 5000 })
    return {
      ok: openResult.status === 0,
      target,
      status: openResult.status === 0 ? 'opened_desktop' : 'setup_required',
      message: openResult.status === 0
        ? 'Claude Desktop 已打开；请安装 Claude Code CLI 后重试。'
        : '未发现 Claude Code CLI，也无法打开 Claude Desktop。',
    }
  }

  const commandFile = await writeClaudeLoginCommand(executable)
  if (mode === 'prepare') {
    return {
      ok: true,
      target,
      status: 'prepared',
      message: 'Claude Code 登录脚本已准备好；硬件长按 SET 时可打开登录终端。',
      commandFile,
    }
  }

  const openResult = await runCommandAsync('open', [commandFile], { cwd: '/', timeout: 5000 })
  return {
    ok: openResult.status === 0,
    target,
    status: openResult.status === 0 ? 'login_started' : 'setup_failed',
    message: openResult.status === 0
      ? '已在电脑上打开 Claude Code 登录终端；完成登录后返回 pocket 页面刷新。'
      : `无法打开 Claude 登录终端：${truncateAtBoundary(openResult.stderr || openResult.stdout, 120)}`,
    commandFile,
  }
}

function summarizeCommandOutput(stdout, fallback = '命令已完成') {
  const text = String(stdout ?? '').trim()
  if (!text) return fallback
  try {
    const parsed = JSON.parse(text)
    const payloadTexts = parsed?.result?.payloads
      ?.map((payload) => payload?.text)
      ?.filter(Boolean)
      ?.join('\n')
    if (payloadTexts) return truncateAtBoundary(payloadTexts, 500)
    if (parsed?.result?.text) return truncateAtBoundary(parsed.result.text, 500)
    if (parsed?.summary) return truncateAtBoundary(parsed.summary, 500)
    if (parsed?.status) return truncateAtBoundary(parsed.status, 500)
  } catch {
    // Plain text output is expected for Codex and Claude.
  }
  return truncateAtBoundary(text, 500)
}

function runCodexAppServerTurn({ threadId, message, cwd, timeout = 180000 }) {
  return new Promise((resolve, reject) => {
    const executable = codexDesktopReplyState().executable ?? 'codex'
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd: WORKSPACE_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let runningTurnId = null
    const resumeId = 2
    const turnId = 3
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      finish(new Error(`Codex app-server request timed out after ${timeout}ms`))
    }, timeout)
    const writeRequest = (payload) => {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let frame = null
        try {
          frame = JSON.parse(line)
        } catch {
          continue
        }
        if (frame.id === resumeId) {
          if (frame.error) {
            finish(new Error(frame.error.message || JSON.stringify(frame.error)))
            return
          }
          writeRequest({
            jsonrpc: '2.0',
            id: turnId,
            method: 'turn/start',
            params: {
              threadId,
              cwd,
              input: [{ type: 'text', text: message }],
            },
          })
        }
        if (frame.id === turnId) {
          if (frame.error) {
            finish(new Error(frame.error.message || JSON.stringify(frame.error)))
          } else {
            runningTurnId = frame.result?.turn?.id ?? runningTurnId
            if (frame.result?.turn?.status === 'completed') finish(null, frame.result)
            if (frame.result?.turn?.status === 'failed') {
              finish(new Error(frame.result?.turn?.error?.message || 'Codex turn failed'))
            }
          }
        }
        if (frame.method === 'turn/started' && frame.params?.threadId === threadId) {
          runningTurnId = frame.params?.turn?.id ?? runningTurnId
        }
        if (frame.method === 'turn/completed' && frame.params?.threadId === threadId) {
          const completedTurn = frame.params?.turn
          if (runningTurnId && completedTurn?.id && completedTurn.id !== runningTurnId) continue
          if (completedTurn?.status === 'failed') {
            finish(new Error(completedTurn?.error?.message || 'Codex turn failed'))
          } else {
            finish(null, { turn: completedTurn })
          }
        }
      }
    })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => finish(error))
    child.on('close', (status) => {
      if (settled) return
      finish(new Error(stderr || `Codex app-server proxy exited with ${status ?? 0}`))
    })

    writeRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'AI Company Pocket Bridge', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      },
    })
    writeRequest({
      jsonrpc: '2.0',
      id: resumeId,
      method: 'thread/resume',
      params: { threadId },
    })
  })
}

async function sendCodexDesktopTurn({ taskId, threadId, message, cwd }) {
  const state = codexDesktopReplyState()
  if (!state.available) {
    return {
      ok: false,
      taskId,
      target: 'codex',
      toolSessionId: threadId,
      status: 'desktop_connector_required',
      message: state.reason,
      executable: state.executable,
    }
  }
  try {
    const result = await runCodexAppServerTurn({
      threadId,
      message,
      cwd,
      timeout: 180000,
    })
    invalidateToolSessionCache()
    const refreshError = await refreshCodexDesktopThread(threadId)
    return {
      ok: true,
      taskId,
      target: 'codex',
      toolSessionId: threadId,
      status: 'completed',
      turnId: result?.turn?.id ?? null,
      message: refreshError
        ? `Codex Desktop 当前 session 已回复；桌面刷新失败：${refreshError}`
        : 'Codex Desktop 当前 session 已回复，并已请求桌面端刷新。',
    }
  } catch (error) {
    return {
      ok: false,
      taskId,
      target: 'codex',
      toolSessionId: threadId,
      status: 'desktop_send_failed',
      message: error.message,
    }
  }
}

function spawnTrackedCommand({ taskId, target, command, args, cwd, message, toolSessionId, toolSessionCwd, source = 'pocket-command', mirrorOnly = false }) {
  if (toolSessionId) invalidateToolSessionCache()
  if (!mirrorOnly) {
    activeTasks.set(taskId, {
      taskId,
      agentId: target,
      toolSessionId,
      toolSessionCwd,
      source,
      message,
      threadId: 'pocket',
      startedAt: new Date().toISOString(),
    })
    emitEvent({
      type: 'task_started',
      taskId,
      agentId: target,
      toolSessionId,
      toolSessionCwd,
      threadId: 'pocket',
      message,
      metric: `${target} 已接收便携端指令`,
      bubble: 'pocket',
    })
  }

  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  child.on('error', (error) => {
    activeTasks.delete(taskId)
    if (toolSessionId) invalidateToolSessionCache()
    if (mirrorOnly) return
    emitEvent({
      type: 'task_failed',
      taskId,
      agentId: target,
      toolSessionId,
      toolSessionCwd,
      threadId: 'pocket',
      error: error.message,
      metric: '启动失败',
      bubble: '异常',
    })
  })
  child.on('close', (status) => {
    activeTasks.delete(taskId)
    if (toolSessionId) invalidateToolSessionCache()
    if (mirrorOnly) return
    if (status === 0) {
      emitEvent({
        type: 'task_finished',
        taskId,
        agentId: target,
        toolSessionId,
        toolSessionCwd,
        threadId: 'pocket',
        result: {
          answer: summarizeCommandOutput(stdout),
          raw: stdout,
        },
        metric: '便携端指令完成',
        bubble: '完成',
      })
      return
    }
    emitEvent({
      type: 'task_failed',
      taskId,
      agentId: target,
      toolSessionId,
      toolSessionCwd,
      threadId: 'pocket',
      error: truncateAtBoundary(stderr || stdout || `退出码 ${status}`, 500),
      metric: '便携端指令失败',
      bubble: '异常',
    })
  })
}

async function startPocketCommand({ target = 'supervisor', message = '', toolSessionId = null, toolSessionCwd = null, toolSessionSource = null } = {}) {
  const cleanMessage = String(message ?? '').trim()
  if (!cleanMessage) throw new Error('message is required')
  const commandCwd = resolveCommandCwd(toolSessionCwd)
  const taskId = `pocket-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const entry = {
    taskId,
    target,
    toolSessionId,
    toolSessionCwd: commandCwd,
    message: cleanMessage,
    at: new Date().toISOString(),
  }
  await logPocketCommand(entry)

  if (target === 'codex') {
    if (!toolSessionId) {
      return {
        ok: false,
        taskId,
        target,
        status: 'session_required',
        message: 'Codex pocket 现在只镜像真实桌面 session；请先进入一个 Codex session 再语音回复。',
      }
    }
    if (toolSessionId && toolSessionSource && toolSessionSource !== 'exec') {
      return sendCodexDesktopTurn({
        taskId,
        threadId: toolSessionId,
        message: cleanMessage,
        cwd: commandCwd,
      })
    }
    const args = toolSessionId
      ? [
        'exec',
        'resume',
        '--all',
        '--skip-git-repo-check',
        toolSessionId,
        cleanMessage,
        ]
      : [
          'exec',
          '--cd',
          WORKSPACE_ROOT,
          '--sandbox',
          'read-only',
          '--skip-git-repo-check',
          cleanMessage,
        ]
    spawnTrackedCommand({
      taskId,
      target,
      command: 'codex',
      args,
      cwd: commandCwd,
      message: cleanMessage,
      toolSessionId,
      toolSessionCwd: commandCwd,
      mirrorOnly: Boolean(toolSessionId),
    })
    return { ok: true, taskId, target, status: 'running' }
  }

  if (target === 'openclaw') {
    spawnTrackedCommand({
      taskId,
      target,
      command: 'openclaw',
      args: [
        'agent',
        '--agent',
        'main',
        '--session-key',
        'agent:main:pocket',
        '--message',
        cleanMessage,
        '--json',
        '--timeout',
        '180',
      ],
      cwd: WORKSPACE_ROOT,
      message: cleanMessage,
      toolSessionId: 'agent:main:pocket',
      toolSessionCwd: WORKSPACE_ROOT,
    })
    return { ok: true, taskId, target, status: 'running' }
  }

  if (target === 'claude-code') {
    if (!toolSessionId) {
      return {
        ok: false,
        taskId,
        target,
        status: 'session_required',
        message: 'Claude Code pocket 现在只镜像真实 session；请先进入一个 Claude Code session 再语音回复。',
      }
    }
    const executable = findExecutable(TOOL_SPECS.find((tool) => tool.id === 'claude-code'))
    if (executable) {
      const authStatus = await readClaudeAuthStatus().catch(() => null)
      if (authStatus?.loggedIn === false) {
        return {
          ok: false,
          taskId,
          target,
          status: 'setup_required',
          message: 'Claude Code CLI 未登录；请在这台电脑运行 claude auth login 后重试。',
          auth: authStatus,
        }
      }
      spawnTrackedCommand({
        taskId,
        target,
        command: executable,
        args: [
          '--print',
          '--output-format',
          'text',
          '--permission-mode',
          'dontAsk',
          ...(toolSessionId ? ['--resume', toolSessionId] : []),
          cleanMessage,
        ],
        cwd: commandCwd,
        message: cleanMessage,
        toolSessionId,
        toolSessionCwd: commandCwd,
        mirrorOnly: Boolean(toolSessionId),
      })
      return { ok: true, taskId, target, status: 'running' }
    }
    const openResult = await runCommandAsync('open', ['-a', 'Claude'], { cwd: '/', timeout: 5000 })
    return {
      ok: true,
      taskId,
      target,
      status: openResult.status === 0 ? 'opened' : 'setup_required',
      message: 'Claude Desktop 已打开；未发现 Claude Code CLI，指令已记录到 pocket command log。',
    }
  }

  return {
    ok: false,
    taskId,
    target,
    status: 'unsupported',
    message: `Unknown pocket target: ${target}`,
  }
}

export {
  buildPocketStatus,
  startPocketSetup,
  startPocketCommand,
}
