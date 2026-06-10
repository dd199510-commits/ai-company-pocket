// config.mjs — 集中配置：环境变量、路径、模型、Agent 目录与能力注册表（单一事实来源）。
import { existsSync, readFileSync } from 'node:fs'
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
  ?? (process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o-mini')
const PLANNER_BASE_URL = (
  process.env.OS_AGENT_PLANNER_BASE_URL
  ?? process.env.DEEPSEEK_BASE_URL
  ?? process.env.OPENAI_BASE_URL
  ?? (process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com' : 'https://api.openai.com/v1')
).replace(/\/$/, '')
const PLANNER_PROVIDER = process.env.OS_AGENT_PLANNER_PROVIDER
  ?? (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'openai-compatible')
const RESEARCH_PROVIDER = process.env.OS_AGENT_RESEARCH_PROVIDER ?? (process.env.GEMINI_API_KEY ? 'gemini' : 'browser')
const RESEARCH_MODEL = process.env.OS_AGENT_RESEARCH_MODEL ?? 'gemini-2.5-flash'
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

// 默认模型名健康检查：未显式配置时给出启动告警，避免静默失败再回退。
if (PLANNER_MODE === 'llm' && !process.env.OS_AGENT_PLANNER_MODEL) {
  console.warn(`[config] 未设置 OS_AGENT_PLANNER_MODEL，当前使用默认值 "${PLANNER_MODEL}"；建议在 .env 显式指定。`)
}
if (RESEARCH_PROVIDER === 'gemini' && !process.env.OS_AGENT_RESEARCH_MODEL) {
  console.warn(`[config] 未设置 OS_AGENT_RESEARCH_MODEL，当前使用默认值 "${RESEARCH_MODEL}"；建议在 .env 显式指定。`)
}

export {
  HOST,
  PORT,
  RUNTIME_ROOT,
  WORKSPACE_ROOT,
  ARTIFACT_ROOT,
  BROWSER_ARTIFACT_ROOT,
  NOTE_ARTIFACT_ROOT,
  HISTORY_LOG_PATH,
  FILE_INDEX_PATH,
  FASTER_WHISPER_TRANSCRIBE,
  PLANNER_API_KEY,
  PLANNER_MODE,
  PLANNER_MODEL,
  PLANNER_BASE_URL,
  PLANNER_PROVIDER,
  RESEARCH_PROVIDER,
  RESEARCH_MODEL,
  GEMINI_API_KEY,
  RESEARCH_PROXY_URL,
  DEFAULT_RUNTIME,
  AGENTS,
  CAPABILITY_REGISTRY,
  OPENCLAW_AGENT_MAP,
  publicCapabilityRegistry,
  agentName,
  hasCapability,
  describeCapability,
}
