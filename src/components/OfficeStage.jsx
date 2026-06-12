import { useEffect, useRef, useState } from 'react'

export const OFFICE_STAGE_WIDTH = 1200
export const OFFICE_STAGE_HEIGHT = 720

export function agentStatusText(agent) {
  if (agent.state === 'working') return '执行中'
  if (agent.state === 'waiting') return '待确认'
  if (agent.state === 'done') return '已完成'
  if (agent.state === 'failed') return '异常'
  if (agent.state === 'reserved') return '预留'
  return '就绪'
}

function stagePoint(agent) {
  return {
    x: (Number.parseFloat(agent.layout.x) / 100) * OFFICE_STAGE_WIDTH,
    y: (Number.parseFloat(agent.layout.y) / 100) * OFFICE_STAGE_HEIGHT,
  }
}

/**
 * 矢量数字员工：头、身体、手臂、桌面、显示器都是 SVG 元素，
 * 状态动画（呼吸 / 打字 / 眨眼 / 举手 / 完成徽章）由 CSS 驱动。
 */
function AgentCharacter({ agent }) {
  const supervisor = Boolean(agent.supervisor)
  return (
    <svg
      className={[
        'figure-svg',
        `figure-state-${agent.state}`,
        supervisor ? 'figure-supervisor' : '',
      ].filter(Boolean).join(' ')}
      viewBox="0 0 150 126"
      style={{
        '--accent': agent.accent,
        '--accent-dark': agent.darkAccent,
      }}
      role="img"
      aria-label={`${agent.name} · ${agentStatusText(agent)}`}
    >
      {/* 地面阴影 */}
      <ellipse className="fig-ground" cx="75" cy="118" rx="52" ry="6" />

      {/* 椅背 */}
      <rect className="fig-chair" x="59" y="56" width="32" height="34" rx="9" />

      {/* 人物（呼吸动画组） */}
      <g className="fig-person">
        {/* 左右手臂（打字动画） */}
        <g className="fig-arm fig-arm-left">
          <rect x="44" y="58" width="11" height="26" rx="5.5" />
        </g>
        <g className="fig-arm fig-arm-right">
          <rect x="95" y="58" width="11" height="26" rx="5.5" />
        </g>
        {/* 待确认时举起的手 */}
        <g className="fig-hand-raised">
          <rect x="100" y="34" width="10" height="26" rx="5" />
          <circle cx="105" cy="32" r="6" />
        </g>
        {/* 身体 */}
        <path
          className="fig-body"
          d="M 49 92 Q 49 56 75 56 Q 101 56 101 92 Z"
        />
        {/* 领口 */}
        <path className="fig-collar" d="M 67 57 Q 75 64 83 57 L 83 62 Q 75 69 67 62 Z" />
        {/* 头 */}
        <g className="fig-head-group">
          <circle className="fig-head" cx="75" cy="40" r="15" />
          <path
            className="fig-hair"
            d="M 60 38 Q 60 24 75 24 Q 90 24 90 38 Q 86 30 75 30 Q 64 30 60 38 Z"
          />
          {/* 眼睛（眨眼动画） */}
          <g className="fig-eyes">
            <circle className="fig-eye" cx="69.5" cy="41" r="1.9" />
            <circle className="fig-eye" cx="80.5" cy="41" r="1.9" />
          </g>
          {/* 嘴：常态微笑，failed 时变扁 */}
          <path className="fig-mouth" d="M 71 47 Q 75 50 79 47" />
          {supervisor ? (
            <g className="fig-headset">
              <path d="M 59 38 Q 59 22 75 22 Q 91 22 91 38" />
              <circle cx="59" cy="40" r="3.4" />
              <circle cx="91" cy="40" r="3.4" />
              <path d="M 91 44 Q 91 52 83 53" />
            </g>
          ) : null}
        </g>
      </g>

      {/* 桌面（人物前方，挡住下半身） */}
      <g className="fig-desk">
        <rect className="fig-desk-leg" x="32" y="96" width="7" height="20" rx="2" />
        <rect className="fig-desk-leg" x="111" y="96" width="7" height="20" rx="2" />
        <rect className="fig-desk-top" x="20" y="88" width="110" height="11" rx="4" />
        <rect className="fig-desk-accent" x="20" y="88" width="110" height="3.4" rx="1.7" />
        {/* 笔记本（背面朝观众） */}
        <g className="fig-laptop">
          <rect className="fig-laptop-lid" x="57" y="66" width="36" height="24" rx="3" />
          <circle className="fig-laptop-logo" cx="75" cy="78" r="3" />
          <rect className="fig-laptop-base" x="53" y="88" width="44" height="4" rx="2" />
        </g>
        {/* 屏幕工作光晕 */}
        <ellipse className="fig-screen-glow" cx="75" cy="70" rx="30" ry="16" />
        {/* 桌面小物：马克杯 + 绿植 */}
        <g className="fig-mug">
          <rect x="106" y="79" width="9" height="9" rx="1.6" />
          <path d="M 115 81 q 5 2 0 5" fill="none" />
        </g>
        <g className="fig-plant">
          <rect x="33" y="81" width="9" height="7" rx="1.6" />
          <path d="M 37.5 81 q -5 -7 -1 -10 q 3 4 1 10 Z" />
          <path d="M 37.5 81 q 5 -6 2 -10 q -4 3 -2 10 Z" />
        </g>
      </g>

      {/* 工作中：上升的数据粒子 */}
      <g className="fig-bits">
        <rect className="fig-bit fig-bit-1" x="63" y="58" width="4.6" height="4.6" rx="1.2" />
        <rect className="fig-bit fig-bit-2" x="74" y="60" width="3.8" height="3.8" rx="1" />
        <rect className="fig-bit fig-bit-3" x="84" y="57" width="4.2" height="4.2" rx="1.1" />
      </g>

      {/* 状态徽章 */}
      <g className="fig-badge fig-badge-done">
        <circle cx="113" cy="38" r="11" />
        <path d="M 107.5 38.4 L 111.5 42.4 L 119 34.4" />
      </g>
      <g className="fig-badge fig-badge-waiting">
        <circle cx="113" cy="38" r="11" />
        <text x="113" y="43" textAnchor="middle">?</text>
      </g>
      <g className="fig-badge fig-badge-failed">
        <circle cx="113" cy="38" r="11" />
        <text x="113" y="43" textAnchor="middle">!</text>
      </g>

      {/* 主控雷达环（routing 时扩散） */}
      {supervisor ? (
        <g className="fig-radar">
          <circle cx="75" cy="72" r="26" />
          <circle cx="75" cy="72" r="26" />
        </g>
      ) : null}
    </svg>
  )
}

export function AgentStation({ agent, selected, onSelect, stagger = 0 }) {
  const style = {
    '--agent-x': agent.layout.x,
    '--agent-y': agent.layout.y,
    '--agent-w': agent.layout.w,
    '--agent-h': agent.layout.h,
    '--agent-z': agent.layout.z,
    '--agent-accent': agent.accent,
    '--agent-dark-accent': agent.darkAccent,
    // 错开每个角色的呼吸/眨眼节奏，避免全场同步的机械感。
    '--agent-stagger': `${(stagger * 0.53) % 2.7}s`,
  }

  return (
    <button
      className={[
        'agent-station',
        agent.supervisor ? 'agent-station-main' : '',
        selected ? 'agent-station-selected' : '',
        `agent-station-${agent.state}`,
      ].filter(Boolean).join(' ')}
      style={style}
      onClick={() => onSelect(agent.id)}
      type="button"
    >
      <span className="agent-station-art">
        <AgentCharacter agent={agent} />
        <span className="agent-name-plate">
          <i className="agent-name-dot" aria-hidden="true" />
          {agent.name}
        </span>
        <span className="agent-status-chip">{agentStatusText(agent)}</span>
        <span className="agent-metric-tip">{agent.metric}</span>
      </span>
    </button>
  )
}

function linkEndpoints(main, agent) {
  const from = stagePoint(main)
  const to = stagePoint(agent)
  return {
    from: { x: from.x, y: from.y + 64 },
    to: { x: to.x, y: to.y - 62 },
  }
}

function curvePath(from, to) {
  const midY = (from.y + to.y) / 2
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`
}

export function AgentLinks({ agents, activeTask }) {
  const main = agents.find((agent) => agent.id === 'main')
  if (!main) return null

  const routeSource = agents.find((agent) => agent.id === activeTask?.currentRoute?.fromAgentId)
  const routeTarget = agents.find((agent) => agent.id === activeTask?.currentRoute?.toAgentId)
  let routePath = ''
  if (routeSource && routeTarget && routeSource.id !== routeTarget.id) {
    const fromPt = routeSource.id === 'main'
      ? { ...stagePoint(routeSource), y: stagePoint(routeSource).y + 64 }
      : { ...stagePoint(routeSource), y: stagePoint(routeSource).y - 62 }
    const toPt = routeTarget.id === 'main'
      ? { ...stagePoint(routeTarget), y: stagePoint(routeTarget).y + 64 }
      : { ...stagePoint(routeTarget), y: stagePoint(routeTarget).y - 62 }
    routePath = curvePath(fromPt, toPt)
  }

  return (
    <svg
      className="agent-link-layer"
      viewBox={`0 0 ${OFFICE_STAGE_WIDTH} ${OFFICE_STAGE_HEIGHT}`}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="agent-route-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="5.4"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 7 3.5 L 0 7 z" className="agent-route-arrow" />
        </marker>
        <filter id="link-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {agents.filter((agent) => agent.id !== 'main').map((agent, index) => {
        const { from, to } = linkEndpoints(main, agent)
        const path = curvePath(from, to)
        const active = agent.state === 'working' || agent.state === 'waiting'
        const completed = agent.state === 'done'
        const offset = (index * 0.45) % 2
        return (
          <g
            key={agent.id}
            className={[
              'agent-link',
              active ? 'agent-link-active' : '',
              completed ? 'agent-link-done' : '',
              `agent-link-${agent.state}`,
            ].filter(Boolean).join(' ')}
            style={{ '--link-accent': agent.accent }}
          >
            <path className="agent-link-base" d={path} />
            <path className="agent-link-flow" d={path} style={{ animationDelay: `${-offset}s` }} />
            {active ? (
              <>
                <circle className="agent-link-particle" r="4">
                  <animateMotion dur="2s" begin={`${offset}s`} repeatCount="indefinite" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.6 1" />
                </circle>
                <circle className="agent-link-particle agent-link-particle-soft" r="2.6">
                  <animateMotion dur="2s" begin={`${offset + 0.7}s`} repeatCount="indefinite" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.6 1" />
                </circle>
              </>
            ) : null}
          </g>
        )
      })}

      {routePath ? (
        <g className="agent-route">
          <path
            className="agent-route-path"
            d={routePath}
            markerEnd="url(#agent-route-arrow)"
            filter="url(#link-glow)"
          />
          <circle r="5" className="agent-route-pulse">
            <animateMotion dur="1.6s" repeatCount="indefinite" path={routePath} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.6 1" />
          </circle>
          <circle r="3" className="agent-route-pulse agent-route-pulse-tail">
            <animateMotion dur="1.6s" begin="0.45s" repeatCount="indefinite" path={routePath} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.6 1" />
          </circle>
        </g>
      ) : null}
    </svg>
  )
}

export function WorkspaceStatusBoard({ agents, activeTask, pendingAction }) {
  const activeAgents = agents.filter((agent) => agent.state === 'working' || agent.state === 'waiting')
  const boardMode = pendingAction ? 'waiting' : activeTask ? 'running' : 'idle'
  return (
    <div className={`workspace-status-board workspace-status-board-${boardMode}`} aria-label="工作区状态">
      <span className="board-mount board-mount-left" aria-hidden="true" />
      <span className="board-mount board-mount-right" aria-hidden="true" />
      <div className="board-screen-glow" aria-hidden="true" />
      <div className="board-topline">
        <span className="board-live-dot" />
        <span>{pendingAction ? 'WAITING APPROVAL' : activeTask ? 'LIVE TASK FLOW' : 'STANDBY'}</span>
        <span className="board-clock">OS AGENT OPS</span>
      </div>
      <strong>{activeTask?.title ?? '等待主控接收任务'}</strong>
      {activeAgents.length ? (
        <div className="board-agent-strip">
          {activeAgents.map((agent) => (
            <em key={agent.id}>{agent.name} · {agentStatusText(agent)}</em>
          ))}
        </div>
      ) : null}
      <div className="board-equalizer" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>
    </div>
  )
}

export function AgentWorkspace({ agents, selectedId, onSelect, activeTask, pendingAction }) {
  const viewportRef = useRef(null)
  const [stageScale, setStageScale] = useState(1)

  useEffect(() => {
    const updateScale = () => {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect?.width || !rect?.height) return
      const availableHeight = Math.max(0, rect.height - 76)
      setStageScale(Math.min(rect.width / OFFICE_STAGE_WIDTH, availableHeight / OFFICE_STAGE_HEIGHT))
    }

    updateScale()
    const observer = new ResizeObserver(updateScale)
    if (viewportRef.current) observer.observe(viewportRef.current)
    window.addEventListener('resize', updateScale)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateScale)
    }
  }, [])

  return (
    <div className="agent-office-panel">
      <div className="agent-office-viewport" ref={viewportRef}>
        <div
          className="agent-office-frame"
          style={{
            width: OFFICE_STAGE_WIDTH * stageScale,
            height: OFFICE_STAGE_HEIGHT * stageScale,
          }}
        >
          <div
            className={[
              'agent-office-stage',
              activeTask || pendingAction ? 'agent-office-stage-active' : '',
            ].filter(Boolean).join(' ')}
            style={{
              width: OFFICE_STAGE_WIDTH,
              height: OFFICE_STAGE_HEIGHT,
              transform: `scale(${stageScale})`,
            }}
          >
            <div className="agent-office-title">OS Agent Workspace</div>
            <WorkspaceStatusBoard agents={agents} activeTask={activeTask} pendingAction={pendingAction} />
            <AgentLinks agents={agents} activeTask={activeTask} />
            <div className="office-wall-light office-wall-light-left" aria-hidden="true" />
            <div className="office-wall-light office-wall-light-right" aria-hidden="true" />
            <div className="office-command-rug" aria-hidden="true" />
            <div className="office-main-halo" aria-hidden="true" />
            <div className="agent-office-grid" aria-hidden="true" />
            {agents.map((agent, index) => (
              <AgentStation
                key={agent.id}
                agent={agent}
                selected={agent.id === selectedId}
                onSelect={onSelect}
                stagger={index}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
