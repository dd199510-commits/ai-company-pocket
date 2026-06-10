// infer.mjs — 轻量意图/格式/标题推断（正则启发式）。
// 注意：这里只放“可独立测试的纯函数”，新意图优先交给 LLM 规划器 + 能力注册表，而不是继续加正则。
import path from 'node:path'
import { NOTE_ARTIFACT_ROOT } from './config.mjs'
import { normalizeArtifactPath, slugifyFilename } from './lib.mjs'

function isOpenFileRequest(message) {
  return /(?:打开|再打开|重新打开|\bopen\b).*(文件|报告|文档|docx?|pdf|md|txt|html)|\.(?:docx?|pdf|md|txt|html)\s*(这个|那个)?$/i
    .test(message)
}

function wantsReportFileOutput(message) {
  if (isOpenFileRequest(message)) return false
  return /(形成|生成|整理成|写成|保存|导出).*(报告|信息报告|文档|docx?|word|pdf|md|markdown|文件)|报告.*(保存|生成|形成|文档|文件|docx?|word|pdf|md|markdown)/i
    .test(message)
}
function isSaveControlMessage(message) {
  return /保存|存起来|存一下|记下来|写成.*文件|落.*文件|导出|存成|保存成|刚才.*内容|刚才.*整理|你来定|你决定|随便|都行/.test(message)
}

function isSaveClarificationAnswer(answer) {
  return /保存哪部分|什么文件名|保存成什么文件名|保存到哪个文件夹|希望.*文件名|希望.*保存到/.test(answer)
}

function inferSaveFormat(message, context = []) {
  const text = [
    message,
    ...context.slice(-3).map((item) => item.user ?? ''),
  ].join('\n').toLowerCase()
  if (/\bdocx\b/.test(text)) return 'docx'
  if (/\bdoc\b|word|文档/.test(text)) return 'doc'
  if (/\btxt\b|纯文本|文本/.test(text)) return 'txt'
  if (/\bhtml?\b|网页/.test(text)) return 'html'
  if (/\bmd\b|markdown/.test(text)) return 'md'
  return 'md'
}

function saveFormatLabel(format) {
  const labels = {
    md: 'Markdown',
    txt: 'TXT',
    html: 'HTML',
    doc: 'Word 可打开的 DOC',
    docx: '原生 DOCX',
    pdf: 'PDF',
  }
  return labels[format] ?? format.toUpperCase()
}
function inferReportFormat(message) {
  if (/\bdocx\b/i.test(message)) return 'docx'
  if (/\bpdf\b/i.test(message)) return 'pdf'
  if (/\bdoc\b|Word|文档/i.test(message)) return 'doc'
  if (/\bhtml?\b/i.test(message)) return 'html'
  if (/\btxt\b|纯文本|文本/i.test(message)) return 'txt'
  if (/\bmd\b|markdown/i.test(message)) return 'md'
  return 'doc'
}

function inferRequestedReportPath(message, fallbackTitle) {
  const format = inferReportFormat(message)
  const explicitPath = message.match(/((?:\/|artifacts\/notes\/)[^\s，。；;]+?\.(?:docx|doc|pdf|html|txt|md))/i)?.[1]
  if (explicitPath && !isGenericReportFileName(path.basename(explicitPath))) return normalizeArtifactPath(explicitPath)

  const namedFile = message.match(/文件名(?:为|是)?['"“”‘’]?([^'"“”‘’，。；;\s]+?\.(?:docx|doc|pdf|html|txt|md))['"“”‘’]?/i)?.[1]
    ?? message.match(/保存(?:为|成)?['"“”‘’]?([^'"“”‘’，。；;\s]+?\.(?:docx|doc|pdf|html|txt|md))['"“”‘’]?/i)?.[1]
  if (namedFile && !isGenericReportFileName(namedFile)) return path.join(NOTE_ARTIFACT_ROOT, namedFile)

  const date = new Date().toISOString().slice(0, 10)
  return path.join(NOTE_ARTIFACT_ROOT, `${date}-${slugifyFilename(fallbackTitle)}.${format}`)
}

function cleanInferredSubject(value) {
  return String(value ?? '')
    .replace(/^(一下|一些|有关|关于|围绕|搜索|搜搜|查查|调研|整理|给我|帮我|请|形成|生成|做个|做一份|一个|一份)+/, '')
    .replace(/(的信息|的资料|的背景|的相关介绍|相关介绍|信息报告|报告|财报|文档|文件|资料)$/g, '')
    .trim()
}

function isGenericReportTitle(value) {
  const compact = String(value ?? '')
    .replace(/\.(?:docx?|pdf|html|txt|md)$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/(给我|帮我|请|形成|生成|整理|保存|一个|一份|有关|关于|信息报告|报告|文档|文件|资料|内容|看看|打开)/g, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  return compact.length < 2
}

function isGenericReportFileName(fileName) {
  return isGenericReportTitle(path.basename(fileName, path.extname(fileName)))
}

function inferTitleFromAnswer(answer) {
  const text = String(answer ?? '').trim()
  if (!text) return ''

  const heading = text.match(/^#{1,3}\s+(.{2,50}?)(?:\n|$)/m)?.[1]
  if (heading && !isGenericReportTitle(heading)) return heading.replace(/[:：]\s*$/, '').trim()

  const namedReport = text.match(/(?:^|\n)\s*(?:#*\s*)?([\u4e00-\u9fa5A-Za-z0-9 .·（）()_-]{2,40}(?:对比|分析|介绍|信息|调研|研究|报告)[\u4e00-\u9fa5A-Za-z0-9 .·（）()_-]{0,18})(?:\n|$)/)?.[1]
  if (namedReport && !isGenericReportTitle(namedReport)) return namedReport.trim()

  const conclusionSubject = text.match(/(?:核心结论|结论)[:：]?\s*(?:\*\*)?([\u4e00-\u9fa5A-Za-z0-9 .·（）()_-]{2,28})(?:\*\*)?(?:（|\(|目前|是|为|，|,|：|:|\s)/)?.[1]
  const cleanedConclusion = cleanInferredSubject(conclusionSubject)
  if (cleanedConclusion && !isGenericReportTitle(cleanedConclusion)) return `${cleanedConclusion}信息报告`

  const entitySubject = text.match(/(?:^|\n)\s*(?:\*\*)?([\u4e00-\u9fa5A-Za-z0-9 .·（）()_-]{2,28})(?:\*\*)?(?:（[^）]+）)?(?:是一家|是中国|成立于|目前正|位于)/)?.[1]
  const cleanedEntity = cleanInferredSubject(entitySubject)
  if (cleanedEntity && !isGenericReportTitle(cleanedEntity)) return `${cleanedEntity}信息报告`

  return ''
}

function inferNoteTitle(sourceMessage, answer = '') {
  const subjectMatch = sourceMessage.match(/(?:有关|关于|围绕|搜索|搜搜|查查|调研|整理|参观|拜访|去)([\u4e00-\u9fa5A-Za-z0-9]{2,18})/)
    ?? sourceMessage.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,18})(?:的信息|的资料|的背景|报告|财报|开会|参观|拜访)/)
  if (subjectMatch?.[1]) {
    const subject = cleanInferredSubject(subjectMatch[1])
    if (subject && !isGenericReportTitle(subject)) {
      if (/会议|开会|参观|拜访/.test(sourceMessage)) return `${subject}会前准备`
      if (/报告|doc|文档|资料|信息|调研|搜索|搜搜|查查/.test(sourceMessage)) return `${subject}信息报告`
      return subject
    }
  }
  const answerTitle = inferTitleFromAnswer(answer)
  if (answerTitle) return answerTitle
  if (/会议|开会|参观|拜访/.test(sourceMessage)) return '会前准备'
  const compact = sourceMessage
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '')
    .slice(0, 18)
  return compact && !isGenericReportTitle(compact) ? compact : '保存内容'
}
function wantsIndexedFileList(message) {
  return /((本地|当前|项目|工作区|索引).*)?文件.*(哪些|都有|列表|清单|列一下|列出|都是啥|是什么|10\s*个|十个)|列.*文件|file\s+list|list\s+files/i
    .test(message)
}

function wantsIndexedFileLocations(message) {
  return /(这些|这十个|10\s*个|十个|本地|索引|文件).*(地址|路径|位置|在哪|哪里|哪个文件夹|存在哪个文件夹|所在.*文件夹|完整路径|绝对路径)|文件.*(地址|路径|位置|在哪|哪里|文件夹|完整路径|绝对路径)|where.*files|file.*paths?/i
    .test(message)
}

function isReportCountRequest(message) {
  return /(之前|刚才|已经|总共|一共|都)?(生成|保存|整理)?了?几个报告|报告.*(几个|多少|数量|统计|一共|总共)|多少个.*报告/i
    .test(message)
}

function isReportListRequest(message) {
  return /(现在|之前|当前|已有|生成|保存|整理)?(都)?有(什么|哪些|多少)?报告|报告.*(有哪些|有什么|列表|清单|列出|列一下|都有什么|都有哪些)/i
    .test(message)
}

function wantsGeneratedFileSave(message) {
  if (isReportCountRequest(message) || isReportListRequest(message)) return false
  if (/保存目录|默认保存|报告保存目录|保存位置|保存路径/.test(message)) return false
  return /(保存|写入|整理成|生成|形成|另存|导出).*(md|markdown|txt|html|docx?|word|pdf|文件|文档|报告)|保存(?:为|成)?\s*[^\s，。；;]+?\.(?:md|txt|html|docx?|pdf)/i
    .test(message)
}
function isFileSummaryRequest(message) {
  return /(读取|读一下|看看|总结|概括|识别|ocr|主要讲了啥|讲了什么|内容|摘要).*(文件|报告|docx?|pdf|excel|xlsx?|pptx?|图片|图像|文档)|文件.*(主要讲了啥|讲了什么|总结|摘要|内容)|报告.*(主要讲了啥|讲了什么|总结|摘要|内容)/i.test(message)
}

function isDocumentConversionRequest(message) {
  return /(另存|转成|转换|导出|保存为|保存成|整理成).*(word|docx|doc|pdf|html|txt|md|markdown|文档|纯文本)|word.*(另存|转换|保存)|pdf.*(另存|转换|保存)|扩展名.*(改为|换成)/i
    .test(message)
}

function isFileManagementRequest(message) {
  return /(删除|删掉|移除|重命名|改名|移动|挪到|复制|拷贝).*(文件|报告|文档|artifacts\/notes|\.md|\.docx?|\.pdf|\.txt|\.html)|^(删除|删掉|重命名|改名|移动|复制|拷贝)/i
    .test(message)
}
function wantsScreenshot(message) {
  return /截图|截屏|screenshot|screen shot/i.test(message)
}

function extractClickText(message) {
  const match = message.match(/点击\s*[“"']?([^”"',，。]+)[”"']?/u)
    ?? message.match(/click\s+["']?([^"',.]+)["']?/i)
  return match?.[1]
    ?.replace(/\s*(并|然后|后)\s*(截图|截屏|screenshot).*$/iu, '')
    .trim() ?? null
}
function isWeatherRequest(message) {
  return /天气|气温|温度|下雨|降雨|空气|weather/i.test(message)
}

function extractWeatherCity(message) {
  const cityMatch = message.match(/(?:今天|明天|后天|查询|查一下|帮我查|看看|的|天气|气温|温度|\s)*(北京|上海|广州|深圳|杭州|南京|成都|重庆|武汉|西安|天津|苏州|长沙|郑州|青岛|厦门|香港|台北)/u)
  if (cityMatch?.[1]) return cityMatch[1]
  const englishMatch = message.match(/weather\s+(?:in\s+)?([a-zA-Z\s-]+)/i)
  return englishMatch?.[1]?.trim() || '北京'
}

function extractWeatherDay(message) {
  const text = String(message ?? '').toLowerCase()
  if (/day_after_tomorrow|day after tomorrow|后天/u.test(text)) {
    return { offset: 2, label: '后天' }
  }
  if (/tomorrow|明天/u.test(text)) {
    return { offset: 1, label: '明天' }
  }
  if (/today|今天/u.test(text)) {
    return { offset: 0, label: '今天' }
  }
  return { offset: 0, label: '今天' }
}

export {
  isOpenFileRequest,
  wantsReportFileOutput,
  isSaveControlMessage,
  isSaveClarificationAnswer,
  inferSaveFormat,
  saveFormatLabel,
  inferReportFormat,
  inferRequestedReportPath,
  cleanInferredSubject,
  isGenericReportTitle,
  isGenericReportFileName,
  inferTitleFromAnswer,
  inferNoteTitle,
  wantsIndexedFileList,
  wantsIndexedFileLocations,
  isReportCountRequest,
  isReportListRequest,
  wantsGeneratedFileSave,
  isFileSummaryRequest,
  isDocumentConversionRequest,
  isFileManagementRequest,
  wantsScreenshot,
  extractClickText,
  isWeatherRequest,
  extractWeatherCity,
  extractWeatherDay,
}
