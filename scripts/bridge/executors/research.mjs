// executors/research.mjs — 研究助手执行器：联网问答（Gemini grounding）、网页读取、浏览器自动化、天气。
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BROWSER_ARTIFACT_ROOT,
  GEMINI_API_KEY,
  RESEARCH_MODEL,
  RESEARCH_PROVIDER,
} from '../config.mjs'
import { emitEvent } from '../events.mjs'
import {
  extractClickText,
  extractWeatherCity,
  extractWeatherDay,
  isWeatherRequest,
  wantsScreenshot,
} from '../infer.mjs'
import {
  extractFirstUrl,
  extractMetaDescription,
  extractTitle,
  fetchTextPage,
  postJsonWithOptionalProxy,
  stringArg,
  stripHtml,
  unsupportedCapabilityResult,
} from '../lib.mjs'
import { callPlannerJson, synthesizeWithPlannerModel } from '../planner.mjs'
import { PLANNER_API_KEY, PLANNER_MODE } from '../config.mjs'

function buildSearchUrl(message) {
  const query = buildSearchQuery(message)
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query || message)}`
}

function buildSearchQuery(message) {
  const cleaned = message
    .replace(/搜索|检索|查一下|帮我查|浏览器|网页|打开/gu, ' ')
    .trim()
  const currentDate = new Date().toISOString().slice(0, 10)
  if (/今天|最新|刚刚|发布|新闻|动态|release|launch|announc/i.test(cleaned)) {
    return `${cleaned} ${currentDate}`
  }
  return cleaned
}
function weatherTextFromCondition(condition) {
  const raw = condition?.lang_zh?.[0]?.value ?? condition?.weatherDesc?.[0]?.value ?? '未知'
  const normalized = String(raw).trim()
  const commonMap = {
    Sunny: '晴',
    Clear: '晴',
    'Partly cloudy': '局部多云',
    Cloudy: '多云',
    Overcast: '阴',
    Mist: '薄雾',
    Fog: '雾',
    'Patchy rain nearby': '附近有零星降雨',
    'Light rain': '小雨',
    'Moderate rain': '中雨',
    'Heavy rain': '大雨',
    'Light snow': '小雪',
    'Moderate snow': '中雪',
    'Heavy snow': '大雪',
  }
  return commonMap[normalized] ?? normalized
}

function pickForecastHour(forecast) {
  const hourly = Array.isArray(forecast?.hourly) ? forecast.hourly : []
  return hourly.find((item) => item.time === '1200')
    ?? hourly.find((item) => item.time === '1500')
    ?? hourly[Math.floor(hourly.length / 2)]
    ?? null
}

function maxHourlyValue(forecast, key) {
  const values = (forecast?.hourly ?? [])
    .map((item) => Number.parseFloat(item?.[key]))
    .filter((value) => Number.isFinite(value))
  return values.length ? Math.max(...values) : null
}

function buildWeatherAnswer(weather) {
  const forecast = weather.forecast
  const dateText = forecast.date ? `（${forecast.date}）` : ''
  if (weather.dayOffset === 0) {
    return [
      `${weather.city}今天${dateText}天气：${weather.current.condition}，当前 ${weather.current.tempC}°C，体感 ${weather.current.feelsLikeC}°C。`,
      `今日预报：${forecast.condition}，气温 ${forecast.minTempC ?? '-'}-${forecast.maxTempC ?? '-'}°C；降雨概率最高 ${forecast.chanceOfRain ?? '-'}%；湿度 ${forecast.humidity ?? '-'}%；风速 ${forecast.windKmph ?? '-'} km/h；紫外线 ${forecast.uvIndex ?? '-'}。`,
      `来源：wttr.in，观测时间 UTC ${weather.current.observedAtUtc ?? '-'}`,
    ].join('\n')
  }
  return [
    `${weather.city}${weather.dayLabel}${dateText}天气预报：${forecast.condition}，气温 ${forecast.minTempC ?? '-'}-${forecast.maxTempC ?? '-'}°C。`,
    `平均气温 ${forecast.avgTempC ?? '-'}°C；降雨概率最高 ${forecast.chanceOfRain ?? '-'}%；湿度 ${forecast.humidity ?? '-'}%；风速 ${forecast.windKmph ?? '-'} km/h；紫外线 ${forecast.uvIndex ?? '-'}。`,
    '来源：wttr.in 预报数据。',
  ].join('\n')
}

async function fetchWeather(city, day = { offset: 0, label: '今天' }) {
  const cityMap = {
    北京: 'Beijing',
    上海: 'Shanghai',
    广州: 'Guangzhou',
    深圳: 'Shenzhen',
    杭州: 'Hangzhou',
    南京: 'Nanjing',
    成都: 'Chengdu',
    重庆: 'Chongqing',
    武汉: 'Wuhan',
    西安: 'Xian',
    天津: 'Tianjin',
    苏州: 'Suzhou',
    长沙: 'Changsha',
    郑州: 'Zhengzhou',
    青岛: 'Qingdao',
    厦门: 'Xiamen',
    香港: 'Hong Kong',
    台北: 'Taipei',
  }
  const query = cityMap[city] ?? city
  const page = await fetchTextPage(`https://wttr.in/${encodeURIComponent(query)}?format=j1&lang=zh`)
  const data = JSON.parse(page.body)
  const current = data.current_condition?.[0]
  const forecasts = Array.isArray(data.weather) ? data.weather : []
  const forecast = forecasts[Math.min(day.offset, Math.max(forecasts.length - 1, 0))]
  const forecastHour = pickForecastHour(forecast)
  if (!current) throw new Error('weather payload missing current condition')
  if (!forecast) throw new Error('weather payload missing forecast')
  return {
    city,
    dayOffset: day.offset,
    dayLabel: day.label,
    sourceUrl: `https://wttr.in/${encodeURIComponent(query)}?format=j1&lang=zh`,
    current: {
      observedAtUtc: current.observation_time,
      condition: weatherTextFromCondition(current),
      tempC: current.temp_C,
      feelsLikeC: current.FeelsLikeC,
      humidity: current.humidity,
      windKmph: current.windspeedKmph,
      precipitationMm: current.precipMM,
      uvIndex: current.uvIndex,
    },
    forecast: {
      date: forecast.date,
      condition: weatherTextFromCondition(forecastHour),
      minTempC: forecast.mintempC,
      maxTempC: forecast.maxtempC,
      avgTempC: forecast.avgtempC,
      chanceOfRain: maxHourlyValue(forecast, 'chanceofrain'),
      chanceOfSnow: maxHourlyValue(forecast, 'chanceofsnow'),
      humidity: forecastHour?.humidity,
      windKmph: forecastHour?.windspeedKmph,
      windDirection: forecastHour?.winddir16Point,
      precipitationMm: forecastHour?.precipMM,
      uvIndex: forecastHour?.uvIndex,
    },
  }
}
async function fetchSearchResultPages(results, limit = 3) {
  const pages = []
  for (const result of results.slice(0, limit)) {
    if (!/^https?:\/\//i.test(result.url)) continue
    try {
      const page = await fetchTextPage(result.url)
      pages.push({
        title: extractTitle(page.body) || result.title,
        url: page.url,
        text: stripHtml(page.body).slice(0, 2200),
      })
    } catch (error) {
      pages.push({
        title: result.title,
        url: result.url,
        text: `读取失败：${error.message}`,
      })
    }
  }
  return pages
}

async function runBrowserAutomation({ taskId, agentId, message, url }) {
  const { chromium } = await import('playwright')
  const headless = process.env.VISUAL_BRIDGE_BROWSER_HEADLESS !== 'false'
  const clickText = extractClickText(message)
  const shouldScreenshot = wantsScreenshot(message) || Boolean(clickText)
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
  })
  const page = await browser.newPage({
    viewport: { width: 1365, height: 768 },
  })

  try {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-browser-open`,
      status: 'running',
      title: '打开页面',
      detail: url,
      metric: 'Chrome 自动化',
      bubble: '打开',
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})

    let clicked = null
    let clickError = null
    if (clickText) {
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-browser-click`,
        status: 'running',
        title: '点击页面元素',
        detail: clickText,
        metric: '正在点击',
        bubble: '点击',
      })
      try {
        await page.getByText(clickText, { exact: false }).first().click({ timeout: 6000 })
        await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {})
        clicked = clickText
      } catch (error) {
        clickError = error.message
        emitEvent({
          type: 'task_log',
          taskId,
          agentId,
          stepId: `${taskId}-browser-click-failed`,
          status: 'failed',
          title: '点击未完成',
          detail: error.message,
          metric: '点击失败，保留现场',
          bubble: '受阻',
        })
      }
    }

    const title = await page.title()
    const currentUrl = page.url()
    const visibleText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
    let screenshotPath = null

    if (shouldScreenshot) {
      await mkdir(BROWSER_ARTIFACT_ROOT, { recursive: true })
      screenshotPath = path.join(BROWSER_ARTIFACT_ROOT, `${taskId}.png`)
      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
          timeout: 8000,
        })
      } catch {
        const cdp = await page.context().newCDPSession(page)
        const shot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
        })
        await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'))
      }
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-browser-screenshot`,
        status: 'done',
        title: '保存截图',
        detail: screenshotPath,
        metric: '截图已保存',
        bubble: '截图',
      })
    }

    return {
      title,
      url: currentUrl,
      text: visibleText.slice(0, 1400),
      clicked,
      clickError,
      screenshotPath,
      mode: 'playwright',
    }
  } finally {
    await browser.close()
  }
}

function extractSearchResults(html) {
  const results = []
  const linkPattern = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match = linkPattern.exec(html)
  while (match && results.length < 5) {
    results.push({
      title: stripHtml(match[2]).slice(0, 120),
      url: normalizeSearchResultUrl(match[1]),
      snippet: '',
    })
    match = linkPattern.exec(html)
  }
  return results
}

function normalizeSearchResultUrl(rawUrl) {
  const cleaned = rawUrl.replaceAll('&amp;', '&')
  try {
    const absolute = cleaned.startsWith('//')
      ? `https:${cleaned}`
      : cleaned.startsWith('/')
        ? `https://duckduckgo.com${cleaned}`
        : cleaned
    const parsed = new URL(absolute)
    const redirected = parsed.searchParams.get('uddg')
    return redirected ? decodeURIComponent(redirected) : absolute
  } catch {
    return cleaned
  }
}

async function executeBrowserAgent({ taskId, agentId, message }) {
  if (isWeatherRequest(message)) {
    const city = extractWeatherCity(message)
    const day = extractWeatherDay(message)
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-weather-fetch`,
      status: 'running',
      title: '查询天气',
      detail: `${city}${day.label}`,
      metric: `正在获取${day.label}天气`,
      bubble: '天气',
    })
    try {
      const weather = await fetchWeather(city, day)
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-weather-fetch`,
        status: 'done',
        title: '查询天气',
        detail: `${city}${day.label} ${weather.forecast.condition} ${weather.forecast.minTempC ?? '-'}-${weather.forecast.maxTempC ?? '-'}°C`,
        metric: '天气已获取',
        bubble: '完成',
      })
      return {
        answer: buildWeatherAnswer(weather),
        weather,
        url: weather.sourceUrl,
      }
    } catch (error) {
      console.error(`[research-agent] weather failed: ${error.message}`)
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-weather-fetch`,
        status: 'failed',
        title: '天气查询失败',
        detail: error.message,
        metric: '天气能力失败',
        bubble: '失败',
      })
      throw new Error(`天气查询失败：${error.message}`)
    }
  }

  const requestedUrl = extractFirstUrl(message)
  const url = requestedUrl ?? buildSearchUrl(message)
  const needsBrowserOperation = wantsScreenshot(message) || Boolean(extractClickText(message))

  if (needsBrowserOperation) {
    try {
      const automated = await runBrowserAutomation({ taskId, agentId, message, url })
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-browser-automation-done`,
        status: 'done',
        title: '浏览器操作完成',
        detail: automated.clicked ? `已点击：${automated.clicked}` : '已打开并读取页面',
        metric: '浏览器已操作',
        bubble: '完成',
      })
      return {
        answer: [
          `已用 Chrome 自动化打开：${automated.url}`,
          `标题：${automated.title || '未读取到标题'}`,
          automated.clicked ? `已点击：${automated.clicked}` : '',
          automated.clickError ? `点击未完成：${automated.clickError}` : '',
          automated.screenshotPath ? `截图：${automated.screenshotPath}` : '',
          '',
          `页面文本预览：${automated.text}`,
        ].filter(Boolean).join('\n'),
        ...automated,
      }
    } catch (error) {
      console.error(`[research-agent] automation fallback: ${error.message}`)
      emitEvent({
        type: 'task_log',
        taskId,
        agentId,
        stepId: `${taskId}-browser-automation-fallback`,
        status: 'failed',
        title: '浏览器自动化失败',
        detail: `${error.message}；改用静态读取。`,
        metric: '改用静态读取',
        bubble: '降级',
      })
    }
  }

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-browser-fetch`,
    status: 'running',
    title: requestedUrl ? '读取网页' : '联网搜索',
    detail: url,
    metric: requestedUrl ? '正在读取网页' : '正在搜索网页',
    bubble: '联网',
  })

  const page = await fetchTextPage(url)
  const title = extractTitle(page.body)
  const description = extractMetaDescription(page.body)
  const text = stripHtml(page.body).slice(0, 1200)
  const results = requestedUrl ? [] : extractSearchResults(page.body)
  const resultPages = requestedUrl ? [] : await fetchSearchResultPages(results)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-browser-parse`,
    status: 'done',
    title: '整理页面信息',
    detail: `HTTP ${page.status} / ${page.contentType || 'unknown content-type'}`,
    metric: '已整理网页',
    bubble: '整理',
  })

  if (resultPages.length) {
    emitEvent({
      type: 'task_log',
      taskId,
      agentId,
      stepId: `${taskId}-browser-source-pages`,
      status: 'done',
      title: '读取来源页',
      detail: `已读取 ${resultPages.length} 个搜索结果来源。`,
      metric: '已补充来源',
      bubble: '来源',
    })
  }

  const synthesizedAnswer = await synthesizeWithPlannerModel({
    message,
    sourceTitle: title,
    sourceText: [
      text,
      ...resultPages.map((item, index) => [
        `来源 ${index + 1}: ${item.title}`,
        `URL: ${item.url}`,
        item.text,
      ].join('\n')),
    ].join('\n\n'),
    results: results.map((item, index) => ({
      ...item,
      pageTextPreview: resultPages[index]?.text?.slice(0, 600) ?? '',
    })),
  }).catch((error) => {
    console.error(`[research-agent] synthesis skipped: ${error.message}`)
    return null
  })

  const answer = synthesizedAnswer
    ? [
        synthesizedAnswer,
        requestedUrl ? `来源：${page.url}` : `依据：${results.length ? results.map((item) => item.title).join('、') : title}`,
      ].join('\n')
    : requestedUrl
    ? [
        `已读取：${page.url}`,
        `标题：${title}`,
        description ? `摘要：${description}` : '',
        '',
        `正文预览：${text}`,
      ].filter(Boolean).join('\n')
    : [
        `已搜索：${message}`,
        `搜索页标题：${title}`,
        results.length
          ? `前 ${results.length} 条结果：\n${results.map((item, index) => `${index + 1}. ${item.title}${item.snippet ? `：${item.snippet}` : ''}`).join('\n')}`
          : `未解析到标准结果，页面预览：${text.slice(0, 600)}`,
      ].join('\n')

  return {
    answer,
    url: page.url,
    title,
    description,
    results,
    resultPages,
  }
}

function normalizeResearchAction(action) {
  const allowed = new Set(['grounded_answer', 'read_url', 'browser_action', 'weather', 'unknown'])
  const normalized = String(action ?? '').trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'unknown'
}

async function buildResearchAgentIntent({ message }) {
  if (!PLANNER_API_KEY || PLANNER_MODE !== 'llm') {
    return {
      action: extractFirstUrl(message) ? 'read_url' : isWeatherRequest(message) ? 'weather' : 'grounded_answer',
      confidence: 0.6,
      instruction: message,
    }
  }
  const parsed = await callPlannerJson({
    system: [
      'You are the embedded intent model inside a unified research/web assistant.',
      'Decide what web capability should be used. Do not answer the user.',
      'Return only JSON: {"action":"grounded_answer|read_url|browser_action|weather|unknown","confidence":0.0,"instruction":"..."}',
      'Use grounded_answer for general web research, latest facts, news, company background, comparisons, and broad search questions.',
      'Use read_url when the user gives a URL and wants it read or summarized.',
      'Use browser_action when the user asks to click, screenshot, operate a page, or perform visual browser automation.',
      'Use weather for weather questions.',
      'Preserve the user language in instruction.',
    ].join('\n'),
    payload: {
      userMessage: message,
      url: extractFirstUrl(message),
      wantsScreenshot: wantsScreenshot(message),
      clickText: extractClickText(message),
    },
  })
  return {
    action: normalizeResearchAction(parsed.action),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
    instruction: typeof parsed.instruction === 'string' && parsed.instruction.trim() ? parsed.instruction.trim() : message,
  }
}

function extractGeminiText(payload) {
  return payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim() ?? ''
}

function extractGeminiSources(payload) {
  const chunks = payload.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  return chunks
    .map((chunk) => chunk.web)
    .filter((web) => web?.uri || web?.title)
    .map((web) => ({
      title: web.title ?? web.uri,
      url: web.uri,
    }))
    .filter((source, index, array) => source.url && array.findIndex((item) => item.url === source.url) === index)
    .slice(0, 6)
}

async function executeResearchAgent({ taskId, agentId, message }) {
  const intent = await buildResearchAgentIntent({ message })
  if (intent.action === 'read_url' || intent.action === 'browser_action' || intent.action === 'weather') {
    return executeBrowserAgent({ taskId, agentId, message: intent.instruction })
  }
  if (intent.action === 'unknown' || intent.confidence < 0.45) {
    return {
      answer: '我还没判断清楚这个研究任务要怎么查。你可以补一句：要搜索资料、读取网页、截图，还是做对比研究。',
    }
  }
  if (RESEARCH_PROVIDER !== 'gemini' || !GEMINI_API_KEY) {
    throw new Error('研究助手需要 Gemini Google Search grounding，但当前没有配置 GEMINI_API_KEY。')
  }

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-research-grounded`,
    status: 'running',
    title: '联网研究',
    detail: `${RESEARCH_PROVIDER}/${RESEARCH_MODEL}`,
    metric: 'Google Search grounding',
    bubble: '研究',
  })

  const payload = await postJsonWithOptionalProxy(
    `https://generativelanguage.googleapis.com/v1beta/models/${RESEARCH_MODEL}:generateContent`,
    {
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  `当前日期：${new Date().toISOString().slice(0, 10)}。`,
                  '请用简体中文回答。优先给结论，再给必要要点。',
                  '如果是最新/今天/实时问题，请使用联网结果，不要凭记忆补事实。',
                  `用户问题：${intent.instruction}`,
                ].join('\n'),
              },
            ],
          },
        ],
        tools: [
          {
            google_search: {},
          },
        ],
      generationConfig: {
        temperature: 0,
      },
      }),
      timeout: 60000,
    },
  )

  const text = extractGeminiText(payload)
  if (!text) throw new Error('Gemini research returned empty content')
  const sources = extractGeminiSources(payload)

  emitEvent({
    type: 'task_log',
    taskId,
    agentId,
    stepId: `${taskId}-research-grounded`,
    status: 'done',
    title: '联网研究',
    detail: sources.length ? `已返回 ${sources.length} 个来源` : '已返回联网答案',
    metric: '研究完成',
    bubble: '完成',
  })

  return {
    answer: [
      text,
      sources.length
        ? `\n来源：\n${sources.map((source, index) => `${index + 1}. ${source.title} - ${source.url}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n'),
    sources,
    provider: RESEARCH_PROVIDER,
    model: RESEARCH_MODEL,
  }
}
async function executeResearchCapability({ taskId, agentId, step }) {
  const args = step.args ?? {}
  if (step.capability === 'weather') {
    const city = stringArg(args, 'city')
    const day = stringArg(args, 'day')
    const dayLabelMap = {
      today: '今天',
      tomorrow: '明天',
      day_after_tomorrow: '后天',
    }
    const normalizedDay = dayLabelMap[day] ?? day
    const parts = [step.message]
    if (city && !String(step.message).includes(city)) parts.push(`城市：${city}`)
    if (normalizedDay && !/(今天|明天|后天|today|tomorrow|day_after_tomorrow|day after tomorrow)/iu.test(step.message)) {
      parts.push(`时间：${normalizedDay}`)
    }
    return executeBrowserAgent({ taskId, agentId, message: parts.filter(Boolean).join('\n') })
  }
  if (step.capability === 'read_url') {
    const url = stringArg(args, 'url') ?? extractFirstUrl(step.message)
    if (!url) return unsupportedCapabilityResult('研究助手', '读取网页', '没有解析到 URL。')
    return executeBrowserAgent({ taskId, agentId, message: `读取 ${url}\n${step.message}` })
  }
  if (step.capability === 'browser_action') return executeBrowserAgent({ taskId, agentId, message: step.message })
  if (step.capability === 'grounded_answer') {
    const query = stringArg(args, 'query') ?? step.message
    return executeResearchAgent({ taskId, agentId, message: query })
  }
  return unsupportedCapabilityResult('研究助手', step.capability)
}

export {
  executeBrowserAgent,
  executeResearchAgent,
  executeResearchCapability,
  fetchWeather,
}
