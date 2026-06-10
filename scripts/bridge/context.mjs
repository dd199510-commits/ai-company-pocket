// context.mjs — 跨任务上下文：会话历史摘要、最近保存文件、主控运行时上下文。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { NOTE_ARTIFACT_ROOT, WORKSPACE_ROOT } from './config.mjs'
import { readHistory, readHistoryEvents } from './events.mjs'
import { isSaveClarificationAnswer, isSaveControlMessage } from './infer.mjs'
import { normalizeArtifactPath } from './lib.mjs'

async function findLastSaveableAnswer(currentTaskId, threadId) {
  const events = await readHistoryEvents()
  const startedMessages = new Map()
  const startedThreads = new Map()
  for (const event of events) {
    if (event.type === 'task_started' && event.taskId && event.message) {
      startedMessages.set(event.taskId, event.message)
      if (event.threadId) startedThreads.set(event.taskId, event.threadId)
    }
  }

  for (const event of [...events].reverse()) {
    if (event.taskId === currentTaskId) continue
    if (event.type !== 'task_finished') continue
    const eventThreadId = event.threadId ?? startedThreads.get(event.taskId)
    if (threadId && eventThreadId && eventThreadId !== threadId) continue
    const answer = event.result?.answer
    if (!answer || typeof answer !== 'string') continue
    const sourceMessage = startedMessages.get(event.taskId) ?? ''
    if (isSaveControlMessage(sourceMessage)) continue
    if (isSaveClarificationAnswer(answer)) continue
    return {
      taskId: event.taskId,
      sourceMessage,
      answer,
    }
  }
  return null
}

async function findRecentSavedFile(currentTaskId, threadId) {
  const files = await findRecentSavedFiles(currentTaskId, threadId, 1)
  return files[0] ?? null
}

function collectSavedFilesFromResult(result, bucket = []) {
  if (!result || typeof result !== 'object') return bucket
  if (Array.isArray(result.sourceFiles)) {
    for (const sourceFile of result.sourceFiles) {
      const candidatePath = normalizeArtifactPath(sourceFile)
      if (candidatePath && existsSync(candidatePath)) {
        bucket.push({
          path: candidatePath,
          relativePath: path.relative(WORKSPACE_ROOT, candidatePath),
          format: path.extname(candidatePath).replace(/^\./, ''),
        })
      }
    }
  }
  if (result.savedPath || result.files?.length) {
    const savedPath = result.savedPath
    const relativePath = result.files?.find((file) => String(file).startsWith('artifacts/notes/'))
    const candidatePath = savedPath ?? (relativePath ? path.resolve(WORKSPACE_ROOT, relativePath) : null)
    if (candidatePath && existsSync(candidatePath)) {
      bucket.push({
        path: candidatePath,
        relativePath: relativePath ?? path.relative(WORKSPACE_ROOT, candidatePath),
        format: result.format ?? path.extname(candidatePath).replace(/^\./, ''),
      })
    }
  }
  if (Array.isArray(result.results)) {
    for (const item of result.results) collectSavedFilesFromResult(item.result, bucket)
  }
  return bucket
}

async function findRecentSavedFiles(currentTaskId, threadId, limit = 6) {
  const events = await readHistoryEvents()
  const startedThreads = new Map()
  for (const event of events) {
    if (event.type === 'task_started' && event.taskId && event.threadId) {
      startedThreads.set(event.taskId, event.threadId)
    }
  }

  const collect = (strictThread) => {
    const seen = new Set()
    const matches = []
    for (const event of [...events].reverse()) {
      if (event.taskId === currentTaskId || event.type !== 'task_finished') continue
      const eventThreadId = event.threadId ?? startedThreads.get(event.taskId)
      if (threadId && strictThread && eventThreadId !== threadId) continue
      for (const file of collectSavedFilesFromResult(event.result)) {
        if (seen.has(file.path)) continue
        seen.add(file.path)
        matches.push(file)
        if (matches.length >= limit) return matches
      }
    }
    return matches
  }

  if (threadId) {
    const strictMatches = collect(true)
    if (strictMatches.length) return strictMatches
  }
  return collect(false)
}

async function buildSupervisorRuntimeContext(taskId, threadId) {
  const recentSavedFile = await findRecentSavedFile(taskId, threadId).catch(() => null)
  return {
    workspaceRoot: WORKSPACE_ROOT,
    defaultSaveDir: path.relative(WORKSPACE_ROOT, NOTE_ARTIFACT_ROOT),
    defaultSaveDirAbsolute: NOTE_ARTIFACT_ROOT,
    supportedSaveFormats: ['md', 'txt', 'html', 'doc', 'docx', 'pdf'],
    recentSavedFile: recentSavedFile
      ? {
          relativePath: recentSavedFile.relativePath,
          absolutePath: recentSavedFile.path,
          format: recentSavedFile.format,
        }
      : null,
  }
}
async function buildConversationContext(currentTaskId, threadId) {
  const history = await readHistory(20)
  return history
    .filter((item) => item.taskId !== currentTaskId)
    .filter((item) => !threadId || !item.threadId || item.threadId === threadId)
    .filter((item) => item.status === 'done' || item.status === 'waiting_confirmation')
    .slice(0, 6)
    .reverse()
    .map((item) => ({
      user: item.message,
      status: item.status,
      summary: item.summary,
      pendingAction: item.pendingAction?.title ?? null,
    }))
}

export {
  findLastSaveableAnswer,
  findRecentSavedFile,
  findRecentSavedFiles,
  collectSavedFilesFromResult,
  buildSupervisorRuntimeContext,
  buildConversationContext,
}
