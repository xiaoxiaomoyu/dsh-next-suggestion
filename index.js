/**
 * Host half of dsh-next-suggestion.
 *
 * Owns two local routes under /plugins/dsh-next-suggestion:
 *   GET  /config   — what the Client needs to render (enabled, count)
 *   POST /predict  — reads the current Session, asks the model for candidate
 *                    next messages, returns { items: string[] }
 *
 * No state is kept between requests: the Session log is the only context, so a
 * reload or a second browser tab cannot see a stale transcript.
 *
 * @module dsh-next-suggestion
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-next-suggestion'

/** Services this plugin needs before apply runs. */
export const inject = ['webServer', 'sessions', 'llm']

const BASE = '/plugins/dsh-next-suggestion'
const MAX_BODY_BYTES = 16 * 1024
const LOG_DIR = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-next-suggestion')
const LOG_PATH = path.join(LOG_DIR, 'debug.log')

const DEFAULTS = {
  enabled: true,
  count: 3,
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  maxMessages: 12,
  messageChars: 1200,
  timeoutMs: 15000,
  maxOutputTokens: 4000,
  debug: false,
}

/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** @param {string | undefined} value @param {string} fallback */
function pickString(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/** @param {unknown} raw */
function normalizeConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: value.enabled !== false,
    count: clampInt(value.count, 1, 3, DEFAULTS.count),
    provider: pickString(value.provider, DEFAULTS.provider),
    model: pickString(value.model, DEFAULTS.model),
    maxMessages: clampInt(value.maxMessages, 2, 20, DEFAULTS.maxMessages),
    messageChars: clampInt(value.messageChars, 100, 2000, DEFAULTS.messageChars),
    timeoutMs: clampInt(value.timeoutMs, 1000, 60000, DEFAULTS.timeoutMs),
    maxOutputTokens: clampInt(value.maxOutputTokens, 200, 16000, DEFAULTS.maxOutputTokens),
    debug: value.debug === true,
  }
}

/** Append one development line; failures never affect a request. @param {boolean} on @param {string} line */
let logDirReady = false
function debugLog(on, line) {
  if (!on) return
  try {
    if (!logDirReady) {
      fs.mkdirSync(LOG_DIR, { recursive: true })
      logDirReady = true
    }
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // logging is best-effort
  }
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} payload */
function sendJson(res, status, payload) {
  if (res.writableEnded) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Only loopback pages and same-origin callers may spend tokens. The route is
 * registered on the Host web server, so it is outside the /api auth fence and
 * must defend itself.
 * @param {import('node:http').IncomingMessage} req
 */
function isAllowedOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1'
}

/** @param {import('node:http').IncomingMessage} req */
async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Keep both ends of a long message: the opening states the point, the tail
 * carries conclusions and the question the user is about to answer.
 * @param {string} text
 * @param {number} head
 * @param {number} tail
 */
function clipEnds(text, head, tail) {
  if (text.length <= head + tail + 1) return text
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

/** @param {any} message */
function messageText(message) {
  return (message.content || [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * Newest-first pick plus the task seed (the first user message), which tells
 * the model what the whole session is about.
 * @param {any} session
 * @param {{ maxMessages: number, messageChars: number }} cfg
 * @returns {{ seed: string, transcript: string, recentUser: string[], lastRole: string }}
 */
function buildContext(session, cfg) {
  /** @type {string[]} */
  const picked = []
  /** @type {string[]} */
  const recentUser = []
  let messages
  try {
    messages = session.deriveMessages()
  } catch {
    return { seed: '', transcript: '', recentUser: [], lastRole: '' }
  }

  /** @type {string | undefined} */
  let seed
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = messageText(message)
    if (text === '') continue
    seed = clipEnds(text, 240, 0)
    break
  }

  /** @type {string} */
  let lastRole = ''
  let total = 0
  for (let i = messages.length - 1; i >= 0 && picked.length < cfg.maxMessages; i -= 1) {
    const message = messages[i]
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const text = messageText(message)
    if (text === '') continue
    if (lastRole === '') lastRole = message.role
    if (message.role === 'user' && recentUser.length < 4) recentUser.push(text)
    const clipped =
      message.role === 'assistant'
        ? clipEnds(text, 350, cfg.messageChars)
        : clipEnds(text, cfg.messageChars, 0)
    if (picked.length > 0 && total + clipped.length > 12000) break
    total += clipped.length
    picked.push(`${message.role === 'user' ? '用户' : '助手'}: ${clipped}`)
  }

  return {
    seed: seed === undefined ? '' : seed,
    transcript: picked.reverse().join('\n\n'),
    recentUser,
    lastRole,
  }
}

/** @param {number} count */
function systemPrompt(count) {
  return [
    '你在预测用户的下一条消息，不是继续对话，也不是替助手回答。',
    '先读懂助手最后一条消息：它在陈述结论、给出选项，还是在问用户问题。用户下一句通常是对它的回应。',
    `给出最多 ${count} 条用户最可能发的下一条消息，按可能性从高到低。`,
    '写得像用户本人会打的字：长度不限，一句到两句都行，该长就长，该短就短。',
    '尽量具体：提到文件、选项、数字、要改的地方，不要停在「继续」「好的」这种客套话。',
    '几条候选可以对应不同意图（照做、纠正、追问），也可以是对同一意图的不同说法。',
    '不要重复用户最近说过的话，不要复述助手的原话。',
    '用对话本身的语言。不加引号、不加解释、不加序号、不用 markdown。',
    '只输出 JSON 字符串数组，例如 ["按这个改，先跑通再说","第二步太慢了，先只做卡片"]。',
    '一条都猜不出就输出 []。',
  ].join('\n')
}

/**
 * @param {{ seed: string, transcript: string }} context
 */
function userPrompt(context) {
  const parts = []
  if (context.seed !== '') parts.push(`任务：${context.seed}`)
  parts.push(`最近对话：\n${context.transcript}`)
  parts.push('下一条用户消息候选：')
  return parts.join('\n\n')
}

/**
 * Tolerant parse: JSON array first, line list second. Candidates that merely
 * repeat something the user just said are dropped — that is an echo, not a
 * prediction.
 * @param {string} text
 * @param {number} count
 * @param {readonly string[]} [recentUser]
 */
function parseItems(text, count, recentUser = []) {
  const raw = String(text || '').trim()
  if (raw === '') return []
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  /** @type {unknown[]} */
  let list = []
  const start = unfenced.indexOf('[')
  const end = unfenced.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(unfenced.slice(start, end + 1))
      if (Array.isArray(parsed)) list = parsed
    } catch {
      // fall through to line parsing
    }
  }
  if (list.length === 0) {
    // The model may run out of output budget mid-array, leaving valid opening
    // strings and an unterminated tail. Salvage every complete quoted string
    // before considering raw line splitting, so a cut-off never surfaces as a
    // JSON-looking candidate.
    /** @type {string[]} */
    const salvaged = []
    const quoted = /"((?:[^"\\]|\\.)*)"/g
    let match
    while ((match = quoted.exec(unfenced)) !== null) {
      try {
        salvaged.push(JSON.parse(`"${match[1]}"`))
      } catch {
        salvaged.push(match[1])
      }
    }
    list =
      salvaged.length > 0
        ? salvaged
        : unfenced
            .split(/\r?\n/)
            .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
            .filter(Boolean)
  }

  /** @param {string} value */
  const normalize = (value) =>
    value
      .toLowerCase()
      .replace(/[\s，。！？、,.!?；;：:'"“”‘’（）()【】\[\]]/g, '')
      .trim()
  const recent = new Set(recentUser.map(normalize).filter(Boolean))

  const seen = new Set()
  const items = []
  for (const candidate of list) {
    if (typeof candidate !== 'string') continue
    let item = candidate
      .trim()
      .replace(/^["'“”「」]+|["'“”「」]+$/g, '')
      .replace(/^(?:用户|助手)\s*[:：]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (item === '' || item.startsWith('<skip>') || item.startsWith('[]')) continue
    // Never render serialization leftovers as a candidate.
    if (/^[\[{]/.test(item) || item.includes('","') || item.includes('":"')) continue
    const key = normalize(item)
    if (recent.has(key)) continue
    if (item.length > 200) item = item.slice(0, 200)
    if (seen.has(item)) continue
    seen.add(item)
    items.push(item)
    if (items.length >= count) break
  }
  return items
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig)

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  function handleConfig(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method' })
    if (!isAllowedOrigin(req)) return sendJson(res, 403, { error: 'origin' })
    debugLog(cfg.debug, `GET config from ${req.headers.origin ?? 'no-origin'}`)
    return sendJson(res, 200, { enabled: cfg.enabled, count: cfg.count, debug: cfg.debug })
  }

  /**
   * Development beacon: the Client reports its own turn/condition state here so
   * failures are visible in `.debug.log` instead of only in the browser console.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleDebug(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' })
    if (!isAllowedOrigin(req)) return sendJson(res, 403, { error: 'origin' })
    let body
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: 'body' })
    }
    debugLog(cfg.debug, `client ${JSON.stringify(body).slice(0, 500)}`)
    return sendJson(res, 200, { ok: true })
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handlePredict(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' })
    if (!isAllowedOrigin(req)) return sendJson(res, 403, { error: 'origin' })
    if (!cfg.enabled) return sendJson(res, 200, { items: [] })

    let body
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: 'body' })
    }
    const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : ''
    const fresh = Boolean(body && body.fresh === true)
    debugLog(cfg.debug, `POST predict sid=${sessionId.slice(0, 12)}${fresh ? ' fresh' : ''}`)
    const session = sessionId === '' ? undefined : ctx.sessions.get(/** @type {any} */ (sessionId))
    if (session === undefined) return sendJson(res, 200, { items: [] })

    const context = buildContext(session, cfg)
    // A prediction answers an assistant turn. If the newest message is the
    // user's own (aborted turn, or a brand-new session), there is nothing to
    // respond to yet.
    if (context.transcript === '' || context.lastRole !== 'assistant') {
      return sendJson(res, 200, { items: [] })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
    const onClose = () => controller.abort()
    req.on('close', onClose)
    try {
      const stream = ctx.llm.stream({
        provider: cfg.provider,
        model: cfg.model,
        system: systemPrompt(cfg.count),
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(context) }] }],
        reasoningEffort: /** @type {any} */ ('high'),
        maxTokens: cfg.maxOutputTokens,
        // A "try again" call should not repeat the same sentence.
        temperature: fresh ? 0.9 : 0.5,
        signal: controller.signal,
        purpose: 'dsh-next-suggestion',
      })
      let output = ''
      for await (const chunk of stream) {
        if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
      }
      const items = parseItems(output, cfg.count, context.recentUser)
      debugLog(cfg.debug, `  -> ${items.length} items (${JSON.stringify(output).slice(0, 160)})`)
      return sendJson(res, 200, { items })
    } catch (error) {
      debugLog(cfg.debug, `  -> failed: ${error instanceof Error ? error.message : String(error)}`)
      console.warn('[dsh-next-suggestion] prediction failed:', error instanceof Error ? error.message : error)
      return sendJson(res, 200, { items: [] })
    } finally {
      clearTimeout(timer)
      req.off('close', onClose)
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/config`, handler: handleConfig }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/predict`, handler: handlePredict }),
    ]
    if (cfg.debug) disposers.push(ctx.webServer.register({ kind: 'exact', path: `${BASE}/debug`, handler: handleDebug }))
    return () => disposers.forEach((dispose) => dispose())
  })
}

