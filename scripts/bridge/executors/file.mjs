// executors/file.mjs — 文件助手执行器：索引/检索/读取/保存/转换/改写/比较/管理。
// 对外只暴露 executeFileAgent（直连模式）与 executeFileCapability（能力管线模式）。
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ARTIFACT_ROOT,
  FILE_INDEX_PATH,
  NOTE_ARTIFACT_ROOT,
  PLANNER_API_KEY,
  PLANNER_MODE,
  WORKSPACE_ROOT,
} from '../config.mjs'
import { activeTasks, emitEvent, pendingActions } from '../events.mjs'
import { findLastSaveableAnswer, findRecentSavedFile, findRecentSavedFiles } from '../context.mjs'
import {
  inferNoteTitle,
  inferReportFormat,
  inferRequestedReportPath,
  inferSaveFormat,
  isDocumentConversionRequest,
  isFileManagementRequest,
  isFileSummaryRequest,
  isReportCountRequest,
  isReportListRequest,
  saveFormatLabel,
  wantsGeneratedFileSave,
  wantsIndexedFileList,
  wantsIndexedFileLocations,
} from '../infer.mjs'
import {
  arrayArg,
  ensureWorkspaceFile,
  extractFilePathReferences,
  extractFirstFilePath,
  escapeHtml,
  htmlToStructuredText,
  markdownToBasicHtml,
  normalizeTargetFilePath,
  resolveExistingFileReference,
  runCommandAsync,
  slugifyFilename,
  stringArg,
  stripMarkdown,
  tokenizeText,
  topKeywords,
  formatFileSize,
  unsupportedCapabilityResult,
} from '../lib.mjs'
import { callPlannerJson } from '../planner.mjs'

let cachedFileIndex = null

function invalidateFileIndex() {
  cachedFileIndex = null
}

function getFileIndexInfo() {
  return cachedFileIndex
    ? {
        builtAt: cachedFileIndex.builtAt,
        fileCount: cachedFileIndex.files.length,
      }
    : null
}

function buildSavedContent({ title, sourceMessage, answer, format }) {
  const savedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const markdown = [
    `# ${title}`,
    '',
    `- 保存时间：${savedAt}`,
    sourceMessage ? `- 来源问题：${sourceMessage}` : null,
    '',
    '---',
    '',
    answer.trim(),
    '',
  ].filter((line) => line !== null).join('\n')

  if (format === 'txt') return stripMarkdown(markdown)

  if (format === 'html' || format === 'doc') {
    return [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8">',
      `<title>${escapeHtml(title)}</title>`,
      '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65;color:#111827;padding:32px;}h1,h2,h3,h4{line-height:1.35;}hr{border:0;border-top:1px solid #d1d5db;margin:20px 0;}p{margin:8px 0;}</style>',
      '</head>',
      '<body>',
      markdownToBasicHtml(markdown),
      '</body>',
      '</html>',
      '',
    ].join('\n')
  }

  return markdown
}

async function writeDocxFile(filePath, { title, sourceMessage, answer }) {
  const payloadPath = path.join(ARTIFACT_ROOT, `docx-payload-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.json`)
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeFile(payloadPath, JSON.stringify({ title, sourceMessage, answer }), 'utf8')
  const script = String.raw`
import json, sys
from docx import Document

payload_path, output_path = sys.argv[1], sys.argv[2]
with open(payload_path, 'r', encoding='utf-8') as f:
    payload = json.load(f)

doc = Document()
doc.add_heading(payload.get('title') or '文档', 0)
if payload.get('sourceMessage'):
    doc.add_paragraph('来源：' + payload['sourceMessage'])
for block in str(payload.get('answer') or '').split('\n'):
    text = block.strip()
    if not text:
        continue
    if text.startswith('#'):
        doc.add_heading(text.lstrip('#').strip(), level=1)
    elif text.startswith(('- ', '* ')):
        doc.add_paragraph(text[2:].strip(), style='List Bullet')
    else:
        doc.add_paragraph(text)
doc.save(output_path)
`
  const result = await runCommandAsync('python3', ['-c', script, payloadPath, filePath], { timeout: 15000 })
  await rm(payloadPath, { force: true }).catch(() => {})
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '生成 DOCX 失败')
  }
}

async function writePdfFile(filePath, { title, sourceMessage, answer }) {
  const payloadPath = path.join(ARTIFACT_ROOT, `pdf-payload-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.json`)
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeFile(payloadPath, JSON.stringify({ title, sourceMessage, answer }), 'utf8')
  const script = String.raw`
import json, sys
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
except Exception:
    print('missing reportlab', file=sys.stderr)
    sys.exit(12)

payload_path, output_path = sys.argv[1], sys.argv[2]
with open(payload_path, 'r', encoding='utf-8') as f:
    payload = json.load(f)
c = canvas.Canvas(output_path, pagesize=A4)
width, height = A4
y = height - 48
for line in [payload.get('title') or '文档', payload.get('sourceMessage') or '', ''] + str(payload.get('answer') or '').split('\n'):
    safe = line.encode('latin-1', 'replace').decode('latin-1')
    c.drawString(48, y, safe[:95])
    y -= 16
    if y < 48:
        c.showPage()
        y = height - 48
c.save()
`
  const result = await runCommandAsync('python3', ['-c', script, payloadPath, filePath], { timeout: 15000 })
  await rm(payloadPath, { force: true }).catch(() => {})
  if (result.status === 12) {
    throw new Error('PDF 生成需要 reportlab 或 pandoc，目前本机未安装；我可以先保存成 docx/doc/html。')
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '生成 PDF 失败')
  }
}

async function writeSavedFile(filePath, { title, sourceMessage, answer, format }) {
  await mkdir(path.dirname(filePath), { recursive: true })
  if (format === 'docx') {
    await writeDocxFile(filePath, { title, sourceMessage, answer })
    return
  }
  if (format === 'pdf') {
    await writePdfFile(filePath, { title, sourceMessage, answer })
    return
  }
  await writeFile(filePath, buildSavedContent({ title, sourceMessage, answer, format }), 'utf8')
}

async function saveReportFromResult({ taskId, agentId, userMessage, stepMessage, previousResult, format: requestedFormat, title: requestedTitle }) {
  const answer = previousResult?.answer
    ?? previousResult?.summary
    ?? (typeof previousResult === 'string' ? previousResult : '')
  if (!answer || !String(answer).trim()) {
    return {
      answer: '前一步还没有可写入报告的内容，所以没有生成文件。',
    }
  }

  const pathHint = `${userMessage}\n${stepMessage}\n${requestedFormat ?? ''}\n${requestedTitle ?? ''}`
  const format = requestedFormat ?? inferReportFormat(pathHint)
  const title = (requestedTitle || inferNoteTitle(userMessage, answer)).replace(/参观准备$/, '信息报告')
  const filePath = inferRequestedReportPath(`${pathHint}\n保存为 ${slugifyFilename(title)}.${format}`, title)
  const relativePath = path.relative(WORKSPACE_ROOT, filePath)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-report`,
    status: 'running',
    title: '生成报告文件',
    detail: `准备写入 ${relativePath}`,
    metric: `写入 ${saveFormatLabel(format)}`,
    bubble: '保存',
  })

  await writeSavedFile(filePath, {
    title,
    sourceMessage: userMessage,
    answer: String(answer),
    format,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-report`,
    status: 'done',
    title: '生成报告文件',
    detail: `已写入 ${relativePath}`,
    metric: '报告已保存',
    bubble: '完成',
  })

  return {
    answer: `报告已生成：${relativePath}`,
    files: [relativePath],
    savedPath: filePath,
    format,
  }
}
async function savePreviousAnswerAsNote({ taskId, agentId, threadId, format = 'md' }) {
  const target = await findLastSaveableAnswer(taskId, threadId)
  if (!target) {
    return {
      answer: '我没找到上一段可保存的完整内容。你可以先让我生成一段内容，再说“保存起来”。',
    }
  }
  const title = inferNoteTitle(target.sourceMessage, target.answer)
  const date = new Date().toISOString().slice(0, 10)
  const fileName = `${date}-${slugifyFilename(title)}.${format}`
  const filePath = path.join(NOTE_ARTIFACT_ROOT, fileName)
  const relativePath = path.relative(WORKSPACE_ROOT, filePath)
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-note`,
    status: 'running',
    title: '保存本地笔记',
    detail: `准备写入 ${relativePath}`,
    metric: `写入 ${saveFormatLabel(format)}`,
    bubble: '保存',
  })

  await writeSavedFile(filePath, {
    title,
    sourceMessage: target.sourceMessage,
    answer: target.answer,
    format,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-note`,
    status: 'done',
    title: '保存本地笔记',
    detail: `已写入 ${relativePath}`,
    metric: '保存完成',
    bubble: '完成',
  })

  return {
    answer: `保存好了。我把刚才那段内容存成了 ${saveFormatLabel(format)}：${relativePath}`,
    files: [relativePath],
    savedPath: filePath,
    format,
  }
}
async function listWorkspaceFiles() {
  const rg = await runCommandAsync('rg', ['--files', '-g', '!*node_modules*', '-g', '!dist/*', '-g', '!*.png', '-g', '!*.jpg'])
  if (rg.status === 0 && rg.stdout.trim()) {
    return rg.stdout.trim().split('\n').slice(0, 80)
  }
  const find = await runCommandAsync('find', ['.', '-maxdepth', '3', '-type', 'f'])
  if (find.status === 0 && find.stdout.trim()) {
    return find.stdout.trim().split('\n').map((file) => file.replace(/^\.\//, '')).slice(0, 80)
  }
  return []
}

function isIndexableTextFile(file) {
  return /\.(md|txt|js|jsx|mjs|json|css|html|ts|tsx|yml|yaml)$/i.test(file)
    && !file.includes('package-lock.json')
}
function publicFileEntry(entry) {
  return {
    file: entry.file,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    preview: entry.preview,
    keywords: entry.keywords,
  }
}

function findSnippet(content, queryTokens) {
  const lower = content.toLowerCase()
  const matchIndex = queryTokens
    .map((token) => lower.indexOf(token.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  const start = Math.max(0, (matchIndex ?? 0) - 120)
  return content.slice(start, start + 360).replace(/\s+/g, ' ').trim()
}

async function buildFileIndex() {
  const files = (await listWorkspaceFiles()).filter(isIndexableTextFile)
  const indexed = []
  for (const file of files) {
    const absolutePath = path.resolve(WORKSPACE_ROOT, file)
    if (!absolutePath.startsWith(WORKSPACE_ROOT)) continue
    const [content, fileStat] = await Promise.all([
      readFile(absolutePath, 'utf8').catch(() => ''),
      stat(absolutePath).catch(() => null),
    ])
    if (!content.trim()) continue
    indexed.push({
      file,
      size: fileStat?.size ?? content.length,
      mtimeMs: fileStat?.mtimeMs ?? null,
      preview: content.slice(0, 900).trim(),
      keywords: topKeywords(content),
      content,
    })
  }

  cachedFileIndex = {
    builtAt: new Date().toISOString(),
    root: WORKSPACE_ROOT,
    files: indexed,
  }

  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeFile(FILE_INDEX_PATH, JSON.stringify({
    ...cachedFileIndex,
    files: cachedFileIndex.files.map(publicFileEntry),
  }, null, 2), 'utf8')

  return cachedFileIndex
}

async function getFileIndex() {
  if (cachedFileIndex) return cachedFileIndex
  return buildFileIndex()
}

async function searchFileIndex(message, limit = 5) {
  const index = await getFileIndex()
  const queryTokens = tokenizeText(message)
  const scored = index.files.map((entry) => {
    const filename = entry.file.toLowerCase()
    const content = entry.content.toLowerCase()
    const keywordSet = new Set(entry.keywords.map((item) => item.term))
    const score = queryTokens.reduce((sum, token) => {
      const lower = token.toLowerCase()
      return sum
        + (filename.includes(lower) ? 8 : 0)
        + (keywordSet.has(lower) ? 5 : 0)
        + (content.includes(lower) ? 2 : 0)
    }, 0)
    return {
      file: entry.file,
      score,
      size: entry.size,
      keywords: entry.keywords.slice(0, 6),
      snippet: findSnippet(entry.content, queryTokens),
    }
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  return {
    builtAt: index.builtAt,
    totalFiles: index.files.length,
    matches: scored.slice(0, limit),
  }
}

function chooseReadableFiles(files, message) {
  const keywords = message
    .toLowerCase()
    .split(/[\s，。,.、/]+/)
    .filter((word) => word.length > 1)
  const textFilePattern = /\.(md|txt|js|jsx|mjs|json|css|html)$/i
  const scored = files
    .filter((file) => textFilePattern.test(file))
    .map((file) => {
      const lower = file.toLowerCase()
      const score = keywords.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 2 : 0), 0)
        + (/(readme|package|app|bridge|agents)/i.test(file) ? 1 : 0)
      return { file, score }
    })
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, 5).map((item) => item.file)
}
async function listSavedReportFiles() {
  return listSavedArtifactFiles({ scope: 'reports' })
}

function normalizeSavedFileScope(value, message = '') {
  const text = `${value ?? ''} ${message}`.toLowerCase()
  if (/报告|report/.test(text)) return 'reports'
  return 'notes'
}

async function listSavedArtifactFiles({ scope = 'notes', query = '', format = '' } = {}) {
  const entries = await readdir(NOTE_ARTIFACT_ROOT, { withFileTypes: true }).catch(() => [])
  const loweredQuery = String(query ?? '').trim().toLowerCase()
  const normalizedFormat = String(format ?? '').trim().replace(/^\./, '').toLowerCase()
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('~$'))
    .filter((entry) => /\.(docx?|pdf|html?|txt|md)$/i.test(entry.name))
    .filter((entry) => scope !== 'reports' || /报告/i.test(entry.name))
    .filter((entry) => !loweredQuery || entry.name.toLowerCase().includes(loweredQuery))
    .filter((entry) => !normalizedFormat || path.extname(entry.name).replace(/^\./, '').toLowerCase() === normalizedFormat)
    .map(async (entry) => {
      const filePath = path.join(NOTE_ARTIFACT_ROOT, entry.name)
      const fileStat = await stat(filePath).catch(() => null)
      return {
        name: entry.name,
        path: filePath,
        relativePath: path.relative(WORKSPACE_ROOT, filePath),
        mtimeMs: fileStat?.mtimeMs ?? 0,
      }
    }))
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function countSavedFiles({ taskId, agentId, scope = 'notes', query = '', format = '' }) {
  const normalizedScope = normalizeSavedFileScope(scope)
  const files = await listSavedArtifactFiles({ scope: normalizedScope, query, format })
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-count-saved-files`,
    status: 'done',
    title: '统计已保存文件',
    detail: `${NOTE_ARTIFACT_ROOT}`,
    metric: `${files.length} 个文件`,
    bubble: '统计',
  })
  const preview = files.slice(0, 8).map((file, index) => `${index + 1}. ${file.relativePath}`).join('\n')
  const scopeLabel = normalizedScope === 'reports' ? '报告文件' : '已保存文件'
  return {
    answer: [
      `按默认保存目录 artifacts/notes 来算，当前匹配到 ${files.length} 个${scopeLabel}。`,
      files.length ? `最近几个是：\n${preview}` : null,
    ].filter(Boolean).join('\n\n'),
    files: files.map((file) => file.relativePath),
    fileCount: files.length,
  }
}

async function listSavedFiles({ taskId, agentId, scope = 'notes', query = '', format = '' }) {
  const normalizedScope = normalizeSavedFileScope(scope)
  const files = await listSavedArtifactFiles({ scope: normalizedScope, query, format })
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-list-saved-files`,
    status: 'done',
    title: '列出已保存文件',
    detail: `${NOTE_ARTIFACT_ROOT}`,
    metric: `${files.length} 个文件`,
    bubble: '文件',
  })
  const scopeLabel = normalizedScope === 'reports' ? '报告文件' : '已保存文件'
  return {
    answer: files.length
      ? [
          `当前默认保存目录 artifacts/notes 里有 ${files.length} 个${scopeLabel}：`,
          files.map((file, index) => `${index + 1}. ${file.relativePath}`).join('\n'),
        ].join('\n\n')
      : `当前默认保存目录 artifacts/notes 里没有匹配的${scopeLabel}。`,
    files: files.map((file) => file.relativePath),
    fileCount: files.length,
  }
}

async function countSavedReports({ taskId, agentId }) {
  const reports = await listSavedReportFiles()
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-count-reports`,
    status: 'done',
    title: '统计已生成报告',
    detail: `${NOTE_ARTIFACT_ROOT}`,
    metric: `${reports.length} 个报告文件`,
    bubble: '统计',
  })
  const preview = reports.slice(0, 8).map((file, index) => `${index + 1}. ${file.relativePath}`).join('\n')
  return {
    answer: [
      `按默认保存目录 artifacts/notes 里“文件名包含「报告」”来算，你之前生成了 ${reports.length} 个报告文件。`,
      reports.length ? `最近几个是：\n${preview}` : null,
    ].filter(Boolean).join('\n\n'),
    files: reports.map((file) => file.relativePath),
    reportCount: reports.length,
  }
}

async function listSavedReports({ taskId, agentId }) {
  const reports = await listSavedReportFiles()
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-list-reports`,
    status: 'done',
    title: '列出已生成报告',
    detail: `${NOTE_ARTIFACT_ROOT}`,
    metric: `${reports.length} 个报告文件`,
    bubble: '报告',
  })
  return {
    answer: reports.length
      ? [
          `当前默认保存目录 artifacts/notes 里有 ${reports.length} 个报告文件：`,
          reports.map((file, index) => `${index + 1}. ${file.relativePath}`).join('\n'),
        ].join('\n\n')
      : '当前默认保存目录 artifacts/notes 里还没有文件名包含「报告」的报告文件。',
    files: reports.map((file) => file.relativePath),
    reportCount: reports.length,
  }
}

async function saveIndexedFileList({ taskId, agentId, message, index }) {
  const wantsLocations = wantsIndexedFileLocations(message)
  const format = inferReportFormat(message)
  const title = wantsLocations ? '工作区索引文件路径' : '工作区可索引文件列表'
  const filePath = inferRequestedReportPath(message, title)
  const relativePath = path.relative(WORKSPACE_ROOT, filePath)
  const body = wantsLocations
    ? [
        `工作区根目录：${WORKSPACE_ROOT}`,
        '',
        '完整路径：',
        formatIndexedFileLocations(index.files),
      ].join('\n')
    : [
        `文件助手当前索引到 ${index.files.length} 个可读取文本文件：`,
        '',
        formatIndexedFileList(index.files),
      ].join('\n')

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-indexed-files`,
    status: 'running',
    title: '保存文件清单',
    detail: `准备写入 ${relativePath}`,
    metric: `写入 ${saveFormatLabel(format)}`,
    bubble: '保存',
  })

  await writeSavedFile(filePath, {
    title,
    sourceMessage: message,
    answer: body,
    format,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-save-indexed-files`,
    status: 'done',
    title: '保存文件清单',
    detail: `已写入 ${relativePath}`,
    metric: '保存完成',
    bubble: '完成',
  })

  return {
    answer: `文件清单已保存：${relativePath}`,
    files: [relativePath],
    savedPath: filePath,
    format,
    search: {
      builtAt: index.builtAt,
      totalFiles: index.files.length,
      matches: [],
    },
    indexPath: FILE_INDEX_PATH,
  }
}

function describeFileKind(file) {
  if (/\.jsx$/i.test(file)) return 'React 组件'
  if (/\.css$/i.test(file)) return '样式表'
  if (/\.mjs$/i.test(file)) return 'Node 脚本'
  if (/\.js$/i.test(file)) return 'JavaScript'
  if (/\.json$/i.test(file)) return 'JSON 配置'
  if (/\.md$/i.test(file)) return 'Markdown 文档'
  if (/\.html$/i.test(file)) return 'HTML 入口'
  return '文本文件'
}

function describeIndexedFilePurpose(file) {
  if (file === 'src/App.jsx') return '主界面组件，负责工作区、对话、任务时间线和多助手交互。'
  if (file === 'src/main.jsx') return 'React 应用入口，把 App 挂载到页面。'
  if (file === 'src/styles.css') return '全局样式，控制办公室大屏、左右分栏、聊天区和助手卡片视觉。'
  if (file === 'src/agents.js') return '前端助手目录，定义主控、文件、研究、文书、日程、应用等工位信息。'
  if (file === 'scripts/openclaw-visual-bridge.mjs') return '本地后端桥接服务，负责主控规划、能力路由、文件/联网/应用执行和 SSE 事件。'
  if (file === 'package.json') return '项目依赖和 npm 脚本配置。'
  if (file === 'package-lock.json') return '依赖版本锁定文件。'
  if (file === 'README.md') return '项目说明和运行方式。'
  if (file === 'CODE_REVIEW.md') return '代码审查记录或改造建议。'
  if (file === 'vite.config.js') return 'Vite 构建配置。'
  if (file === 'eslint.config.js') return 'ESLint 代码规范配置。'
  if (file === 'index.html') return '浏览器 HTML 入口，加载前端脚本。'
  if (/^artifacts\//.test(file)) return '运行时生成物或任务产物。'
  if (/\.md$/i.test(file)) return 'Markdown 文档。'
  if (/\.json$/i.test(file)) return '结构化配置或数据文件。'
  if (/\.css$/i.test(file)) return '样式文件。'
  if (/\.(jsx?|mjs)$/i.test(file)) return 'JavaScript 逻辑文件。'
  return '可读取文本文件。'
}
function formatIndexedFileList(files) {
  return files
    .map((entry, index) => `${index + 1}. ${entry.file}（${describeFileKind(entry.file)}，${formatFileSize(entry.size)}）：${describeIndexedFilePurpose(entry.file)}`)
    .join('\n')
}

function formatIndexedFileLocations(files) {
  return files
    .map((entry, index) => `${index + 1}. ${path.join(WORKSPACE_ROOT, entry.file)}`)
    .join('\n')
}
function parseFileManagementAction(message) {
  const source = extractFirstFilePath(message)
  if (!source) return null
  const sourcePath = ensureWorkspaceFile(source)
  if (/删除|删掉|移除/i.test(message)) {
    return {
      type: 'delete_file',
      sourcePath,
      title: `删除 ${path.basename(sourcePath)}`,
      detail: `将删除 ${path.relative(WORKSPACE_ROOT, sourcePath)}。`,
    }
  }

  const targetName = message.match(/(?:重命名为|改名为|命名为|另命名为)[：:\s'“”‘’"]*([^'"“”‘’，。；;\s]+)/i)?.[1]
  if ((/重命名|改名/i.test(message)) && targetName) {
    const targetPath = ensureWorkspaceFile(path.join(path.dirname(sourcePath), targetName))
    return {
      type: 'rename_file',
      sourcePath,
      targetPath,
      title: `重命名 ${path.basename(sourcePath)}`,
      detail: `将 ${path.relative(WORKSPACE_ROOT, sourcePath)} 重命名为 ${path.relative(WORKSPACE_ROOT, targetPath)}。`,
    }
  }

  const target = message.match(/(?:移动到|挪到|复制到|拷贝到)[：:\s'“”‘’"]*([^'"“”‘’，。；;\s]+)/i)?.[1]
  if (target && /移动|挪到|复制|拷贝/i.test(message)) {
    const normalizedTarget = target.includes('.') && !target.endsWith('/')
      ? target
      : path.join(target, path.basename(sourcePath))
    const targetPath = ensureWorkspaceFile(normalizedTarget)
    return {
      type: /复制|拷贝/i.test(message) ? 'copy_file' : 'move_file',
      sourcePath,
      targetPath,
      title: `${/复制|拷贝/i.test(message) ? '复制' : '移动'} ${path.basename(sourcePath)}`,
      detail: `将 ${path.relative(WORKSPACE_ROOT, sourcePath)} ${/复制|拷贝/i.test(message) ? '复制' : '移动'}到 ${path.relative(WORKSPACE_ROOT, targetPath)}。`,
    }
  }
  return null
}

function prepareFileManagementAction({ taskId, agentId, message }) {
  const parsed = parseFileManagementAction(message)
  if (!parsed) {
    return { answer: '我还没识别出要管理的具体文件和目标。请给出文件路径，以及要删除、重命名、移动还是复制。' }
  }
  if (!existsSync(parsed.sourcePath)) {
    return { answer: `源文件不存在：${path.relative(WORKSPACE_ROOT, parsed.sourcePath)}` }
  }
  const actionId = `action-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const action = {
    actionId,
    taskId,
    agentId,
    ownerAgentId: agentId,
    ...parsed,
    createdAt: new Date().toISOString(),
  }
  pendingActions.set(actionId, action)
  emitEvent({
    type: 'action_required',
    taskId,
    agentId,
    actionId,
    title: action.title,
    detail: action.detail,
    metric: '等待用户确认',
    bubble: '确认',
  })
  return {
    pendingAction: action,
    answer: `已准备动作：${action.title}。请确认后执行。`,
  }
}

function normalizeDeleteScope(value, message = '') {
  const text = `${value ?? ''} ${message}`.toLowerCase()
  if (/报告|report/.test(text)) return 'reports'
  if (/笔记|notes?|artifacts\/notes|生成|保存/.test(text)) return 'notes'
  if (/工作区|workspace|项目/.test(text)) return 'workspace'
  return 'notes'
}

function pathLooksSafeForBulkDelete(filePath, scope) {
  const absolute = ensureWorkspaceFile(filePath)
  const relative = path.relative(WORKSPACE_ROOT, absolute)
  if (scope === 'workspace') return false
  if (scope === 'reports' || scope === 'notes') {
    return !relative.startsWith('..')
      && !path.isAbsolute(relative)
      && relative.startsWith(`artifacts${path.sep}notes${path.sep}`)
  }
  return false
}

async function listNoteFilesForDelete({ scope, query }) {
  const entries = await readdir(NOTE_ARTIFACT_ROOT, { withFileTypes: true }).catch(() => [])
  const loweredQuery = String(query ?? '').trim().toLowerCase()
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('~$'))
    .filter((entry) => /\.(docx?|pdf|html?|txt|md)$/i.test(entry.name))
    .filter((entry) => scope !== 'reports' || /报告/i.test(entry.name))
    .filter((entry) => !loweredQuery || entry.name.toLowerCase().includes(loweredQuery))
    .map(async (entry) => {
      const filePath = path.join(NOTE_ARTIFACT_ROOT, entry.name)
      const fileStat = await stat(filePath).catch(() => null)
      return {
        path: filePath,
        relativePath: path.relative(WORKSPACE_ROOT, filePath),
        mtimeMs: fileStat?.mtimeMs ?? 0,
      }
    }))
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function resolveDeleteCandidates({ message, args = {} }) {
  const explicitPaths = [
    ...arrayArg(args, 'filePaths'),
    ...arrayArg(args, 'files'),
    ...arrayArg(args, 'paths'),
    stringArg(args, 'filePath'),
    stringArg(args, 'path'),
  ].filter(Boolean)
  const scope = normalizeDeleteScope(stringArg(args, 'scope'), message)
  const keep = stringArg(args, 'keep')
  const query = stringArg(args, 'query')

  let candidates = []
  if (explicitPaths.length) {
    const resolved = await resolveFileReferences(explicitPaths)
    candidates = resolved.map((filePath) => ({
      path: ensureWorkspaceFile(filePath),
      relativePath: path.relative(WORKSPACE_ROOT, ensureWorkspaceFile(filePath)),
      mtimeMs: 0,
    }))
  } else {
    candidates = await listNoteFilesForDelete({ scope, query })
  }

  const unique = [...new Map(candidates.map((file) => [file.path, file])).values()]
    .filter((file) => existsSync(file.path))
    .filter((file) => explicitPaths.length || pathLooksSafeForBulkDelete(file.path, scope))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const keepFile = keep === 'latest' ? unique[0] : null
  const deleteFiles = keepFile ? unique.slice(1) : unique
  return { scope, keep, keepFile, deleteFiles, totalMatched: unique.length }
}

async function prepareDeleteFilesAction({ taskId, agentId, message, args = {} }) {
  const { scope, keep, keepFile, deleteFiles, totalMatched } = await resolveDeleteCandidates({ message, args })
  if (!deleteFiles.length) {
    return {
      answer: keepFile
        ? `当前只匹配到 1 个文件，不需要删除：${keepFile.relativePath}`
        : `没有找到可删除的匹配文件。范围：${scope}`,
      files: keepFile ? [keepFile.relativePath] : [],
      matchedCount: totalMatched,
    }
  }

  const actionId = `action-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const action = {
    actionId,
    taskId,
    agentId,
    ownerAgentId: agentId,
    type: 'delete_files',
    title: keepFile
      ? `删除 ${deleteFiles.length} 个文件，保留 ${path.basename(keepFile.path)}`
      : `删除 ${deleteFiles.length} 个文件`,
    detail: [
      keepFile ? `将保留：${keepFile.relativePath}` : null,
      `将删除 ${deleteFiles.length} 个文件：`,
      ...deleteFiles.slice(0, 12).map((file, index) => `${index + 1}. ${file.relativePath}`),
      deleteFiles.length > 12 ? `...还有 ${deleteFiles.length - 12} 个` : null,
    ].filter(Boolean).join('\n'),
    scope,
    keep,
    keepPath: keepFile?.path,
    deletePaths: deleteFiles.map((file) => file.path),
    createdAt: new Date().toISOString(),
  }
  pendingActions.set(actionId, action)
  emitEvent({
    type: 'action_required',
    taskId,
    agentId,
    actionId,
    title: action.title,
    detail: action.detail,
    metric: '等待用户确认',
    bubble: '确认',
  })
  return {
    pendingAction: action,
    answer: [
      '已准备删除文件，执行前需要你确认。',
      action.detail,
    ].join('\n'),
  }
}

async function prepareReportCleanupAction({ taskId, agentId, keep = 'latest' }) {
  return prepareDeleteFilesAction({
    taskId,
    agentId,
    message: '删除旧报告，保留最新报告',
    args: { scope: 'reports', keep },
  })
}

async function resolveReadableFileFromMessage(taskId, message, threadId) {
  const explicitFilePath = extractFirstFilePath(message)
  if (explicitFilePath) {
    const absolutePath = await resolveExistingFileReference(explicitFilePath)
    if (absolutePath && existsSync(absolutePath)) return absolutePath
  }

  const recentSaved = await findRecentSavedFile(taskId, threadId).catch(() => null)
  if (recentSaved?.path && existsSync(recentSaved.path)) return recentSaved.path

  const fileNameMatch = message.match(/([^\s，。；;]+?\.(?:docx|doc|pdf|xlsx|xls|pptx|ppt|html|txt|md|png|jpg|jpeg|webp|tif|tiff))/i)?.[1]
  if (fileNameMatch) {
    const candidate = path.join(NOTE_ARTIFACT_ROOT, fileNameMatch)
    if (existsSync(candidate)) return candidate
  }

  const noteFiles = await readdir(NOTE_ARTIFACT_ROOT, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(noteFiles
    .filter((entry) => entry.isFile() && /\.(docx|doc|pdf|xlsx|xls|pptx|ppt|html?|txt|md|png|jpe?g|webp|tiff?)$/i.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(NOTE_ARTIFACT_ROOT, entry.name)
      const fileStat = await stat(filePath).catch(() => null)
      const nameScore = tokenizeText(message).reduce((score, token) => {
        return score + (entry.name.toLowerCase().includes(token.toLowerCase()) ? 6 : 0)
      }, 0)
      const reportScore = /报告|文档|doc|文件/.test(message) && /报告|文档|doc/i.test(entry.name) ? 4 : 0
      return {
        filePath,
        score: nameScore + reportScore,
        mtimeMs: fileStat?.mtimeMs ?? 0,
      }
    }))

  const sorted = candidates
    .filter((candidate) => candidate.score > 0 || /刚|最近|上一个|这个|形成|生成|报告|文档|doc|文件/.test(message))
    .sort((a, b) => (b.score - a.score) || (b.mtimeMs - a.mtimeMs))

  return sorted[0]?.filePath ?? null
}
function inferConvertedFilePath(sourceFile, message, format) {
  const explicitTarget = message.match(/(?:另存为|保存为|保存成|转成|转换成|导出为|文件名(?:为|是)?)[\s\S]{0,18}?[：:\s'“”‘’"]*([^'"“”‘’，。；;\s]+?\.(?:docx|doc|pdf|html|txt|md))/i)?.[1]
  if (explicitTarget) {
    return path.isAbsolute(explicitTarget)
      ? explicitTarget
      : path.join(path.dirname(sourceFile), explicitTarget)
  }

  const parsed = path.parse(sourceFile)
  const ext = `.${format}`
  const baseName = parsed.ext.toLowerCase() === ext.toLowerCase()
    ? `${parsed.name}-副本`
    : parsed.name
  return path.join(parsed.dir, `${baseName}${ext}`)
}

function inferRewriteTargetPath(sourceFile, message, format) {
  const explicitTargets = extractFilePathReferences(message)
    .filter((filePath) => filePath !== extractFirstFilePath(message))
  const target = explicitTargets.at(-1)
    ?? message.match(/(?:保存为|保存成|另存为|文件名(?:为|是)?)[\s\S]{0,18}?[：:\s'“”‘’"]*([^'"“”‘’，。；;\s]+?\.(?:docx|doc|pdf|html|txt|md))/i)?.[1]
  if (target) return path.isAbsolute(target) ? target : path.join(path.dirname(sourceFile), target)

  const parsed = path.parse(sourceFile)
  return path.join(parsed.dir, `${parsed.name}_精炼.${format}`)
}

function normalizeFileAgentAction(action) {
  const allowed = new Set(['read', 'convert', 'rewrite', 'compare', 'save_previous', 'write_file', 'list_files', 'list_paths', 'list_saved_files', 'count_files', 'count_reports', 'list_reports', 'delete_files', 'cleanup_reports', 'search', 'manage', 'unknown'])
  const normalized = String(action ?? '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'unknown'
}

async function resolveFileReferences(references = []) {
  const resolved = []
  for (const reference of references) {
    const filePath = await resolveExistingFileReference(reference).catch(() => null)
    if (filePath && existsSync(filePath) && !resolved.includes(filePath)) resolved.push(filePath)
  }
  return resolved
}
function inferCommonDocumentTitle(files, fallback = '文档版本比较报告') {
  const names = files
    .map((file) => path.basename(file, path.extname(file)))
    .map((name) => name
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')
      .replace(/[_-]?(精炼|副本|修改版|新版|原版|版本\d+)$/i, '')
      .trim())
    .filter(Boolean)
  if (!names.length) return fallback
  let common = names[0]
  for (const name of names.slice(1)) {
    while (common && !name.includes(common)) common = common.slice(0, -1)
  }
  common = common.replace(/[_-]+$/g, '').trim()
  return common.length >= 2 ? `${common}版本比较报告` : fallback
}

function isGeneratedComparisonFile(filePath) {
  const name = path.basename(filePath, path.extname(filePath))
  return /(版本比较报告|比较结果|对比结果|差异报告|文档版本比较报告)$/i.test(name)
}

function normalizedComparableName(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/[_-]?(精炼|副本|修改版|新版|原版|简版|详细版|版本\d+)$/i, '')
    .replace(/(版本比较报告|比较结果|对比结果|差异报告)$/i, '')
    .trim()
}

function commonPrefixLength(a, b) {
  let length = 0
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1
  return length
}

function selectRecentFilesForComparison(recentFiles, { allowGeneratedComparisonFiles = false } = {}) {
  const candidates = recentFiles
    .filter((file) => allowGeneratedComparisonFiles || !isGeneratedComparisonFile(file.path))
    .slice(0, 8)
  if (candidates.length < 2) return candidates.map((file) => file.path)

  let best = null
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = normalizedComparableName(candidates[i].path)
      const right = normalizedComparableName(candidates[j].path)
      const sameName = left && right && left === right ? 100 : 0
      const contains = left && right && (left.includes(right) || right.includes(left)) ? 30 : 0
      const common = commonPrefixLength(left, right)
      const score = sameName + contains + common * 2 - i - j
      if (!best || score > best.score) {
        best = { score, pair: [candidates[i].path, candidates[j].path] }
      }
    }
  }
  return best?.pair ?? candidates.slice(0, 2).map((file) => file.path)
}

async function buildFileAgentIntent({ taskId, message, threadId, index }) {
  if (!PLANNER_API_KEY || PLANNER_MODE !== 'llm') return null
  const recentSavedFiles = await findRecentSavedFiles(taskId, threadId, 8).catch(() => [])
  const explicitReferences = extractFilePathReferences(message)
  const resolvedExplicitReferences = await resolveFileReferences(explicitReferences)
  const system = [
    'You are the embedded intent model inside a local file assistant.',
    'Your job is not to answer the user. Your job is to decide the local file operation to execute.',
    'Infer intent holistically from the user message, recent saved files, and explicit file references. Do not route by keyword alone.',
    'Return only JSON in this shape: {"action":"read|convert|rewrite|compare|save_previous|write_file|list_files|list_paths|list_saved_files|count_files|delete_files|search|manage|unknown","confidence":0.0,"sourceFiles":["..."],"targetFile":null,"format":null,"instruction":"...","shouldSave":false,"answer":null}',
    'Use rewrite when the user asks to refine, shorten, polish, rewrite, edit, make more concise, or change report content.',
    'Use compare when the user asks to compare two files, two versions, differences, whether the refined version changed, or similar follow-ups.',
    'Use convert only when the main goal is format conversion, such as md to doc or doc to pdf.',
    'Use save_previous when the user asks to save the previous answer/content as a file.',
    'Use read when the user asks to summarize, inspect, or tell the content of a file.',
    'Use list_files/list_paths for project workspace, 工区, 工作区, repo, source files, code files, indexed file lists or paths, especially when the user asks what files are for.',
    'Use count_files when the user asks how many reports/files were previously generated or saved. This is a direct answer task, not a save task.',
    'Use list_saved_files only when the user asks what saved/generated/artifacts/notes/reports exist. Do not use it for project workspace/source file lists.',
    'Use write_file when the user asks to save previous output/content as a file.',
    'Use delete_files when the user asks to delete one file, multiple files, old files, old reports, all reports except the latest one, clean report history, or bulk remove generated files. This requires confirmation.',
    'Use cleanup_reports only as a compatibility alias for deleting old reports while keeping latest.',
    'If the user says "这两个版本" or similar, choose compare and rely on recentSavedFiles.',
    'If the user says "这个报告" or similar, choose the most recent saved file as the source.',
    'For targetFile, only include a path if the user explicitly gave one or the operation naturally creates a new file.',
    'For format, use doc, docx, pdf, md, txt, or html when requested; otherwise null.',
    'Use Simplified Chinese in instruction.',
  ].join('\n')
  const parsed = await callPlannerJson({
    system,
    payload: {
      userMessage: message,
      workspaceRoot: WORKSPACE_ROOT,
      defaultSaveDir: path.relative(WORKSPACE_ROOT, NOTE_ARTIFACT_ROOT),
      explicitReferences,
      resolvedExplicitReferences: resolvedExplicitReferences.map((file) => path.relative(WORKSPACE_ROOT, file)),
      recentSavedFiles: recentSavedFiles.map((file) => ({
        relativePath: file.relativePath,
        format: file.format,
      })),
      indexedFiles: index.files.map((entry) => entry.file).slice(0, 30),
    },
  })

  const action = normalizeFileAgentAction(parsed.action)
  const confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0
  const modelSourceFiles = Array.isArray(parsed.sourceFiles) ? parsed.sourceFiles : []
  let sourceFiles = await resolveFileReferences([
    ...resolvedExplicitReferences,
    ...modelSourceFiles,
  ])
  const format = inferReportFormat(`${message} ${parsed.format ?? ''}`)
  if (action === 'compare' && explicitReferences.length === 0) {
    sourceFiles = sourceFiles.filter((filePath) => !isGeneratedComparisonFile(filePath))
  }

  if ((action === 'read' || action === 'convert' || action === 'rewrite') && !sourceFiles.length) {
    const recent = await findRecentSavedFile(taskId, threadId).catch(() => null)
    if (recent?.path) sourceFiles = [recent.path]
  }
  if (action === 'compare' && sourceFiles.length < 2) {
    const recent = await findRecentSavedFiles(taskId, threadId, 8).catch(() => [])
    const selected = explicitReferences.length
      ? recent.map((file) => file.path)
      : selectRecentFilesForComparison(recent)
    for (const filePath of selected) {
      if (!sourceFiles.includes(filePath)) sourceFiles.push(filePath)
      if (sourceFiles.length >= 2) break
    }
  }

  return {
    action,
    confidence,
    sourceFiles,
    targetFile: normalizeTargetFilePath(parsed.targetFile),
    format,
    instruction: typeof parsed.instruction === 'string' && parsed.instruction.trim()
      ? parsed.instruction.trim()
      : message,
    shouldSave: Boolean(parsed.shouldSave),
  }
}
async function transformDocumentWithPlanner({ message, instruction, sourceText, relativeSource }) {
  const parsed = await callPlannerJson({
    system: [
      'You rewrite local document content for a file assistant.',
      'Return only JSON in this shape: {"answer":"..."}',
      'Use only the provided source document. Do not add new facts, numbers, dates, or citations.',
      'If the instruction asks for a more concise version, preserve the key conclusion, important data, and comparisons, while removing repetition and verbose phrasing.',
      'Keep the output well structured with short headings and bullets when useful.',
      'Answer in Simplified Chinese.',
    ].join('\n'),
    payload: {
      userMessage: message,
      instruction,
      relativeSource,
      sourceText: sourceText.slice(0, 12000),
    },
  })
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
  if (!answer) throw new Error('文件助手模型没有返回可保存的改写内容。')
  return answer
}

async function compareDocumentsWithPlanner({ message, files }) {
  const parsed = await callPlannerJson({
    system: [
      'You compare two local documents for a file assistant.',
      'Return only JSON in this shape: {"answer":"..."}',
      'Compare only the provided document texts. Do not invent external facts.',
      'Include: overall verdict, main content differences, structure/length differences, whether the second file is actually more concise, and recommended next action.',
      'Answer in concise Simplified Chinese.',
    ].join('\n'),
    payload: {
      userMessage: message,
      files: files.map((file) => ({
        relativePath: file.relativePath,
        text: file.text.slice(0, 9000),
        characters: file.text.length,
      })),
    },
  })
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
  if (!answer) throw new Error('文件助手模型没有返回比较结果。')
  return answer
}

async function rewriteDocumentFile({ taskId, agentId, sourceFile, targetFile, format, message, instruction }) {
  const raw = await readFile(sourceFile, 'utf8')
  const text = await readableDocumentText(raw, sourceFile)
  const relativeSource = path.relative(WORKSPACE_ROOT, sourceFile)
  const finalFormat = format ?? inferReportFormat(message)
  const finalTarget = targetFile ?? inferRewriteTargetPath(sourceFile, message, finalFormat)
  const relativeTarget = path.relative(WORKSPACE_ROOT, finalTarget)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-rewrite-document`,
    status: 'running',
    title: '改写文档内容',
    detail: `${relativeSource} → ${relativeTarget}`,
    metric: `写入 ${saveFormatLabel(finalFormat)}`,
    bubble: '改写',
  })

  const rewritten = await transformDocumentWithPlanner({
    message,
    instruction,
    sourceText: text,
    relativeSource,
  })
  await writeSavedFile(finalTarget, {
    title: path.basename(finalTarget, path.extname(finalTarget)),
    sourceMessage: `基于 ${relativeSource} 改写：${instruction}`,
    answer: rewritten,
    format: finalFormat,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-rewrite-document`,
    status: 'done',
    title: '改写文档内容',
    detail: `已写入 ${relativeTarget}`,
    metric: '改写完成',
    bubble: '完成',
  })

  return {
    answer: `已按要求改写并保存：${relativeTarget}`,
    files: [relativeTarget],
    savedPath: finalTarget,
    sourceFiles: [relativeSource],
    format: finalFormat,
    text: rewritten,
  }
}

async function compareDocumentFiles({ taskId, agentId, sourceFiles, targetFile, format, message }) {
  const selected = sourceFiles.slice(0, 2)
  if (selected.length < 2) {
    return { answer: '我还没找到两份可比较的文件。请告诉我两个文件名，或先生成/保存两个版本。' }
  }
  const files = []
  for (const filePath of selected) {
    const raw = await readFile(filePath, 'utf8')
    const text = await readableDocumentText(raw, filePath)
    files.push({
      filePath,
      relativePath: path.relative(WORKSPACE_ROOT, filePath),
      text,
    })
  }
  const finalFormat = format ?? 'doc'
  const finalTarget = targetFile ?? path.join(
    NOTE_ARTIFACT_ROOT,
    `${slugifyFilename(inferCommonDocumentTitle(selected))}.${finalFormat}`,
  )
  const relativeTarget = path.relative(WORKSPACE_ROOT, finalTarget)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-compare-documents`,
    status: 'running',
    title: '比较两个文档版本',
    detail: files.map((file) => file.relativePath).join(' ↔ '),
    metric: `写入 ${saveFormatLabel(finalFormat)}`,
    bubble: '比较',
  })

  const comparison = await compareDocumentsWithPlanner({ message, files })
  await writeSavedFile(finalTarget, {
    title: path.basename(finalTarget, path.extname(finalTarget)),
    sourceMessage: `比较：${files.map((file) => file.relativePath).join(' 与 ')}`,
    answer: comparison,
    format: finalFormat,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-compare-documents`,
    status: 'done',
    title: '比较两个文档版本',
    detail: `比较结果已写入 ${relativeTarget}`,
    metric: '比较完成',
    bubble: '完成',
  })

  return {
    answer: comparison,
    files: [relativeTarget],
    savedPath: finalTarget,
    format: finalFormat,
    comparedFiles: files.map((file) => file.relativePath),
  }
}
function buildIndexedFileLocationsResult({ taskId, agentId, index }) {
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-paths`,
    status: 'done',
    title: '列出文件位置',
    detail: `工作区根目录：${WORKSPACE_ROOT}`,
    metric: '已列出路径',
    bubble: '路径',
  })

  const answer = [
    `这些索引文件都在这个项目工作区下面：`,
    WORKSPACE_ROOT,
    '',
    `完整路径如下：`,
    formatIndexedFileLocations(index.files),
  ].join('\n')

  return {
    answer,
    root: WORKSPACE_ROOT,
    files: index.files.map((entry) => entry.file),
    paths: index.files.map((entry) => path.join(WORKSPACE_ROOT, entry.file)),
    snippets: [],
    search: {
      builtAt: index.builtAt,
      totalFiles: index.files.length,
      matches: [],
    },
    indexPath: FILE_INDEX_PATH,
  }
}

function buildIndexedFileListResult({ taskId, agentId, index }) {
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-read`,
    status: 'done',
    title: '列出文件索引',
    detail: `返回 ${index.files.length} 个已索引文本文件。`,
    metric: '已列出文件',
    bubble: '清单',
  })

  const answer = [
    `文件助手当前索引到 ${index.files.length} 个可读取文本文件：`,
    formatIndexedFileList(index.files),
  ].join('\n\n')

  return {
    answer,
    files: index.files.map((entry) => entry.file),
    snippets: [],
    search: {
      builtAt: index.builtAt,
      totalFiles: index.files.length,
      matches: [],
    },
    indexPath: FILE_INDEX_PATH,
  }
}

async function buildFileSearchResult({ taskId, agentId, message, index }) {
  const files = index.files.map((entry) => entry.file)
  const search = await searchFileIndex(message)
  const readable = search.matches.length
    ? search.matches.map((match) => match.file)
    : chooseReadableFiles(files, message)
  const snippets = readable.map((file) => ({
    file,
    preview: (index.files.find((entry) => entry.file === file)?.content ?? '').slice(0, 900).trim(),
  }))

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-read`,
    status: 'done',
    title: '索引与检索',
    detail: `索引 ${search.totalFiles} 个文本文件，命中 ${search.matches.length} 个结果。`,
    metric: '已读取文件',
    bubble: '读取',
  })

  const answer = [
    `已建立本地文件索引：${search.totalFiles} 个文本文件。`,
    search.matches.length
      ? `命中结果：\n${search.matches.map((match, index) => `${index + 1}. ${match.file}（score ${match.score}）：${match.snippet}`).join('\n')}`
      : readable.length
        ? `未找到明确内容命中，优先查看：${readable.join('、')}。`
        : '没有找到可直接读取的文本文件。',
  ].join('\n')

  return {
    answer,
    files: files.slice(0, 24),
    snippets,
    search,
    indexPath: FILE_INDEX_PATH,
  }
}

async function executeFileAgentIntent({ taskId, agentId, message, intent, index, threadId }) {
  if (!intent) return null
  if (intent.confidence < 0.55 || intent.action === 'unknown') {
    return unsupportedCapabilityResult('文件助手', '未能可靠识别文件动作', '可以补齐更明确的文件意图提示或让用户指定文件/动作。')
  }
  if (intent.action === 'manage') return prepareFileManagementAction({ taskId, agentId, message })
  if (intent.action === 'list_files' && wantsGeneratedFileSave(message)) {
    return saveIndexedFileList({ taskId, agentId, message, index })
  }
  if (intent.action === 'list_files') return buildIndexedFileListResult({ taskId, agentId, index })
  if (intent.action === 'list_paths' && wantsGeneratedFileSave(message)) {
    return saveIndexedFileList({ taskId, agentId, message, index })
  }
  if (intent.action === 'list_paths') return buildIndexedFileLocationsResult({ taskId, agentId, index })
  if (intent.action === 'count_reports') {
    return countSavedReports({ taskId, agentId })
  }
  if (intent.action === 'list_reports') {
    return listSavedReports({ taskId, agentId })
  }
  if (intent.action === 'list_saved_files') {
    return listSavedFiles({
      taskId,
      agentId,
      scope: /报告|report/i.test(message) ? 'reports' : 'notes',
    })
  }
  if (intent.action === 'count_files') {
    return countSavedFiles({
      taskId,
      agentId,
      scope: /报告|report/i.test(message) ? 'reports' : 'notes',
    })
  }
  if (intent.action === 'cleanup_reports') {
    return prepareReportCleanupAction({ taskId, agentId })
  }
  if (intent.action === 'delete_files') {
    return prepareDeleteFilesAction({
      taskId,
      agentId,
      message,
      args: {
        filePaths: intent.sourceFiles,
        scope: /报告|report/i.test(message) ? 'reports' : 'notes',
        keep: /保留.*最新|除了最新|除最新|keep.*latest/i.test(message) ? 'latest' : null,
      },
    })
  }
  if (intent.action === 'save_previous') {
    return savePreviousAnswerAsNote({
      taskId,
      agentId,
      threadId,
      format: intent.format ?? inferSaveFormat(message),
    })
  }
  if (intent.action === 'write_file') {
    return savePreviousAnswerAsNote({
      taskId,
      agentId,
      threadId,
      format: intent.format ?? inferSaveFormat(message),
    })
  }
  if (intent.action === 'rewrite') {
    if (!intent.sourceFiles.length) return { answer: '我没找到要改写的源文件。请告诉我文件名，或者先让我保存一份内容。' }
    return rewriteDocumentFile({
      taskId,
      agentId,
      sourceFile: intent.sourceFiles[0],
      targetFile: intent.targetFile,
      format: intent.format,
      message,
      instruction: intent.instruction,
    })
  }
  if (intent.action === 'compare') {
    return compareDocumentFiles({
      taskId,
      agentId,
      sourceFiles: intent.sourceFiles,
      targetFile: intent.targetFile,
      format: intent.format,
      message,
    })
  }
  if (intent.action === 'convert') {
    if (!intent.sourceFiles.length) return { answer: '我没找到要转换的源文件。你可以告诉我具体文件名，或者先让我保存一份内容。' }
    return convertReadableDocumentFile({
      taskId,
      agentId,
      sourceFile: intent.sourceFiles[0],
      message,
    })
  }
  if (intent.action === 'read' && intent.sourceFiles.length) {
    const targetFile = intent.sourceFiles[0]
    const raw = await readFile(targetFile, 'utf8')
    const text = await readableDocumentText(raw, targetFile)
    const relativePath = path.relative(WORKSPACE_ROOT, targetFile)
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-read-document`,
      status: 'done',
      title: '读取报告文件',
      detail: relativePath,
      metric: '已读取报告',
      bubble: '读取',
    })
    return {
      answer: summarizeReadableDocument(text, targetFile),
      files: [relativePath],
      snippets: [{ file: relativePath, preview: text.slice(0, 1200) }],
      text,
    }
  }
  if (intent.action === 'read' && !intent.sourceFiles.length) {
    return unsupportedCapabilityResult('文件助手', '读取文件', '我已经识别到要读取文件，但没有解析到可读取的具体文件。需要补齐文件定位能力或请用户指定文件。')
  }
  if (intent.action === 'search') return buildFileSearchResult({ taskId, agentId, message, index })
  return unsupportedCapabilityResult('文件助手', intent.action)
}
async function readableDocumentText(raw, filePath) {
  if (/\.docx$/i.test(filePath)) return extractDocxText(filePath)
  if (/\.pdf$/i.test(filePath)) return extractPdfText(filePath)
  if (/\.xlsx?$/i.test(filePath)) return extractSpreadsheetText(filePath)
  if (/\.pptx?$/i.test(filePath)) return extractPresentationText(filePath)
  if (/\.(png|jpe?g|webp|tiff?)$/i.test(filePath)) return extractImageText(filePath)
  if (/\.(doc|html?)$/i.test(filePath)) {
    return htmlToStructuredText(raw)
      .trim()
  }
  return stripMarkdown(raw).replace(/\n{3,}/g, '\n\n').trim()
}

async function extractDocxText(filePath) {
  const script = String.raw`
import sys
from docx import Document
doc = Document(sys.argv[1])
print('\n'.join(p.text for p in doc.paragraphs if p.text.strip()))
`
  const result = await runCommandAsync('python3', ['-c', script, filePath], { timeout: 12000 })
  if (result.status !== 0) throw new Error(result.stderr.trim() || '读取 DOCX 失败')
  return result.stdout.trim()
}

async function extractPdfText(filePath) {
  const result = await runCommandAsync('pdftotext', ['-layout', filePath, '-'], { timeout: 15000 })
  if (result.status !== 0) throw new Error(result.stderr.trim() || '读取 PDF 失败')
  return result.stdout.trim()
}

async function extractSpreadsheetText(filePath) {
  const script = String.raw`
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
out = []
for ws in wb.worksheets[:5]:
    out.append('工作表：' + ws.title)
    for row in ws.iter_rows(max_row=30, values_only=True):
        values = [str(v) for v in row if v is not None]
        if values:
            out.append(' | '.join(values))
print('\n'.join(out))
`
  const result = await runCommandAsync('python3', ['-c', script, filePath], { timeout: 15000 })
  if (result.status !== 0) throw new Error(result.stderr.trim() || '读取 Excel 失败')
  return result.stdout.trim()
}

async function extractPresentationText(filePath) {
  if (/\.ppt$/i.test(filePath)) {
    throw new Error('旧版 .ppt 暂不支持读取，请先转换为 .pptx。')
  }
  const list = await runCommandAsync('unzip', ['-Z1', filePath], { timeout: 8000 })
  if (list.status !== 0) throw new Error(list.stderr.trim() || '读取 PPTX 失败')
  const slideNames = list.stdout.split(/\r?\n/).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  const lines = []
  for (const slideName of slideNames.slice(0, 30)) {
    const result = await runCommandAsync('unzip', ['-p', filePath, slideName], { timeout: 8000 })
    if (result.status !== 0) continue
    const text = result.stdout
      .replace(/<a:t>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) lines.push(`${path.basename(slideName, '.xml')}：${text}`)
  }
  return lines.join('\n')
}

async function extractImageText(filePath) {
  const result = await runCommandAsync('tesseract', [filePath, 'stdout', '-l', 'chi_sim+eng'], { timeout: 20000 })
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'OCR 失败，请确认本机安装了 tesseract 和中文语言包。')
  return result.stdout.trim() || 'OCR 没识别出文字。'
}

async function convertReadableDocumentFile({ taskId, agentId, sourceFile, message }) {
  const format = inferReportFormat(message)

  const raw = await readFile(sourceFile, 'utf8')
  const text = await readableDocumentText(raw, sourceFile)
  const title = path.basename(sourceFile, path.extname(sourceFile))
  const targetFile = inferConvertedFilePath(sourceFile, message, format)
  const relativeSource = path.relative(WORKSPACE_ROOT, sourceFile)
  const relativeTarget = path.relative(WORKSPACE_ROOT, targetFile)
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-convert-document`,
    status: 'running',
    title: '转换文档格式',
    detail: `${relativeSource} → ${relativeTarget}`,
    metric: `写入 ${saveFormatLabel(format)}`,
    bubble: '转换',
  })

  await writeSavedFile(targetFile, {
    title,
    sourceMessage: `由 ${relativeSource} 转换生成`,
    answer: text,
    format,
  })
  cachedFileIndex = null

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-convert-document`,
    status: 'done',
    title: '转换文档格式',
    detail: `已写入 ${relativeTarget}`,
    metric: '转换完成',
    bubble: '完成',
  })

  return {
    answer: `已转换并保存为 ${saveFormatLabel(format)}：${relativeTarget}`,
    files: [relativeTarget],
    savedPath: targetFile,
    format,
  }
}

function summarizeReadableDocument(text, filePath) {
  const compact = text.replace(/[ \t]+/g, ' ').trim()
  const title = path.basename(filePath)
  const lines = []
  const core = compact.match(/核心结论\s*\n?([\s\S]+?)(?:\n\s*报告要点|\n\s*一、|\n\s*来源：|$)/)?.[1]?.trim()
  if (core) {
    lines.push('核心结论：')
    lines.push(...core.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5))
  }

  const sections = [...compact.matchAll(/(^|\n)([一二三四五六七八九十]、\s*[^\n]+)([\s\S]*?)(?=\n[一二三四五六七八九十]、|\n来源：|$)/g)]
    .map((match) => match[2].trim())
    .slice(0, 4)
  if (sections.length) {
    if (lines.length) lines.push('')
    lines.push('主要内容：')
    lines.push(...sections.map((section) => section.slice(0, 260)))
  }

  if (!lines.length) {
    lines.push(`${title} 的主要内容：`)
    lines.push(...compact.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 10))
  }

  return [
    `我读了 ${path.relative(WORKSPACE_ROOT, filePath)}。`,
    '',
    ...lines,
  ].join('\n')
}
async function executeFileAgent({ taskId, agentId, message }) {
  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-scan`,
    status: 'running',
    title: '扫描工作区',
    detail: WORKSPACE_ROOT,
    metric: '正在扫描文件',
    bubble: '扫描',
  })
  const index = await buildFileIndex()
  const files = index.files.map((entry) => entry.file)
  const threadId = activeTasks.get(taskId)?.threadId
  const modelIntent = await buildFileAgentIntent({ taskId, message, threadId, index })
  const modelHandled = await executeFileAgentIntent({
    taskId,
    agentId,
    message,
    intent: modelIntent,
    index,
    threadId,
  })
  if (modelHandled) return modelHandled

  if (isFileManagementRequest(message)) {
    return prepareFileManagementAction({ taskId, agentId, message })
  }

  if (isReportCountRequest(message)) {
    return countSavedReports({ taskId, agentId })
  }
  if (isReportListRequest(message)) {
    return listSavedReports({ taskId, agentId })
  }

  if ((wantsIndexedFileList(message) || wantsIndexedFileLocations(message)) && wantsGeneratedFileSave(message)) {
    return saveIndexedFileList({ taskId, agentId, message, index })
  }

  const sourceFileForConversion = isDocumentConversionRequest(message)
    ? await resolveReadableFileFromMessage(taskId, message, threadId)
    : null
  if (sourceFileForConversion) {
    return convertReadableDocumentFile({
      taskId,
      agentId,
      sourceFile: sourceFileForConversion,
      message,
    })
  }
  if (isDocumentConversionRequest(message)) {
    return {
      answer: '我没找到要转换的源文件。你可以告诉我具体文件名，或者先让我保存一份内容。',
    }
  }

  const targetFile = isFileSummaryRequest(message)
    ? await resolveReadableFileFromMessage(taskId, message, threadId)
    : null
  if (targetFile) {
    const raw = await readFile(targetFile, 'utf8')
    const text = await readableDocumentText(raw, targetFile)
    const relativePath = path.relative(WORKSPACE_ROOT, targetFile)
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-read-document`,
      status: 'done',
      title: '读取报告文件',
      detail: relativePath,
      metric: '已读取报告',
      bubble: '读取',
    })
    return {
      answer: summarizeReadableDocument(text, targetFile),
      files: [relativePath],
      snippets: [{ file: relativePath, preview: text.slice(0, 1200) }],
      text,
    }
  }

  if (wantsIndexedFileLocations(message)) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-paths`,
      status: 'done',
      title: '列出文件位置',
      detail: `工作区根目录：${WORKSPACE_ROOT}`,
      metric: '已列出路径',
      bubble: '路径',
    })

    const answer = [
      `这些索引文件都在这个项目工作区下面：`,
      WORKSPACE_ROOT,
      '',
      `完整路径如下：`,
      formatIndexedFileLocations(index.files),
    ].join('\n')

    return {
      answer,
      root: WORKSPACE_ROOT,
      files,
      paths: index.files.map((entry) => path.join(WORKSPACE_ROOT, entry.file)),
      snippets: [],
      search: {
        builtAt: index.builtAt,
        totalFiles: index.files.length,
        matches: [],
      },
      indexPath: FILE_INDEX_PATH,
    }
  }

  if (wantsIndexedFileList(message)) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-read`,
      status: 'done',
      title: '列出文件索引',
      detail: `返回 ${index.files.length} 个已索引文本文件。`,
      metric: '已列出文件',
      bubble: '清单',
    })

    const answer = [
      `文件助手当前索引到 ${index.files.length} 个可读取文本文件：`,
      formatIndexedFileList(index.files),
    ].join('\n\n')

    return {
      answer,
      files,
      snippets: [],
      search: {
        builtAt: index.builtAt,
        totalFiles: index.files.length,
        matches: [],
      },
      indexPath: FILE_INDEX_PATH,
    }
  }

  const search = await searchFileIndex(message)
  const readable = search.matches.length
    ? search.matches.map((match) => match.file)
    : chooseReadableFiles(files, message)
  const snippets = []

  for (const file of readable) {
    const content = index.files.find((entry) => entry.file === file)?.content ?? ''
    snippets.push({
      file,
      preview: content.slice(0, 900).trim(),
    })
  }

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-read`,
    status: 'done',
    title: '索引与检索',
    detail: `索引 ${search.totalFiles} 个文本文件，命中 ${search.matches.length} 个结果。`,
    metric: '已读取文件',
    bubble: '读取',
  })

  const answer = [
    `已建立本地文件索引：${search.totalFiles} 个文本文件。`,
    search.matches.length
      ? `命中结果：\n${search.matches.map((match, index) => `${index + 1}. ${match.file}（score ${match.score}）：${match.snippet}`).join('\n')}`
      : readable.length
        ? `未找到明确内容命中，优先查看：${readable.join('、')}。`
        : '没有找到可直接读取的文本文件。',
  ].join('\n')

  return {
    answer,
    files: files.slice(0, 24),
    snippets,
    search,
    indexPath: FILE_INDEX_PATH,
  }
}
async function resolveCapabilityFilePath({ taskId, threadId, message, args }) {
  const explicit = stringArg(args, 'filePath')
    ?? stringArg(args, 'path')
    ?? stringArg(args, 'sourceFile')
  if (explicit) {
    const resolved = await resolveExistingFileReference(explicit).catch(() => null)
    if (resolved && existsSync(resolved)) return resolved
  }
  return resolveReadableFileFromMessage(taskId, message, threadId)
}

async function executeFileCapability({ taskId, agentId, step, previousResult, userMessage, threadId }) {
  const args = step.args ?? {}
  if (step.capability === 'list_reports') return listSavedReports({ taskId, agentId })
  if (step.capability === 'count_reports') return countSavedReports({ taskId, agentId })
  if (step.capability === 'list_saved_files') {
    return listSavedFiles({
      taskId,
      agentId,
      scope: stringArg(args, 'scope') ?? normalizeSavedFileScope(null, step.message),
      query: stringArg(args, 'query') ?? '',
      format: stringArg(args, 'format') ?? '',
    })
  }
  if (step.capability === 'count_files') {
    return countSavedFiles({
      taskId,
      agentId,
      scope: stringArg(args, 'scope') ?? normalizeSavedFileScope(null, step.message),
      query: stringArg(args, 'query') ?? '',
      format: stringArg(args, 'format') ?? '',
    })
  }

  const index = await buildFileIndex()
  if (step.capability === 'list_files') return buildIndexedFileListResult({ taskId, agentId, index })
  if (step.capability === 'list_paths') return buildIndexedFileLocationsResult({ taskId, agentId, index })
  if (step.capability === 'search_files') {
    const query = stringArg(args, 'query') ?? step.message
    return buildFileSearchResult({ taskId, agentId, message: query, index })
  }
  if (step.capability === 'save_report') {
    if (!previousResult) {
      return unsupportedCapabilityResult('文件助手', '保存上一步报告', '当前工作流里没有可保存的上一步结果。')
    }
    return saveReportFromResult({
      taskId,
      agentId,
      userMessage,
      stepMessage: step.message,
      previousResult,
      format: stringArg(args, 'format') ?? inferReportFormat(`${userMessage}\n${step.message}`),
      title: stringArg(args, 'title'),
    })
  }
  if (step.capability === 'write_file') {
    const source = stringArg(args, 'source') ?? 'previous_result'
    if (source === 'previous_answer' || !previousResult) {
      return savePreviousAnswerAsNote({
        taskId,
        agentId,
        threadId,
        format: stringArg(args, 'format') ?? inferSaveFormat(`${userMessage}\n${step.message}`),
      })
    }
    return saveReportFromResult({
      taskId,
      agentId,
      userMessage,
      stepMessage: step.message,
      previousResult,
      format: stringArg(args, 'format') ?? inferReportFormat(`${userMessage}\n${step.message}`),
      title: stringArg(args, 'title'),
    })
  }
  if (step.capability === 'save_previous_answer') {
    return savePreviousAnswerAsNote({
      taskId,
      agentId,
      threadId,
      format: stringArg(args, 'format') ?? inferSaveFormat(`${userMessage}\n${step.message}`),
    })
  }
  if (step.capability === 'read_file') {
    const sourceFile = await resolveCapabilityFilePath({ taskId, threadId, message: step.message, args })
    if (!sourceFile) {
      return unsupportedCapabilityResult('文件助手', '读取文件', '我已经识别到要读取文件，但没有解析到可读取的具体文件。')
    }
    const raw = await readFile(sourceFile, 'utf8')
    const text = await readableDocumentText(raw, sourceFile)
    const relativePath = path.relative(WORKSPACE_ROOT, sourceFile)
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-read-document`,
      status: 'done',
      title: '读取报告文件',
      detail: relativePath,
      metric: '已读取报告',
      bubble: '读取',
    })
    return {
      answer: summarizeReadableDocument(text, sourceFile),
      files: [relativePath],
      snippets: [{ file: relativePath, preview: text.slice(0, 1200) }],
      text,
    }
  }
  if (step.capability === 'convert_file') {
    const sourceFile = await resolveCapabilityFilePath({ taskId, threadId, message: step.message, args })
    if (!sourceFile) return unsupportedCapabilityResult('文件助手', '转换文件格式', '没有找到要转换的源文件。')
    const format = stringArg(args, 'format')
    const message = format ? `${step.message}\n转换成 ${format}` : step.message
    return convertReadableDocumentFile({ taskId, agentId, sourceFile, message })
  }
  if (step.capability === 'rewrite_file') {
    const sourceFile = await resolveCapabilityFilePath({ taskId, threadId, message: step.message, args })
    if (!sourceFile) return unsupportedCapabilityResult('文件助手', '改写文件', '没有找到要改写的源文件。')
    return rewriteDocumentFile({
      taskId,
      agentId,
      sourceFile,
      targetFile: normalizeTargetFilePath(stringArg(args, 'targetFile') ?? stringArg(args, 'targetPath')),
      format: stringArg(args, 'format') ?? inferReportFormat(step.message),
      message: step.message,
      instruction: stringArg(args, 'instruction') ?? step.message,
    })
  }
  if (step.capability === 'compare_files') {
    const explicit = arrayArg(args, 'filePaths')
      .concat(arrayArg(args, 'sourceFiles'))
      .concat(arrayArg(args, 'files'))
    const sourceFiles = explicit.length
      ? await resolveFileReferences(explicit)
      : selectRecentFilesForComparison(await findRecentSavedFiles(taskId, threadId, 8).catch(() => [])).filter(Boolean)
    return compareDocumentFiles({
      taskId,
      agentId,
      sourceFiles,
      targetFile: normalizeTargetFilePath(stringArg(args, 'targetFile') ?? stringArg(args, 'targetPath')),
      format: stringArg(args, 'format') ?? inferReportFormat(step.message),
      message: step.message,
    })
  }
  if (step.capability === 'manage_file') return prepareFileManagementAction({ taskId, agentId, message: step.message })
  if (step.capability === 'delete_files') return prepareDeleteFilesAction({ taskId, agentId, message: step.message, args })
  if (step.capability === 'cleanup_reports') return prepareReportCleanupAction({ taskId, agentId, keep: stringArg(args, 'keep') ?? 'latest' })
  return unsupportedCapabilityResult('文件助手', step.capability)
}

export {
  buildFileIndex,
  getFileIndex,
  publicFileEntry,
  invalidateFileIndex,
  getFileIndexInfo,
  executeFileAgent,
  executeFileCapability,
  writeSavedFile,
}
