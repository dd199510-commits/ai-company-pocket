import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const BRIDGE_URL = 'http://127.0.0.1:5181'
const STATUS_POLL_MS = 5000

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

function PixelTool({ tool, selected, index }) {
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
        <span className="pocket-tool-face">{tool.glyph}</span>
        <i className="pocket-tool-eye pocket-tool-eye-left" />
        <i className="pocket-tool-eye pocket-tool-eye-right" />
        <b className="pocket-tool-arm pocket-tool-arm-left" />
        <b className="pocket-tool-arm pocket-tool-arm-right" />
        <b className="pocket-tool-foot pocket-tool-foot-left" />
        <b className="pocket-tool-foot pocket-tool-foot-right" />
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

function MiniMainframe({ selected }) {
  return (
    <div className={`pocket-mainframe ${selected ? 'pocket-mainframe-selected' : ''}`}>
      <div className="pocket-main-screen">
        <span>MAIN</span>
        <i />
      </div>
      <div className="pocket-main-agent">
        <b />
        <b />
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
  const rows = display?.rows?.length
    ? display.rows
    : [
        display?.primary ?? { label: tool.usage?.label ?? 'USAGE', value: tool.usage?.value ?? '--', percent: tool.usage?.percent },
        display?.secondary,
      ].filter(Boolean)

  return (
    <div className={`pocket-usage-tile pocket-usage-tile-${display?.type ?? 'unknown'}`}>
      <strong>{tool.shortName}</strong>
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
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PocketApp() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [lastCommand, setLastCommand] = useState('')
  const [commandFeedback, setCommandFeedback] = useState(null)
  const pressTimer = useRef(null)
  const longPressFired = useRef(false)

  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetch(`${BRIDGE_URL}/api/pocket/status${force ? '?force=1' : ''}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setStatus(await response.json())
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

  const selected = items[selectedIndex] ?? items[0]
  const pendingCount = status?.tasks?.pending?.length ?? 0
  const activeCount = status?.tasks?.active?.length ?? 0
  const assetCount = status?.assets?.recentCount ?? 0
  const readiness = status?.readiness
  const selectedTool = selected?.tool
  const needsSetup = selectedTool?.status === 'setup'
  const pendingAction = status?.tasks?.pending?.[0] ?? null
  const activeTask = status?.tasks?.active?.[0] ?? null

  const sendCommand = useCallback(async (message) => {
    const target = selected?.commandTarget ?? 'supervisor'
    setLastCommand(message)
    try {
      const response = await fetch(`${BRIDGE_URL}/api/pocket/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, message }),
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
  }, [refresh, selected?.commandTarget])

  const startSetup = useCallback(async () => {
    const target = selected?.commandTarget
    if (!target) return
    setLastCommand('SETUP')
    try {
      const response = await fetch(`${BRIDGE_URL}/api/pocket/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const payload = await response.json().catch(() => ({}))
      setCommandFeedback({
        target,
        status: payload.status ?? (response.ok ? 'setup' : 'failed'),
        message: payload.message ?? payload.error ?? (response.ok ? '设置流程已启动' : `HTTP ${response.status}`),
      })
      if (!response.ok || payload.ok === false) setError(payload.message ?? payload.error ?? `HTTP ${response.status}`)
      else setError('')
    } catch (nextError) {
      setError(nextError.message)
      setCommandFeedback({ target, status: 'failed', message: nextError.message })
    }
    refresh(true)
  }, [refresh, selected?.commandTarget])

  const { speechState, start, stop } = useSpeechCommand({ onResult: sendCommand })
  const frontActionText = needsSetup ? 'SET' : speechState === 'listening' ? 'REC' : 'HOLD'

  const moveSelection = useCallback((direction) => {
    setSelectedIndex((current) => {
      const count = Math.max(items.length, 1)
      return (current + direction + count) % count
    })
  }, [items.length])

  const pressAction = useCallback(() => {
    longPressFired.current = false
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true
      if (selectedTool?.status === 'setup') {
        startSetup()
        return
      }
      start()
    }, 650)
  }, [selectedTool?.status, start, startSetup])

  const releaseAction = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (longPressFired.current) {
      stop()
      return
    }
  }, [stop])

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
  }, [moveSelection, pressAction, refresh, releaseAction])

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
          <MiniMainframe selected={selected?.id === 'supervisor'} />
          <div className="pocket-route-line pocket-route-line-left" />
          <div className="pocket-route-line pocket-route-line-right" />
          {(status?.tools ?? []).map((tool, index) => (
            <PixelTool key={tool.id} tool={tool} index={index} selected={selected?.id === tool.id} />
          ))}
          <Facility type="permissions" selected={selected?.id === 'permissions'} label="PERMS" value={pendingCount ? `${pendingCount} WAIT` : 'CLEAR'} />
          <Facility type="assets" selected={selected?.id === 'assets'} label="ASSETS" value={String(assetCount)} />
        </div>

        <section className="pocket-detail">
          <div className="pocket-detail-title">
            <strong>{selected?.name ?? '主控'}</strong>
            <span>{speechState === 'idle' ? statusLabel(selectedTool?.status ?? activeTask?.status) : speechState.toUpperCase()}</span>
          </div>
          {error ? (
            <p className="pocket-detail-error">Bridge: {error}</p>
          ) : (
            <p>
              {pendingAction
                ? `${pendingAction.title}: ${pendingAction.detail}`
                : activeTask
                  ? `${activeTask.agentId}: ${activeTask.message}`
                  : selectedTool
                    ? `${selectedTool.detail} / ${needsSetup ? '长按大按钮设置' : selectedTool.usage?.value ?? 'usage N/A'}`
                    : readiness?.headline ?? '主控待命；长按大按钮语音下达指令。'}
            </p>
          )}
          {commandFeedback ? (
            <p className="pocket-command-feedback">
              {commandFeedback.status}: {commandFeedback.message}
            </p>
          ) : null}
          {lastCommand ? <p className="pocket-last-command">VOICE: {lastCommand}</p> : null}
        </section>

        <footer className="pocket-controls">
          <span>侧键: 选择</span>
          <span>{needsSetup ? 'HOLD: 设置' : 'HOLD: 说话'}</span>
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
