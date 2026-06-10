// executors/writing.mjs — 文书助手执行器：起草/润色/总结 + 录音转写生成会议纪要。
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  FASTER_WHISPER_TRANSCRIBE,
  NOTE_ARTIFACT_ROOT,
  PLANNER_API_KEY,
  PLANNER_BASE_URL,
  PLANNER_MODE,
  PLANNER_MODEL,
  WORKSPACE_ROOT,
} from '../config.mjs'
import { emitEvent } from '../events.mjs'
import {
  extractAudioFilePath,
  normalizeArtifactPath,
  parsePlannerJson,
  runCommandAsync,
  slugifyFilename,
  stringArg,
  truncateAtBoundary,
  unsupportedCapabilityResult,
} from '../lib.mjs'
import { callPlannerJson } from '../planner.mjs'
import { invalidateFileIndex } from './file.mjs'

function extractTranscriptText(raw) {
  return String(raw ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^\s*(Detected language|ETA|Loading model|Transcribing|Processing|Progress)/i.test(line))
    .join('\n')
    .trim()
}

function buildSimpleMeetingMinutes(transcript, sourceName) {
  const lines = transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const preview = lines.slice(0, 12)
  return [
    `# ${sourceName} 会议纪要`,
    '',
    `- 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    `- 来源录音：${sourceName}`,
    '',
    '## 摘要',
    preview.length ? preview.join('\n') : '转写稿为空，未能提取摘要。',
    '',
    '## 行动项',
    '- 暂未自动识别到明确行动项，请结合转写稿复核。',
    '',
    '## 转写稿',
    transcript || '未识别到文字。',
    '',
  ].join('\n')
}

async function synthesizeMeetingMinutes({ transcript, sourceName }) {
  if (!PLANNER_API_KEY || !transcript.trim()) return null
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
            '你是文书助手，擅长整理录音转写稿和会议纪要。',
            '请根据转写稿生成简体中文纪要。',
            'Return only JSON: {"minutes":"..."}',
            '结构必须包含：会议摘要、关键讨论、结论/决定、行动项（负责人未知则写待确认）、风险/待补充。',
            '不要编造转写稿没有的信息。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            sourceName,
            transcript: transcript.slice(0, 18000),
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
  return typeof parsed.minutes === 'string' && parsed.minutes.trim() ? parsed.minutes.trim() : null
}

async function transcribeMeetingAudio({ taskId, agentId, message }) {
  const rawPath = extractAudioFilePath(message)
  if (!rawPath) {
    return {
      answer: [
        '可以，文书助手已经准备好接录音识别和纪要整理能力。',
        '请给我一个本地录音文件路径，例如：',
        '识别 /Users/you/meeting.m4a 并整理会议纪要',
        '',
        '支持常见格式：mp3、m4a、wav、aac、flac、ogg、mp4、mov。',
      ].join('\n'),
    }
  }

  const audioPath = normalizeArtifactPath(rawPath)
  if (!audioPath || !existsSync(audioPath)) {
    return { answer: `我没找到录音文件：${rawPath}` }
  }
  if (!existsSync(FASTER_WHISPER_TRANSCRIBE)) {
    return { answer: `本地转写脚本不存在：${FASTER_WHISPER_TRANSCRIBE}` }
  }

  const stem = slugifyFilename(path.basename(audioPath, path.extname(audioPath)))
  const date = new Date().toISOString().slice(0, 10)
  const transcriptPath = path.join(NOTE_ARTIFACT_ROOT, `${date}-${stem}-转写稿.txt`)
  const minutesPath = path.join(NOTE_ARTIFACT_ROOT, `${date}-${stem}-会议纪要.md`)
  const relativeAudio = path.relative(WORKSPACE_ROOT, audioPath)
  const relativeTranscript = path.relative(WORKSPACE_ROOT, transcriptPath)
  const relativeMinutes = path.relative(WORKSPACE_ROOT, minutesPath)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-audio-transcribe`,
    status: 'running',
    title: '识别会议录音',
    detail: relativeAudio,
    metric: '本地 Whisper 转写中',
    bubble: '转写',
  })

  await mkdir(NOTE_ARTIFACT_ROOT, { recursive: true })
  const transcribeResult = await runCommandAsync(FASTER_WHISPER_TRANSCRIBE, [
    audioPath,
    '--format', 'text',
    '--detect-paragraphs',
    '-o', transcriptPath,
  ], { timeout: 30 * 60 * 1000 })
  if (transcribeResult.status !== 0) {
    throw new Error(transcribeResult.stderr.trim() || '录音转写失败')
  }

  const transcript = existsSync(transcriptPath)
    ? extractTranscriptText(await readFile(transcriptPath, 'utf8'))
    : extractTranscriptText(transcribeResult.stdout)
  await writeFile(transcriptPath, transcript, 'utf8')

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-audio-transcribe`,
    status: 'done',
    title: '识别会议录音',
    detail: `已写入 ${relativeTranscript}`,
    metric: '转写完成',
    bubble: '完成',
  })

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-minutes-build`,
    status: 'running',
    title: '整理会议纪要',
    detail: '根据转写稿生成纪要',
    metric: '纪要生成中',
    bubble: '纪要',
  })

  const llmMinutes = await synthesizeMeetingMinutes({
    transcript,
    sourceName: path.basename(audioPath),
  }).catch((error) => {
    console.error(`[writing-agent] minutes synthesis skipped: ${error.message}`)
    return null
  })
  const minutes = llmMinutes ?? buildSimpleMeetingMinutes(transcript, path.basename(audioPath))
  await writeFile(minutesPath, minutes, 'utf8')
  invalidateFileIndex()

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-minutes-build`,
    status: 'done',
    title: '整理会议纪要',
    detail: `已写入 ${relativeMinutes}`,
    metric: '纪要完成',
    bubble: '完成',
  })

  return {
    answer: [
      '录音已识别，并整理成纪要。',
      `转写稿：${relativeTranscript}`,
      `纪要文件：${relativeMinutes}`,
      '',
      `纪要预览：${truncateAtBoundary(minutes, 420)}`,
    ].join('\n'),
    transcriptPath,
    minutesPath,
    files: [relativeTranscript, relativeMinutes],
    transcriptPreview: transcript.slice(0, 1200),
  }
}
function normalizeWritingAction(action) {
  const allowed = new Set(['draft', 'polish', 'summarize', 'minutes_from_audio', 'unknown'])
  const normalized = String(action ?? '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'unknown'
}

async function buildWritingAgentIntent({ message }) {
  if (!PLANNER_API_KEY || PLANNER_MODE !== 'llm') {
    return {
      action: extractAudioFilePath(message) ? 'minutes_from_audio' : 'draft',
      confidence: 0.6,
      instruction: message,
    }
  }
  const parsed = await callPlannerJson({
    system: [
      'You are the embedded intent model inside a writing/document assistant.',
      'Decide the writing operation. Do not perform the writing in this step.',
      'Return only JSON: {"action":"draft|polish|summarize|minutes_from_audio|unknown","confidence":0.0,"instruction":"..."}',
      'Use draft for writing reports, briefs, copy, scripts, meeting materials, summaries to be written from given context, and general text material creation.',
      'Use polish for rewriting, improving wording, making text more formal, more concise, or more human.',
      'Use summarize for summarizing pasted text or provided material when no local file operation is requested.',
      'Use minutes_from_audio for audio transcription, recording recognition, or generating minutes from audio/video files.',
      'Preserve the user language in instruction.',
    ].join('\n'),
    payload: {
      userMessage: message,
      audioPath: extractAudioFilePath(message),
    },
  })
  return {
    action: normalizeWritingAction(parsed.action),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
    instruction: typeof parsed.instruction === 'string' && parsed.instruction.trim() ? parsed.instruction.trim() : message,
  }
}

async function generateWritingMaterial({ taskId, agentId, message, intent }) {
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-writing-draft`,
    status: 'running',
    title: '撰写文字材料',
    detail: intent.action,
    metric: '模型撰写中',
    bubble: '撰写',
  })

  const parsed = await callPlannerJson({
    system: [
      'You are a professional Chinese writing assistant for office materials.',
      'Return only JSON: {"answer":"..."}',
      'Write concise, useful, well-structured Simplified Chinese.',
      'If the user asked for polishing or summarizing, only use the supplied user text and do not invent missing facts.',
      'If key context is missing, produce a useful draft and clearly mark assumptions or questions at the end.',
    ].join('\n'),
    payload: {
      action: intent.action,
      userMessage: message,
      instruction: intent.instruction,
    },
  })
  const answer = typeof parsed.answer === 'string' && parsed.answer.trim()
    ? parsed.answer.trim()
    : '我没有生成出可用的文字材料。'

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-writing-draft`,
    status: 'done',
    title: '撰写文字材料',
    detail: truncateAtBoundary(answer, 180),
    metric: '撰写完成',
    bubble: '完成',
  })

  return { answer }
}

async function executeWritingAgent({ taskId, agentId, message }) {
  const intent = await buildWritingAgentIntent({ message })
  if (intent.action === 'minutes_from_audio') {
    return transcribeMeetingAudio({ taskId, agentId, message: intent.instruction })
  }
  if (intent.action === 'unknown' || intent.confidence < 0.45) {
    return {
      answer: '我还没判断清楚要写哪类材料。你可以直接说：写一份会议纪要、起草邮件、润色这段话、整理成汇报稿。',
    }
  }
  return generateWritingMaterial({ taskId, agentId, message, intent })
}
async function executeWritingCapability({ taskId, agentId, step, previousResult }) {
  const args = step.args ?? {}
  const priorText = previousResult?.answer || previousResult?.text || previousResult?.raw || ''
  const messageWithContext = priorText
    ? [
        step.message,
        '',
        '上一步助手结果：',
        String(priorText).slice(0, 12000),
      ].join('\n')
    : step.message
  if (step.capability === 'minutes_from_audio') {
    const audioPath = stringArg(args, 'audioPath')
    const message = audioPath ? `${messageWithContext}\n录音文件：${audioPath}` : messageWithContext
    return transcribeMeetingAudio({ taskId, agentId, message })
  }
  if (step.capability === 'draft_text') {
    return generateWritingMaterial({ taskId, agentId, message: messageWithContext, intent: { action: 'draft', instruction: stringArg(args, 'instruction') ?? step.message } })
  }
  if (step.capability === 'polish_text') {
    return generateWritingMaterial({ taskId, agentId, message: messageWithContext, intent: { action: 'polish', instruction: stringArg(args, 'instruction') ?? step.message } })
  }
  if (step.capability === 'summarize_text') {
    return generateWritingMaterial({ taskId, agentId, message: messageWithContext, intent: { action: 'summarize', instruction: stringArg(args, 'instruction') ?? step.message } })
  }
  return unsupportedCapabilityResult('文书助手', step.capability)
}

export {
  executeWritingAgent,
  executeWritingCapability,
}
