// server.mjs — HTTP/SSE 入口：路由、运行时快照、基础来源校验。
import { createServer } from 'node:http'
import {
  AGENTS,
  DEFAULT_RUNTIME,
  GEMINI_API_KEY,
  HOST,
  OPENCLAW_AGENT_MAP,
  PLANNER_API_KEY,
  PLANNER_BASE_URL,
  PLANNER_MODE,
  PLANNER_MODEL,
  PLANNER_PROVIDER,
  PORT,
  RESEARCH_MODEL,
  RESEARCH_PROVIDER,
  RUNTIME_ROOT,
  WORKSPACE_ROOT,
} from './config.mjs'
import { activeTasks, clients, pendingActions, readHistory } from './events.mjs'
import { buildFileIndex, getFileIndex, getFileIndexInfo, publicFileEntry } from './executors/file.mjs'
import { checkPort } from './lib.mjs'
import { confirmAction, startTask } from './pipeline.mjs'

// 仅允许本机前端来源访问，降低恶意网页通过 localhost 调用敏感接口的风险。
const ALLOWED_ORIGIN_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const ACCESS_TOKEN = process.env.VISUAL_BRIDGE_TOKEN ?? null

function isRequestAllowed(request) {
  const origin = request.headers.origin
  if (origin && !ALLOWED_ORIGIN_PATTERN.test(origin)) return false
  if (ACCESS_TOKEN) {
    const provided = request.headers['x-bridge-token']
    if (provided !== ACCESS_TOKEN) return false
  }
  return true
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload, null, 2))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
  })
}
async function runtimeSnapshot() {
  const openclawRuntime = OPENCLAW_AGENT_MAP['writing-agent'] ?? DEFAULT_RUNTIME
  const gatewayListening = await checkPort(openclawRuntime.gatewayPort)
  return {
    ok: true,
    profile: 'local-os-agent',
    message: '本地执行桥已连接',
    runtimeRoot: RUNTIME_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
    gateway: {
      port: openclawRuntime.gatewayPort,
      url: `ws://127.0.0.1:${openclawRuntime.gatewayPort}`,
      listening: gatewayListening,
    },
    activeTasks: [...activeTasks.values()],
    pendingActions: [...pendingActions.values()].map((action) => ({
      actionId: action.actionId,
      taskId: action.taskId,
      agentId: action.agentId,
      type: action.type,
      title: action.title,
      detail: action.detail,
    })),
    planner: {
      mode: PLANNER_MODE === 'llm' && PLANNER_API_KEY ? 'llm' : 'rules',
      requestedMode: PLANNER_MODE,
      provider: PLANNER_PROVIDER,
      model: PLANNER_MODEL,
      baseUrl: PLANNER_BASE_URL,
      configured: Boolean(PLANNER_API_KEY),
    },
    research: {
      provider: RESEARCH_PROVIDER,
      model: RESEARCH_MODEL,
      configured: Boolean(GEMINI_API_KEY),
    },
    fileIndex: getFileIndexInfo(),
    agents: AGENTS,
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (!isRequestAllowed(request)) {
    sendJson(response, 403, { ok: false, error: 'origin or token not allowed' })
    return
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/runtime') {
      sendJson(response, 200, await runtimeSnapshot())
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/history') {
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10)
      sendJson(response, 200, {
        ok: true,
        history: await readHistory(Number.isFinite(limit) ? limit : 20),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/file-index') {
      const rebuild = url.searchParams.get('rebuild') === '1'
      const index = rebuild ? await buildFileIndex() : await getFileIndex()
      sendJson(response, 200, {
        ok: true,
        builtAt: index.builtAt,
        root: index.root,
        fileCount: index.files.length,
        files: index.files.map(publicFileEntry),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
      })
      response.write('\n')
      clients.add(response)
      response.on('error', () => clients.delete(response))
      request.on('close', () => clients.delete(response))
      return
    }

    if (request.method === 'POST' && (url.pathname === '/api/tasks' || url.pathname === '/api/probe')) {
      const body = await readJson(request)
      const message = body.message || '只回复 OK'
      const result = await startTask({
        message,
        requestedAgentId: body.agentId,
        threadId: body.threadId,
      })
      sendJson(response, 202, result)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/actions/confirm') {
      const body = await readJson(request)
      sendJson(response, 200, await confirmAction(body.actionId))
      return
    }

    sendJson(response, 404, { ok: false, error: 'Not found' })
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Local OS Agent bridge listening at http://${HOST}:${PORT}`)
  console.log(`workspace=${WORKSPACE_ROOT}`)
  console.log(`writing gateway=ws://127.0.0.1:${OPENCLAW_AGENT_MAP['writing-agent'].gatewayPort}`)
})
