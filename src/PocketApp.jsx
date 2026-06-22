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
        <PocketSprite id={tool.id} />
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
