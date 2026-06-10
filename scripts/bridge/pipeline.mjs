// pipeline.mjs — 通用执行管线：能力步骤分发、主控多步编排、任务生命周期、确认动作执行。
// 新增能力的标准路径：config.CAPABILITY_REGISTRY 声明 → 执行器实现 → CAPABILITY_EXECUTORS 挂载，主控自动可用。
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  AGENTS,
  WORKSPACE_ROOT,
  agentName,
  describeCapability,
  hasCapability,
} from './config.mjs'
import {
  activeTasks,
  buildChatReportPreview,
  compactResultForClient,
  emitEvent,
  pendingActions,
  summarizeResult,
} from './events.mjs'
import { buildConversationContext, buildSupervisorRuntimeContext } from './context.mjs'
import { runCommandAsync, unsupportedCapabilityResult } from './lib.mjs'
import { buildSupervisorBrief, buildSupervisorPlan, classifyAgent } from './planner.mjs'
import { executeFileAgent, executeFileCapability, invalidateFileIndex } from './executors/file.mjs'
import { executeResearchAgent, executeResearchCapability } from './executors/research.mjs'
import { executeWritingAgent, executeWritingCapability } from './executors/writing.mjs'
import {
  executeAppCapability,
  executeScheduleAgent,
  executeSystemAgent,
} from './executors/system.mjs'

// 能力执行器注册表：agentId → 该助手的能力步骤执行函数。
const CAPABILITY_EXECUTORS = {
  'file-agent': executeFileCapability,
  'research-agent': executeResearchCapability,
  'writing-agent': executeWritingCapability,
  'app-agent': executeAppCapability,
}

// 直连执行器注册表：跳过主控、直接对话某个助手时使用。
const AGENT_EXECUTORS = {
  'file-agent': executeFileAgent,
  'research-agent': executeResearchAgent,
  'browser-agent': ({ taskId, message }) => executeResearchAgent({ taskId, agentId: 'research-agent', message }),
  'writing-agent': executeWritingAgent,
  'meeting-agent': ({ taskId, message }) => executeWritingAgent({ taskId, agentId: 'writing-agent', message }),
  'schedule-agent': executeScheduleAgent,
  'app-agent': executeSystemAgent,
}

async function executeCapabilityStep({ taskId, step, previousResult, userMessage, threadId }) {
  if (!hasCapability(step.agentId, step.capability)) {
    return unsupportedCapabilityResult(agentName(step.agentId), step.capability)
  }
  const executor = CAPABILITY_EXECUTORS[step.agentId]
  if (!executor) {
    return unsupportedCapabilityResult(agentName(step.agentId), step.capability)
  }
  return executor({
    taskId,
    agentId: step.agentId,
    step,
    previousResult,
    userMessage,
    threadId,
  })
}

async function executeTask({ taskId, agentId, message }) {
  if (agentId === 'main') return executeSupervisorTask({ taskId, agentId, message })
  const executor = AGENT_EXECUTORS[agentId]
  if (executor) return executor({ taskId, agentId, message })
  return executeFileAgent({ taskId, agentId: 'file-agent', message })
}

async function executeSupervisorTask({ taskId, agentId, message }) {
  const threadId = activeTasks.get(taskId)?.threadId
  const context = await buildConversationContext(taskId, threadId)
  const runtimeContext = await buildSupervisorRuntimeContext(taskId, threadId)
  const planResult = await buildSupervisorPlan(message, context, runtimeContext)
  const plan = planResult.steps
  if (planResult.answer && plan.length === 0) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-supervisor-clarify`,
      status: 'done',
      title: '主控澄清',
      detail: planResult.answer,
      metric: `无需派活 / ${planResult.source}`,
      bubble: '澄清',
      announce: true,
    })
    return {
      answer: planResult.answer,
      plan,
      results: [],
    }
  }
  const supervisorBrief = buildSupervisorBrief(message, plan, planResult.source)
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-supervisor-plan`,
    status: 'done',
    title: '主控理解与派活',
    detail: supervisorBrief,
    metric: `${plan.length} 个步骤 / ${planResult.source}`,
    bubble: '计划',
    announce: true,
  })

  const results = []
  for (const [index, step] of plan.entries()) {
    const agentName = AGENTS.find((agent) => agent.id === step.agentId)?.name ?? step.agentId
    const previousResult = results.at(-1)
    const fromAgentId = previousResult?.agentId ?? 'main'
    const handoffText = previousResult
      ? [
          `${previousResult.agentName} 已完成上一步。`,
          `结果摘要：${previousResult.summary || '已完成'}`,
          `请继续处理：${step.message}`,
        ].join('\n')
      : step.message
    if (fromAgentId !== step.agentId) {
      emitEvent({
        type: 'agent_message',
        taskId,
        fromAgentId,
        toAgentId: step.agentId,
        title: previousResult ? '交付下一步' : '任务指派',
        text: handoffText,
      })
    }
    emitEvent({
      type: 'task_log',
      taskId,
      agentId: step.agentId,
      stepId: `${taskId}-supervisor-step-${index + 1}`,
      status: 'running',
      title: `执行步骤 ${index + 1}`,
      detail: `${agentName}: ${step.capability ? `${describeCapability(step.agentId, step.capability)} / ` : ''}${step.message}`,
      metric: `步骤 ${index + 1}/${plan.length}`,
      bubble: '执行',
    })

    const result = step.capability
      ? await executeCapabilityStep({
          taskId,
          step,
          previousResult: previousResult?.result,
          userMessage: message,
          threadId,
        })
      : await executeTask({
          taskId,
          agentId: step.agentId,
          message: step.message,
        })

    if (result?.pendingAction) {
      return result
    }

    results.push({
      agentId: step.agentId,
      agentName,
      message: step.message,
      summary: summarizeResult(result),
      result,
    })
    const nextStep = plan[index + 1]
    if (!nextStep) {
      emitEvent({
        type: 'agent_message',
        taskId,
        fromAgentId: step.agentId,
        toAgentId: 'main',
        title: '回报主控',
        text: summarizeResult(result) || '已完成',
      })
    }
    emitEvent({
      type: 'task_log',
      taskId,
      agentId: step.agentId,
      stepId: `${taskId}-supervisor-step-${index + 1}`,
      status: 'done',
      title: `完成步骤 ${index + 1}`,
      detail: `${agentName}: ${summarizeResult(result) || '已完成'}`,
      metric: `步骤 ${index + 1}/${plan.length} 完成`,
      bubble: '完成',
    })
  }

  const savedResults = results.filter((item) => item.result?.savedPath)
  const reportPreview = savedResults.length ? buildChatReportPreview(results) : ''
  const finalAnswer = savedResults.length
    ? [
        '完成了，报告已整理并保存。',
        ...savedResults.flatMap((item) => (item.result?.files ?? []).map((file) => `文件：${file}`)),
        '完整内容已写入文件，聊天里先放简版摘要。',
        reportPreview ? `摘要：${reportPreview}` : null,
      ].filter(Boolean).join('\n')
    : results.length === 1
    ? results[0].result?.answer ?? `${results[0].agentName}: ${results[0].summary || '已完成'}`
    : [
        `主控已完成 ${results.length} 个步骤：`,
        ...results.map((item, index) => `${index + 1}. ${item.agentName}: ${item.summary || '已完成'}`),
      ].join('\n')

  return {
    answer: finalAnswer,
    plan,
    results,
  }
}

async function startTask({ message, requestedAgentId, threadId }) {
  const agentId = classifyAgent(message, requestedAgentId)
  const agent = AGENTS.find((item) => item.id === agentId)
  if (!agent) throw new Error(`Unknown agent: ${agentId}`)

  const taskId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  activeTasks.set(taskId, {
    taskId,
    agentId,
    message,
    threadId,
    startedAt: new Date().toISOString(),
  })
  emitEvent({
    type: 'task_started',
    taskId,
    agentId,
    threadId,
    message,
    metric: `${agent.name} 已接管`,
    bubble: agent.executor,
  })

  executeTask({ taskId, agentId, message })
    .then((result) => {
      if (result?.pendingAction) return
      activeTasks.delete(taskId)
      emitEvent({
        type: 'task_finished',
        taskId,
        agentId,
        threadId,
        result: compactResultForClient(result),
        metric: '任务已完成',
        bubble: '完成',
      })
    })
    .catch((error) => {
      activeTasks.delete(taskId)
      emitEvent({
        type: 'task_failed',
        taskId,
        agentId,
        threadId,
        error: error.message,
        metric: '执行失败',
        bubble: '异常',
      })
    })

  return { ok: true, taskId, agentId, threadId, status: 'running' }
}

async function confirmAction(actionId) {
  const action = pendingActions.get(actionId)
  if (!action) throw new Error(`Unknown pending action: ${actionId}`)

  if (action.type === 'open_app') {
    const result = await runCommandAsync('open', ['-a', action.appName], { cwd: '/', timeout: 8000 })
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `open -a ${action.appName} failed`)
    }
  }

  if (action.type === 'open_file') {
    const result = await runCommandAsync('open', [action.filePath], { cwd: '/', timeout: 8000 })
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `open ${action.filePath} failed`)
    }
  }

  if (action.type === 'delete_file') {
    await rm(action.sourcePath, { force: false })
    invalidateFileIndex()
  }

  if (action.type === 'rename_file' || action.type === 'move_file') {
    await mkdir(path.dirname(action.targetPath), { recursive: true })
    await rename(action.sourcePath, action.targetPath)
    invalidateFileIndex()
  }

  if (action.type === 'copy_file') {
    await mkdir(path.dirname(action.targetPath), { recursive: true })
    await copyFile(action.sourcePath, action.targetPath)
    invalidateFileIndex()
  }

  if (action.type === 'cleanup_reports' || action.type === 'delete_files') {
    for (const filePath of action.deletePaths ?? []) {
      await rm(filePath, { force: true }).catch(() => {})
    }
    invalidateFileIndex()
  }

  pendingActions.delete(actionId)
  const result = {
    answer: `已确认并执行：${action.title}`,
  }
  if (action.type === 'open_file') {
    result.files = [action.relativePath]
    result.savedPath = action.filePath
    result.format = path.extname(action.filePath).replace(/^\./, '')
  }
  if (action.type === 'cleanup_reports' || action.type === 'delete_files') {
    result.answer = [
      `已删除 ${action.deletePaths?.length ?? 0} 个文件。`,
      action.keepPath ? `保留：${path.relative(WORKSPACE_ROOT, action.keepPath)}` : null,
    ].filter(Boolean).join('\n')
    result.files = action.keepPath ? [path.relative(WORKSPACE_ROOT, action.keepPath)] : []
  }
  emitEvent({
    type: 'task_finished',
    taskId: action.taskId,
    agentId: action.ownerAgentId ?? action.agentId,
    threadId: action.threadId,
    result,
    metric: '已执行确认动作',
    bubble: '完成',
  })
  activeTasks.delete(action.taskId)
  return { ok: true, actionId }
}

export {
  startTask,
  confirmAction,
  executeTask,
}
