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

const PX = 6

function px(col, row, w = 1, h = 1, cls) {
  return <rect x={col * PX} y={row * PX} width={w * PX} height={h * PX} className={cls} />
}

/**
 * 像素风数字员工：整张图都在 6px 网格上用方块拼成（shape-rendering: crispEdges），
 * 状态动画（呼吸 / 打字 / 眨眼 / 举手 / 徽章）用 steps() 逐帧跳动，保持复古手感。
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
      <rect className="fig-ground" x="27" y="113" width="96" height="7" />

      {/* 人物（呼吸动画组） */}
      <g className="fig-person">
        {/* 左右手臂（打字时逐帧敲击） */}
        <g className="fig-arm fig-arm-left">
          {px(8, 11, 1, 3, 'fig-arm-sleeve')}
          {px(9, 14, 1, 1, 'fig-skin')}
        </g>
        <g className="fig-arm fig-arm-right">
          {px(16, 11, 1, 3, 'fig-arm-sleeve')}
          {px(15, 14, 1, 1, 'fig-skin')}
        </g>
        {/* 待确认时举起的手 */}
        <g className="fig-hand-raised">
          {px(16, 8, 1, 3, 'fig-arm-sleeve')}
          {px(16, 7, 1, 1, 'fig-skin')}
        </g>
        {/* 身体 + 领口 */}
        {px(9, 11, 7, 4, 'fig-body')}
        {px(11, 11, 3, 1, 'fig-collar')}
        {/* 头 */}
        <g className="fig-head-group">
          {px(11, 10, 3, 1, 'fig-skin')}
          {px(10, 3, 5, 1, 'fig-hair')}
          {px(9, 4, 7, 2, 'fig-hair')}
          {px(9, 6, 1, 1, 'fig-hair')}
          {px(15, 6, 1, 1, 'fig-hair')}
          {px(10, 6, 5, 1, 'fig-skin')}
          {px(9, 7, 7, 2, 'fig-skin')}
          {px(10, 9, 5, 1, 'fig-skin')}
          <g className="fig-eyes">
            {px(11, 7, 1, 1, 'fig-eye')}
            {px(13, 7, 1, 1, 'fig-eye')}
          </g>
          {px(10, 8, 1, 1, 'fig-blush')}
          {px(14, 8, 1, 1, 'fig-blush')}
          <rect className="fig-mouth" x="72" y="55" width="6" height="3" />
          {supervisor ? (
            <g className="fig-headset">
              <rect x="54" y="15" width="42" height="4" />
              <rect x="50" y="19" width="4" height="19" />
              <rect x="96" y="19" width="4" height="19" />
              <rect x="47" y="36" width="8" height="11" />
              <rect x="95" y="36" width="8" height="11" />
              <rect x="95" y="47" width="3" height="5" />
              <rect x="86" y="52" width="12" height="3" />
            </g>
          ) : null}
        </g>
      </g>

      {/* 桌面（人物前方，挡住下半身） */}
      <g className="fig-desk">
        <rect className="fig-desk-leg" x="30" y="99" width="6" height="15" />
        <rect className="fig-desk-leg" x="114" y="99" width="6" height="15" />
        <rect className="fig-desk-top" x="24" y="90" width="102" height="9" />
        <rect className="fig-desk-accent" x="24" y="90" width="102" height="3" />
        <rect className="fig-desk-edge" x="24" y="96" width="102" height="3" />
        {/* 笔记本（背面朝观众） */}
        <g className="fig-laptop">
          <rect className="fig-laptop-lid" x="63" y="69" width="24" height="21" />
          <rect className="fig-laptop-logo" x="72" y="76" width="6" height="6" />
        </g>
        {/* 屏幕工作光晕 */}
        <ellipse className="fig-screen-glow" cx="75" cy="72" rx="28" ry="15" />
        {/* 桌面小物：马克杯 + 小盆栽 */}
        <g className="fig-mug">
          <rect x="105" y="81" width="9" height="9" />
          <rect x="114" y="83" width="3" height="5" />
        </g>
        <g className="fig-plant">
          <rect className="fig-plant-leaf" x="36" y="71" width="3" height="12" />
          <rect className="fig-plant-leaf" x="33" y="74" width="3" height="3" />
          <rect className="fig-plant-leaf" x="39" y="77" width="3" height="3" />
          <rect className="fig-plant-pot" x="33" y="83" width="9" height="7" />
        </g>
      </g>

      {/* 工作中：上升的数据像素 */}
      <g className="fig-bits">
        <rect className="fig-bit fig-bit-1" x="63" y="57" width="6" height="6" />
        <rect className="fig-bit fig-bit-2" x="74" y="60" width="5" height="5" />
        <rect className="fig-bit fig-bit-3" x="85" y="56" width="6" height="6" />
      </g>

      {/* 状态徽章（像素方块 + 点阵图标） */}
      <g className="fig-badge fig-badge-done">
        <rect className="fig-badge-bg" x="102" y="26" width="22" height="22" />
        <g className="fig-badge-glyph">
          <rect x="105" y="35" width="3" height="3" />
          <rect x="108" y="38" width="3" height="3" />
          <rect x="111" y="35" width="3" height="3" />
          <rect x="114" y="32" width="3" height="3" />
          <rect x="117" y="29" width="3" height="3" />
        </g>
      </g>
      <g className="fig-badge fig-badge-waiting">
        <rect className="fig-badge-bg" x="102" y="26" width="22" height="22" />
        <g className="fig-badge-glyph">
          <rect x="109" y="28" width="9" height="3" />
          <rect x="106" y="31" width="3" height="3" />
          <rect x="118" y="31" width="3" height="3" />
          <rect x="118" y="34" width="3" height="3" />
          <rect x="115" y="37" width="3" height="3" />
          <rect x="112" y="40" width="3" height="3" />
          <rect x="112" y="45" width="3" height="3" />
        </g>
      </g>
      <g className="fig-badge fig-badge-failed">
        <rect className="fig-badge-bg" x="102" y="26" width="22" height="22" />
        <g className="fig-badge-glyph">
          <rect x="111" y="30" width="4" height="11" />
          <rect x="111" y="44" width="4" height="4" />
        </g>
      </g>

      {/* 主控雷达环（routing 时扩散的像素方框） */}
      {supervisor ? (
        <g className="fig-radar">
          <rect x="49" y="46" width="52" height="52" />
          <rect x="49" y="46" width="52" height="52" />
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
