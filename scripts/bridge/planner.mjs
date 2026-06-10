// planner.mjs — 主控规划器：规则规划（离线兜底）+ LLM 规划（能力注册表约束）。
// 设计原则：LLM 只能从 CAPABILITY_REGISTRY 选能力；缺能力时显式报 missingCapabilities，不硬凑。
import {
  AGENTS,
  PLANNER_API_KEY,
  PLANNER_BASE_URL,
  PLANNER_MODE,
  PLANNER_MODEL,
  PLANNER_PROVIDER,
  agentName,
  describeCapability,
  hasCapability,
  publicCapabilityRegistry,
} from './config.mjs'
import {
  extractWeatherCity,
  extractWeatherDay,
  inferReportFormat,
  isWeatherRequest,
  wantsReportFileOutput,
} from './infer.mjs'
import { extractFirstFilePath, parsePlannerJson } from './lib.mjs'

function classifyAgent(message, requestedAgentId) {
  if (requestedAgentId === 'browser-agent') return 'research-agent'
  if (requestedAgentId === 'meeting-agent') return 'writing-agent'
  if (requestedAgentId) return requestedAgentId
  return 'main'
}

function classifyCapability(message) {
  const text = message.toLowerCase()
  const fallbackIntent = inferFallbackIntent(message)
  if (fallbackIntent.agentId) return fallbackIntent.agentId
  if (/录音|音频|转写|听写|语音识别|transcribe|audio|mp3|m4a|wav/.test(text)) return 'writing-agent'
  if (/(本地|工作区|项目|代码|readme|文件|目录|repo|code|file|folder).*(搜索|查找|找出|列|读|看)|文件|目录|项目|readme|代码|file|folder|repo|code/.test(text)) return 'file-agent'
  if (/(开会|拜访|客户|银行|公司|机构).*(准备|背景|资料|信息|调研|研究)|背景信息|公开信息|资料|搜索|查一下|了解一下/.test(text)) return 'research-agent'
  if (/日程|排期|提醒|待办|calendar|schedule|reminder/.test(text) && !/打开|启动|open/.test(text)) return 'schedule-agent'
  if (/会议纪要|纪要|材料|文案|撰写|起草|改写|润色|总结成|minutes|draft|writing/.test(text)) return 'writing-agent'
  if (/应用|启动|系统|微信|邮件|日历|chrome|safari|finder|terminal|app|system|mail/.test(text)) return 'app-agent'
  if (/今天|最新|新闻|发布|实时|现在|recent|latest|news|today/.test(text)) return 'research-agent'
  if (/网页|浏览器|官网|新闻|browser|web|url|https?:\/\//.test(text)) return 'research-agent'
  return 'file-agent'
}

function splitTaskMessage(message) {
  const parts = message
    .split(/(?:然后|再|并且|，然后|，再|。|；|;|\n)+/u)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length ? parts : [message]
}

function buildRuleSupervisorPlan(message) {
  const fallbackIntent = inferFallbackIntent(message)
  if (fallbackIntent.answer) return []
  if (fallbackIntent.agentId) return [{ agentId: fallbackIntent.agentId, message }]
  if (isExternalMeetingPrep(message)) {
    return buildExternalMeetingResearchPlan(message)
  }

  const parts = splitTaskMessage(message)
  const steps = parts.map((part) => ({
    agentId: classifyCapability(part),
    message: part,
  }))

  if (steps.length === 1 && steps[0].message !== message) {
    steps[0].message = message
  }

  return steps.filter((step, index, array) => {
    const previous = array[index - 1]
    return !previous || previous.agentId !== step.agentId || previous.message !== step.message
  })
}

function normalizePlannerSteps(steps) {
  const allowedAgentIds = new Set(AGENTS.map((agent) => agent.id).filter((id) => id !== 'main'))
  const normalized = Array.isArray(steps)
    ? steps
        .map((step) => ({
          agentId: allowedAgentIds.has(step?.agentId) ? step.agentId : null,
          message: String(step?.message ?? '').trim(),
        }))
        .filter((step) => step.agentId && step.message)
    : []
  return normalized
}

function normalizeCapabilityWorkflow(workflow, originalMessage) {
  const allowedAgentIds = new Set(AGENTS.map((agent) => agent.id).filter((id) => id !== 'main'))
  return Array.isArray(workflow)
    ? workflow
        .map((step) => {
          const agentId = allowedAgentIds.has(step?.agentId) ? step.agentId : null
          const capability = String(step?.capability ?? '').trim()
          const message = String(step?.message ?? step?.instruction ?? originalMessage ?? '').trim()
          const args = step?.args && typeof step.args === 'object' && !Array.isArray(step.args)
            ? step.args
            : {}
          if (!agentId || !capability || !message) return null
          return {
            agentId,
            capability,
            args,
            message,
          }
        })
        .filter(Boolean)
    : []
}

function normalizeMissingCapabilities(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        agentId: typeof item?.agentId === 'string' ? item.agentId : null,
        capability: String(item?.capability ?? item?.name ?? '').trim(),
        reason: String(item?.reason ?? item?.description ?? '').trim(),
      })).filter((item) => item.capability)
    : []
}

function validateCapabilityWorkflow(workflow) {
  return workflow
    .filter((step) => !hasCapability(step.agentId, step.capability))
    .map((step) => ({
      agentId: step.agentId,
      capability: step.capability,
      reason: `${agentName(step.agentId)}当前没有注册 ${step.capability} 能力。`,
    }))
}

function formatMissingCapabilities(missingCapabilities) {
  const lines = missingCapabilities.map((item, index) => {
    const owner = item.agentId ? agentName(item.agentId) : '未定助手'
    const reason = item.reason ? `：${item.reason}` : ''
    return `${index + 1}. ${owner} / ${item.capability}${reason}`
  })
  return [
    '我已经识别出你要做的事，但当前能力清单里缺少对应执行能力，所以这次不会用别的能力硬凑。',
    '',
    '缺少的能力：',
    ...lines,
    '',
    '把这些能力补进对应助手后，再让主控从能力清单里选择执行。'
  ].join('\n')
}

function ensureReportSaveWorkflow(message, workflow) {
  if (!wantsReportFileOutput(message)) return workflow
  if (workflow.some((step) => step.agentId === 'file-agent' && (step.capability === 'write_file' || step.capability === 'save_report'))) return workflow
  const hasContentProducer = workflow.some((step) => step.agentId !== 'file-agent')
  if (!hasContentProducer) return workflow
  return [
    ...workflow,
    {
      agentId: 'file-agent',
      capability: 'write_file',
      args: {
        format: inferReportFormat(message),
        source: 'previous_result',
      },
      message: '将上一步输出写入合适命名的文件',
    },
  ]
}

function finalizeSupervisorWorkflow(message, workflow) {
  return ensureReportSaveWorkflow(message, normalizeCapabilityWorkflow(workflow, message))
}

function inferMandatoryCapabilityWorkflow(message) {
  if (isWeatherRequest(message)) {
    const city = extractWeatherCity(message)
    const day = extractWeatherDay(message)
    const dayArgMap = {
      今天: 'today',
      明天: 'tomorrow',
      后天: 'day_after_tomorrow',
    }
    return {
      intent: 'research',
      confidence: 0.96,
      needsTool: true,
      steps: [
        {
          agentId: 'research-agent',
          capability: 'weather',
          args: {
            city,
            day: dayArgMap[day.label] ?? 'today',
          },
          message,
        },
      ],
    }
  }
  return null
}
function parseIntentEnvelope(parsed) {
  const intent = typeof parsed.intent === 'string' ? parsed.intent : 'unspecified'
  const confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null
  const needsTool = typeof parsed.needsTool === 'boolean' ? parsed.needsTool : null
  return { intent, confidence, needsTool }
}

function buildSupervisorBrief(message, plan, source) {
  const routeLabel = source === 'llm'
    ? `${PLANNER_PROVIDER}/${PLANNER_MODEL}`
    : source === 'meeting-research'
      ? '研究助手先检索公开信息'
      : source
  if (source === 'meeting-research') {
    return [
      `收到，我先帮你把「${message}」这件事铺一下底。`,
      '我会先让研究助手查对方机构的公开背景和近期重点，再整理会前准备、切入角度，以及还需要问你的几个关键问题。',
      `执行方式：${routeLabel}`,
    ].join('\n')
  }

  const dispatchLines = plan.map((step, index) => {
    const agentName = AGENTS.find((agent) => agent.id === step.agentId)?.name ?? step.agentId
    const capability = step.capability ? ` / ${describeCapability(step.agentId, step.capability)}` : ''
    const visibleMessage = step.message.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? step.message
    return `${index + 1}. ${agentName}${capability}：${visibleMessage}`
  })
  if (plan.length === 1) {
    const agentName = AGENTS.find((agent) => agent.id === plan[0].agentId)?.name ?? plan[0].agentId
    const capability = plan[0].capability ? ` / ${describeCapability(plan[0].agentId, plan[0].capability)}` : ''
    const visibleMessage = plan[0].message.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? plan[0].message
    return [
      `收到，我先按「${message}」来处理。`,
      `我会调用${agentName}${capability}：${visibleMessage}`,
      `调度：${routeLabel}`,
    ].join('\n')
  }
  return [
    `收到，我先按「${message}」来处理。`,
    `这件事我会分 ${plan.length} 步走：`,
    ...dispatchLines,
    `调度：${routeLabel}`,
  ].join('\n')
}

function requiresResearch(message) {
  if (inferFallbackIntent(message).answer) return false
  return /天气|气温|温度|下雨|降雨|空气|今天|明天|后天|最新|新闻|发布|实时|现在|recent|latest|news|today|tomorrow|weather/i.test(message)
}

function isImplicitRecentDocumentSummary(message) {
  const text = message.trim()
  if (text.length > 36) return false
  return /^(主要内容是啥|主要内容是什么|讲了啥|讲了什么|说了啥|说了什么|总结一下|概括一下|摘要|内容呢)[？?。.\s]*$/.test(text)
    || /(主要内容|讲了啥|讲了什么|总结|概括|摘要)/.test(text)
}

function inferRuntimeFollowupIntent(message, runtimeContext = {}) {
  const recentSavedFile = runtimeContext.recentSavedFile
  const explicitFilePath = extractFirstFilePath(message)
  if (explicitFilePath && /(这个|那个|打开|再打开|重新打开|open)|\.(?:docx?|pdf|md|txt|html)\s*$/i.test(message)) {
    return {
      intent: 'open_referenced_file',
      confidence: 0.92,
      needsTool: true,
      steps: [
        {
          agentId: 'app-agent',
          capability: 'open_file',
          args: { filePath: explicitFilePath },
          message: `打开文件 ${explicitFilePath}`,
        },
      ],
    }
  }
  if (recentSavedFile?.relativePath && isImplicitRecentDocumentSummary(message)) {
    return {
      intent: 'read_saved_document',
      confidence: 0.9,
      needsTool: true,
      steps: [
        {
          agentId: 'file-agent',
          capability: 'read_file',
          args: { filePath: recentSavedFile.relativePath },
          message: `读取最近保存的报告 ${recentSavedFile.relativePath}，总结主要内容`,
        },
      ],
    }
  }
  return null
}

function inferFallbackIntent(message) {
  const text = message.trim()
  if (isSocialChat(text)) {
    return {
      intent: 'social_chat',
      confidence: 0.95,
      needsTool: false,
      answer: buildSocialChatAnswer(text),
    }
  }
  if (/(刚|最近|上一个|这个).*(报告|文档|文件).*(讲了啥|讲了什么|总结|摘要|内容)|读.*(报告|文档|文件)|总结.*(报告|文档|文件)/.test(text)) {
    return {
      intent: 'read_saved_document',
      confidence: 0.86,
      needsTool: true,
      agentId: 'file-agent',
    }
  }
  if (/(删除|删掉|移除|重命名|改名|移动|挪到|复制|拷贝).*(文件|报告|文档|artifacts\/notes|\.md|\.docx?|\.pdf|\.txt|\.html)/i.test(text)) {
    return {
      intent: 'file_management',
      confidence: 0.88,
      needsTool: true,
      agentId: 'file-agent',
    }
  }
  if (/(录音|音频|转写|听写|语音识别|会议录音|会议音频|transcribe|audio|mp3|m4a|wav)/i.test(text)) {
    return {
      intent: 'writing_audio',
      confidence: 0.9,
      needsTool: true,
      agentId: 'writing-agent',
    }
  }
  if (/(保存|生成|形成|写成).*(报告|文档|doc|文件).*(打开)?|打开.*(刚保存|已保存|报告|文档|文件)/.test(text)) {
    return {
      intent: 'document_workflow',
      confidence: 0.82,
      needsTool: true,
      agentId: null,
    }
  }
  return {
    intent: 'unknown',
    confidence: 0.2,
    needsTool: null,
    agentId: null,
    answer: null,
  }
}

function isSocialChat(message) {
  const text = message.trim().toLowerCase()
  return /^(hi|hello|hey|你好|您好|哈喽|嗨)[！!。.\s]*$/i.test(text)
    || /(你|主控|助手|你们).*(今天|现在|刚才)?(过得|过的|咋样|怎么样|还好吗|累不累|忙不忙|在干嘛|干啥|心情|状态)/.test(text)
    || /(今天|现在).*(过得|过的).*(咋样|怎么样)/.test(text)
}

function buildSocialChatAnswer(message) {
  if (/过得|过的/.test(message)) {
    return '还挺充实的。刚刚一直在陪你把这个多智能体工作台往顺手、靠谱的方向磨：路由、报告生成、文件读取、展示细节都修了一轮。现在感觉脑子热着，但状态不错。你今天怎么样？'
  }
  if (/在干嘛|干啥|忙不忙/.test(message)) {
    return '我在这儿待命，也顺手盯着这个工作台的运行状态。你抛目标过来，我先判断要不要派活；闲聊也可以，不需要每句话都进工具链。'
  }
  return '在呢。你直接说就好，闲聊我会直接接住；需要查资料、读文件、开应用时我再派给对应助手。'
}

function isExternalMeetingPrep(message) {
  return /(开会|拜访|客户会|见客户).*(准备|背景|资料|信息|调研|研究|问题)/.test(message)
}

function buildExternalMeetingResearchPlan(message) {
  return [
    {
      agentId: 'research-agent',
      capability: 'grounded_answer',
      args: { query: message },
      message: [
        message,
        '请先搜索公开信息，不要先追问。',
        '重点整理：机构背景、近期动态、业务重点、可能关心的议题、会前准备清单，以及仍需要向用户确认的少量关键问题。',
      ].join('\n'),
    },
  ]
}
async function buildLlmSupervisorPlan(message, context = [], runtimeContext = {}) {
  if (!PLANNER_API_KEY) throw new Error('planner API key is not configured')
  const response = await fetch(`${PLANNER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PLANNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are the planner for a local OS agent MVP.',
            `Current date: ${new Date().toISOString().slice(0, 10)}.`,
            'You are always the first responder. Understand and acknowledge the user naturally before deciding whether a specialist is needed.',
            'Return only JSON in this shape: {"intent":"social_chat|qa|research|file_read|file_write|writing|schedule|app_action|document_workflow|clarify|unsupported","confidence":0.0,"needsTool":false,"answer":null,"workflow":[{"agentId":"research-agent","capability":"grounded_answer","args":{"query":"..."},"message":"..."}],"missingCapabilities":[{"agentId":"schedule-agent","capability":"create_reminder","reason":"日程助手尚未接入创建提醒执行器"}]}',
            'First infer the user intent holistically from the whole utterance and conversation context. Do not route by keyword alone.',
            'You must choose tool actions only from capabilityRegistry. Do not invent an executable capability in workflow.',
            'If the required action is not in capabilityRegistry, return workflow: [] and put the missing action in missingCapabilities. Do not substitute another capability.',
            'Capability design principle: prefer general verb-object abilities with parameters, such as list_saved_files, count_files, write_file, delete_files, read_file. Do not create or request case-specific abilities named after a company, topic, report, date, or one-off user story.',
            'When a user mentions a domain object such as report, note, document, meeting material, or saved file, express it as args.scope, args.query, args.format, args.title, or args.source rather than a separate capability when a general capability exists.',
            'If it is a clear executable task supported by capabilityRegistry, set needsTool true, answer null, and fill workflow.',
            'If the user is greeting, only sends punctuation, asks what you can do, or gives no executable goal, return a short natural answer and workflow: []. Do not use a generic clarification template for greetings.',
            'If the user is making casual/social chat with you, such as asking how you are today, what you are doing, whether you are tired/busy, or your mood/status, answer directly as the supervisor and return workflow: []. Do not route these to research-agent even if the text contains today/now.',
            'If the user asks a general question that can be answered from model knowledge without current, private, local, or external data, answer directly and return workflow: [].',
            'If the user has an executable goal but misses required details and no safe default exists, ask one concise clarification question and return workflow: [].',
            'If the user only provides a short noun or ambiguous topic, ask what they want to do with it and return workflow: [].',
            'Use conversationContext to resolve follow-up references like 继续, 再查查, 刚才那个, 上一个, 它, 这个, and similar phrases.',
            'Use runtimeContext to resolve references to saved files, default save locations, workspace root, and previous outputs.',
            'If the previous user asked a count/list/statistics question and the current user says 直接告诉我 or similar, use file-agent count_files or list_saved_files with suitable scope/filter. Do not open a file and do not create a new file.',
            'If the user asks where files will be saved by default, answer using runtimeContext.defaultSaveDir and return workflow: [].',
            'If the user asks where the previous saved file is, answer using runtimeContext.recentSavedFile.relativePath and return workflow: [].',
            'If runtimeContext.recentSavedFile exists and the user asks a short follow-up such as 主要内容是啥, 讲了啥, 总结一下, 摘要, or 概括一下, use file-agent read_file with args.filePath = runtimeContext.recentSavedFile.relativePath.',
            'If the user asks to save previous content, use file-agent write_file with args.source="previous_answer" and include requested format if any.',
            'If the user asks to save the immediately previous produced report/content in a multi-step workflow, use file-agent write_file after the content-producing step.',
            'If the user asks to open something with explicit phrases like 帮我打开, 重新打开, 打开那个文件, 打开最近的文件, 对就是那个文件, and runtimeContext.recentSavedFile exists, use app-agent open_file with args.filePath = runtimeContext.recentSavedFile.relativePath.',
            'If a follow-up refers to a previous task, rewrite the workflow message with the resolved target and the new user instruction.',
            'If the user asks for current facts, weather, forecasts, news, latest releases, local files, websites, apps, meetings, or anything requiring execution, use workflow instead of answering from memory.',
            'Allowed agentId values: file-agent, research-agent, writing-agent, schedule-agent, app-agent.',
            'Use research-agent for current facts, latest news, releases, market/product updates, broad web questions, URLs, web search, page reading, clicking, screenshots, and anything that benefits from Google Search grounding or webpage access.',
            'For weather, forecast, temperature, rain, snow, or air-quality questions, use research-agent weather. Preserve the requested city and relative day such as 今天, 明天, 后天 in args and step message. Do not use grounded_answer for weather unless the weather capability is missing.',
            'For preparing a meeting with an external company, bank, client, or institution, route to research-agent first to gather public background, recent developments, business priorities, and suggested meeting preparation questions.',
            'Do not use file-agent for meeting preparation unless the user explicitly asks to inspect local project files or uploaded documents.',
            'Use file-agent for local files, project folders, code, README, documents.',
            'If the user asks about 工作区, 工区, 项目目录, 项目文件, source files, repo files, code files, or asks these files are for, use file-agent list_files or list_paths. Do not use list_saved_files for this.',
            'Use file-agent list_saved_files/count_files for listing or counting generated files, reports, notes, documents, or saved artifacts. Treat report as a scope/filter, not a separate capability.',
            'Use file-agent write_file for saving any previous answer, previous step result, report, note, document, or generated text to disk. Treat report/doc/md as format/title/scope arguments, not separate capabilities.',
            'Use file-agent delete_files when the user asks to delete one file, multiple files, old files, old reports, all reports except the latest one, clean generated files, or bulk remove local files. This capability requires confirmation.',
            'Use file-agent manage_file for rename, move, or copy local files. The file-agent will require user confirmation before destructive or state-changing operations.',
            'cleanup_reports is only a compatibility alias; prefer delete_files with args like {"scope":"reports","keep":"latest"} for report cleanup.',
            'Use writing-agent for writing materials, drafting, polishing, summaries, minutes, scripts, copy, and transcribing or recognizing meeting audio/recordings into minutes.',
            'Schedule-agent currently has no executable capabilities. For creating reminders, calendar events, or managing schedules, return missingCapabilities rather than workflow.',
            'Use app-agent only when the user explicitly asks to open, launch, or control a named local app. Do not invent an app from a generic topic.',
            'Do not route to app-agent for food, places, products, or generic searches unless the user explicitly says to open or use a specific app.',
            'For local food/place/product discovery, use research-agent or ask a clarification question if the intent is unclear.',
            'If the user gives an ambiguous request, route it to the most relevant specialist and preserve the missing information in the message.',
            'Only route because the user intends to use a tool or needs external/local/private/current information. Relative words like today/now/recent are not sufficient by themselves.',
            'Do not invent dates, names, URLs, or facts in step messages.',
            'Preserve relative time expressions like 今天, 明天, latest, today unless the user provided an exact date.',
            'Preserve the user language in every step message. If the user writes Chinese, write Chinese. Do not translate user instructions.',
            'When the user language is ambiguous, answer in concise Simplified Chinese.',
            'Preserve user intent and keep each step executable by one specialist.',
            `Capability registry: ${JSON.stringify(publicCapabilityRegistry())}`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            userMessage: message,
            conversationContext: context,
            runtimeContext,
          }),
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`planner HTTP ${response.status}: ${await response.text()}`)
  }
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('planner returned empty content')
  const parsed = parsePlannerJson(content)
  const intentEnvelope = parseIntentEnvelope(parsed)
  const answer = typeof parsed.answer === 'string' && parsed.answer.trim()
    ? parsed.answer.trim()
    : null
  const workflow = finalizeSupervisorWorkflow(message, parsed.workflow)
  const legacySteps = workflow.length
    ? []
    : normalizePlannerSteps(parsed.steps, message).map((step) => ({
        ...step,
        capability: 'legacy_unmapped_step',
        args: {},
      }))
  const steps = workflow.length ? workflow : legacySteps
  const missingCapabilities = [
    ...normalizeMissingCapabilities(parsed.missingCapabilities),
    ...validateCapabilityWorkflow(steps),
  ]
  if (missingCapabilities.length) {
    return {
      answer: formatMissingCapabilities(missingCapabilities),
      steps: [],
      missingCapabilities,
      ...intentEnvelope,
      needsTool: false,
    }
  }
  const mandatoryWorkflow = inferMandatoryCapabilityWorkflow(message)
  const hasMandatoryWeatherStep = steps.some((step) => step.agentId === 'research-agent' && step.capability === 'weather')
  if (mandatoryWorkflow && !hasMandatoryWeatherStep) {
    return {
      answer: null,
      steps: mandatoryWorkflow.steps,
      intent: mandatoryWorkflow.intent,
      confidence: Math.max(intentEnvelope.confidence ?? 0, mandatoryWorkflow.confidence),
      needsTool: true,
    }
  }
  const runtimeFollowup = inferRuntimeFollowupIntent(message, runtimeContext)
  if (runtimeFollowup && (steps.length === 0 || intentEnvelope.intent === 'clarify' || answer)) {
    return {
      answer: null,
      steps: finalizeSupervisorWorkflow(message, runtimeFollowup.steps),
      intent: runtimeFollowup.intent,
      confidence: Math.max(intentEnvelope.confidence ?? 0, runtimeFollowup.confidence),
      needsTool: true,
    }
  }
  const fallbackIntent = inferFallbackIntent(message)
  if (fallbackIntent.answer && (!intentEnvelope.needsTool || steps.length === 0)) {
    return {
      answer: answer ?? fallbackIntent.answer,
      steps: [],
      intent: fallbackIntent.intent,
      confidence: Math.max(intentEnvelope.confidence ?? 0, fallbackIntent.confidence),
    }
  }
  if (fallbackIntent.agentId && steps.length === 0 && fallbackIntent.confidence >= 0.8) {
    return {
      answer: formatMissingCapabilities([{
        agentId: fallbackIntent.agentId,
        capability: 'model_workflow_missing',
        reason: '主控识别到可能需要工具，但模型没有产出可校验的能力工作流。',
      }]),
      steps: [],
      intent: fallbackIntent.intent,
      confidence: fallbackIntent.confidence,
      needsTool: false,
    }
  }
  if (answer && steps.length === 0 && intentEnvelope.needsTool !== true) {
    return { answer, steps, ...intentEnvelope }
  }
  if (requiresResearch(message) && steps.length === 0 && intentEnvelope.needsTool === true) {
    return {
      answer: formatMissingCapabilities([{
        agentId: 'research-agent',
        capability: 'model_workflow_missing',
        reason: '主控判断需要研究能力，但模型没有返回 grounded_answer/read_url/browser_action/weather 之一。',
      }]),
      steps: [],
      ...intentEnvelope,
      needsTool: false,
    }
  }
  if (answer && steps.length === 0) return { answer, steps, ...intentEnvelope }
  return {
    answer: steps.length
      ? null
      : formatMissingCapabilities([{
          agentId: null,
          capability: 'model_workflow_missing',
          reason: '主控模型没有返回可执行能力工作流。',
        }]),
    steps,
    ...intentEnvelope,
  }
}

async function synthesizeWithPlannerModel({ message, sourceTitle, sourceText, results }) {
  if (!PLANNER_API_KEY) return null
  const response = await fetch(`${PLANNER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PLANNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You summarize browser retrieval results for a local OS agent.',
            'Return only JSON in this shape: {"answer":"..."}',
            'Answer in concise Simplified Chinese.',
            'Use only the provided retrieved text/results. Do not invent live data.',
            'If the retrieved data is insufficient for a direct answer, say what is missing and include the most relevant result names.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            userRequest: message,
            sourceTitle,
            sourceText: sourceText?.slice(0, 1800),
            results: results?.slice(0, 5),
          }),
        },
      ],
    }),
  })
  if (!response.ok) return null
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (!content) return null
  const parsed = parsePlannerJson(content)
  return typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : null
}

async function callPlannerJson({ system, payload, temperature = 0 }) {
  if (!PLANNER_API_KEY) throw new Error('planner API key is not configured')
  const response = await fetch(`${PLANNER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PLANNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: system,
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`planner HTTP ${response.status}: ${await response.text()}`)
  }
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('planner returned empty content')
  return parsePlannerJson(content)
}

async function buildSupervisorPlan(message, context = [], runtimeContext = {}) {
  if (PLANNER_MODE === 'llm') {
    try {
      return {
        source: 'llm',
        ...await buildLlmSupervisorPlan(message, context, runtimeContext),
      }
    } catch (error) {
      console.error(`[planner] failed: ${error.message}`)
      return {
        source: 'llm-error',
        answer: [
          '主控模型这次没有成功完成意图识别，所以我不会改用规则硬猜。',
          `错误信息：${error.message}`,
          '这类情况应该补齐模型调用稳定性或重试机制，而不是静默 fallback。',
        ].join('\n'),
        steps: [],
        error: error.message,
      }
    }
  }
  const fallbackIntent = inferFallbackIntent(message)
  return {
    source: 'rules',
    answer: fallbackIntent.answer ?? null,
    steps: buildRuleSupervisorPlan(message),
  }
}

export {
  classifyAgent,
  buildRuleSupervisorPlan,
  buildSupervisorPlan,
  buildSupervisorBrief,
  callPlannerJson,
  synthesizeWithPlannerModel,
}
