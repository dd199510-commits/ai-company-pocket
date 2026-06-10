import {
  Bot,
  CheckCircle2,
  FileSearch,
  History,
  Trash2,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Wifi,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { agentCatalog, demoTask } from './agents'
import { AgentWorkspace } from './components/OfficeStage'

const VISUAL_BRIDGE_URL = 'http://127.0.0.1:5181'
const CHAT_HISTORY_STORAGE_KEY = 'agentChatThreads'
const ACTIVE_CHAT_STORAGE_KEY = 'agentActiveChatId'
const DEFAULT_CHAT_ID = 'chat-default'
const DEFAULT_ASSISTANT_GREETING = '你好，我是主控。你直接说要做什么就行，我会先判断是否需要研究、文件、文书、应用或日程能力；需要执行前会把路线说清楚。'
const STATIC_AGENT_MAP = Object.fromEntries(agentCatalog.map((agent) => [agent.id, agent]))

function createDefaultChatThread() {
  return {
    id: DEFAULT_CHAT_ID,
    title: '新对话',
    agentId: 'main',
    updatedAt: new Date().toISOString(),
    messages: [
      {
        role: 'assistant',
        agentId: 'main',
        fromAgentId: 'main',
        text: DEFAULT_ASSISTANT_GREETING,
      },
    ],
  }
}

function createEmptyChatThread(agentId = 'main') {
  const now = new Date().toISOString()
  return {
    id: `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: '新对话',
    agentId,
    updatedAt: now,
    messages: [
      {
        role: 'assistant',
        agentId: 'main',
        fromAgentId: 'main',
        text: DEFAULT_ASSISTANT_GREETING,
      },
    ],
  }
}

function loadStoredChatThreads() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) ?? '[]')
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.filter((thread) => thread?.id && Array.isArray(thread.messages))
    }
  } catch {
    // Ignore invalid local storage and fall back to a clean default thread.
  }
  return [createDefaultChatThread()]
}

function makeChatTitle(message) {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return '新对话'
  return normalized.length > 18 ? `${normalized.slice(0, 18)}…` : normalized
}

function taskStatusLabel(status) {
  if (status === 'running') return '任务中'
  if (status === 'waiting_confirmation') return '待确认'
  if (status === 'done') return '已完成'
  if (status === 'failed') return '失败'
  return ''
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&bull;/g, '•')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function extractAssistantText(result) {
  if (!result) return '已完成，但没有返回文本。'
  if (typeof result === 'string') return decodeHtmlEntities(result)
  if (result.result) return decodeHtmlEntities(extractAssistantText(result.result))
  if (result.answer) return decodeHtmlEntities(result.answer)
  if (result.meta?.finalAssistantVisibleText) return decodeHtmlEntities(result.meta.finalAssistantVisibleText)
  if (result.meta?.finalAssistantRawText) return decodeHtmlEntities(result.meta.finalAssistantRawText)
  if (Array.isArray(result.payloads)) {
    const text = result.payloads.map((payload) => payload.text).filter(Boolean).join('\n')
    if (text) return text
  }
  if (result.raw) return result.raw
  return JSON.stringify(result)
}

function appendUniqueMessage(messages, message) {
  const previous = messages.at(-1)
  if (
    previous
    && previous.role === message.role
    && previous.text?.trim() === message.text?.trim()
    && (previous.agentId ?? '') === (message.agentId ?? '')
    && (previous.fromAgentId ?? '') === (message.fromAgentId ?? '')
    && (previous.toAgentId ?? '') === (message.toAgentId ?? '')
  ) {
    return messages
  }
  return [...messages, message]
}

function agentName(agentId) {
  return STATIC_AGENT_MAP[agentId]?.name ?? agentId ?? '助手'
}

function normalizeChatMessage(agentId, message) {
  if (message.role === 'user') {
    return {
      ...message,
      agentId: message.agentId ?? agentId,
      toAgentId: message.toAgentId ?? agentId,
    }
  }
  if (message.role === 'handoff') {
    return {
      ...message,
      agentId: message.agentId ?? message.toAgentId ?? agentId,
    }
  }
  return {
    ...message,
    agentId: message.agentId ?? agentId,
    fromAgentId: message.fromAgentId ?? agentId,
  }
}

function messageBelongsToAgent(message, selectedAgentId) {
  const agentIds = [
    message.agentId,
    message.fromAgentId,
    message.toAgentId,
  ].filter(Boolean)

  if (!agentIds.length) return selectedAgentId === 'main'
  if (selectedAgentId === 'main') {
    if (message.role === 'handoff') return agentIds.includes('main')
    if (message.role === 'user') return (message.toAgentId ?? message.agentId ?? 'main') === 'main'
    return (message.fromAgentId ?? message.agentId ?? 'main') === 'main'
  }
  return agentIds.includes(selectedAgentId)
}

function getVisibleMessages(messages, selectedAgentId) {
  return (messages ?? []).filter((message) => messageBelongsToAgent(message, selectedAgentId))
}

function messageRouteLabel(message) {
  if (message.role === 'handoff') {
    return `${agentName(message.fromAgentId)} → ${agentName(message.toAgentId)}`
  }
  if (message.role === 'assistant' && message.fromAgentId && message.fromAgentId !== 'main') {
    return agentName(message.fromAgentId)
  }
  if (message.role === 'user' && message.toAgentId && message.toAgentId !== 'main') {
    return `你 → ${agentName(message.toAgentId)}`
  }
  return ''
}

function buildTaskStep(event, fallbackId) {
  return {
    id: event.stepId ?? fallbackId ?? `${event.taskId}-${Date.now()}`,
    status: event.status ?? 'running',
    title: event.title ?? '执行日志',
    detail: event.detail ?? '',
  }
}

function upsertTaskStep(task, step) {
  return {
    ...task,
    steps: [
      ...(task.steps ?? []).filter((item) => item.id !== step.id),
      step,
    ],
  }
}

function buildStartedTask(event) {
  return {
    id: event.taskId,
    title: event.message,
    agentId: event.agentId,
    status: 'running',
    currentRoute: null,
    steps: [
      {
        id: `${event.taskId}-route`,
        status: 'done',
        title: '主控路由',
        detail: `已选择 ${STATIC_AGENT_MAP[event.agentId]?.name ?? event.agentId}`,
      },
      {
        id: `${event.taskId}-execute`,
        status: 'running',
        title: '执行器启动',
        detail: event.metric ?? '正在执行任务',
      },
    ],
  }
}

function taskFromHistoryItem(item) {
  if (!item) return null
  return {
    id: item.taskId,
    title: item.message,
    agentId: item.agentId,
    status: item.status === 'failed'
      ? 'failed'
      : item.status === 'done'
        ? 'done'
        : item.status === 'waiting_confirmation'
          ? 'running'
          : 'running',
    currentRoute: item.pendingAction
      ? { fromAgentId: item.agentId ?? 'main', toAgentId: item.pendingAction.agentId ?? item.agentId }
      : null,
    steps: item.steps?.length
      ? item.steps
      : [
          {
            id: `${item.taskId}-history`,
            status: item.status === 'failed' ? 'failed' : 'done',
            title: '历史记录',
            detail: item.summary || item.startedAt || '已从本地历史恢复',
          },
        ],
  }
}

function renderInlineMarkdown(text) {
  const parts = decodeHtmlEntities(text).split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/)
    if (bold) return <strong key={index}>{bold[1]}</strong>
    return part
  })
}

function truncateMessageText(text, maxLength = 900) {
  const decoded = decodeHtmlEntities(text)
  if (decoded.length <= maxLength) return decoded
  const slice = decoded.slice(0, maxLength)
  const boundary = Math.max(
    slice.lastIndexOf('\n'),
    slice.lastIndexOf('。'),
    slice.lastIndexOf('；'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
  )
  return `${slice.slice(0, boundary > maxLength * 0.45 ? boundary + 1 : maxLength).trim()}…`
}

function FormattedMessage({ text }) {
  const decodedText = decodeHtmlEntities(text)
  const canExpand = decodedText.length > 900
  const [expanded, setExpanded] = useState(false)
  const visibleText = canExpand && !expanded ? truncateMessageText(decodedText) : decodedText
  const lines = visibleText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return (
    <div className="formatted-message">
      {lines.map((line, index) => {
        if (/^-{3,}$/.test(line)) {
          return <hr key={index} className="formatted-divider" />
        }

        const heading = line.match(/^(#{1,6})\s+(.+)$/)
        if (heading) {
          const level = Math.min(heading[1].length, 4)
          return (
            <p key={index} className={`formatted-heading formatted-heading-${level}`}>
              {renderInlineMarkdown(heading[2].replace(/[:：]\s*$/, ''))}
            </p>
          )
        }

        const source = line.match(/^(\d+)\.\s+(.+?)\s+-\s+(https?:\/\/\S+)$/)
        if (source) {
          return (
            <p key={index} className="formatted-source">
              <span>{source[1]}.</span>
              <a href={source[3]} target="_blank" rel="noreferrer">{source[2]}</a>
            </p>
          )
        }

        const bullet = line.match(/^[*-]\s+(.+)$/)
        if (bullet) {
          return <p key={index} className="formatted-bullet">{renderInlineMarkdown(bullet[1])}</p>
        }

        return <p key={index}>{renderInlineMarkdown(line)}</p>
      })}
      {canExpand ? (
        <button
          type="button"
          className="formatted-expand-button"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      ) : null}
    </div>
  )
}

function TaskTimeline({ task, pendingAction, onConfirmAction }) {
  const steps = task?.steps ?? []
  return (
    <section className="task-timeline" aria-label="任务时间线">
      <div className="panel-section-title">
        <CheckCircle2 size={16} />
        <span>任务执行</span>
      </div>
      {task ? (
        <>
          <div className="task-current">
            <strong>{task.title}</strong>
            <span>{task.status === 'running' ? '执行中' : task.status === 'failed' ? '需要处理' : '已完成'}</span>
          </div>
          {pendingAction ? (
            <div className="pending-action">
              <strong>{pendingAction.title}</strong>
              <span>{pendingAction.detail}</span>
              <button type="button" onClick={() => onConfirmAction(pendingAction.actionId)}>
                确认执行
              </button>
            </div>
          ) : null}
          <ol>
            {steps.map((step) => (
              <li key={step.id} className={`task-step task-step-${step.status}`}>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="empty-note">输入一个目标后，主控助手会显示路由、权限边界和执行结果。</p>
      )}
    </section>
  )
}

function ChatHistory({ threads, activeId, onSelect, onDelete }) {
  return (
    <div className="chat-history-list" aria-label="对话历史">
      {threads.map((thread) => (
        <div
          key={thread.id}
          className={[
            'chat-history-row',
            thread.id === activeId ? 'chat-history-item-active' : '',
          ].filter(Boolean).join(' ')}
        >
          <button
            type="button"
            className="chat-history-item"
            onClick={() => onSelect(thread.id)}
          >
            <strong>{thread.title}</strong>
            <span className="chat-history-meta">
              {thread.taskStatus ? (
                <em className={`chat-history-task chat-history-task-${thread.taskStatus}`}>
                  {taskStatusLabel(thread.taskStatus)}
                </em>
              ) : null}
              {new Date(thread.updatedAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </button>
          <button
            type="button"
            className="chat-history-delete"
            aria-label={`删除对话 ${thread.title}`}
            title="删除对话"
            onClick={() => onDelete(thread.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

function TaskHistory({ items, onSelect }) {
  return (
    <section className="task-history" aria-label="最近任务">
      <div className="panel-section-title">
        <History size={16} />
        <span>最近任务</span>
      </div>
      {items.length ? (
        <div className="task-history-list">
          {items.map((item) => (
            <button
              key={item.taskId}
              type="button"
              className={`task-history-item task-history-item-${item.status}`}
              onClick={() => onSelect(item)}
            >
              <strong>{item.message || item.taskId}</strong>
              <span>
                {STATIC_AGENT_MAP[item.agentId]?.name ?? item.agentId}
                {' / '}
                {item.status === 'waiting_confirmation'
                  ? '待确认'
                  : item.status === 'failed'
                    ? '失败'
                    : item.status === 'done'
                      ? '完成'
                      : '执行中'}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-note">暂无历史。完成一次任务后会出现在这里。</p>
      )}
    </section>
  )
}

export function App() {
  const processedEventIds = useRef(new Set())
  const taskChatMap = useRef(new Map())
  const workspaceRef = useRef(null)
  const [agents, setAgents] = useState(agentCatalog)
  const [selectedId, setSelectedId] = useState('main')
  const [workspaceSplit, setWorkspaceSplit] = useState(() => {
    const saved = Number.parseFloat(window.localStorage.getItem('agentWorkspaceSplit') ?? '')
    return Number.isFinite(saved) ? Math.min(78, Math.max(48, saved)) : 72
  })
  const [runtime, setRuntime] = useState({
    status: 'checking',
    profile: 'local-os-agent',
    message: '正在检查本地执行桥',
  })
  const [draft, setDraft] = useState('')
  const [activeTask, setActiveTask] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [taskHistory, setTaskHistory] = useState([])
  const [chatThreads, setChatThreads] = useState(loadStoredChatThreads)
  const [activeChatId, setActiveChatId] = useState(() => {
    const stored = window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY)
    const threads = loadStoredChatThreads()
    return threads.some((thread) => thread.id === stored) ? stored : threads[0]?.id ?? DEFAULT_CHAT_ID
  })
  const [showChatHistory, setShowChatHistory] = useState(false)
  const selectedAgent = agents.find((agent) => agent.id === selectedId) ?? agents[0]
  const activeChat = chatThreads.find((thread) => thread.id === activeChatId) ?? chatThreads[0] ?? createDefaultChatThread()
  const selectedMessages = getVisibleMessages(activeChat.messages, selectedId)
  const visibleTask = activeChat.task ?? activeTask
  const visiblePendingAction = activeChat.pendingAction ?? pendingAction
  const readyAgents = agents.filter((agent) => agent.state !== 'working').length
  const inspectorSplit = 100 - workspaceSplit

  useEffect(() => {
    window.localStorage.setItem('agentWorkspaceSplit', String(workspaceSplit))
  }, [workspaceSplit])

  useEffect(() => {
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(chatThreads.slice(0, 30)))
  }, [chatThreads])

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeChatId)
  }, [activeChatId])

  const updateWorkspaceSplit = (clientX) => {
    const rect = workspaceRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    const nextSplit = ((clientX - rect.left) / rect.width) * 100
    setWorkspaceSplit(Math.min(78, Math.max(48, nextSplit)))
  }

  const startWorkspaceResize = (event) => {
    if (window.matchMedia('(max-width: 1120px)').matches) return
    event.preventDefault()
    updateWorkspaceSplit(event.clientX)

    const move = (moveEvent) => updateWorkspaceSplit(moveEvent.clientX)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const nudgeWorkspaceSplit = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setWorkspaceSplit((current) => {
      const delta = event.key === 'ArrowLeft' ? -3 : 3
      return Math.min(78, Math.max(48, current + delta))
    })
  }

  const appendMessage = (agentId, message, chatId = activeChatId) => {
    setChatThreads((current) => {
      const now = new Date().toISOString()
      const existing = current.length ? current : [createDefaultChatThread()]
      const normalizedMessage = normalizeChatMessage(agentId, message)
      return existing.map((thread) => {
        if (thread.id !== chatId) return thread
        const nextMessages = appendUniqueMessage(thread.messages ?? [], normalizedMessage)
        const shouldRetitle = normalizedMessage.role === 'user' && (!thread.title || thread.title === '新对话')
        return {
          ...thread,
          agentId: thread.agentId ?? agentId,
          title: shouldRetitle ? makeChatTitle(normalizedMessage.text) : thread.title,
          updatedAt: now,
          messages: nextMessages,
        }
      })
    })
  }

  const updateChatTaskState = (chatId, patch) => {
    if (!chatId) return
    setChatThreads((current) => {
      const now = new Date().toISOString()
      return current.map((thread) => (
        thread.id === chatId
          ? {
              ...thread,
              ...patch,
              updatedAt: now,
            }
          : thread
      ))
    })
  }

  const updateChatWorkflow = (chatId, updater) => {
    if (!chatId) return
    setChatThreads((current) => {
      const now = new Date().toISOString()
      return current.map((thread) => {
        if (thread.id !== chatId) return thread
        const nextTask = updater(thread.task ?? null)
        return {
          ...thread,
          task: nextTask,
          taskStatus: nextTask?.status ?? thread.taskStatus,
          updatedAt: now,
        }
      })
    })
  }

  const reconcileCompletedTasks = (historyItems) => {
    const completedItems = (historyItems ?? [])
      .filter((item) => (item.status === 'done' || item.status === 'failed') && item.message)
      .slice(0, 6)
    if (!completedItems.length) return

    setChatThreads((current) => {
      let changed = false
      const now = new Date().toISOString()
      const nextThreads = current.map((thread) => {
        const messages = thread.messages ?? []
        const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user')
        if (lastUserIndex < 0) return thread
        const lastUserMessage = messages[lastUserIndex]?.text?.trim()
        const matchedTask = completedItems.find((item) => item.message?.trim() === lastUserMessage)
        if (!matchedTask) return thread
        const alreadyAnswered = messages.slice(lastUserIndex + 1).some((message) => message.role === 'assistant')
        if (alreadyAnswered) return thread

        const answer = matchedTask.status === 'failed'
          ? matchedTask.summary || '任务执行失败。'
          : matchedTask.summary || '任务已完成。'
        changed = true
        return {
          ...thread,
          taskStatus: matchedTask.status,
          updatedAt: now,
          messages: appendUniqueMessage(messages, {
            role: 'assistant',
            agentId: matchedTask.agentId ?? thread.taskAgentId ?? 'main',
            fromAgentId: matchedTask.agentId ?? thread.taskAgentId ?? 'main',
            text: answer,
          }),
        }
      })
      return changed ? nextThreads : current
    })
  }

  const updateAgentState = (agentId, patch) => {
    setAgents((current) =>
      current.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent)),
    )
  }

  const applyTaskEvent = (event) => {
    if (event.eventId) {
      if (processedEventIds.current.has(event.eventId)) return
      processedEventIds.current.add(event.eventId)
    }
    const eventChatId = event.threadId ?? (event.taskId ? taskChatMap.current.get(event.taskId) : null) ?? activeChatId

    if (event.type === 'task_started') {
      const startedTask = buildStartedTask(event)
      if (event.taskId) {
        taskChatMap.current.set(event.taskId, eventChatId)
        updateChatTaskState(eventChatId, {
          taskId: event.taskId,
          taskAgentId: event.agentId,
          taskStatus: 'running',
          task: startedTask,
          pendingAction: null,
        })
      }
      setAgents((current) =>
        current.map((agent) => ({
          ...agent,
          state: agent.id === event.agentId ? 'working' : agent.state,
          bubble: agent.id === event.agentId ? event.bubble ?? '执行' : agent.bubble,
          metric: agent.id === event.agentId ? event.metric ?? '正在执行' : agent.metric,
        })),
      )
      setActiveTask(startedTask)
      return
    }

    if (event.type === 'task_log') {
      if (event.announce && event.detail) {
        appendMessage(event.agentId ?? 'main', {
          role: 'assistant',
          agentId: event.agentId ?? 'main',
          fromAgentId: event.agentId ?? 'main',
          text: event.detail,
        }, eventChatId)
      }
      const nextStep = buildTaskStep(event)
      updateChatWorkflow(eventChatId, (task) => (
        upsertTaskStep(task ?? {
          id: event.taskId,
          title: event.message ?? '任务执行中',
          agentId: event.agentId,
          status: 'running',
          steps: [],
        }, nextStep)
      ))
      setActiveTask((current) => {
        if (!current) return current
        if (current.id !== event.taskId) return current
        return upsertTaskStep(current, nextStep)
      })
      if (event.agentId) {
        updateAgentState(event.agentId, {
          state: event.agentId === 'main' && event.status !== 'failed'
            ? 'working'
            : event.status === 'done'
            ? 'done'
            : event.status === 'failed'
              ? 'failed'
              : 'working',
          metric: event.metric ?? event.detail ?? '执行中',
          bubble: event.bubble ?? '处理中',
        })
      }
      return
    }

    if (event.type === 'agent_message') {
      const nextRoute = {
        fromAgentId: event.fromAgentId ?? 'main',
        toAgentId: event.toAgentId ?? 'main',
      }
      updateChatWorkflow(eventChatId, (task) => ({
        ...(task ?? {
          id: event.taskId,
          title: event.message ?? '任务执行中',
          agentId: event.fromAgentId ?? 'main',
          status: 'running',
          steps: [],
        }),
        currentRoute: nextRoute,
      }))
      setActiveTask((current) => (
        current?.id === event.taskId ? { ...current, currentRoute: nextRoute } : current
      ))
      appendMessage(event.toAgentId ?? event.fromAgentId ?? 'main', {
        role: 'handoff',
        agentId: event.toAgentId ?? event.fromAgentId ?? 'main',
        fromAgentId: event.fromAgentId ?? 'main',
        toAgentId: event.toAgentId ?? 'main',
        text: event.text ?? '',
      }, eventChatId)
      return
    }

    if (event.type === 'action_required') {
      updateChatTaskState(eventChatId, {
        taskId: event.taskId,
        taskAgentId: event.agentId,
        taskStatus: 'waiting_confirmation',
        pendingAction: {
          actionId: event.actionId,
          taskId: event.taskId,
          agentId: event.agentId,
          title: event.title,
          detail: event.detail,
        },
      })
      setPendingAction({
        actionId: event.actionId,
        taskId: event.taskId,
        agentId: event.agentId,
        title: event.title,
        detail: event.detail,
      })
      setActiveTask((current) => {
        if (!current) return current
        if (current.id !== event.taskId) return current
        return {
          ...current,
          status: 'running',
          steps: [
            ...current.steps.filter((step) => step.id !== `${event.taskId}-action-required`),
            {
              id: `${event.taskId}-action-required`,
              status: 'running',
              title: '等待确认',
              detail: event.detail ?? '需要用户确认后继续',
            },
          ],
        }
      })
      updateChatWorkflow(eventChatId, (task) => upsertTaskStep({
        ...(task ?? {
          id: event.taskId,
          title: event.message ?? '任务执行中',
          agentId: event.agentId,
          status: 'running',
          steps: [],
        }),
        status: 'running',
        currentRoute: { fromAgentId: 'main', toAgentId: event.agentId },
      }, {
        id: `${event.taskId}-action-required`,
        status: 'running',
        title: '等待确认',
        detail: event.detail ?? '需要用户确认后继续',
      }))
      updateAgentState(event.agentId, {
        state: 'waiting',
        metric: event.metric ?? '等待用户确认',
        bubble: event.bubble ?? '确认',
      })
      return
    }

    if (event.type === 'task_finished' || event.type === 'task_failed') {
      const failed = event.type === 'task_failed'
      setPendingAction(null)
      updateChatTaskState(eventChatId, {
        taskId: event.taskId,
        taskAgentId: event.agentId,
        taskStatus: failed ? 'failed' : 'done',
        pendingAction: null,
      })
      appendMessage(event.agentId, {
        role: 'assistant',
        agentId: event.agentId,
        fromAgentId: event.agentId,
        text: failed ? event.error ?? '任务执行失败。' : extractAssistantText(event.result),
      }, eventChatId)
      setActiveTask((current) => {
        if (!current) return current
        if (current.id !== event.taskId) return current
        return {
          ...current,
          status: failed ? 'failed' : 'done',
          steps: [
            ...current.steps.filter((step) => step.id !== `${event.taskId}-finish`),
            {
              id: `${event.taskId}-finish`,
              status: failed ? 'failed' : 'done',
              title: failed ? '执行失败' : '结果返回',
              detail: failed ? event.error ?? '请检查执行器状态' : event.metric ?? '结果已写入对话',
            },
          ],
        }
      })
      updateChatWorkflow(eventChatId, (task) => upsertTaskStep({
        ...(task ?? {
          id: event.taskId,
          title: event.message ?? '任务执行完成',
          agentId: event.agentId,
          steps: [],
        }),
        status: failed ? 'failed' : 'done',
        currentRoute: null,
      }, {
        id: `${event.taskId}-finish`,
        status: failed ? 'failed' : 'done',
        title: failed ? '执行失败' : '结果返回',
        detail: failed ? event.error ?? '请检查执行器状态' : event.metric ?? '结果已写入对话',
      }))
      updateAgentState(event.agentId, {
        state: failed ? 'idle' : 'done',
        metric: failed ? '执行失败' : event.metric ?? '已完成',
        bubble: failed ? '异常' : '完成',
      })
      if (event.taskId) taskChatMap.current.delete(event.taskId)
      refreshHistory()
    }
  }

  const applyRuntimeSnapshot = (snapshot) => {
    const liveTask = snapshot.activeTasks?.[0] ?? null
    const livePendingAction = snapshot.pendingActions?.[0] ?? null
    setRuntime({
      status: 'connected',
      profile: snapshot.profile ?? 'local-os-agent',
      runtimeRoot: snapshot.runtimeRoot,
      gateway: snapshot.gateway,
      planner: snapshot.planner,
      agentCount: snapshot.agents?.length ?? agentCatalog.length,
      message: snapshot.message ?? '本地执行桥已连接',
    })

    if (livePendingAction) {
      setPendingAction(livePendingAction)
    }

    if (liveTask) {
      setActiveTask((current) => {
        if (current?.id === liveTask.taskId) return current
        return {
          id: liveTask.taskId,
          title: liveTask.message,
          agentId: liveTask.agentId,
          status: 'running',
          steps: [
            {
              id: `${liveTask.taskId}-runtime`,
              status: livePendingAction ? 'running' : 'running',
              title: livePendingAction ? '等待确认' : '运行中',
              detail: livePendingAction?.detail ?? '已从本地执行桥恢复当前任务状态',
            },
          ],
        }
      })
    }

    setAgents((current) =>
      current.map((agent) => {
        const liveAgent = snapshot.agents?.find((item) => item.id === agent.id)
        const isActive = liveTask?.agentId === agent.id
        const isPending = livePendingAction?.agentId === agent.id
        if (!liveAgent && !isActive && !isPending) return agent
        return {
          ...agent,
          state: isPending ? 'waiting' : isActive ? 'working' : agent.state,
          metric: isPending ? livePendingAction.title : liveAgent?.metric ?? agent.metric,
          bubble: isPending ? '确认' : isActive ? '执行' : agent.bubble,
        }
      }),
    )
  }

  const refreshHistory = async () => {
    try {
      const response = await fetch(`${VISUAL_BRIDGE_URL}/api/history?limit=8`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const history = payload.history ?? []
      setTaskHistory(history)
      setChatThreads((current) => {
        const now = new Date().toISOString()
        let changed = false
        const next = current.map((thread) => {
          const historyItem = history.find((item) => item.taskId && item.taskId === thread.taskId)
          if (!historyItem) return thread
          const nextTask = taskFromHistoryItem(historyItem)
          changed = true
          return {
            ...thread,
            task: nextTask,
            pendingAction: historyItem.pendingAction
              ? {
                  ...historyItem.pendingAction,
                  taskId: historyItem.taskId,
                  agentId: historyItem.pendingAction.agentId ?? historyItem.agentId,
                }
              : null,
            taskStatus: historyItem.status,
            updatedAt: now,
          }
        })
        return changed ? next : current
      })
      reconcileCompletedTasks(history)
    } catch {
      setTaskHistory([])
    }
  }

  const refreshRuntime = async () => {
    try {
      const response = await fetch(`${VISUAL_BRIDGE_URL}/api/runtime`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const snapshot = await response.json()
      applyRuntimeSnapshot(snapshot)
      refreshHistory()
    } catch {
      setRuntime({
        status: 'offline',
        profile: 'local-os-agent',
        message: '本地执行桥未启动',
      })
    }
  }

  useEffect(() => {
    const initialRefresh = window.setTimeout(refreshRuntime, 0)
    const timer = window.setInterval(refreshRuntime, 8000)
    const events = new EventSource(`${VISUAL_BRIDGE_URL}/api/events`)

    events.onmessage = (message) => {
      const event = JSON.parse(message.data)
      applyTaskEvent(event)
    }

    events.onerror = () => {
      setRuntime((current) => (
        current.status === 'connected'
          ? current
          : { status: 'offline', profile: 'local-os-agent', message: '本地执行桥未启动' }
      ))
    }

    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(timer)
      events.close()
    }
    // The local bridge URL is fixed for this MVP.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetDemo = () => {
    setAgents(agentCatalog)
    setSelectedId('main')
    setActiveTask(null)
    setPendingAction(null)
    refreshRuntime()
  }

  const startNewChat = () => {
    const nextThread = createEmptyChatThread('main')
    setChatThreads((current) => [nextThread, ...current])
    setActiveChatId(nextThread.id)
    setSelectedId('main')
    setDraft('')
    setShowChatHistory(false)
    setActiveTask(null)
    setPendingAction(null)
  }

  const selectChatThread = (threadId) => {
    const thread = chatThreads.find((item) => item.id === threadId)
    if (!thread) return
    setActiveChatId(threadId)
    setSelectedId(thread.agentId ?? 'main')
    setActiveTask(thread.task ?? null)
    setPendingAction(thread.pendingAction ?? null)
    setDraft('')
    setShowChatHistory(false)
  }

  const deleteChatThread = (threadId) => {
    setChatThreads((current) => {
      const remaining = current.filter((thread) => thread.id !== threadId)
      const nextThreads = remaining.length ? remaining : [createDefaultChatThread()]
      if (threadId === activeChatId) {
        const nextActive = nextThreads[0]
        setActiveChatId(nextActive.id)
        setSelectedId(nextActive.agentId ?? 'main')
        setDraft('')
        setActiveTask(null)
        setPendingAction(null)
      }
      return nextThreads
    })
  }

  const selectHistoryItem = (item) => {
    setSelectedId(item.agentId)
    const historyTask = taskFromHistoryItem(item)
    setPendingAction(item.pendingAction)
    setActiveTask(historyTask)
    if (item.summary) {
      const historyThreadId = `history-${item.taskId}`
      setChatThreads((current) => {
        const thread = {
          id: historyThreadId,
          title: makeChatTitle(item.message),
          agentId: item.agentId,
          taskId: item.taskId,
          taskAgentId: item.agentId,
          taskStatus: item.status,
          task: historyTask,
          pendingAction: item.pendingAction ?? null,
          updatedAt: item.finishedAt ?? item.startedAt ?? new Date().toISOString(),
          messages: [
          { role: 'user', agentId: item.agentId, toAgentId: item.agentId, text: item.message },
          { role: 'assistant', agentId: item.agentId, fromAgentId: item.agentId, text: item.summary },
          ],
        }
        const withoutDuplicate = current.filter((chat) => chat.id !== historyThreadId)
        return [thread, ...withoutDuplicate]
      })
      setActiveChatId(historyThreadId)
    }
  }

  const submitTask = async (message, preferredAgentId = selectedId) => {
    const targetAgentId = preferredAgentId === 'main' ? undefined : preferredAgentId
    const chatId = activeChatId
    appendMessage(preferredAgentId, {
      role: 'user',
      agentId: preferredAgentId,
      toAgentId: preferredAgentId,
      text: message,
    }, chatId)
    setDraft('')

    try {
      const response = await fetch(`${VISUAL_BRIDGE_URL}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, agentId: targetAgentId, threadId: chatId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }
      const payload = await response.json()
      if (payload.taskId) {
        taskChatMap.current.set(payload.taskId, chatId)
        updateChatTaskState(chatId, {
          taskId: payload.taskId,
          taskAgentId: payload.agentId ?? preferredAgentId,
          taskStatus: payload.status ?? 'running',
        })
      }
      if (payload.status === 'done' && payload.result) {
        appendMessage(preferredAgentId, {
          role: 'assistant',
          agentId: payload.agentId ?? preferredAgentId,
          fromAgentId: payload.agentId ?? preferredAgentId,
          text: extractAssistantText(payload.result),
        }, chatId)
      }
      if (payload.status === 'failed') {
        appendMessage(preferredAgentId, {
          role: 'assistant',
          agentId: payload.agentId ?? preferredAgentId,
          fromAgentId: payload.agentId ?? preferredAgentId,
          text: payload.error ?? '任务执行失败。',
        }, chatId)
      }
    } catch (error) {
      appendMessage(preferredAgentId, {
        role: 'assistant',
        agentId: preferredAgentId,
        fromAgentId: preferredAgentId,
        text: `本地执行桥不可用：${error.message}`,
      }, chatId)
    }
  }

  const runDemo = () => {
    submitTask(demoTask, 'main')
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message) return
    await submitTask(message, selectedId)
  }

  const confirmAction = async (actionId) => {
    try {
      const response = await fetch(`${VISUAL_BRIDGE_URL}/api/actions/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }
    } catch (error) {
      appendMessage(pendingAction?.agentId ?? selectedId, {
        role: 'assistant',
        agentId: pendingAction?.agentId ?? selectedId,
        fromAgentId: pendingAction?.agentId ?? selectedId,
        text: `确认动作失败：${error.message}`,
      })
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-titlebar">
          <span className="app-title-dot" aria-hidden="true" />
          <span className="app-eyebrow">马维斯式本地 AI 工作台</span>
        </div>
        <div className="app-actions">
          <button type="button" onClick={runDemo}>
            <Play size={16} />
            演示任务
          </button>
          <button type="button" className="secondary-button" onClick={refreshRuntime}>
            <Wifi size={16} />
            检查执行桥
          </button>
          <button type="button" className="secondary-button" onClick={resetDemo}>
            <RotateCcw size={16} />
            重置
          </button>
        </div>
      </header>

      <section
        className="agent-workspace"
        ref={workspaceRef}
        style={{
          '--workspace-left': `${workspaceSplit}%`,
          '--workspace-right': `${inspectorSplit}%`,
        }}
      >
        <AgentWorkspace
          agents={agents}
          selectedId={selectedId}
          onSelect={setSelectedId}
          activeTask={visibleTask}
          pendingAction={visiblePendingAction}
        />

        <div
          className="workspace-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整工作区和互动区宽度"
          aria-valuemin={48}
          aria-valuemax={78}
          aria-valuenow={Math.round(workspaceSplit)}
          tabIndex={0}
          onPointerDown={startWorkspaceResize}
          onKeyDown={nudgeWorkspaceSplit}
        >
          <span />
        </div>

        <aside className="agent-inspector">
          <div className="agent-inspector-head">
            <span className="agent-inspector-icon" aria-hidden="true">
              <Bot size={18} />
            </span>
            <div>
              <span>{selectedAgent.role}</span>
              <h2>{selectedAgent.name}</h2>
            </div>
          </div>
          <div className="agent-chat-panel">
            <div className="agent-chat-head">
              <div className="panel-section-title">
                <FileSearch size={16} />
                <span>对话与结果</span>
                {activeChat.taskStatus ? (
                  <em className={`thread-task-status thread-task-status-${activeChat.taskStatus}`}>
                    任务工作流 · {taskStatusLabel(activeChat.taskStatus)}
                  </em>
                ) : null}
              </div>
              <div className="agent-chat-actions">
                <button
                  type="button"
                  className="icon-text-button"
                  onClick={() => setShowChatHistory((current) => !current)}
                  aria-pressed={showChatHistory}
                >
                  <History size={15} />
                  历史
                </button>
                <button
                  type="button"
                  className="icon-text-button primary-lite-button"
                  onClick={startNewChat}
                >
                  <Plus size={15} />
                  新对话
                </button>
              </div>
            </div>
            {showChatHistory ? (
              <ChatHistory
                threads={chatThreads}
                activeId={activeChatId}
                onSelect={selectChatThread}
                onDelete={deleteChatThread}
              />
            ) : null}
            <div className="agent-chat-log" aria-live="polite">
              {selectedMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`agent-chat-message agent-chat-message-${message.role}`}
                >
                  {messageRouteLabel(message) ? (
                    <span className="agent-chat-route">{messageRouteLabel(message)}</span>
                  ) : null}
                  {message.role === 'assistant' || message.role === 'handoff'
                    ? <FormattedMessage text={message.text} />
                    : message.text}
                </div>
              ))}
            </div>
            <form className="agent-chat-form" onSubmit={sendMessage}>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={`发给${selectedAgent.name}`}
              />
              <button type="submit" disabled={!draft.trim()} aria-label="发送任务">
                <Send size={16} />
              </button>
            </form>
          </div>
          <details className="agent-inspector-details" open={Boolean(pendingAction)}>
            <summary>运行与任务详情</summary>
            <div className="agent-inspector-details-body">
              <div className="agent-inspector-status">
                <strong>{selectedAgent.metric}</strong>
                <span>{selectedAgent.task}</span>
              </div>
              <div className={`runtime-status runtime-status-${runtime.status}`}>
                <span className="runtime-status-dot" />
                <div>
                  <strong>{runtime.message}</strong>
                  <span>
                    profile: {runtime.profile}
                    {runtime.gateway ? ` / OpenClaw ${runtime.gateway.listening ? 'online' : 'offline'}:${runtime.gateway.port}` : ''}
                    {runtime.planner ? ` / planner ${runtime.planner.mode}` : ''}
                  </span>
                </div>
              </div>
              <div className="agent-message-preview">
                <ShieldCheck size={16} />
                <p>涉及发送消息、修改文件、控制应用等动作时，MVP 会先停在确认边界，不做静默执行。</p>
              </div>
              <div className="agent-summary-grid" aria-label="本地能力概览">
                <span>
                  能力
                  <strong>{agents.length}</strong>
                </span>
                <span>
                  就绪
                  <strong>{readyAgents}</strong>
                </span>
              </div>
              <TaskTimeline
                task={visibleTask}
                pendingAction={visiblePendingAction}
                onConfirmAction={confirmAction}
              />
              <TaskHistory items={taskHistory} onSelect={selectHistoryItem} />
            </div>
          </details>
        </aside>
      </section>
    </main>
  )
}
