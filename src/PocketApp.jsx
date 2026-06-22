import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const BRIDGE_URL = 'http://127.0.0.1:5181'
const STATUS_POLL_MS = 5000
const MENU_PAGE_SIZE = 3
const SHORT_PRESS_DELAY_MS = 260
const VIEWED_TASKS_STORAGE_KEY = 'pocket-viewed-task-ids'
const VIEWED_TASKS_BASELINE_KEY = 'pocket-viewed-task-ids-tool-session-v2'
const DETAIL_SECTION_SEPARATOR = '\u001d'
const SESSION_MESSAGE_SEPARATOR = '\u001e'

function statusLabel(status) {
  if (status === 'online') return 'ON'
  if (status === 'limited') return 'LIM'
  if (status === 'setup') return 'SET'
  if (status === 'offline') return 'OFF'
  if (status === 'running') return 'RUN'
  if (status === 'waiting_confirmation') return 'WAIT'
  if (status === 'done') return 'DONE'
  if (status === 'failed') return 'ERR'
  return 'IDLE'
}

function statusClass(status) {
  if (status === 'online' || status === 'done') return 'ok'
  if (status === 'limited' || status === 'setup' || status === 'waiting_confirmation') return 'wait'
  if (status === 'offline' || status === 'failed') return 'err'
  if (status === 'running') return 'run'
  return 'idle'
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '--:--'
  }
}

function useSpeechCommand({ onResult }) {
  const recognitionRef = useRef(null)
  const [speechState, setSpeechState] = useState('idle')

  const start = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSpeechState('fallback')
      onResult('汇报当前 AI 公司状态')
      setTimeout(() => setSpeechState('idle'), 900)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => setSpeechState('listening')
    recognition.onerror = () => setSpeechState('idle')
    recognition.onend = () => setSpeechState((current) => (current === 'listening' ? 'idle' : current))
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim()
      setSpeechState('sending')
      if (text) onResult(text)
      setTimeout(() => setSpeechState('idle'), 900)
    }
    recognitionRef.current = recognition
    recognition.start()
  }, [onResult])

  const stop = useCallback(() => {
    recognitionRef.current?.stop?.()
  }, [])

  return { speechState, start, stop }
}

/* ============================================================
   墨水屏吉祥物精灵（灰阶像素版：比 1-bit 更接近原本吉祥物）
   ============================================================ */

function CodexSprite() {
  // Codex 研究宠物：云朵头、深色终端脸、小蓝机器人身体的灰阶复刻。
  return (
    <svg className="pocket-sprite pocket-sprite-codex" viewBox="0 0 84 88" aria-hidden="true">
      <ellipse className="pk-shadow" cx="42" cy="81" rx="28" ry="4" />
      <g className="pk-codex-core">
        <g className="pk-codex-clouds">
          <rect className="pk-outline" x="15" y="21" width="15" height="18" />
          <rect className="pk-outline" x="22" y="13" width="18" height="18" />
          <rect className="pk-outline" x="36" y="9" width="21" height="19" />
          <rect className="pk-outline" x="53" y="16" width="17" height="18" />
          <rect className="pk-outline" x="57" y="30" width="13" height="15" />
          <rect className="pk-outline" x="12" y="34" width="17" height="16" />
          <rect className="pk-outline" x="24" y="24" width="40" height="30" />
          <rect className="pk-mid" x="18" y="23" width="13" height="15" />
          <rect className="pk-light" x="25" y="16" width="15" height="14" />
          <rect className="pk-mid" x="39" y="12" width="17" height="15" />
          <rect className="pk-light" x="55" y="18" width="12" height="15" />
          <rect className="pk-mid" x="16" y="36" width="15" height="13" />
          <rect className="pk-light" x="27" y="27" width="34" height="24" />
        </g>
        <rect className="pk-screen-shell" x="25" y="29" width="37" height="22" />
        <rect className="pk-screen" x="29" y="33" width="29" height="14" />
        <path className="pk-screen-glyph" d="M35 36 L41 40 L35 44" />
        <rect className="pk-screen-glyph pk-cursor" x="48" y="41" width="7" height="3" />
        <rect className="pk-outline" x="28" y="54" width="31" height="24" />
        <rect className="pk-mid" x="31" y="57" width="25" height="18" />
        <path className="pk-paper-line" d="M36 62 L41 66 L36 70" />
        <rect className="pk-paper" x="45" y="66" width="8" height="3" />
        <rect className="pk-outline pk-limb pk-arm-l" x="17" y="58" width="10" height="18" />
        <rect className="pk-outline pk-limb pk-arm-r" x="59" y="58" width="10" height="18" />
        <rect className="pk-mid" x="20" y="61" width="7" height="13" />
        <rect className="pk-mid" x="59" y="61" width="7" height="13" />
        <rect className="pk-outline pk-leg-l" x="32" y="76" width="9" height="9" />
        <rect className="pk-outline pk-leg-r" x="47" y="76" width="9" height="9" />
      </g>
    </svg>
  )
}

function ClaudeSprite() {
  // Claude Code / Claw'd：尽量贴合原始橙色块状吉祥物的比例。
  return (
    <svg className="pocket-sprite pocket-sprite-claude" viewBox="0 0 84 88" aria-hidden="true">
      <ellipse className="pk-shadow" cx="42" cy="82" rx="31" ry="4" />
      <g className="pk-claude-core">
        <rect className="pk-outline" x="13" y="28" width="58" height="36" />
        <rect className="pk-outline" x="26" y="19" width="45" height="13" />
        <rect className="pk-mid" x="16" y="31" width="52" height="30" />
        <rect className="pk-light" x="29" y="22" width="39" height="10" />
        <rect className="pk-outline pk-claude-eye-l" x="31" y="36" width="9" height="9" />
        <rect className="pk-outline pk-claude-eye-r" x="55" y="36" width="9" height="9" />
        <rect className="pk-outline" x="1" y="39" width="15" height="14" />
        <rect className="pk-outline" x="68" y="39" width="15" height="14" />
        <rect className="pk-mid pk-claude-arm-l" x="3" y="42" width="13" height="8" />
        <rect className="pk-mid pk-claude-arm-r" x="68" y="42" width="13" height="8" />
        <rect className="pk-mid pk-claude-leg-1" x="22" y="64" width="8" height="18" />
        <rect className="pk-mid pk-claude-leg-2" x="37" y="64" width="8" height="18" />
        <rect className="pk-mid pk-claude-leg-3" x="52" y="64" width="8" height="18" />
        <rect className="pk-mid pk-claude-leg-4" x="66" y="64" width="8" height="18" />
      </g>
    </svg>
  )
}

function OpenClawSprite() {
  // OpenClaw：圆球应用伙伴，天线、腮红、发光眼和小短腿。
  return (
    <svg className="pocket-sprite pocket-sprite-openclaw" viewBox="0 0 84 88" aria-hidden="true">
      <ellipse className="pk-shadow" cx="42" cy="82" rx="27" ry="4" />
      <g className="pk-openclaw-core">
        <path className="pk-antenna pk-openclaw-ant-l" d="M30 24 C25 12 18 10 14 15" />
        <path className="pk-antenna pk-openclaw-ant-r" d="M54 24 C59 12 66 10 70 15" />
        <circle className="pk-outline" cx="42" cy="48" r="31" />
        <circle className="pk-mid" cx="42" cy="48" r="27" />
        <path className="pk-light" d="M22 38 C27 25 42 18 57 27 C43 27 32 31 22 38 Z" />
        <g className="pk-openclaw-hand pk-openclaw-hand-l">
          <circle className="pk-outline" cx="15" cy="48" r="10" />
          <circle className="pk-mid" cx="15" cy="48" r="7" />
        </g>
        <g className="pk-openclaw-hand pk-openclaw-hand-r">
          <circle className="pk-outline" cx="69" cy="48" r="10" />
          <circle className="pk-light" cx="69" cy="48" r="7" />
        </g>
        <circle className="pk-outline" cx="32" cy="41" r="6" />
        <circle className="pk-outline" cx="53" cy="41" r="6" />
        <circle className="pk-paper" cx="30" cy="39" r="2" />
        <circle className="pk-paper" cx="51" cy="39" r="2" />
        <rect className="pk-outline pk-mouth" x="37" y="55" width="11" height="4" />
        <rect className="pk-outline pk-openclaw-foot-l" x="31" y="75" width="9" height="9" />
        <rect className="pk-outline pk-openclaw-foot-r" x="47" y="75" width="9" height="9" />
      </g>
    </svg>
  )
}

function MainSprite() {
  // 主控：戴耳机的调度员，坐在小控制台后面。
  return (
    <svg className="pocket-sprite pocket-sprite-main" viewBox="0 0 66 70" aria-hidden="true">
      <ellipse className="pk-shadow" cx="33" cy="66" rx="24" ry="3" />
      <rect className="pk-outline" x="20" y="11" width="26" height="8" />
      <rect className="pk-mid" x="18" y="18" width="30" height="14" />
      <rect className="pk-paper" x="22" y="21" width="22" height="18" />
      <rect className="pk-outline" x="17" y="22" width="5" height="14" />
      <rect className="pk-outline" x="44" y="22" width="5" height="14" />
      <path className="pk-band" d="M18 22 Q33 6 48 22" />
      <path className="pk-band" d="M47 33 Q55 38 42 41" />
      <rect className="pk-ink-dot" x="27" y="28" width="3" height="4" />
      <rect className="pk-ink-dot" x="37" y="28" width="3" height="4" />
      <rect className="pk-mid" x="18" y="42" width="31" height="18" />
      <rect className="pk-outline" x="13" y="50" width="40" height="14" />
      <rect className="pk-screen" x="18" y="54" width="30" height="6" />
      <rect className="pk-paper" x="24" y="56" width="6" height="2" />
      <rect className="pk-paper" x="34" y="56" width="9" height="2" />
    </svg>
  )
}

function PocketSprite({ id }) {
  if (id === 'codex') return <CodexSprite />
  if (id === 'claude-code') return <ClaudeSprite />
  if (id === 'openclaw') return <OpenClawSprite />
  return <MainSprite />
}

function PixelTool({ tool, selected, index, notice }) {
  const cls = statusClass(tool.status)
  const avatarClass = `pocket-avatar-${tool.id.replace(/[^a-z0-9-]/gi, '-')}`
  const officeX = tool.station?.x ?? 120 + index * 160
  const officeY = tool.station?.y ? tool.station.y - 108 : 152
  const usagePercent = Number.isFinite(tool.usage?.percent) ? `${tool.usage.percent}%` : '0%'
  return (
    <div
      className={[
        'pocket-tool',
        `pocket-tool-${cls}`,
        avatarClass,
        selected ? 'pocket-tool-selected' : '',
      ].filter(Boolean).join(' ')}
      style={{ left: officeX, top: officeY }}
    >
      <div className="pocket-tool-roof" />
      <div className="pocket-tool-avatar" aria-hidden="true">
        <PocketSprite id={tool.id} />
        {notice ? <span className={`pocket-agent-notice pocket-agent-notice-${notice.type}`}>{notice.label}</span> : null}
      </div>
      <div className="pocket-tool-desk" />
      <div className="pocket-tool-meta">
        <strong>{tool.shortName}</strong>
        <em>{statusLabel(tool.status)}</em>
      </div>
      <div className="pocket-usage-bar" aria-hidden="true">
        <i style={{ width: usagePercent }} />
      </div>
    </div>
  )
}

function MiniMainframe({ selected, hasUnread }) {
  return (
    <div className={`pocket-mainframe ${selected ? 'pocket-mainframe-selected' : ''}`}>
      <div className={`pocket-main-screen ${hasUnread ? 'pocket-main-screen-unread' : ''}`}>
        <span>{hasUnread ? '有新消息!' : 'MAIN'}</span>
        <i />
      </div>
      <div className="pocket-main-agent" aria-hidden="true">
        <MainSprite />
      </div>
      <div className="pocket-main-desk" />
    </div>
  )
}

function Facility({ type, selected, label, value }) {
  return (
    <div className={[
      'pocket-facility',
      `pocket-facility-${type}`,
      selected ? 'pocket-facility-selected' : '',
    ].filter(Boolean).join(' ')}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  )
}

function clampUsagePercent(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(100, number))
}

function UsageTile({ tool }) {
  const display = tool.usage?.display
  const resetPrefix = display?.mode === 'remaining' ? 'RST' : 'SRC'
  const rows = display?.rows?.length
    ? display.rows
    : [
        display?.primary ?? { label: tool.usage?.label ?? 'USAGE', value: tool.usage?.value ?? '--', percent: tool.usage?.percent },
        display?.secondary,
      ].filter(Boolean)

  return (
    <div className={`pocket-usage-tile pocket-usage-tile-${display?.type ?? 'unknown'}`}>
      <strong>{display?.mode === 'remaining' ? `${tool.shortName} LEFT` : tool.shortName}</strong>
      <div className="pocket-usage-rows">
        {rows.slice(0, 2).map((row, rowIndex) => {
          const percent = clampUsagePercent(row.percent)
          return (
            <div
              className={`pocket-usage-row ${percent === null ? 'pocket-usage-row-empty' : ''}`}
              key={`${row.label}-${rowIndex}`}
            >
              <span>{row.label}</span>
              <i aria-hidden="true">
                <b style={{ width: percent === null ? '0%' : `${percent}%` }} />
              </i>
              <em>{row.value ?? '--'}</em>
              {row.reset ? <small>{resetPrefix} {row.reset}</small> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function shortText(value, max = 46) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return '--'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function compactDateTime(value) {
  if (!value) return '--:--'
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '--:--'
  }
}

function normalizeTaskStatus(task) {
  if (task.pendingAction) return 'waiting_confirmation'
  return task.status ?? 'running'
}

function taskTitle(task) {
  return task.title ?? task.message ?? task.summary ?? task.pendingAction?.title ?? task.taskId ?? '未命名任务'
}

function taskDetail(task) {
  return task.summary
    ?? task.pendingAction?.detail
    ?? task.message
    ?? task.steps?.[0]?.detail
    ?? task.taskId
    ?? ''
}

function taskIdentity(task) {
  return task?.taskId ?? task?.actionId ?? `${task?.agentId ?? task?.target ?? 'task'}-${task?.startedAt ?? task?.finishedAt ?? task?.message ?? ''}`
}

function taskTime(task) {
  return Date.parse(task?.finishedAt ?? task?.startedAt ?? '') || 0
}

function isUnreadTask(task, viewedTaskIds) {
  return ['done', 'failed'].includes(task?.status) && !viewedTaskIds.has(taskIdentity(task))
}

function fullTaskText(task) {
  if (!task) return '暂无详情'
  const steps = (task.steps ?? [])
    .map((step) => `${step.title ?? 'STEP'}: ${step.detail ?? step.metric ?? step.status ?? ''}`)
    .filter(Boolean)
    .join('\n')
  const conversation = (task.conversation ?? [])
    .map((item) => {
      const role = item.role === 'assistant' ? 'AI' : 'USER'
      const time = item.at ? ` ${compactDateTime(item.at)}` : ''
      return `${role}${time}\n${item.text ?? ''}`
    })
    .filter(Boolean)
    .join(`\n${SESSION_MESSAGE_SEPARATOR}\n`)
  return [
    conversation ? `SESSION\n${conversation}` : null,
    !conversation && task.message ? `PROMPT\n${task.message}` : null,
    !conversation && task.summary ? `REPLY\n${task.summary}` : null,
    task.pendingAction?.detail ? `PERMISSION\n${task.pendingAction.title ?? 'Permission'}\n${task.pendingAction.detail}` : null,
    steps ? `CONTEXT\n${steps}` : null,
    task.artifacts?.length ? `ASSETS\n${task.artifacts.join('\n')}` : null,
    task.workspaceLabel ? `PROJECT\n${task.workspaceLabel}` : null,
    task.workspaceRoot ? `WORKDIR\n${task.workspaceRoot}` : null,
    task.toolSource ? `TOOL SOURCE\n${task.toolSource}` : null,
    task.canReply === false ? `REPLY\n${task.replyBlockedReason ?? '只读：该真实 session 暂不支持从 pocket 原地回复'}` : null,
    task.replyMode ? `REPLY MODE\n${task.replyMode}` : null,
    task.toolSessionId ? `TOOL SESSION\n${task.toolSessionId}` : null,
    task.taskId ? `AI COMPANY TASK\n${task.taskId}` : null,
  ].filter(Boolean).join(`\n${DETAIL_SECTION_SEPARATOR}\n`) || taskDetail(task)
}

function toolSourceLabel(task) {
  const source = String(task?.toolSource ?? '').toLowerCase()
  if (!source) return null
  if (source === 'exec') return 'CLI'
  if (source.includes('app') || source.includes('desktop')) return 'APP'
  return source.toUpperCase().slice(0, 8)
}

function canReplyToTask(task) {
  return Boolean(task?.toolSessionId) && task?.canReply !== false
}

function taskBelongsToTool(task, toolId) {
  return task.agentId === toolId || task.target === toolId || task.toolId === toolId
}

function findLatestTask(status, task) {
  if (!task) return task
  const identity = taskIdentity(task)
  const candidates = [
    ...(status?.tasks?.active ?? []),
    ...(status?.tasks?.history ?? []),
  ]
  return candidates.find((candidate) => {
    return (
      taskIdentity(candidate) === identity
      || (task.toolSessionId && candidate.toolSessionId === task.toolSessionId)
      || (task.taskId && candidate.taskId === task.taskId)
    )
  }) ?? task
}

function latestActiveSessionForTool(status, toolId) {
  return (status?.tasks?.active ?? [])
    .filter((task) => taskBelongsToTool(task, toolId))
    .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))[0] ?? null
}

function toolPendingPermission(status, toolId) {
  return (status?.tasks?.pending ?? []).find((action) => taskBelongsToTool(action, toolId)) ?? null
}

function toolUnreadFinished(status, toolId, viewedTaskIds) {
  return (status?.tasks?.history ?? []).find((task) => {
    const finished = ['done', 'failed'].includes(task.status)
    return finished && taskBelongsToTool(task, toolId) && !viewedTaskIds.has(taskIdentity(task))
  }) ?? null
}

function toolNotice(status, tool, viewedTaskIds) {
  if (toolPendingPermission(status, tool.id)) return { type: 'permit', label: '?' }
  if (latestActiveSessionForTool(status, tool.id)) return { type: 'running', label: '…' }
  if (toolUnreadFinished(status, tool.id, viewedTaskIds)) return { type: 'unread', label: '!' }
  return null
}

function buildSessionRows(status, tool, limit, viewedTaskIds) {
  const active = (status?.tasks?.active ?? [])
    .filter((task) => taskBelongsToTool(task, tool.id))
    .map((task) => ({ ...task, status: task.status ?? 'running', source: 'active' }))
  const history = (status?.tasks?.history ?? [])
    .filter((task) => taskBelongsToTool(task, tool.id))
    .map((task) => ({ ...task, source: 'history' }))
  const commands = (status?.tasks?.recentCommands ?? [])
    .filter((command) => command.target === tool.id && !['codex', 'claude-code'].includes(tool.id))
    .map((command) => ({
      taskId: command.taskId,
      agentId: command.target,
      message: command.message,
      startedAt: command.at,
      status: 'sent',
      source: 'command',
    }))
  const nonCommandKeys = new Set([...active, ...history].map((task) => (
    `${task.agentId}:${task.message}:${Math.round(taskTime(task) / 300000)}`
  )))
  const uniqueCommands = commands.filter((task) => {
    const key = `${task.agentId}:${task.message}:${Math.round(taskTime(task) / 300000)}`
    return !nonCommandKeys.has(key)
  })
  const seen = new Set()
  const sessions = [...active, ...history, ...uniqueCommands].filter((task) => {
    const id = task.taskId ?? `${task.agentId}-${task.startedAt}-${task.message}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }).sort((a, b) => {
    const activeDelta = Number(b.status === 'running') - Number(a.status === 'running')
    if (activeDelta) return activeDelta
    const realDelta = Number(Boolean(b.toolSessionId || b.source === 'tool-session')) - Number(Boolean(a.toolSessionId || a.source === 'tool-session'))
    if (realDelta) return realDelta
    return taskTime(b) - taskTime(a)
  })
  const visible = sessions.slice(0, limit).map((task) => ({
    id: task.taskId ?? `${task.agentId}-${task.startedAt}`,
    type: 'session',
    status: normalizeTaskStatus(task),
    unread: isUnreadTask(task, viewedTaskIds),
    real: Boolean(task.toolSessionId || task.source === 'tool-session'),
    title: taskTitle(task),
    meta: [
      isUnreadTask(task, viewedTaskIds) ? 'NEW' : null,
      task.toolSessionId || task.source === 'tool-session' ? 'REAL' : null,
      toolSourceLabel(task),
      task.toolSessionId && task.canReply === false ? 'VIEW' : null,
      task.workspaceLabel ? shortText(task.workspaceLabel, 14) : null,
      statusLabel(normalizeTaskStatus(task)),
      compactDateTime(task.finishedAt ?? task.startedAt),
    ].filter(Boolean).join(' · '),
    detail: taskDetail(task),
    item: task,
  }))
  if (sessions.length > limit) {
    visible.push({
      id: `more-${limit}`,
      type: 'more',
      status: 'more',
      title: '…',
      meta: '加载更早 session',
      detail: `${sessions.length - limit} 条更早记录`,
    })
  }
  return visible
}

function buildPermissionRows(status) {
  const pending = status?.tasks?.pending ?? []
  return pending.map((action) => ({
    id: action.actionId,
    type: 'permission',
    status: 'waiting_confirmation',
    title: action.title ?? 'Permission',
    meta: action.agentId ?? action.taskId ?? 'AI',
    detail: action.detail,
    item: action,
  }))
}

function buildNotificationRows(status, limit, viewedTaskIds) {
  const pending = (status?.tasks?.pending ?? []).map((action) => ({
    id: action.actionId,
    type: 'permission',
    status: 'waiting_confirmation',
    title: action.title ?? 'Permission',
    meta: action.agentId ?? action.taskId ?? 'AI',
    detail: action.detail,
    item: action,
  }))
  const active = (status?.tasks?.active ?? []).map((task) => ({
    id: task.taskId,
    type: 'notification',
    status: 'running',
    title: taskTitle(task),
    meta: `${task.agentId ?? 'AI'} · RUN`,
    detail: taskDetail(task),
    item: task,
  }))
  const finished = (status?.tasks?.history ?? [])
    .filter((task) => ['done', 'failed'].includes(task.status))
    .map((task) => ({
      id: task.taskId,
      type: 'notification',
      status: normalizeTaskStatus(task),
      unread: isUnreadTask(task, viewedTaskIds),
      real: Boolean(task.toolSessionId || task.source === 'tool-session'),
      title: taskTitle(task),
      meta: [
        isUnreadTask(task, viewedTaskIds) ? 'NEW' : null,
        task.toolSessionId || task.source === 'tool-session' ? 'REAL' : null,
        task.agentId ?? 'AI',
        compactDateTime(task.finishedAt ?? task.startedAt),
      ].filter(Boolean).join(' · '),
      detail: taskDetail(task),
      item: task,
    }))
  const notifications = [...pending, ...active, ...finished].sort((a, b) => {
    const waitDelta = Number(b.status === 'waiting_confirmation') - Number(a.status === 'waiting_confirmation')
    if (waitDelta) return waitDelta
    const activeDelta = Number(b.status === 'running') - Number(a.status === 'running')
    if (activeDelta) return activeDelta
    const unreadDelta = Number(Boolean(b.unread)) - Number(Boolean(a.unread))
    if (unreadDelta) return unreadDelta
    return taskTime(b.item) - taskTime(a.item)
  })
  const visible = notifications.slice(0, limit)
  if (notifications.length > limit) {
    visible.push({
      id: `more-${limit}`,
      type: 'more',
      status: 'more',
      title: '…',
      meta: '加载更早通知',
      detail: `${notifications.length - limit} 条更早记录`,
    })
  }
  return visible
}

function buildAssetRows(status, limit, viewedTaskIds) {
  const assets = (status?.tasks?.history ?? [])
    .filter((task) => task.artifacts?.length || task.summary)
    .map((task) => ({
      id: task.taskId,
      type: 'asset',
      status: task.status,
      unread: isUnreadTask(task, viewedTaskIds),
      real: Boolean(task.toolSessionId || task.source === 'tool-session'),
      title: task.artifacts?.[0] ?? taskTitle(task),
      meta: [
        isUnreadTask(task, viewedTaskIds) ? 'NEW' : null,
        task.toolSessionId || task.source === 'tool-session' ? 'REAL' : null,
        task.agentId ?? 'AI',
        compactDateTime(task.finishedAt ?? task.startedAt),
      ].filter(Boolean).join(' · '),
      detail: task.summary ?? task.artifacts?.join(', '),
      item: task,
    }))
    .sort((a, b) => {
      const unreadDelta = Number(Boolean(b.unread)) - Number(Boolean(a.unread))
      if (unreadDelta) return unreadDelta
      return taskTime(b.item) - taskTime(a.item)
    })
  const visible = assets.slice(0, limit)
  if (assets.length > limit) {
    visible.push({
      id: `more-${limit}`,
      type: 'more',
      status: 'more',
      title: '…',
      meta: '加载更早资产',
      detail: `${assets.length - limit} 条更早记录`,
    })
  }
  return visible
}

function EmptyMenu({ text }) {
  return <div className="pocket-menu-empty">{text}</div>
}

function PocketMenuPanel({ title, subtitle, rows, cursor }) {
  const listRef = useRef(null)

  useEffect(() => {
    const selectedRow = listRef.current?.querySelector('.pocket-menu-row-selected')
    selectedRow?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor, rows.length])

  return (
    <div className="pocket-menu-panel">
      <div className="pocket-menu-head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="pocket-menu-list" ref={listRef}>
        {rows.length ? rows.map((row, rowIndex) => (
          <div
            className={[
              'pocket-menu-row',
              rowIndex === cursor ? 'pocket-menu-row-selected' : '',
              `pocket-menu-row-${statusClass(row.status)}`,
              row.type === 'more' ? 'pocket-menu-row-more' : '',
              row.unread ? 'pocket-menu-row-unread' : '',
              row.real ? 'pocket-menu-row-real' : '',
            ].filter(Boolean).join(' ')}
            key={row.id ?? `${row.title}-${rowIndex}`}
          >
            <i>{row.type === 'more' ? '…' : row.unread ? '!' : row.real ? 'R' : rowIndex + 1}</i>
            <strong>{shortText(row.title, 28)}</strong>
            <span>{shortText(row.meta, 30)}</span>
          </div>
        )) : <EmptyMenu text="暂无记录" />}
      </div>
    </div>
  )
}

const DETAIL_SECTION_RE = /^(SESSION|PROMPT|REPLY|PERMISSION|CONTEXT|ASSETS|PROJECT|WORKDIR|TOOL SOURCE|REPLY MODE|TOOL SESSION|AI COMPANY TASK)\n/
const DETAIL_SECTION_SPLIT_RE = /\n\n(?=(?:SESSION|PROMPT|REPLY|PERMISSION|CONTEXT|ASSETS|PROJECT|WORKDIR|TOOL SOURCE|REPLY MODE|TOOL SESSION|AI COMPANY TASK)\n)/

function detailSections(detail) {
  const clean = String(detail ?? '').trim()
  if (!clean) return []
  const parts = clean.includes(DETAIL_SECTION_SEPARATOR)
    ? clean.split(`\n${DETAIL_SECTION_SEPARATOR}\n`)
    : clean.split(DETAIL_SECTION_SPLIT_RE)
  return parts.map((part, index) => {
    const match = part.match(DETAIL_SECTION_RE)
    if (!match) return { id: `detail-${index}`, title: 'DETAIL', body: part.trim() }
    return {
      id: `${match[1]}-${index}`,
      title: match[1],
      body: part.slice(match[0].length).trim(),
    }
  }).filter((section) => section.body)
}

function conversationMessages(body) {
  return String(body ?? '').split(`\n${SESSION_MESSAGE_SEPARATOR}\n`).map((part, index) => {
    const [head = '', ...lines] = part.split('\n')
    const role = head.startsWith('AI') ? 'AI' : 'USER'
    return {
      id: `${role}-${index}`,
      role,
      time: head.replace(/^(USER|AI)\s*/, '').trim(),
      text: lines.join('\n').trim(),
    }
  }).filter((message) => message.text)
}

function PocketDetailBody({ detail, bodyRef }) {
  const sections = detailSections(detail)
  if (!sections.length) return <div className="pocket-menu-detail-body" ref={bodyRef}>暂无详情</div>
  return (
    <div className="pocket-menu-detail-body" ref={bodyRef}>
      {sections.map((section) => {
        if (section.title === 'SESSION') {
          return (
            <section className="pocket-detail-section pocket-detail-section-session" key={section.id}>
              <h3>SESSION</h3>
              <div className="pocket-session-thread">
                {conversationMessages(section.body).map((message) => (
                  <article className={`pocket-session-message pocket-session-message-${message.role.toLowerCase()}`} key={message.id}>
                    <header>
                      <strong>{message.role === 'AI' ? 'REPLY' : 'PROMPT'}</strong>
                      {message.time ? <span>{message.time}</span> : null}
                    </header>
                    <p>{message.text}</p>
                  </article>
                ))}
              </div>
            </section>
          )
        }
        return (
          <section className={`pocket-detail-section pocket-detail-section-${section.title.toLowerCase().replaceAll(' ', '-')}`} key={section.id}>
            <h3>{section.title}</h3>
            <p>{section.body}</p>
          </section>
        )
      })}
    </div>
  )
}

function PocketDetailPanel({ title, status, detail, meta, bodyRef }) {
  return (
    <div className="pocket-menu-panel pocket-menu-detail-panel">
      <div className="pocket-menu-head">
        <strong>{shortText(title, 28)}</strong>
        <span>{status}</span>
      </div>
      <PocketDetailBody detail={detail} bodyRef={bodyRef} />
      {meta ? <em>{shortText(meta, 80)}</em> : null}
    </div>
  )
}

export function PocketApp() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [lastCommand, setLastCommand] = useState('')
  const [commandFeedback, setCommandFeedback] = useState(null)
  const [panel, setPanel] = useState({ type: 'home', cursor: 0, limit: MENU_PAGE_SIZE })
  const [viewedTaskIds, setViewedTaskIds] = useState(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(VIEWED_TASKS_STORAGE_KEY) ?? '[]'))
    } catch {
      return new Set()
    }
  })
  const pressTimer = useRef(null)
  const shortPressTimer = useRef(null)
  const longPressFired = useRef(false)
  const viewedInitializedRef = useRef(false)
  const detailBodyRef = useRef(null)

  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetch(`${BRIDGE_URL}/api/pocket/status${force ? '?force=1' : ''}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (!viewedInitializedRef.current) {
        viewedInitializedRef.current = true
        try {
          const hasStoredViewed = window.localStorage.getItem(VIEWED_TASKS_STORAGE_KEY)
          const hasToolSessionBaseline = window.localStorage.getItem(VIEWED_TASKS_BASELINE_KEY)
          if (!hasStoredViewed || !hasToolSessionBaseline) {
            const baseline = (payload.tasks?.history ?? [])
              .filter((task) => ['done', 'failed'].includes(task.status))
              .map((task) => taskIdentity(task))
              .filter(Boolean)
            const mergedBaseline = [...new Set([
              ...(hasStoredViewed ? JSON.parse(hasStoredViewed) : []),
              ...baseline,
            ])]
            window.localStorage.setItem(VIEWED_TASKS_STORAGE_KEY, JSON.stringify(mergedBaseline.slice(-160)))
            window.localStorage.setItem(VIEWED_TASKS_BASELINE_KEY, '1')
            setViewedTaskIds(new Set(mergedBaseline))
          }
        } catch {
          // Ignore storage failures on constrained embedded browsers.
        }
      }
      setStatus(payload)
      setError('')
    } catch (nextError) {
      setError(nextError.message)
    }
  }, [])

  useEffect(() => {
    const initialTimer = setTimeout(() => refresh(false), 0)
    const timer = setInterval(() => refresh(false), STATUS_POLL_MS)
    return () => {
      clearTimeout(initialTimer)
      clearInterval(timer)
    }
  }, [refresh])

  const items = useMemo(() => {
    if (!status) return [{ type: 'main', id: 'supervisor', name: '主控', commandTarget: 'supervisor' }]
    const tools = status?.tools ?? []
    return [
      { type: 'main', id: 'supervisor', name: '主控', commandTarget: 'supervisor' },
      ...tools.map((tool) => ({ type: 'tool', id: tool.id, name: tool.name, commandTarget: tool.id, tool })),
      { type: 'facility', id: 'permissions', name: 'Permissions', commandTarget: 'supervisor' },
      { type: 'facility', id: 'assets', name: 'Assets', commandTarget: 'supervisor' },
    ]
  }, [status])

  const safeSelectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0))
  const selected = items[safeSelectedIndex] ?? items[0]
  const pendingCount = status?.tasks?.pending?.length ?? 0
  const activeCount = status?.tasks?.active?.length ?? 0
  const assetCount = status?.assets?.recentCount ?? 0
  const readiness = status?.readiness
  const selectedTool = selected?.tool
  const pendingAction = status?.tasks?.pending?.[0] ?? null
  const activeTask = status?.tasks?.active?.[0] ?? null
  const selectedActiveSession = selectedTool ? latestActiveSessionForTool(status, selectedTool.id) : null
  const toolNotices = useMemo(() => {
    const next = {}
    for (const tool of status?.tools ?? []) next[tool.id] = toolNotice(status, tool, viewedTaskIds)
    return next
  }, [status, viewedTaskIds])
  const hasUnreadMessages = useMemo(() => {
    return (status?.tasks?.history ?? []).some((task) => {
      return ['done', 'failed'].includes(task.status) && !viewedTaskIds.has(taskIdentity(task))
    })
  }, [status, viewedTaskIds])

  const markTaskViewed = useCallback((task) => {
    const id = taskIdentity(task)
    if (!id) return
    setViewedTaskIds((current) => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      try {
        window.localStorage.setItem(VIEWED_TASKS_STORAGE_KEY, JSON.stringify([...next].slice(-120)))
      } catch {
        // Ignore storage failures on constrained embedded browsers.
      }
      return next
    })
  }, [])

  const panelRows = useMemo(() => {
    if (panel.type === 'sessions') {
      const tool = status?.tools?.find((item) => item.id === panel.toolId)
      return tool ? buildSessionRows(status, tool, panel.limit ?? MENU_PAGE_SIZE, viewedTaskIds) : []
    }
    if (panel.type === 'permissions') return buildPermissionRows(status)
    if (panel.type === 'notifications') return buildNotificationRows(status, panel.limit ?? MENU_PAGE_SIZE, viewedTaskIds)
    if (panel.type === 'assets') return buildAssetRows(status, panel.limit ?? MENU_PAGE_SIZE, viewedTaskIds)
    return []
  }, [panel.limit, panel.toolId, panel.type, status, viewedTaskIds])

  const panelCursor = panelRows.length ? Math.min(panel.cursor, panelRows.length - 1) : 0
  const selectedPanelRow = panelRows[panelCursor] ?? null
  const currentPermission = panel.type === 'permissionDetail'
    ? (status?.tasks?.pending ?? []).find((action) => action.actionId === panel.actionId) ?? panel.item
    : null
  const currentDetailItem = ['sessionDetail', 'notificationDetail', 'assetDetail'].includes(panel.type)
    ? findLatestTask(status, panel.item)
    : null

  const approvePendingAction = useCallback(async (action) => {
    if (!action?.actionId) return false
    try {
      const response = await fetch(`${BRIDGE_URL}/api/actions/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: action.actionId }),
      })
      const payload = await response.json().catch(() => ({}))
      setCommandFeedback({
        target: action.agentId ?? 'permission',
        status: payload.ok === false || !response.ok ? 'failed' : 'approved',
        message: payload.error ?? payload.message ?? (response.ok ? 'Permission 已确认执行' : `HTTP ${response.status}`),
      })
      if (!response.ok || payload.ok === false) {
        setError(payload.error ?? payload.message ?? `HTTP ${response.status}`)
        return false
      }
      setError('')
      setPanel({ type: 'permissions', cursor: 0, limit: MENU_PAGE_SIZE })
      refresh(true)
      return true
    } catch (nextError) {
      setError(nextError.message)
      setCommandFeedback({ target: 'permission', status: 'failed', message: nextError.message })
      return false
    }
  }, [refresh])

  const sendCommand = useCallback(async (message) => {
    let target = selected?.commandTarget ?? 'supervisor'
    let outgoingMessage = message
    let toolSessionId = null
    let toolSessionCwd = null
    let toolSessionSource = null
    if (panel.type === 'permissionDetail' && currentPermission) {
      const text = String(message ?? '').trim()
      const wantsReject = /(拒绝|不同意|不允许|不批准|deny|reject|disapprove)/i.test(text)
      const wantsApprove = /(同意|允许|批准|approve|permit|yes|可以)/i.test(text)
      if (wantsApprove && !wantsReject) {
        setLastCommand(text)
        await approvePendingAction(currentPermission)
        return
      }
      target = 'supervisor'
      outgoingMessage = `针对权限请求「${currentPermission.title}」的语音意见：${text || '请根据当前上下文判断'}。权限详情：${currentPermission.detail ?? ''}`
    } else if (
      ['sessionDetail', 'notificationDetail', 'assetDetail'].includes(panel.type)
      && currentDetailItem?.toolSessionId
      && ['codex', 'claude-code', 'openclaw'].includes(currentDetailItem.agentId)
    ) {
      if (!canReplyToTask(currentDetailItem)) {
        const feedback = currentDetailItem.replyBlockedReason ?? '这个真实 session 目前只能查看，不能从 pocket 原地回复。'
        setLastCommand(String(message ?? '').trim())
        setCommandFeedback({ target: currentDetailItem.agentId, status: 'view-only', message: feedback })
        setError('')
        return
      }
      target = currentDetailItem.agentId
      toolSessionId = currentDetailItem.toolSessionId
      toolSessionCwd = currentDetailItem.toolSessionCwd ?? currentDetailItem.workspaceRoot ?? null
      toolSessionSource = currentDetailItem.toolSource ?? null
      outgoingMessage = String(message ?? '').trim() || '继续'
    } else if (panel.type === 'home' && selected?.type === 'tool' && selectedActiveSession) {
      const text = String(message ?? '').trim()
      if (selectedActiveSession.toolSessionId && !canReplyToTask(selectedActiveSession)) {
        const feedback = selectedActiveSession.replyBlockedReason ?? '这个真实 session 目前只能查看，不能从 pocket 原地回复。'
        setLastCommand(text)
        setCommandFeedback({ target: selected.commandTarget, status: 'view-only', message: feedback })
        setError('')
        return
      }
      target = selected.commandTarget
      toolSessionId = selectedActiveSession.toolSessionId ?? null
      toolSessionCwd = selectedActiveSession.toolSessionCwd ?? selectedActiveSession.workspaceRoot ?? null
      toolSessionSource = selectedActiveSession.toolSource ?? null
      outgoingMessage = toolSessionId ? (text || '继续') : [
        `回复当前 active session：${selectedActiveSession.taskId ?? selectedActiveSession.threadId ?? selectedActiveSession.startedAt}`,
        `用户语音：${text || '继续推进这个任务'}`,
        `原始 prompt：${selectedActiveSession.message ?? ''}`,
        `当前上下文：${taskDetail(selectedActiveSession)}`,
      ].join('\n')
    }
    setLastCommand(outgoingMessage)
    try {
      const response = await fetch(`${BRIDGE_URL}/api/pocket/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, message: outgoingMessage, toolSessionId, toolSessionCwd, toolSessionSource }),
      })
      const payload = await response.json().catch(() => ({}))
      setCommandFeedback({
        target,
        status: payload.status ?? (response.ok ? 'sent' : 'failed'),
        message: payload.message ?? payload.error ?? (response.ok ? '指令已发送' : `HTTP ${response.status}`),
      })
      if (!response.ok || payload.ok === false) setError(payload.message ?? payload.error ?? `HTTP ${response.status}`)
      else setError('')
    } catch (nextError) {
      setError(nextError.message)
      setCommandFeedback({ target, status: 'failed', message: nextError.message })
    }
    refresh(true)
  }, [approvePendingAction, currentDetailItem, currentPermission, panel.type, refresh, selected, selectedActiveSession])

  const { speechState, start, stop } = useSpeechCommand({ onResult: sendCommand })
  const frontActionText = speechState === 'listening' ? 'REC' : speechState === 'sending' ? 'SEND' : 'HOLD'

  const moveSelection = useCallback((direction) => {
    if (['permissionDetail', 'sessionDetail', 'notificationDetail', 'assetDetail'].includes(panel.type)) {
      if (detailBodyRef.current) detailBodyRef.current.scrollTop += direction * 46
      return
    }
    if (panel.type !== 'home') {
      setPanel((current) => {
        const count = Math.max(panelRows.length, 1)
        return { ...current, cursor: (current.cursor + direction + count) % count }
      })
      return
    }
    setSelectedIndex((current) => {
      const count = Math.max(items.length, 1)
      return (current + direction + count) % count
    })
  }, [items.length, panel.type, panelRows.length])

  const goBack = useCallback(() => {
    setPanel((current) => {
      if (current.type === 'permissionDetail') return { type: 'permissions', cursor: current.parentCursor ?? 0, limit: MENU_PAGE_SIZE }
      if (current.type === 'sessionDetail') return { type: 'sessions', toolId: current.toolId, cursor: current.parentCursor ?? 0, limit: current.limit ?? MENU_PAGE_SIZE }
      if (current.type === 'notificationDetail') return { type: 'notifications', cursor: current.parentCursor ?? 0, limit: current.limit ?? MENU_PAGE_SIZE }
      if (current.type === 'assetDetail') return { type: 'assets', cursor: current.parentCursor ?? 0, limit: current.limit ?? MENU_PAGE_SIZE }
      return { type: 'home', cursor: 0, limit: MENU_PAGE_SIZE }
    })
  }, [])

  const confirmSelection = useCallback(() => {
    if (panel.type === 'home') {
      if (selected?.id === 'permissions') {
        setPanel({ type: 'permissions', cursor: 0, limit: MENU_PAGE_SIZE })
        return
      }
      if (selected?.id === 'assets') {
        setPanel({ type: 'assets', cursor: 0, limit: MENU_PAGE_SIZE })
        return
      }
      if (selected?.type === 'tool') {
        setPanel({ type: 'sessions', toolId: selected.id, cursor: 0, limit: MENU_PAGE_SIZE })
        return
      }
      setPanel({ type: 'notifications', cursor: 0, limit: MENU_PAGE_SIZE })
      return
    }

    if (selectedPanelRow?.type === 'more') {
      setPanel((current) => ({ ...current, limit: (current.limit ?? MENU_PAGE_SIZE) + MENU_PAGE_SIZE }))
      return
    }

    if (selectedPanelRow?.type === 'permission') {
      setPanel({
        type: 'permissionDetail',
        actionId: selectedPanelRow.item?.actionId,
        item: selectedPanelRow.item,
        parentCursor: panelCursor,
      })
      return
    }

    if (selectedPanelRow?.type === 'session') {
      markTaskViewed(selectedPanelRow.item)
      setPanel({
        type: 'sessionDetail',
        toolId: panel.toolId,
        item: selectedPanelRow.item,
        parentCursor: panelCursor,
        limit: panel.limit,
      })
      return
    }

    if (selectedPanelRow?.type === 'notification') {
      markTaskViewed(selectedPanelRow.item)
      setPanel({
        type: 'notificationDetail',
        item: selectedPanelRow.item,
        parentCursor: panelCursor,
        limit: panel.limit,
      })
      return
    }

    if (selectedPanelRow?.type === 'asset') {
      markTaskViewed(selectedPanelRow.item)
      setPanel({
        type: 'assetDetail',
        item: selectedPanelRow.item,
        parentCursor: panelCursor,
        limit: panel.limit,
      })
    }
  }, [markTaskViewed, panel.limit, panel.toolId, panel.type, panelCursor, selected, selectedPanelRow])

  const pressAction = useCallback(() => {
    longPressFired.current = false
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true
      start()
    }, 650)
  }, [start])

  const releaseAction = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (longPressFired.current) {
      stop()
      return
    }
    if (shortPressTimer.current) {
      clearTimeout(shortPressTimer.current)
      shortPressTimer.current = null
      goBack()
      return
    }
    shortPressTimer.current = setTimeout(() => {
      shortPressTimer.current = null
      confirmSelection()
    }, SHORT_PRESS_DELAY_MS)
  }, [confirmSelection, goBack, stop])

  useEffect(() => () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (shortPressTimer.current) clearTimeout(shortPressTimer.current)
  }, [])

  useEffect(() => {
    const down = (event) => {
      if (event.repeat) return
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        moveSelection(-1)
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        moveSelection(1)
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        pressAction()
      }
      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault()
        goBack()
      }
      if (event.key.toLowerCase() === 'r') refresh(true)
    }
    const up = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        releaseAction()
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [goBack, moveSelection, pressAction, refresh, releaseAction])

  const renderPanel = () => {
    if (panel.type === 'home') return null
    if (panel.type === 'sessions') {
      const tool = status?.tools?.find((item) => item.id === panel.toolId)
      return (
        <PocketMenuPanel
          title={`${tool?.shortName ?? 'AI'} SESSIONS`}
          subtitle="ACTIVE FIRST"
          rows={panelRows}
          cursor={panelCursor}
        />
      )
    }
    if (panel.type === 'permissions') {
      return <PocketMenuPanel title="PERMISSIONS" subtitle="WAITING" rows={panelRows} cursor={panelCursor} />
    }
    if (panel.type === 'notifications') {
      return <PocketMenuPanel title="NOTICES" subtitle="TASK FLOW" rows={panelRows} cursor={panelCursor} />
    }
    if (panel.type === 'assets') {
      return <PocketMenuPanel title="ASSETS" subtitle="COMPANY MEMORY" rows={panelRows} cursor={panelCursor} />
    }
    if (panel.type === 'permissionDetail') {
      return (
        <PocketDetailPanel
          title={currentPermission?.title ?? 'Permission'}
          status="VOICE"
          detail={currentPermission?.detail ?? '长按语音说：同意 / 拒绝 / 补充意见。'}
          meta={currentPermission?.agentId ?? currentPermission?.taskId}
          bodyRef={detailBodyRef}
        />
      )
    }
    if (panel.type === 'sessionDetail' || panel.type === 'notificationDetail' || panel.type === 'assetDetail') {
      return (
        <PocketDetailPanel
          title={taskTitle(currentDetailItem ?? {})}
          status={statusLabel(normalizeTaskStatus(currentDetailItem ?? {}))}
          detail={fullTaskText(currentDetailItem ?? {})}
          meta={`${currentDetailItem?.agentId ?? 'AI'} · ${compactDateTime(currentDetailItem?.finishedAt ?? currentDetailItem?.startedAt)}`}
          bodyRef={detailBodyRef}
        />
      )
    }
    return null
  }

  const detailText = (() => {
    if (panel.type === 'permissions') return selectedPanelRow ? `${selectedPanelRow.title}: ${selectedPanelRow.detail}` : '没有待确认 permission。'
    if (panel.type === 'permissionDetail') return 'HOLD 语音输入 approve / reject；双击返回。'
    if (panel.type === 'sessions') return selectedPanelRow ? `${selectedPanelRow.meta}: ${selectedPanelRow.detail}` : '没有最近 active session。'
    if (panel.type === 'notifications') return selectedPanelRow ? `${selectedPanelRow.meta}: ${selectedPanelRow.detail}` : '没有新的任务通知。'
    if (panel.type === 'assets') return selectedPanelRow ? `${selectedPanelRow.meta}: ${selectedPanelRow.detail}` : '暂无公司资产沉淀。'
    if (['sessionDetail', 'notificationDetail', 'assetDetail'].includes(panel.type)) return taskDetail(currentDetailItem ?? {})
    if (error) return ''
    return pendingAction
      ? `${pendingAction.title}: ${pendingAction.detail}`
      : activeTask
        ? `${activeTask.agentId}: ${activeTask.message}`
        : selectedTool
          ? `${selectedTool.detail} / ${selectedTool.usage?.value ?? 'usage N/A'}`
          : readiness?.headline ?? '主控待命；长按大按钮语音下达指令。'
  })()

  return (
    <main className="pocket-shell">
      <button className="pocket-side-button pocket-side-button-left" type="button" onClick={() => moveSelection(-1)}>PREV</button>
      <button className="pocket-side-button pocket-side-button-right" type="button" onClick={() => moveSelection(1)}>NEXT</button>
      <section className="pocket-screen" aria-label="Pocket AI Company">
        <header className="pocket-statusbar">
          <h1>AI COMPANY</h1>
          <div>
            <span>{status ? formatTime(status.refreshedAt) : '--:--'}</span>
            <span className="pocket-battery">96%</span>
          </div>
        </header>

        <div className="pocket-usage-strip">
          {(status?.tools ?? []).slice(0, 3).map((tool) => (
            <UsageTile key={tool.id} tool={tool} />
          ))}
        </div>

        <div className="pocket-office">
          <div className="pocket-wall-board">
            <strong>READY {readiness ? `${readiness.readyCount}/${readiness.total}` : '--'}</strong>
            <strong>TASK {activeCount}</strong>
            <span>WAIT {pendingCount}</span>
          </div>
          <MiniMainframe selected={selected?.id === 'supervisor'} hasUnread={hasUnreadMessages} />
          <div className="pocket-route-line pocket-route-line-left" />
          <div className="pocket-route-line pocket-route-line-right" />
          {(status?.tools ?? []).map((tool, index) => (
            <PixelTool key={tool.id} tool={tool} index={index} selected={selected?.id === tool.id} notice={toolNotices[tool.id]} />
          ))}
          <Facility type="permissions" selected={selected?.id === 'permissions'} label="PERMS" value={pendingCount ? `${pendingCount} WAIT` : 'CLEAR'} />
          <Facility type="assets" selected={selected?.id === 'assets'} label="ASSETS" value={String(assetCount)} />
          {renderPanel()}
        </div>

        <section className="pocket-detail">
          <div className="pocket-detail-title">
            <strong>{panel.type === 'home' ? selected?.name ?? '主控' : panel.type.toUpperCase()}</strong>
            <span>{speechState === 'idle' ? (panel.type === 'home' ? statusLabel(selectedTool?.status ?? activeTask?.status) : 'MENU') : speechState.toUpperCase()}</span>
          </div>
          {error ? (
            <p className="pocket-detail-error">Bridge: {error}</p>
          ) : (
            <p>{detailText}</p>
          )}
          {commandFeedback ? (
            <p className="pocket-command-feedback">
              {commandFeedback.status}: {commandFeedback.message}
            </p>
          ) : null}
          {lastCommand ? <p className="pocket-last-command">VOICE: {lastCommand}</p> : null}
        </section>

        <footer className="pocket-controls">
          <span>上下: 选择</span>
          <span>短按: 确认</span>
          <span>双击: 返回</span>
          <span>HOLD: 语音</span>
        </footer>
      </section>
      <button
        className="pocket-talk-button"
        type="button"
        onPointerDown={pressAction}
        onPointerUp={releaseAction}
        onPointerCancel={releaseAction}
      >
        {frontActionText}
      </button>
    </main>
  )
}
