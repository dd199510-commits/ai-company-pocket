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

/** 角色脚底的地面锚点（舞台像素坐标），行走小人以此为基准。 */
function personAnchor(agent) {
  const point = stagePoint(agent)
  const stationHeight = (Number.parseFloat(agent.layout.h) / 100) * OFFICE_STAGE_HEIGHT
  return { x: point.x, y: point.y + stationHeight / 2 - 4 }
}

const WALK_SPEED = 72 // px/s，正常步行
const RECALL_SPEED_MULTIPLIER = 2.8 // 被派活时快步赶回
const VISIT_FRONT_OFFSET_Y = 46 // 拜访同事时站在工位前方，避免盖住对方角色。

const PX = 6
const DESKTOP_AGENT_PERSONAS = {
  CLAUDE: 'claude-desktop',
  CODEX: 'codex-pet',
  PENGUIN: 'penguin',
  XIAODU: 'xiaodu-robot',
  RED_ORB: 'red-orb',
}

function px(col, row, w = 1, h = 1, cls) {
  return <rect x={col * PX} y={row * PX} width={w * PX} height={h * PX} className={cls} />
}

function isClaudeDesktopAgent(agent) {
  return agent.persona === DESKTOP_AGENT_PERSONAS.CLAUDE
}

function isCodexPetAgent(agent) {
  return agent.persona === DESKTOP_AGENT_PERSONAS.CODEX
}

function isPenguinAgent(agent) {
  return agent.persona === DESKTOP_AGENT_PERSONAS.PENGUIN
}

function isXiaoduRobotAgent(agent) {
  return agent.persona === DESKTOP_AGENT_PERSONAS.XIAODU
}

function isRedOrbAgent(agent) {
  return agent.persona === DESKTOP_AGENT_PERSONAS.RED_ORB
}

function StatusBadges() {
  return (
    <>
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
    </>
  )
}

function ClaudeDesktopCharacter({ agent }) {
  return (
    <svg
      className={[
        'figure-svg',
        'figure-persona-claude',
        `figure-state-${agent.state}`,
      ].join(' ')}
      viewBox="0 0 150 126"
      style={{
        '--accent': agent.accent,
        '--accent-dark': agent.darkAccent,
      }}
      role="img"
      aria-label={`${agent.name} · ${agentStatusText(agent)}`}
    >
      <rect className="fig-ground" x="24" y="113" width="102" height="7" />

      <g className="claude-window" aria-hidden="true">
        <rect className="claude-window-shadow" x="29" y="17" width="92" height="72" />
        <rect className="claude-window-panel" x="25" y="13" width="92" height="72" />
        <rect className="claude-window-bar" x="25" y="13" width="92" height="11" />
        <rect className="claude-window-dot" x="31" y="17" width="4" height="4" />
        <rect className="claude-window-dot" x="39" y="17" width="4" height="4" />
        <rect className="claude-window-dot" x="47" y="17" width="4" height="4" />
        <g className="claude-terminal-lines">
          <rect x="36" y="34" width="42" height="4" />
          <rect x="36" y="44" width="56" height="4" />
          <rect x="36" y="54" width="33" height="4" />
          <rect className="claude-terminal-cursor" x="73" y="54" width="5" height="4" />
        </g>
      </g>

      <g className="claude-agent-core">
        <g className="claude-agent-body">
          <rect className="claude-arm claude-arm-left" x="20" y="56" width="22" height="17" />
          <rect className="claude-arm claude-arm-right" x="108" y="56" width="22" height="17" />
          <rect className="claude-torso" x="42" y="35" width="66" height="60" />
          <rect className="claude-leg claude-leg-1" x="42" y="95" width="12" height="22" />
          <rect className="claude-leg claude-leg-2" x="61" y="95" width="12" height="22" />
          <rect className="claude-leg claude-leg-3" x="86" y="95" width="12" height="22" />
          <rect className="claude-leg claude-leg-4" x="105" y="95" width="12" height="22" />
          <rect className="claude-eye claude-eye-left" x="58" y="48" width="10" height="10" />
          <rect className="claude-eye claude-eye-right" x="90" y="48" width="10" height="10" />
        </g>
        <g className="claude-thought-pixels">
          <rect className="claude-thought claude-thought-1" x="64" y="24" width="7" height="7" />
          <rect className="claude-thought claude-thought-2" x="78" y="21" width="5" height="5" />
          <rect className="claude-thought claude-thought-3" x="91" y="25" width="6" height="6" />
        </g>
      </g>

      <g className="claude-work-pixels">
        <rect className="claude-work-pixel claude-work-pixel-1" x="43" y="31" width="5" height="5" />
        <rect className="claude-work-pixel claude-work-pixel-2" x="111" y="43" width="6" height="6" />
        <rect className="claude-work-pixel claude-work-pixel-3" x="31" y="82" width="5" height="5" />
      </g>

      <StatusBadges />
    </svg>
  )
}

function CodexPetCharacter({ agent }) {
  return (
    <svg
      className={[
        'figure-svg',
        'figure-persona-codex',
        `figure-state-${agent.state}`,
      ].join(' ')}
      viewBox="0 0 150 126"
      style={{
        '--accent': agent.accent,
        '--accent-dark': agent.darkAccent,
      }}
      role="img"
      aria-label={`${agent.name} · ${agentStatusText(agent)}`}
    >
      <rect className="fig-ground" x="27" y="113" width="96" height="7" />

      <g className="codex-terminal-card" aria-hidden="true">
        <rect className="codex-terminal-shadow" x="30" y="74" width="90" height="27" />
        <rect className="codex-terminal-panel" x="27" y="70" width="90" height="27" />
        <rect className="codex-terminal-line codex-terminal-line-1" x="39" y="79" width="34" height="4" />
        <rect className="codex-terminal-line codex-terminal-line-2" x="39" y="88" width="52" height="4" />
        <rect className="codex-terminal-cursor" x="96" y="88" width="8" height="4" />
      </g>

      <g className="codex-pet-core">
        <g className="codex-pet-head">
          <circle className="codex-cloud codex-cloud-1" cx="50" cy="37" r="18" />
          <circle className="codex-cloud codex-cloud-2" cx="68" cy="27" r="20" />
          <circle className="codex-cloud codex-cloud-3" cx="91" cy="33" r="18" />
          <circle className="codex-cloud codex-cloud-4" cx="101" cy="51" r="17" />
          <circle className="codex-cloud codex-cloud-5" cx="49" cy="55" r="17" />
          <rect className="codex-cloud codex-cloud-body" x="43" y="31" width="66" height="42" rx="18" />
          <rect className="codex-face-screen" x="52" y="41" width="52" height="25" rx="7" />
          <path className="codex-face-prompt" d="M 62 47 L 70 53 L 62 59" />
          <rect className="codex-face-cursor" x="83" y="53" width="13" height="4" />
        </g>

        <rect className="codex-arm codex-arm-left" x="37" y="77" width="13" height="23" rx="6" />
        <rect className="codex-arm codex-arm-right" x="100" y="77" width="13" height="23" rx="6" />
        <rect className="codex-body" x="51" y="73" width="48" height="34" rx="10" />
        <rect className="codex-body-highlight" x="64" y="83" width="24" height="5" rx="2" />
        <path className="codex-body-prompt" d="M 60 84 L 66 88 L 60 92" />
        <rect className="codex-leg codex-leg-left" x="57" y="104" width="14" height="13" rx="3" />
        <rect className="codex-leg codex-leg-right" x="82" y="104" width="14" height="13" rx="3" />
      </g>

      <g className="codex-orbit-pixels">
        <rect className="codex-orbit codex-orbit-1" x="41" y="22" width="6" height="6" />
        <rect className="codex-orbit codex-orbit-2" x="106" y="28" width="5" height="5" />
        <rect className="codex-orbit codex-orbit-3" x="111" y="68" width="6" height="6" />
      </g>

      <StatusBadges />
    </svg>
  )
}

function PenguinCharacter({ agent }) {
  return (
    <svg
      className={[
        'figure-svg',
        'figure-persona-penguin',
        `figure-state-${agent.state}`,
      ].join(' ')}
      viewBox="0 0 150 126"
      style={{
        '--accent': agent.accent,
        '--accent-dark': agent.darkAccent,
      }}
      role="img"
      aria-label={`${agent.name} · ${agentStatusText(agent)}`}
    >
      <rect className="fig-ground" x="48" y="118" width="54" height="5" />

      {/* 像素企鹅（站立版）：方块网格，脚落在最底部 */}
      <g className="pg-core">
        {/* 头 黑 */}
        {px(9, 2, 7, 1, 'pg-blk')}
        {px(8, 3, 9, 1, 'pg-blk')}
        {px(7, 4, 11, 1, 'pg-blk')}
        {px(7, 5, 2, 4, 'pg-blk')}
        {px(16, 5, 2, 4, 'pg-blk')}
        {px(9, 5, 7, 4, 'pg-wht')}
        {px(7, 9, 11, 1, 'pg-blk')}
        {/* 眼 */}
        <g className="pg-eyes">
          {px(10, 6, 1, 2, 'pg-eye')}
          {px(14, 6, 1, 2, 'pg-eye')}
        </g>
        {/* 喙 橙 */}
        {px(11, 7, 3, 2, 'pg-org')}
        {/* 身体 黑 + 肚 白 */}
        {px(6, 10, 13, 7, 'pg-blk')}
        {px(7, 17, 11, 1, 'pg-blk')}
        {px(9, 11, 7, 6, 'pg-wht')}
        {/* 鳍 黑 */}
        <g className="pg-flipper pg-flipper-l">{px(5, 11, 1, 4, 'pg-blk')}</g>
        <g className="pg-flipper pg-flipper-r">{px(19, 11, 1, 4, 'pg-blk')}</g>
        {/* 围巾 红 + 飘带 */}
        {px(7, 9, 11, 1, 'pg-scarf')}
        {px(6, 10, 13, 1, 'pg-scarf')}
        {px(7, 11, 2, 5, 'pg-scarf')}
        {/* 脚 橙 */}
        <g className="pg-foot pg-foot-l">{px(8, 18, 3, 2, 'pg-org')}</g>
        <g className="pg-foot pg-foot-r">{px(14, 18, 3, 2, 'pg-org')}</g>
      </g>

      <g className="penguin-bubbles" aria-hidden="true">
        <g className="penguin-bubble penguin-bubble-code">
          <circle cx="39" cy="23" r="13" />
          <text x="39" y="28">{'{ }'}</text>
        </g>
        <g className="penguin-bubble penguin-bubble-heart">
          <circle cx="112" cy="24" r="12" />
          <path d="M 106 22 C 106 18 112 18 112 22 C 112 18 119 18 119 23 C 119 28 112 32 112 32 C 112 32 106 28 106 22 Z" />
        </g>
        <g className="penguin-bubble penguin-bubble-star">
          <circle cx="124" cy="62" r="11" />
          <path d="M 124 53 L 127 60 L 134 60 L 128 64 L 130 71 L 124 67 L 118 71 L 120 64 L 114 60 L 121 60 Z" />
        </g>
      </g>

      <StatusBadges />
    </svg>
  )
}

function XiaoduRobotCharacter({ agent }) {
  return (
    <svg
      className={[
        'figure-svg',
        'figure-persona-xiaodu',
        `figure-state-${agent.state}`,
      ].join(' ')}
      viewBox="0 0 150 126"
      style={{
        '--accent': agent.accent,
        '--accent-dark': agent.darkAccent,
      }}
      role="img"
      aria-label={`${agent.name} · ${agentStatusText(agent)}`}
    >
      <ellipse className="xiaodu-base-glow" cx="75" cy="116" rx="43" ry="8" />
      <rect className="fig-ground" x="35" y="115" width="80" height="6" />

      <g className="xiaodu-schedule-card" aria-hidden="true">
        <rect className="xiaodu-card-shadow" x="26" y="57" width="31" height="37" />
        <rect className="xiaodu-card-panel" x="23" y="54" width="31" height="37" />
        <rect className="xiaodu-card-line xiaodu-card-line-1" x="30" y="64" width="16" height="3" />
        <rect className="xiaodu-card-line xiaodu-card-line-2" x="30" y="73" width="12" height="3" />
        <rect className="xiaodu-card-dot" x="44" y="72" width="4" height="4" />
      </g>

      <g className="xiaodu-core">
        <g className="xiaodu-head">
          <rect className="xiaodu-head-shell" x="44" y="14" width="72" height="46" rx="18" />
          <rect className="xiaodu-head-screen" x="51" y="21" width="58" height="31" rx="9" />
          <rect className="xiaodu-face-bar" x="65" y="30" width="6" height="18" rx="1" />
          <path className="xiaodu-face-chevron" d="M 91 29 L 80 37 L 91 45" />
          <rect className="xiaodu-head-neck" x="62" y="58" width="31" height="8" />
        </g>
        <path className="xiaodu-body" d="M 52 64 L 99 64 L 108 105 Q 75 119 43 105 Z" />
        <rect className="xiaodu-chest-screen" x="61" y="70" width="31" height="17" rx="3" />
        <rect className="xiaodu-chest-dot xiaodu-chest-dot-1" x="68" y="77" width="3" height="3" />
        <rect className="xiaodu-chest-dot xiaodu-chest-dot-2" x="76" y="77" width="3" height="3" />
        <rect className="xiaodu-chest-dot xiaodu-chest-dot-3" x="84" y="77" width="3" height="3" />
        <text className="xiaodu-body-mark" x="75" y="100">du</text>
        <path className="xiaodu-arm xiaodu-arm-left" d="M 48 66 L 37 85 L 40 102 L 48 99 L 52 79 Z" />
        <path className="xiaodu-arm xiaodu-arm-right" d="M 101 66 L 113 85 L 109 102 L 101 99 L 97 79 Z" />
        <rect className="xiaodu-foot xiaodu-foot-left" x="54" y="107" width="21" height="7" rx="3" />
        <rect className="xiaodu-foot xiaodu-foot-right" x="76" y="107" width="21" height="7" rx="3" />
      </g>

      <g className="xiaodu-signal-pixels" aria-hidden="true">
        <rect className="xiaodu-signal xiaodu-signal-1" x="111" y="29" width="5" height="5" />
        <rect className="xiaodu-signal xiaodu-signal-2" x="119" y="23" width="4" height="4" />
        <rect className="xiaodu-signal xiaodu-signal-3" x="123" y="35" width="5" height="5" />
      </g>

      <StatusBadges />
    </svg>
  )
}

function RedOrbCharacter({ agent }) {
  return (
    <svg
      className={[
        'figure-svg',
        'figure-persona-redorb',
        `figure-state-${agent.state}`,
      ].join(' ')}
      viewBox="0 0 150 126"
      style={{
        '--accent': agent.accent,
        '--accent-dark': agent.darkAccent,
      }}
      role="img"
      aria-label={`${agent.name} · ${agentStatusText(agent)}`}
    >
      <ellipse className="redorb-glow" cx="76" cy="113" rx="45" ry="10" />
      <rect className="fig-ground" x="34" y="115" width="84" height="6" />

      <g className="redorb-app-panel" aria-hidden="true">
        <rect className="redorb-panel-shadow" x="29" y="64" width="33" height="33" />
        <rect className="redorb-panel" x="26" y="61" width="33" height="33" />
        <rect className="redorb-app-dot redorb-app-dot-1" x="34" y="69" width="7" height="7" rx="2" />
        <rect className="redorb-app-dot redorb-app-dot-2" x="46" y="69" width="7" height="7" rx="2" />
        <rect className="redorb-app-dot redorb-app-dot-3" x="34" y="81" width="7" height="7" rx="2" />
        <rect className="redorb-app-dot redorb-app-dot-4" x="46" y="81" width="7" height="7" rx="2" />
      </g>

      <g className="redorb-core">
        <path className="redorb-antenna redorb-antenna-left" d="M 58 24 C 54 14 48 13 44 16" />
        <path className="redorb-antenna redorb-antenna-right" d="M 94 24 C 99 14 105 13 109 16" />
        <circle className="redorb-body" cx="76" cy="65" r="43" />
        <circle className="redorb-cheek redorb-cheek-left" cx="38" cy="61" r="13" />
        <circle className="redorb-cheek redorb-cheek-right" cx="114" cy="61" r="13" />
        <circle className="redorb-eye redorb-eye-left" cx="63" cy="52" r="6" />
        <circle className="redorb-eye redorb-eye-right" cx="90" cy="52" r="6" />
        <circle className="redorb-eye-light redorb-eye-light-left" cx="61" cy="50" r="2" />
        <circle className="redorb-eye-light redorb-eye-light-right" cx="88" cy="50" r="2" />
        <rect className="redorb-foot redorb-foot-left" x="62" y="104" width="11" height="15" rx="2" />
        <rect className="redorb-foot redorb-foot-right" x="80" y="104" width="11" height="15" rx="2" />
      </g>

      <g className="redorb-sparks" aria-hidden="true">
        <rect className="redorb-spark redorb-spark-1" x="42" y="30" width="5" height="5" />
        <rect className="redorb-spark redorb-spark-2" x="109" y="34" width="4" height="4" />
        <rect className="redorb-spark redorb-spark-3" x="119" y="76" width="5" height="5" />
      </g>

      <StatusBadges />
    </svg>
  )
}

/**
 * 像素风数字员工：整张图都在 6px 网格上用方块拼成（shape-rendering: crispEdges），
 * 状态动画（呼吸 / 打字 / 眨眼 / 举手 / 徽章）用 steps() 逐帧跳动，保持复古手感。
 */
function AgentCharacter({ agent }) {
  const supervisor = Boolean(agent.supervisor)
  if (isClaudeDesktopAgent(agent)) return <ClaudeDesktopCharacter agent={agent} />
  if (isCodexPetAgent(agent)) return <CodexPetCharacter agent={agent} />
  if (isPenguinAgent(agent)) return <PenguinCharacter agent={agent} />
  if (isXiaoduRobotAgent(agent)) return <XiaoduRobotCharacter agent={agent} />
  if (isRedOrbAgent(agent)) return <RedOrbCharacter agent={agent} />

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
      <StatusBadges />

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

function ClaudeWalkerSprite() {
  return (
    <svg className="walker-svg walker-persona-claude" viewBox="0 0 90 102" aria-hidden="true">
      <rect className="claude-walker-arm claude-walker-arm-l" x="12" y="38" width="18" height="14" />
      <rect className="claude-walker-arm claude-walker-arm-r" x="60" y="38" width="18" height="14" />
      <rect className="claude-walker-body" x="27" y="20" width="36" height="46" />
      <rect className="claude-walker-eye" x="37" y="31" width="7" height="7" />
      <rect className="claude-walker-eye" x="51" y="31" width="7" height="7" />
      <g className="claude-walker-leg-l">
        <rect className="claude-walker-leg" x="29" y="66" width="9" height="20" />
        <rect className="claude-walker-leg" x="41" y="66" width="8" height="20" />
      </g>
      <g className="claude-walker-leg-r">
        <rect className="claude-walker-leg" x="52" y="66" width="8" height="20" />
        <rect className="claude-walker-leg" x="62" y="66" width="9" height="20" />
      </g>
      <rect className="claude-walker-cursor" x="36" y="7" width="6" height="6" />
      <rect className="claude-walker-cursor claude-walker-cursor-2" x="49" y="11" width="5" height="5" />
    </svg>
  )
}

function CodexWalkerSprite() {
  return (
    <svg className="walker-svg walker-persona-codex" viewBox="0 0 90 102" aria-hidden="true">
      <g className="codex-walker-core">
        <circle className="codex-walker-cloud codex-walker-cloud-1" cx="30" cy="24" r="12" />
        <circle className="codex-walker-cloud codex-walker-cloud-2" cx="43" cy="17" r="14" />
        <circle className="codex-walker-cloud codex-walker-cloud-3" cx="58" cy="24" r="12" />
        <circle className="codex-walker-cloud codex-walker-cloud-4" cx="60" cy="38" r="12" />
        <circle className="codex-walker-cloud codex-walker-cloud-5" cx="28" cy="38" r="12" />
        <rect className="codex-walker-cloud codex-walker-cloud-body" x="26" y="22" width="38" height="29" rx="12" />
        <rect className="codex-walker-face" x="32" y="29" width="28" height="15" rx="4" />
        <path className="codex-walker-prompt" d="M 37 33 L 42 36.5 L 37 40" />
        <rect className="codex-walker-cursor" x="49" y="37" width="7" height="3" />
        <rect className="codex-walker-arm codex-walker-arm-l" x="21" y="54" width="9" height="18" rx="4" />
        <rect className="codex-walker-arm codex-walker-arm-r" x="60" y="54" width="9" height="18" rx="4" />
        <rect className="codex-walker-body" x="32" y="51" width="29" height="25" rx="8" />
        <rect className="codex-walker-body-mark" x="42" y="59" width="9" height="4" rx="2" />
        <g className="codex-walker-leg-l">
          <rect className="codex-walker-leg" x="36" y="74" width="8" height="13" rx="2" />
        </g>
        <g className="codex-walker-leg-r">
          <rect className="codex-walker-leg" x="50" y="74" width="8" height="13" rx="2" />
        </g>
      </g>
    </svg>
  )
}

function PenguinWalkerSprite() {
  return (
    <svg className="walker-svg walker-persona-penguin" viewBox="0 0 90 102" aria-hidden="true">
      {/* 像素企鹅（走动版）：脚画在 viewBox 最底部，天然贴地不悬空 */}
      <g className="pg-walk-core">
        {/* 头 黑 + 脸 白 */}
        {px(5, 1, 5, 1, 'pg-blk')}
        {px(4, 2, 7, 1, 'pg-blk')}
        {px(4, 3, 7, 1, 'pg-blk')}
        {px(4, 4, 1, 3, 'pg-blk')}
        {px(10, 4, 1, 3, 'pg-blk')}
        {px(5, 4, 5, 3, 'pg-wht')}
        {px(4, 7, 7, 1, 'pg-blk')}
        {/* 眼 */}
        <g className="pg-eyes">
          {px(6, 5, 1, 1, 'pg-eye')}
          {px(8, 5, 1, 1, 'pg-eye')}
        </g>
        {/* 喙 橙 */}
        {px(6, 6, 3, 1, 'pg-org')}
        {/* 身体 黑 + 肚 白 */}
        {px(3, 9, 9, 6, 'pg-blk')}
        {px(4, 15, 7, 1, 'pg-blk')}
        {px(5, 10, 5, 5, 'pg-wht')}
        {/* 鳍 黑 */}
        <g className="pg-flipper pg-flipper-l">{px(2, 10, 1, 3, 'pg-blk')}</g>
        <g className="pg-flipper pg-flipper-r">{px(12, 10, 1, 3, 'pg-blk')}</g>
        {/* 围巾 红 + 飘带 */}
        {px(4, 7, 7, 2, 'pg-scarf')}
        {px(5, 9, 2, 2, 'pg-scarf')}
        {/* 脚 橙（底部） */}
        <g className="pg-foot pg-foot-l">{px(4, 16, 3, 1, 'pg-org')}</g>
        <g className="pg-foot pg-foot-r">{px(8, 16, 3, 1, 'pg-org')}</g>
      </g>
    </svg>
  )
}

function XiaoduWalkerSprite() {
  return (
    <svg className="walker-svg walker-persona-xiaodu" viewBox="0 0 90 102" aria-hidden="true">
      <ellipse className="xiaodu-walker-base-glow" cx="45" cy="90" rx="25" ry="5" />
      <g className="xiaodu-walker-core">
        <rect className="xiaodu-walker-head-shell" x="22" y="8" width="46" height="31" rx="12" />
        <rect className="xiaodu-walker-head-screen" x="27" y="13" width="36" height="20" rx="6" />
        <rect className="xiaodu-walker-face-bar" x="36" y="19" width="4" height="11" rx="1" />
        <path className="xiaodu-walker-face-chevron" d="M 53 18 L 46 23 L 53 29" />
        <rect className="xiaodu-walker-neck" x="35" y="38" width="19" height="6" />
        <path className="xiaodu-walker-body" d="M 30 43 L 59 43 L 65 75 Q 45 84 25 75 Z" />
        <rect className="xiaodu-walker-chest" x="37" y="49" width="18" height="11" rx="2" />
        <rect className="xiaodu-walker-chest-dot" x="44" y="54" width="3" height="3" />
        <path className="xiaodu-walker-arm xiaodu-walker-arm-l" d="M 29 45 L 20 59 L 23 73 L 30 68 Z" />
        <path className="xiaodu-walker-arm xiaodu-walker-arm-r" d="M 60 45 L 70 59 L 67 73 L 60 68 Z" />
        <rect className="xiaodu-walker-foot xiaodu-walker-foot-l" x="33" y="76" width="13" height="6" rx="3" />
        <rect className="xiaodu-walker-foot xiaodu-walker-foot-r" x="47" y="76" width="13" height="6" rx="3" />
      </g>
    </svg>
  )
}

function RedOrbWalkerSprite() {
  return (
    <svg className="walker-svg walker-persona-redorb" viewBox="0 0 90 102" aria-hidden="true">
      <ellipse className="redorb-walker-glow" cx="45" cy="88" rx="26" ry="6" />
      <g className="redorb-walker-core">
        <path className="redorb-walker-antenna redorb-walker-antenna-left" d="M 34 21 C 31 14 27 13 24 16" />
        <path className="redorb-walker-antenna redorb-walker-antenna-right" d="M 56 21 C 60 14 64 13 67 16" />
        <circle className="redorb-walker-body" cx="45" cy="52" r="28" />
        <circle className="redorb-walker-cheek redorb-walker-cheek-left" cx="19" cy="50" r="8" />
        <circle className="redorb-walker-cheek redorb-walker-cheek-right" cx="71" cy="50" r="8" />
        <circle className="redorb-walker-eye" cx="37" cy="44" r="4" />
        <circle className="redorb-walker-eye" cx="54" cy="44" r="4" />
        <circle className="redorb-walker-eye-light" cx="36" cy="43" r="1.5" />
        <circle className="redorb-walker-eye-light" cx="53" cy="43" r="1.5" />
        <rect className="redorb-walker-foot redorb-walker-foot-l" x="36" y="76" width="8" height="11" rx="2" />
        <rect className="redorb-walker-foot redorb-walker-foot-r" x="48" y="76" width="8" height="11" rx="2" />
      </g>
    </svg>
  )
}

/** 全身像素小人（带腿），用于在工区内走动。配色沿用工位调色板类名。 */
function WalkerSprite({ agent }) {
  if (isClaudeDesktopAgent(agent)) return <ClaudeWalkerSprite />
  if (isCodexPetAgent(agent)) return <CodexWalkerSprite />
  if (isPenguinAgent(agent)) return <PenguinWalkerSprite />
  if (isXiaoduRobotAgent(agent)) return <XiaoduWalkerSprite />
  if (isRedOrbAgent(agent)) return <RedOrbWalkerSprite />

  return (
    <svg className="walker-svg" viewBox="0 0 90 102" aria-hidden="true">
      {px(5, 0, 5, 1, 'fig-hair')}
      {px(4, 1, 7, 2, 'fig-hair')}
      {px(4, 3, 1, 1, 'fig-hair')}
      {px(10, 3, 1, 1, 'fig-hair')}
      {px(5, 3, 5, 1, 'fig-skin')}
      {px(4, 4, 7, 2, 'fig-skin')}
      {px(5, 6, 5, 1, 'fig-skin')}
      {px(6, 4, 1, 1, 'fig-eye-static')}
      {px(8, 4, 1, 1, 'fig-eye-static')}
      {px(5, 5, 1, 1, 'fig-blush')}
      {px(9, 5, 1, 1, 'fig-blush')}
      <rect className="fig-mouth" x="42" y="37" width="6" height="3" />
      {px(6, 7, 3, 1, 'fig-skin')}
      <g className="walker-arm-l">
        {px(3, 8, 1, 3, 'fig-arm-sleeve')}
        {px(3, 11, 1, 1, 'fig-skin')}
      </g>
      <g className="walker-arm-r">
        {px(11, 8, 1, 3, 'fig-arm-sleeve')}
        {px(11, 11, 1, 1, 'fig-skin')}
      </g>
      {px(4, 8, 7, 3, 'fig-body')}
      {px(6, 8, 3, 1, 'fig-collar')}
      <g className="walker-leg-l">
        {px(5, 11, 2, 2, 'fig-pants')}
        {px(4, 13, 3, 1, 'fig-shoe')}
      </g>
      <g className="walker-leg-r">
        {px(8, 11, 2, 2, 'fig-pants')}
        {px(8, 13, 3, 1, 'fig-shoe')}
      </g>
    </svg>
  )
}

function BubbleIcon({ kind }) {
  if (kind === 'drink') {
    return (
      <svg viewBox="0 0 12 12" className="bubble-icon">
        <rect x="3" y="2" width="6" height="8" fill="#3b82f6" />
        <rect x="4" y="3" width="2" height="3" fill="#bfdbfe" />
      </svg>
    )
  }
  if (kind === 'coffee') {
    return (
      <svg viewBox="0 0 12 12" className="bubble-icon">
        <rect x="2" y="5" width="7" height="5" fill="#92400e" />
        <rect x="9" y="6" width="2" height="2" fill="#92400e" />
        <rect x="3" y="2" width="2" height="2" fill="#cbd5e1" />
        <rect x="6" y="1" width="2" height="2" fill="#cbd5e1" />
      </svg>
    )
  }
  if (kind === 'snack') {
    return (
      <svg viewBox="0 0 12 12" className="bubble-icon">
        <rect x="2" y="2" width="8" height="8" fill="#f59e0b" />
        <rect x="4" y="4" width="2" height="2" fill="#7c2d12" />
        <rect x="7" y="6" width="2" height="2" fill="#7c2d12" />
      </svg>
    )
  }
  return null
}

function PixelBubble({ className = '', kind = 'dots' }) {
  return (
    <span className={`pixel-bubble ${className}`} aria-hidden="true">
      {kind === 'dots' ? <><i /><i /><i /></> : <BubbleIcon kind={kind} />}
    </span>
  )
}

/* —— 办公场景道具（像素精灵） —— */

function WaterCooler() {
  return (
    <svg className="prop-svg" viewBox="0 0 60 102" width="60" height="102" aria-hidden="true">
      <rect x="12" y="6" width="36" height="30" fill="#bfdbfe" />
      <rect x="12" y="16" width="36" height="20" fill="#60a5fa" />
      <rect className="wc-bubble wc-bubble-1" x="22" y="28" width="4" height="4" fill="#dbeafe" />
      <rect className="wc-bubble wc-bubble-2" x="34" y="30" width="3" height="3" fill="#dbeafe" />
      <rect x="24" y="36" width="12" height="6" fill="#93c5fd" />
      <rect x="9" y="42" width="42" height="48" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="16" y="60" width="6" height="6" fill="#3b82f6" />
      <rect x="30" y="60" width="6" height="6" fill="#ef4444" />
      <rect x="14" y="70" width="32" height="4" fill="#e2e8f0" />
      <rect x="6" y="90" width="48" height="9" fill="#94a3b8" />
    </svg>
  )
}

function CoffeeStation() {
  return (
    <svg className="prop-svg" viewBox="0 0 90 102" width="90" height="102" aria-hidden="true">
      <g className="coffee-steam">
        <rect className="cs-steam cs-steam-1" x="24" y="6" width="4" height="4" fill="#cbd5e1" />
        <rect className="cs-steam cs-steam-2" x="32" y="2" width="4" height="4" fill="#cbd5e1" />
      </g>
      <rect x="12" y="18" width="36" height="9" fill="#334155" />
      <rect x="12" y="27" width="9" height="33" fill="#334155" />
      <rect x="39" y="27" width="9" height="33" fill="#334155" />
      <rect x="42" y="30" width="3" height="3" fill="#ef4444" />
      <rect x="21" y="42" width="18" height="18" fill="#e2e8f0" />
      <rect x="21" y="51" width="18" height="9" fill="#78350f" />
      <rect x="12" y="60" width="36" height="6" fill="#334155" />
      <rect x="60" y="51" width="12" height="9" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="72" y="54" width="3" height="3" fill="#cbd5e1" />
      <rect x="0" y="66" width="90" height="12" fill="#a16207" />
      <rect x="0" y="66" width="90" height="3" fill="#ca8a04" />
      <rect x="6" y="78" width="9" height="24" fill="#854d0e" />
      <rect x="75" y="78" width="9" height="24" fill="#854d0e" />
    </svg>
  )
}

function SnackShelf() {
  return (
    <svg className="prop-svg" viewBox="0 0 66 90" width="66" height="90" aria-hidden="true">
      <rect x="0" y="0" width="6" height="90" fill="#9a6b3f" />
      <rect x="60" y="0" width="6" height="90" fill="#9a6b3f" />
      <rect x="0" y="24" width="66" height="6" fill="#b07d49" />
      <rect x="0" y="54" width="66" height="6" fill="#b07d49" />
      <rect x="0" y="84" width="66" height="6" fill="#b07d49" />
      <rect x="9" y="6" width="12" height="18" fill="#ef4444" />
      <rect x="25" y="9" width="12" height="15" fill="#facc15" />
      <rect x="41" y="6" width="14" height="18" fill="#22c55e" />
      <rect x="9" y="37" width="14" height="17" fill="#fb923c" />
      <rect x="27" y="40" width="12" height="14" fill="#a78bfa" />
      <rect x="43" y="37" width="12" height="17" fill="#38bdf8" />
      <rect x="9" y="68" width="20" height="16" fill="#f472b6" />
      <rect x="33" y="71" width="14" height="13" fill="#34d399" />
    </svg>
  )
}

function RestroomDoor() {
  return (
    <svg className="prop-svg" viewBox="0 0 72 132" width="72" height="132" aria-hidden="true">
      <rect x="0" y="0" width="72" height="6" fill="#8aa0b8" />
      <rect x="0" y="0" width="6" height="132" fill="#8aa0b8" />
      <rect x="66" y="0" width="6" height="132" fill="#8aa0b8" />
      <rect x="6" y="6" width="60" height="126" fill="#b08968" />
      <rect x="14" y="66" width="44" height="48" fill="#9a7354" />
      <rect x="50" y="70" width="6" height="6" fill="#334155" />
      <rect x="24" y="22" width="24" height="26" fill="#3b82f6" />
      <rect x="29" y="26" width="4" height="4" fill="#ffffff" />
      <rect x="28" y="32" width="6" height="11" fill="#ffffff" />
      <rect x="39" y="26" width="4" height="4" fill="#ffffff" />
      <rect x="37" y="32" width="8" height="7" fill="#ffffff" />
      <rect x="39" y="39" width="4" height="4" fill="#ffffff" />
    </svg>
  )
}

function OfficeWindow() {
  return (
    <svg className="prop-svg" viewBox="0 0 144 108" width="144" height="108" aria-hidden="true">
      <rect x="0" y="0" width="144" height="108" fill="#ffffff" />
      <rect x="6" y="6" width="132" height="96" fill="#bae3f7" />
      <rect x="18" y="24" width="30" height="6" fill="#ffffff" />
      <rect x="24" y="18" width="18" height="6" fill="#ffffff" />
      <rect x="84" y="48" width="36" height="6" fill="#ffffff" />
      <rect x="92" y="42" width="20" height="6" fill="#ffffff" />
      <rect x="69" y="6" width="6" height="96" fill="#ffffff" />
      <rect x="6" y="51" width="132" height="6" fill="#ffffff" />
    </svg>
  )
}

function CeilingLamp() {
  return (
    <svg className="prop-svg" viewBox="0 0 60 36" width="60" height="36" aria-hidden="true">
      <rect x="28" y="0" width="4" height="9" fill="#64748b" />
      <rect x="12" y="9" width="36" height="12" fill="#475569" />
      <rect x="18" y="21" width="24" height="6" fill="#fde68a" />
    </svg>
  )
}

/** 道具站位点：小人会走过去停留（喝水/咖啡/零食/洗手间）。坐标与下方装饰层渲染位置对齐。 */
const PROP_SPOTS = [
  { id: 'water', stand: { x: 150, y: 414 }, face: -1, bubble: 'drink', pause: 2600 },
  { id: 'coffee', stand: { x: 1002, y: 420 }, face: 1, bubble: 'coffee', pause: 3000 },
  { id: 'snack', stand: { x: 1080, y: 622 }, face: 1, bubble: 'snack', pause: 2400 },
  { id: 'restroom', stand: { x: 948, y: 336 }, face: 1, bubble: null, pause: 3400 },
]

function OfficeDecor() {
  return (
    <>
      <div className="office-prop office-prop-wall" style={{ left: 90, top: 108 }}><OfficeWindow /></div>
      <div className="office-prop office-prop-wall" style={{ left: 252, top: 30 }}><CeilingLamp /></div>
      <div className="office-prop office-prop-wall" style={{ left: 906, top: 30 }}><CeilingLamp /></div>
      <div className="office-prop" style={{ left: 912, top: 168, zIndex: 300 }} title="洗手间"><RestroomDoor /></div>
      <div className="office-prop" style={{ left: 66, top: 312, zIndex: 414 }} title="饮水机"><WaterCooler /></div>
      <div className="office-prop" style={{ left: 1044, top: 318, zIndex: 420 }} title="咖啡角"><CoffeeStation /></div>
      <div className="office-prop" style={{ left: 1118, top: 538, zIndex: 628 }} title="零食架"><SnackShelf /></div>
    </>
  )
}

export function WalkerLayer({ walkers, agents }) {
  const items = Object.values(walkers)
  if (!items.length) return null
  return (
    <div className="walker-layer" aria-hidden="true">
      {items.map((walker) => {
        const agent = agents.find((item) => item.id === walker.id)
        if (!agent) return null
        return (
          <div
            key={walker.id}
            className={[
              'walker',
              walker.walking ? 'walker-walking' : '',
              agent.persona ? `walker-persona-${agent.persona}` : '',
            ].filter(Boolean).join(' ')}
            style={{
              transform: `translate(${walker.x}px, ${walker.y}px)`,
              transitionDuration: `${walker.dur}s`,
              zIndex: Math.round(walker.y),
              '--accent': agent.accent,
              '--accent-dark': agent.darkAccent,
            }}
          >
            {walker.bubble ? <PixelBubble kind={walker.bubble} /> : null}
            <span className="walker-shadow-strip" />
            <span className="walker-flip" style={{ transform: `scaleX(${walker.facing})` }}>
              <WalkerSprite agent={agent} />
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 环境行为模拟：空闲角色随机伸懒腰 / 在工区散步 / 走到同事工位旁聊天；
 * 一旦角色被派活（state 离开 idle），立即快步赶回工位。
 * 整个引擎放在 useEffect 内构建（含随机数和定时器），渲染期只读 state。
 */
function useAmbientLife(agents) {
  const [walkers, setWalkers] = useState({})
  const [chatHosts, setChatHosts] = useState({})
  const [acting, setActing] = useState({})
  const agentsRef = useRef(agents)
  const walkersRef = useRef(walkers)
  const chatHostsRef = useRef(chatHosts)
  const engineRef = useRef(null)

  useEffect(() => {
    agentsRef.current = agents
  }, [agents])

  useEffect(() => {
    walkersRef.current = walkers
  }, [walkers])

  useEffect(() => {
    chatHostsRef.current = chatHosts
  }, [chatHosts])

  // 构建模拟引擎（仅一次）。
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const timers = {}
    const addTimer = (id, fn, delay) => {
      if (!timers[id]) timers[id] = []
      timers[id].push(setTimeout(fn, delay))
    }
    const clearTimers = (id) => {
      for (const timer of timers[id] ?? []) clearTimeout(timer)
      timers[id] = []
    }

    const patchWalker = (id, patch) => {
      setWalkers((current) => (current[id] ? { ...current, [id]: { ...current[id], ...patch } } : current))
    }
    const removeWalker = (id) => {
      setWalkers((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    }
    const setHostChatting = (id, value) => {
      setChatHosts((current) => {
        if (Boolean(current[id]) === value) return current
        const next = { ...current }
        if (value) next[id] = true
        else delete next[id]
        return next
      })
    }

    const scheduleNext = (id, base = 9000) => {
      addTimer(id, () => act(id), base + Math.random() * 16000)
    }

    const walkTo = (id, from, to, speedMultiplier, onArrive) => {
      const distance = Math.hypot(to.x - from.x, to.y - from.y)
      const dur = Math.max(0.4, distance / (WALK_SPEED * speedMultiplier))
      patchWalker(id, {
        x: to.x,
        y: to.y,
        dur,
        walking: true,
        facing: to.x >= from.x ? 1 : -1,
      })
      addTimer(id, () => onArrive(), dur * 1000 + 80)
    }

    const walkHome = (id, agent) => {
      const walker = walkersRef.current[id]
      if (!walker) return
      walkTo(id, { x: walker.x, y: walker.y }, personAnchor(agent), 1, () => {
        removeWalker(id)
        scheduleNext(id)
      })
    }

    const propBusy = {}

    const recall = (id, walker, agent) => {
      clearTimers(id)
      if (walker.propId) propBusy[walker.propId] = false
      patchWalker(id, { recalled: true, bubble: null })
      walkTo(id, { x: walker.x, y: walker.y }, personAnchor(agent), RECALL_SPEED_MULTIPLIER, () => {
        removeWalker(id)
        scheduleNext(id)
      })
    }

    const act = (id) => {
      const agent = agentsRef.current.find((item) => item.id === id)
      if (!agent || agent.state !== 'idle' || walkersRef.current[id]) {
        scheduleNext(id, 6000)
        return
      }
      const roll = Math.random()
      const canWalk = id !== 'main' // 主控留守工位，只做桌前小动作。

      if (roll < 0.2 || !canWalk) {
        setActing((current) => ({ ...current, [id]: 'stretch' }))
        addTimer(id, () => {
          setActing((current) => ({ ...current, [id]: null }))
          scheduleNext(id)
        }, 1700)
        return
      }

      const home = personAnchor(agent)
      const spawn = { id, x: home.x, y: home.y, dur: 0, walking: false, facing: 1, bubble: null }

      if (roll < 0.52) {
        // 去场景道具：饮水机 / 咖啡角 / 零食架 / 洗手间。
        const freeProps = PROP_SPOTS.filter((prop) => !propBusy[prop.id])
        if (freeProps.length) {
          const prop = freeProps[Math.floor(Math.random() * freeProps.length)]
          propBusy[prop.id] = true
          setWalkers((current) => ({ ...current, [id]: { ...spawn, propId: prop.id } }))
          addTimer(id, () => {
            walkTo(id, home, prop.stand, 1, () => {
              patchWalker(id, { walking: false, facing: prop.face, bubble: prop.bubble })
              addTimer(id, () => {
                patchWalker(id, { bubble: null })
                propBusy[prop.id] = false
                walkHome(id, agent)
              }, prop.pause + Math.random() * 2000)
            })
          }, 50)
          return
        }
      }

      if (roll < 0.72) {
        // 在公共区散步，停一会儿再回来。
        const dest = {
          x: OFFICE_STAGE_WIDTH * (0.26 + Math.random() * 0.48),
          y: OFFICE_STAGE_HEIGHT * (0.66 + Math.random() * 0.2),
        }
        setWalkers((current) => ({ ...current, [id]: spawn }))
        addTimer(id, () => {
          walkTo(id, home, dest, 1, () => {
            patchWalker(id, { walking: false })
            addTimer(id, () => walkHome(id, agent), 1600 + Math.random() * 2200)
          })
        }, 50)
        return
      }

      // 拜访同事：走到对方工位旁聊几句。
      const candidates = agentsRef.current.filter((item) => (
        item.id !== id
        && !walkersRef.current[item.id]
        && !chatHostsRef.current[item.id]
      ))
      if (!candidates.length) {
        scheduleNext(id, 5000)
        return
      }
      const partner = candidates[Math.floor(Math.random() * candidates.length)]
      const partnerHome = personAnchor(partner)
      const side = home.x <= partnerHome.x ? -1 : 1
      const dest = {
        x: partnerHome.x + side * 80,
        y: Math.min(partnerHome.y + VISIT_FRONT_OFFSET_Y, OFFICE_STAGE_HEIGHT - 56),
      }
      setWalkers((current) => ({ ...current, [id]: spawn }))
      addTimer(id, () => {
        walkTo(id, home, dest, 1, () => {
          const partnerNow = agentsRef.current.find((item) => item.id === partner.id)
          const partnerFree = partnerNow && partnerNow.state !== 'working' && partnerNow.state !== 'waiting'
          patchWalker(id, { walking: false, facing: side === -1 ? 1 : -1, bubble: 'dots' })
          if (partnerFree) setHostChatting(partner.id, true)
          addTimer(id, () => {
            patchWalker(id, { bubble: null })
            setHostChatting(partner.id, false)
            walkHome(id, agent)
          }, 2800 + Math.random() * 2600)
        })
      }, 50)
    }

    engineRef.current = { recall, clearTimers }
    for (const [index, agent] of agentsRef.current.entries()) {
      addTimer(agent.id, () => act(agent.id), 4000 + index * 2600 + Math.random() * 7000)
    }

    return () => {
      engineRef.current = null
      for (const id of Object.keys(timers)) clearTimers(id)
    }
  }, [])

  // 状态变化：被派活的角色立即收回；忙碌的同事不再挂聊天气泡。
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    for (const [id, walker] of Object.entries(walkersRef.current)) {
      const agent = agents.find((item) => item.id === id)
      if (agent && agent.state !== 'idle' && !walker.recalled) {
        engine.recall(id, walker, agent)
      }
    }
    setChatHosts((current) => {
      let changed = false
      const next = { ...current }
      for (const id of Object.keys(current)) {
        const state = agents.find((item) => item.id === id)?.state
        if (state === 'working' || state === 'waiting') {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [agents])

  return { walkers, chatHosts, acting }
}

export function AgentStation({ agent, selected, onSelect, stagger = 0, away = false, chatting = false, acting = null }) {
  const style = {
    '--agent-x': agent.layout.x,
    '--agent-y': agent.layout.y,
    '--agent-w': agent.layout.w,
    '--agent-h': agent.layout.h,
    // 画家算法：按脚底 y 排序，走动小人与工位可以正确互相遮挡。
    '--agent-z': Math.round(personAnchor(agent).y),
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
        agent.persona ? `agent-station-persona-${agent.persona}` : '',
        selected ? 'agent-station-selected' : '',
        away ? 'agent-station-away' : '',
        acting === 'stretch' ? 'agent-station-stretch' : '',
        `agent-station-${agent.state}`,
      ].filter(Boolean).join(' ')}
      style={style}
      onClick={() => onSelect(agent.id)}
      type="button"
    >
      <span className="agent-station-art">
        <AgentCharacter agent={agent} />
        {chatting ? <PixelBubble className="station-bubble" /> : null}
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
  const { walkers, chatHosts, acting } = useAmbientLife(agents)

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
            <div className="office-command-rug" aria-hidden="true" />
            <OfficeDecor />
            {agents.map((agent, index) => (
              <AgentStation
                key={agent.id}
                agent={agent}
                selected={agent.id === selectedId}
                onSelect={onSelect}
                stagger={index}
                away={Boolean(walkers[agent.id])}
                chatting={Boolean(chatHosts[agent.id])}
                acting={acting[agent.id]}
              />
            ))}
            <WalkerLayer walkers={walkers} agents={agents} />
          </div>
        </div>
      </div>
    </div>
  )
}
