// lib.mjs — 通用工具：文本处理、路径解析、子进程、HTTP。无业务耦合，便于单测复用。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { connect } from 'node:net'
import path from 'node:path'
import { NOTE_ARTIFACT_ROOT, RESEARCH_PROXY_URL, WORKSPACE_ROOT } from './config.mjs'

let cachedResearchProxyUrl

function truncateAtBoundary(value, maxLength = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  const slice = text.slice(0, maxLength)
  const boundary = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('；'),
    slice.lastIndexOf(';'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('\n'),
  )
  if (boundary > maxLength * 0.45) return `${slice.slice(0, boundary + 1).trim()}`
  return `${slice.replace(/[，,、：:；;。\s]*$/, '').trim()}…`
}
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(650)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}
function normalizeArtifactPath(value) {
  if (!value) return null
  const cleaned = String(value)
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’。]+$/g, '')
  if (!cleaned) return null
  return path.isAbsolute(cleaned)
    ? cleaned
    : path.resolve(WORKSPACE_ROOT, cleaned)
}

async function resolveExistingFileReference(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’。]+$/g, '')
  if (!cleaned) return null

  const direct = normalizeArtifactPath(cleaned)
  if (direct && existsSync(direct)) return direct

  const baseName = path.basename(cleaned)
  if (!baseName || baseName === '.' || !/\.[A-Za-z0-9]+$/.test(baseName)) return null

  const noteFiles = await readdir(NOTE_ARTIFACT_ROOT, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(noteFiles
    .filter((entry) => entry.isFile() && !entry.name.startsWith('~$'))
    .filter((entry) => {
      if (entry.name === baseName) return true
      if (entry.name.endsWith(`-${baseName}`)) return true
      const compactEntry = entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, '')
      return compactEntry === baseName
    })
    .map(async (entry) => {
      const filePath = path.join(NOTE_ARTIFACT_ROOT, entry.name)
      const fileStat = await stat(filePath).catch(() => null)
      return {
        filePath,
        score: entry.name === baseName ? 3 : entry.name.endsWith(`-${baseName}`) ? 2 : 1,
        mtimeMs: fileStat?.mtimeMs ?? 0,
      }
    }))

  return candidates
    .sort((a, b) => (b.score - a.score) || (b.mtimeMs - a.mtimeMs))[0]?.filePath ?? null
}
function slugifyFilename(title) {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40) || '保存内容'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stripMarkdown(value) {
  return String(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/^\s*>+\s?/gm, '')
}

function markdownToBasicHtml(value) {
  const lines = String(value).split(/\r?\n/)
  return lines.map((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = Math.min(heading[1].length, 4)
      return `<h${level}>${escapeHtml(stripMarkdown(heading[2]))}</h${level}>`
    }
    if (/^\s*[-*]\s+/.test(line)) {
      return `<p>&bull; ${escapeHtml(stripMarkdown(line.replace(/^\s*[-*]\s+/, '')))}</p>`
    }
    if (/^-{3,}$/.test(line.trim())) return '<hr />'
    if (!line.trim()) return ''
    return `<p>${escapeHtml(stripMarkdown(line))}</p>`
  }).join('\n')
}
function parsePlannerJson(content) {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  return JSON.parse(candidate)
}
function runCommandAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? WORKSPACE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = options.timeout
      ? setTimeout(() => {
          child.kill('SIGTERM')
          stderr += `\n${command} timed out after ${options.timeout}ms`
        }, options.timeout)
      : null
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      resolve({ status: 1, stdout, stderr: stderr || error.message })
    })
    child.on('close', (status) => {
      if (timer) clearTimeout(timer)
      resolve({ status: status ?? 0, stdout, stderr })
    })
  })
}

function canConnectToPort(host, port, timeout = 650) {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function getResearchProxyUrl() {
  if (cachedResearchProxyUrl !== undefined) return cachedResearchProxyUrl
  if (RESEARCH_PROXY_URL) {
    cachedResearchProxyUrl = RESEARCH_PROXY_URL
    return cachedResearchProxyUrl
  }
  for (const port of [7897, 7890, 7891]) {
    if (await canConnectToPort('127.0.0.1', port)) {
      cachedResearchProxyUrl = `http://127.0.0.1:${port}`
      return cachedResearchProxyUrl
    }
  }
  cachedResearchProxyUrl = null
  return cachedResearchProxyUrl
}

async function postJsonWithOptionalProxy(url, { headers = {}, body, timeout = 60000 } = {}) {
  const proxyUrl = await getResearchProxyUrl()
  if (proxyUrl) {
    const args = [
      '-sS',
      '--max-time',
      String(Math.ceil(timeout / 1000)),
      '--proxy',
      proxyUrl,
      '-w',
      '\n__HTTP_STATUS__:%{http_code}',
      '-X',
      'POST',
      url,
    ]
    for (const [key, value] of Object.entries(headers)) {
      args.push('-H', `${key}: ${value}`)
    }
    if (body !== undefined) {
      args.push('--data-binary', body)
    }
    const result = await runCommandAsync('curl', args, { cwd: WORKSPACE_ROOT, timeout: timeout + 3000 })
    if (result.status !== 0) {
      throw new Error(`HTTP proxy request failed: ${result.stderr.trim() || `curl exited with ${result.status}`}`)
    }
    const marker = '\n__HTTP_STATUS__:'
    const markerIndex = result.stdout.lastIndexOf(marker)
    const bodyText = markerIndex >= 0 ? result.stdout.slice(0, markerIndex) : result.stdout
    const status = markerIndex >= 0 ? Number.parseInt(result.stdout.slice(markerIndex + marker.length).trim(), 10) : 200
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      throw new Error(`HTTP ${status}: ${bodyText}`)
    }
    return JSON.parse(bodyText)
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`)
  }
  return JSON.parse(text)
}
function tokenizeText(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fa5]+/u)
    .filter((word) => word.length >= 2 && word.length <= 32)
}

function topKeywords(text, limit = 16) {
  const counts = new Map()
  for (const token of tokenizeText(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}
function formatFileSize(size) {
  if (!Number.isFinite(size)) return '未知大小'
  if (size < 1024) return `${size} B`
  return `${(size / 1024).toFixed(size > 10 * 1024 ? 1 : 2)} KB`
}
function ensureWorkspaceFile(filePath) {
  const absolute = normalizeArtifactPath(filePath)
  if (!absolute) return null
  const relative = path.relative(WORKSPACE_ROOT, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('出于安全考虑，文件管理动作只能操作当前工作区内的文件。')
  }
  return absolute
}
function normalizeTargetFilePath(value, fallbackDir = NOTE_ARTIFACT_ROOT) {
  if (!value) return null
  const cleaned = String(value).trim().replace(/^['"“”‘’]+|['"“”‘’。]+$/g, '')
  if (!cleaned || !/\.(?:docx?|pdf|html|txt|md)$/i.test(cleaned)) return null
  return path.isAbsolute(cleaned)
    ? cleaned
    : cleaned.startsWith('artifacts/')
      ? path.resolve(WORKSPACE_ROOT, cleaned)
      : path.join(fallbackDir, cleaned)
}
function unsupportedCapabilityResult(agentName, capability, detail = '') {
  return {
    answer: [
      `${agentName}已经识别出你要做的是「${capability}」，但当前还没有接入能稳定执行这个动作的能力。`,
      detail || null,
      '我不会改用其它能力硬凑结果。需要补齐对应执行器后再做。',
    ].filter(Boolean).join('\n'),
    unsupportedCapability: capability,
  }
}
function extractFirstUrl(message) {
  const match = message.match(/https?:\/\/[^\s，。),）]+/i)
  return match?.[0] ?? null
}

function extractFirstFilePath(message) {
  return message.match(/((?:\/|artifacts\/notes\/)?[^\s，。；;:：'"“”‘’]+?\.(?:docx|doc|xlsx|xls|pptx|ppt|html|txt|md|pdf|png|jpg|jpeg|webp|tif|tiff|mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|mkv))/i)?.[1] ?? null
}

function extractFilePathReferences(message) {
  return [...String(message ?? '').matchAll(/((?:\/|artifacts\/notes\/)?[^\s，。；;:：'"“”‘’]+?\.(?:docx|doc|xlsx|xls|pptx|ppt|html|txt|md|pdf|png|jpg|jpeg|webp|tif|tiff|mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|mkv))/gi)]
    .map((match) => match[1])
    .filter((filePath, index, array) => array.indexOf(filePath) === index)
}

function extractAudioFilePath(message) {
  const filePath = extractFirstFilePath(message)
  if (filePath && /\.(mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|mkv)$/i.test(filePath)) return filePath
  return message.match(/((?:\/|artifacts\/notes\/)[^\s，。；;]+?\.(?:mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|mkv))/i)?.[1] ?? null
}
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function htmlToStructuredText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>\s*(?:&bull;|•)\s*/gi, '\n- ')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function extractTitle(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return title ? stripHtml(title).slice(0, 120) : '未读取到标题'
}

function extractMetaDescription(html) {
  const meta = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i)
  return meta?.[1] ? stripHtml(meta[1]).slice(0, 260) : ''
}
async function fetchTextPage(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 Local OS Agent MVP',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    const contentType = response.headers.get('content-type') ?? ''
    const body = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      contentType,
      body,
    }
  } finally {
    clearTimeout(timeout)
  }
}
function stringArg(args, key) {
  const value = args?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function arrayArg(args, key) {
  const value = args?.[key]
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
}

export {
  truncateAtBoundary,
  checkPort,
  normalizeArtifactPath,
  resolveExistingFileReference,
  slugifyFilename,
  escapeHtml,
  stripMarkdown,
  markdownToBasicHtml,
  parsePlannerJson,
  runCommandAsync,
  canConnectToPort,
  getResearchProxyUrl,
  postJsonWithOptionalProxy,
  tokenizeText,
  topKeywords,
  formatFileSize,
  ensureWorkspaceFile,
  normalizeTargetFilePath,
  unsupportedCapabilityResult,
  extractFirstUrl,
  extractFirstFilePath,
  extractFilePathReferences,
  extractAudioFilePath,
  stripHtml,
  htmlToStructuredText,
  extractTitle,
  extractMetaDescription,
  fetchTextPage,
  stringArg,
  arrayArg,
}
