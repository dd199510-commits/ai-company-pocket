// events.mjs — 运行时状态（SSE 客户端 / 活动任务 / 待确认动作 / 任务记录）与事件总线、历史持久化。
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { ARTIFACT_ROOT, HISTORY_LOG_PATH } from './config.mjs'
import { truncateAtBoundary } from './lib.mjs'

const clients = new Set()
const activeTasks = new Map()
const pendingActions = new Map()
const taskRecords = new Map()
let eventSequence = 0
// 历史事件内存缓存：避免每个任务都全量重读 task-history.jsonl（原 P1 性能问题）。
let historyEventsCache = null

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
  if (historyEventsCache) historyEventsCache.push(event)
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
  if (historyEventsCache) return historyEventsCache
  const text = await readFile(HISTORY_LOG_PATH, 'utf8').catch(() => '')
  historyEventsCache = text.trim().split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  }).filter(Boolean)
  return historyEventsCache
}

export {
  clients,
  activeTasks,
  pendingActions,
  taskRecords,
  emitEvent,
  summarizeResult,
  buildChatReportPreview,
  compactResultForClient,
  readHistory,
  readHistoryEvents,
}
