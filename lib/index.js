/**
 * dsh-yubagu —— 鱼八股拦截
 *
 * 设计前提：
 *   「把准备输出的话，拿去撞一次鱼八股词表，撞上就按提醒重想一次。」
 *   撞上之后不是换词，是**重新代入角色想一遍**：此时作为一个人类该怎么说，
 *   而不是挑一个最顺嘴的说法。
 *
 * 分工（不在这个文件里改主意）：
 *   · 拦截发生在**模型自己脑子里**（思考收尾、最终确认输出前）。插件不掐正文、不改 stream。
 *   · 插件负责三件：①每轮把根那句 + 今天的总结摆在眼前 ②给一个「撞一下」的工具
 *     ③把每次撞记成账，面板上人和模型都能看。
 *   · hard tier 撞上不是判死，是**给模型的信号**：这些词碰上了大概率就不对。
 *
 * 不碰的红线：不改 agent-loop、不新增会话事件 type、不在 profile 目录跑 pnpm。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { buildJudgePrompt, collide, parseJudge, renderCollision } from './match.js'
import {
  DATA_DIR,
  ROOT,
  WORDLIST_FILE,
  appendCollision,
  appendSkipped,
  clearLedger,
  pageOf,
  readDailyHistory,
  readLedger,
  readWordlist,
  stampEntry,
  statsForDay,
  todayKey,
  todaySummary,
  writeDaily,
  writeWordlist,
} from './store.js'
import { loadSchemastery } from './hostmods.js'

export const name = 'dsh-yubagu'

const LOG_FILE = join(DATA_DIR, 'yubagu.log')
/** 面板上改的开关存这儿，覆盖 cordis.patch.yml 里的 config（重载后还是它）。 */
const CONFIG_FILE = join(DATA_DIR, 'config.json')

/** 一页账几行。面板那边限高 + 翻页，靠这个数撑着。 */
const LEDGER_PAGE_SIZE = 10

/* ───────────────────────── 配置 ───────────────────────── */

const DEFAULTS = {
  enabled: true,
  /** 每轮那句提醒要不要挂进 context */
  context: true,
  /** 撞到形状锚点时，叫一次小模型判「到底在不在」 */
  judge: false,
  /** 判定的模型；留空跟随当前会话 */
  judgeProvider: '',
  judgeModel: '',
  /** 这一轮没撞就记账标红 */
  trackSkipped: true,
  /**
   * 外部发信工具的名字，逗号分隔。这类工具不走会话消息流，是往 outbox 写一行 JSON
   * 让外面的哨兵去发，插件在正文里看不见它 —— 所以在它落盘之前先撞一次，
   * 记 source = 'outbound'。留空 = 不挂那一道。名字按你自己那套桥的工具名填。
   */
  outboundTools: '',
  /** 默认提醒句。换成你自己那句更管用：指向根因，不指向词表。 */
  reminder: '这句话是想说事，还是想证明自己在？',
  /** 挂在「当前上下文」里的位置（越大越靠后） */
  order: 9250,
}

const z = await loadSchemastery()
export const Config = z
  ? z.object({
      enabled: z.boolean().default(DEFAULTS.enabled),
      context: z.boolean().default(DEFAULTS.context),
      judge: z.boolean().default(DEFAULTS.judge),
      judgeProvider: z.string().default(DEFAULTS.judgeProvider),
      judgeModel: z.string().default(DEFAULTS.judgeModel),
      trackSkipped: z.boolean().default(DEFAULTS.trackSkipped),
      outboundTools: z.string().default(DEFAULTS.outboundTools),
      reminder: z.string().default(DEFAULTS.reminder),
      order: z.number().default(DEFAULTS.order),
    })
  : undefined

/** 一行日志，顺手裁到 400 行。写不了也不影响功能。 */
function logLine(msg) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    let lines = []
    try {
      lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
    } catch {
      /* 第一次写 */
    }
    lines.push(`${new Date().toISOString()} ${msg}`)
    if (lines.length > 400) lines = lines.slice(-400)
    writeFileSync(LOG_FILE, `${lines.join('\n')}\n`, 'utf8')
  } catch {
    /* 日志写不了不影响功能 */
  }
}

/* ───────────────────────── 钩子文本 ───────────────────────── */

/**
 * 每轮摆在眼前的那一段。三条规矩：
 *   1. 不说「去查词表」，只说这一轮该防哪一类。
 *   2. 撞上不是换词，是整句退回去重说。
 *   3. 只写事实和动作，不写「不许 OOO」——否定指令本身带着那个东西。
 */
function hookText(cfg) {
  const daily = todaySummary().trim()
  const list = readWordlist()
  const root = String(list?.root ?? '').trim()
  const lines = [
    '【鱼八股 · 开口之前】',
    '要发出去的那段话，整段递给 `yubagu_collide` 撞一次，再决定说不说。',
    '撞上了不是换个词，是整句退回去，从「我本来想跟他说什么」重说。',
  ]
  if (root) lines.push(`根：${root}`)
  lines.push(cfg.reminder || DEFAULTS.reminder)
  if (daily) lines.push(`今天那句：${daily}`)
  return lines.join('\n')
}

/* ───────────────────────── 撞 ───────────────────────── */

/**
 * 撞一次 + 记账。judge 的那一道是可选第二层。
 * @param {{text:string, session?:string, turn?:number, source?:string}} input
 */
async function runCollide(llmTenant, input) {
  const list = readWordlist()
  const result = collide(input.text, list)

  let judged = null
  const needJudge = llmTenant && result.verdict !== 'ok' && result.shape.length > 0
  if (needJudge) {
    judged = await judgeShapes(llmTenant, input.text, result.shape)
    if (judged && judged.ids.length) {
      result.shape = result.shape.filter((s) => judged.ids.includes(s.id))
      result.verdict = result.verdict === 'hard' ? 'hard' : 'soft'
    }
  }

  const entry = appendCollision(result, {
    text: input.text,
    source: input.source || 'tool',
    session: input.session || '',
    turn: input.turn ?? null,
    judged,
  })
  logLine(
    `COLLIDE ${result.verdict} hard=${result.hard.length} soft=${result.soft.length} ` +
      `shape=${result.shape.length} len=${String(input.text || '').length}`,
  )
  return { result, list, entry }
}

/** 叫一次小模型：只问「哪几条形状在」，不问好不好。 */
async function judgeShapes(tenant, text, shapes) {
  try {
    const req = tenant.resolveRequest()
    if (!req) return null
    const prompt = buildJudgePrompt(text, shapes)
    let out = ''
    const stream = tenant.llm.stream({
      provider: req.provider,
      model: req.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: 120,
      signal: tenant.signal,
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && chunk.text) out += chunk.text
    }
    const parsed = parseJudge(out)
    if (!parsed) logLine(`JUDGE 解析失败：${String(out).slice(0, 120)}`)
    return parsed
  } catch (e) {
    logLine(`JUDGE 调用失败：${e?.message ?? e}`)
    return null
  }
}

/* ───────────────────────── 插件入口 ───────────────────────── */

export function apply(root, config = {}) {
  /** 面板上改过的开关落在 data/config.json，优先级高于 cordis.patch.yml 里的 config。 */
  const readConfigFile = () => {
    try {
      if (!existsSync(CONFIG_FILE)) return {}
      const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
      return raw && typeof raw === 'object' ? raw : {}
    } catch {
      return {}
    }
  }
  const writeConfigFile = (patch) => {
    const next = { ...readConfigFile(), ...patch }
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  }
  let cfg = { ...DEFAULTS, ...(config || {}), ...readConfigFile() }

  /**
   * 这一轮是第几轮 —— 只有 `agent/pre-step` 的 payload 里有。
   * 工具 execute 拿不到 turn，只能靠这里记下来，撞完记账时带上。
   * 没记到的（比如第一次 pre-step 还没走完）就记 null，不硬编一个。
   */
  const CURRENT_TURN = new Map()

  /** 顺手给一个会话标上轮次；超过 64 个会话就丢最老的，别无限长。 */
  const rememberTurn = (agent, turn) => {
    const id = String(agent?.id ?? '')
    const n = Number(turn)
    if (!id || !Number.isFinite(n)) return
    if (CURRENT_TURN.size >= 64 && !CURRENT_TURN.has(id)) {
      CURRENT_TURN.delete(CURRENT_TURN.keys().next().value)
    }
    CURRENT_TURN.set(id, n)
  }

  /** 派出去的活（子窗）用同一本账，但它的轮次不该算成这一轮。 */
  const isChildWindow = (agent) => {
    try {
      const h = agent?.session?.header
      return Boolean(h && (h.parentSession || h.origin === 'subagent'))
    } catch {
      return false
    }
  }

  const agentDefaultModel = () => root.get('agentDefaultModel')
  const llmOf = () => root.get('llm')

  /** 给一次判定用的租户：拿到 llm 和挑好的模型。 */
  const judgeTenant = (signal) => {
    const llm = llmOf()
    if (!llm) return null
    const resolveRequest = () => {
      if (cfg.judgeProvider && cfg.judgeModel) {
        return { provider: cfg.judgeProvider, model: cfg.judgeModel }
      }
      try {
        const sel = agentDefaultModel()?.currentSelection?.()
        if (sel?.model) return { provider: sel.provider, model: sel.model }
      } catch {
        /* 降级 */
      }
      return null
    }
    return { llm, resolveRequest, signal }
  }

  logLine(`LOAD enabled=${cfg.enabled} judge=${cfg.judge} wordlist=${WORDLIST_FILE}`)

  /* ── 1. 每轮那段钩子（context，不是 section：一改就追加，不打掉前缀缓存） ── */
  root.inject(['systemPrompt'], (ctx) => {
    ctx.effect(
      () =>
        ctx.systemPrompt.context({
          name: 'yubagu:hook',
          order: cfg.order,
          interpolate: false,
          text: () => (cfg.enabled && cfg.context ? hookText(cfg) : ''),
        }),
      'dsh-yubagu: 每轮那段钩子',
    )
  })

  /* ── 2. 撞一下（工具） ── */
  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'yubagu_collide',
      description:
        '把准备发出去的话整段丢进来，撞一次词表。撞上了别换词，整句退回去，从「本来想说什么」重说。'
        + '只撞字面，判语义的那一道（可选）只给形状嫌疑，不定罪。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要撞的那段话，整段，不要自己先删可疑句。' },
          judge: { type: 'boolean', description: '撞到形状锚点时要不要叫一次小模型判语义。' },
        },
        required: ['text'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict', 'report'],
          properties: {
            verdict: { type: 'string' },
            report: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: String(value?.report ?? '') }],
      },
      execute: async (args, exec) => {
        if (!cfg.enabled) return { verdict: 'off', report: '鱼八股拦截关着呢。' }
        const text = String(args?.text ?? '')
        if (!text.trim()) return { verdict: 'ok', report: '没收到文字。' }
        const wantJudge = args?.judge === true && cfg.judge
        const sessionId = String(exec?.agent?.id ?? '')
        const { result, list } = await runCollide(wantJudge ? judgeTenant(exec?.signal) : null, {
          text,
          source: 'tool',
          session: sessionId,
          turn: CURRENT_TURN.get(sessionId),
        })
        const report = renderCollision(result, list)
        return { verdict: result.verdict, report }
      },
    })

    ctx.tools.register({
      name: 'yubagu_daily',
      description: '写今天那一句总结：根因级、一句、不超过 40 字。按天存，跨天自然失效。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一句话，根因级。写事实，不写「不许 OOO」。' },
        },
        required: ['text'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok', 'day', 'text'],
          properties: {
            ok: { type: 'boolean' },
            day: { type: 'string' },
            text: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value?.day ?? ''} 那一句：${value?.text ?? ''}` }],
      },
      execute: async (args) => {
        const saved = writeDaily(args?.text ?? '')
        logLine(`DAILY ${saved.text}`)
        return { ok: true, day: todayKey(), text: saved.text }
      },
    })

    ctx.tools.register({
      name: 'yubagu_list',
      description: '看词表现状（hard/soft/shape 各多少条、根是什么），或看最近的账。',
      parameters: {
        type: 'object',
        properties: {
          what: { type: 'string', enum: ['wordlist', 'ledger'], description: '默认 wordlist。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: { text: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
      },
      execute: async (args) => {
        if (args?.what === 'ledger') {
          const l = readLedger()
          const rows = l.entries.slice(-10).map((e) => {
            const hit = [...e.hard, ...e.soft, ...e.shape].join(',')
            return `${e.at.slice(5, 16)} ${e.verdict} ${hit || '-'}`
          })
          return { text: rows.length ? rows.join('\n') : '账还是空的。' }
        }
        const list = readWordlist()
        const n = (t) => (list.entries || []).filter((e) => e.tier === t).length
        return {
          text: [
            `词表 ${WORDLIST_FILE}`,
            `hard ${n('hard')} · soft ${n('soft')} · shape ${n('shape')}`,
            `根：${list.root || '（还没写）'}`,
            `今天那句：${todaySummary() || '（今天还没写）'}`,
          ].join('\n'),
        }
      },
    })
  })

  /* ── 3. 记轮次 + 这一轮没撞就留痕（防偷懒） ── */
  /* 3a · 记下这是第几轮：turn 只有 pre-step 的 payload 里有，工具那边拿不到。
   *     记漏了不丢人，硬编一个才是真丢人 —— 拿不到就记 null。 */
  root.effect(() => {
    const off = root.on('agent/pre-step', async (payload, next) => {
      try {
        rememberTurn(payload?.agent, payload?.turn)
      } catch {
        /* 记轮次失败不影响这一轮 */
      }
      return next()
    })
    return () => {
      try {
        off()
      } catch {}
    }
  }, 'dsh-yubagu: 记轮次')

  /* 3b · 一轮收尾时回头看：这一轮有没有递去撞过。
   *     子窗（fork / 派出去的活）共用一本账，它的轮次不该算成这一轮漏撞。 */
  root.effect(() => {
    const off = root.on('agent/turn-stopping', async (payload) => {
      if (!cfg.enabled || !cfg.trackSkipped) return
      try {
        const agent = payload?.agent
        const turn = Number(payload?.turn)
        if (!Number.isFinite(turn)) return
        if (isChildWindow(agent)) return
        const id = String(agent?.id ?? '')
        const l = readLedger()
        const hit = l.entries.some(
          (e) => e.turn === turn && e.session === id && Date.now() - Date.parse(e.at) < 10 * 60_000,
        )
        if (hit) return
        appendSkipped({ session: id, turn, note: '这一轮没递去撞' })
      } catch {
        /* 记账失败不影响回合 */
      }
    })
    return () => {
      try {
        off()
      } catch {}
    }
  }, 'dsh-yubagu: 没撞留痕')

  /* ── 3c. 外部发信通道：发之前先撞一次，撞了也留痕 ──
   *  为什么挂这儿：这类工具不走会话消息流，是往 outbox 写一行 JSON 让外面的哨兵去发，
   *  插件在正文里看不见它。pre-execute 是唯一能拦下来的门 —— 在它落盘之前先撞，
   *  结果记进同一本账（source = 'outbound'），面板上才看得见这条路到底撞没撞。
   *  名字从 cfg.outboundTools 读，逗号分隔；留空就整段不挂。
   *  不拦、不改、不添话：撞完照原样放行。这是留痕，不是审稿。 */
  const outboundSet = new Set(
    String(cfg.outboundTools || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  root.effect(() => {
    const off = root.on('tools/pre-execute', async (exec, next) => {
      try {
        if (cfg.enabled && outboundSet.has(String(exec?.name ?? ''))) {
          const raw = exec?.arguments?.text
          const text = typeof raw === 'string' ? raw : ''
          if (text.trim()) {
            const sessionId = String(exec?.agent?.id ?? '')
            await runCollide(null, {
              text,
              source: 'outbound',
              session: sessionId,
              turn: CURRENT_TURN.get(sessionId),
            })
          }
        }
      } catch {
        /* 撞失败照发：这是留痕，不是闸门 */
      }
      return next()
    })
    return () => {
      try {
        off()
      } catch {}
    }
  }, 'dsh-yubagu: 外部通道留痕')

  /* ── 4. 面板接口 ── */
  root.inject(['webServer'], (ctx) => {
    const server = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
    if (!server || typeof server.register !== 'function') return

    const handler = async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname.replace(/^\/api\/yubagu/, '') || '/'

      if (req.method === 'GET' && (path === '/' || path === '/status')) {
        const list = readWordlist()
        const l = readLedger()
        /* 账不分页会把它自己撑爆：只给第一页，翻页走 /ledger。 */
        const le = pageOf(l.entries, { page: 1, size: LEDGER_PAGE_SIZE })
        const sk = pageOf(l.skipped, { page: 1, size: LEDGER_PAGE_SIZE })
        return sendJson(res, 200, {
          ok: true,
          enabled: cfg.enabled,
          context: cfg.context,
          judge: cfg.judge,
          trackSkipped: cfg.trackSkipped,
          reminder: cfg.reminder,
          root: list.root || '',
          rootHint: list.rootHint || '',
          counts: {
            hard: (list.entries || []).filter((e) => e.tier === 'hard').length,
            soft: (list.entries || []).filter((e) => e.tier === 'soft').length,
            shape: (list.entries || []).filter((e) => e.tier === 'shape').length,
          },
          daily: todayKey(),
          dailyText: todaySummary(),
          stats: statsForDay(),
          ledger: le.rows,
          ledgerPage: le.page,
          ledgerPages: le.pages,
          ledgerTotal: le.total,
          skipped: sk.rows,
          skippedPage: sk.page,
          skippedPages: sk.pages,
          skippedTotal: sk.total,
          pageSize: LEDGER_PAGE_SIZE,
          files: { wordlist: WORDLIST_FILE, data: DATA_DIR, root: ROOT },
        })
      }

      /* 翻页：kind=entries|skipped，page 从 1 开始，1 = 最新那一页。 */
      if (req.method === 'GET' && path === '/ledger') {
        const l = readLedger()
        const kind = url.searchParams.get('kind') === 'skipped' ? 'skipped' : 'entries'
        const page = Number(url.searchParams.get('page')) || 1
        const size = Number(url.searchParams.get('size')) || LEDGER_PAGE_SIZE
        const p = pageOf(kind === 'skipped' ? l.skipped : l.entries, { page, size })
        return sendJson(res, 200, { ok: true, kind, ...p })
      }

      if (req.method === 'GET' && path === '/stats') {
        const day = url.searchParams.get('day') || todayKey()
        return sendJson(res, 200, { ok: true, ...statsForDay(day) })
      }

      if (req.method === 'POST' && path === '/config') {
        const body = await readBody(req)
        const patch = {}
        for (const k of ['enabled', 'context', 'judge', 'trackSkipped']) {
          if (typeof body?.[k] === 'boolean') patch[k] = body[k]
        }
        for (const k of ['judgeProvider', 'judgeModel', 'reminder']) {
          if (typeof body?.[k] === 'string') patch[k] = body[k]
        }
        if (typeof body?.order === 'number') patch.order = body.order
        const saved = writeConfigFile(patch)
        // 活的这一份也跟着变：钩子在下一轮就是新值
        cfg = { ...cfg, ...patch }
        logLine(`CONFIG ${JSON.stringify(patch)}`)
        return sendJson(res, 200, {
          ok: true,
          enabled: cfg.enabled,
          context: cfg.context,
          judge: cfg.judge,
          trackSkipped: cfg.trackSkipped,
          reminder: cfg.reminder,
          saved,
        })
      }

      if (req.method === 'GET' && path === '/wordlist') {
        return sendJson(res, 200, { ok: true, list: readWordlist() })
      }

      if (req.method === 'POST' && path === '/wordlist') {
        const body = await readBody(req)
        if (body?.entry) {
          const list = readWordlist()
          const e = body.entry
          if (!e.text) return sendJson(res, 200, { ok: false, error: '这条没有 text' })
          const id = e.id || `w${Date.now().toString(36)}`
          list.entries = (list.entries || []).filter((x) => x.id !== id)
          list.entries.push({ ...e, id })
          writeWordlist(list)
          logLine(`WORD + ${e.tier || 'hard'} ${e.text}`)
          return sendJson(res, 200, { ok: true, id })
        }
        if (body?.del) {
          const list = readWordlist()
          list.entries = (list.entries || []).filter((x) => x.id !== body.del)
          writeWordlist(list)
          logLine(`WORD - ${body.del}`)
          return sendJson(res, 200, { ok: true })
        }
        if (body?.root !== undefined || body?.rootHint !== undefined) {
          const list = readWordlist()
          if (body.root !== undefined) list.root = String(body.root)
          if (body.rootHint !== undefined) list.rootHint = String(body.rootHint)
          writeWordlist(list)
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 200, { ok: false, error: '没说要改什么' })
      }

      if (req.method === 'POST' && path === '/daily') {
        const body = await readBody(req)
        const saved = writeDaily(body?.text ?? '')
        return sendJson(res, 200, { ok: true, day: todayKey(), text: saved.text })
      }

      if (req.method === 'GET' && path === '/daily') {
        return sendJson(res, 200, { ok: true, history: readDailyHistory() })
      }

      if (req.method === 'POST' && path === '/collide') {
        const body = await readBody(req)
        const text = String(body?.text ?? '')
        if (!text.trim()) return sendJson(res, 200, { ok: false, error: '没有文字' })
        const wantJudge = body?.judge === true && cfg.judge
        const { result, list } = await runCollide(wantJudge ? judgeTenant(undefined) : null, {
          text,
          source: 'panel',
        })
        return sendJson(res, 200, {
          ok: true,
          verdict: result.verdict,
          report: renderCollision(result, list),
          hits: { hard: result.hard, soft: result.soft, shape: result.shape },
        })
      }

      if (req.method === 'POST' && path === '/mark') {
        const body = await readBody(req)
        const e = stampEntry(String(body?.at ?? ''), body?.mark === 'yes' ? 'yes' : 'no', body?.note ?? '')
        return sendJson(res, 200, e ? { ok: true } : { ok: false, error: '没找到这条账' })
      }

      if (req.method === 'POST' && path === '/clear') {
        clearLedger()
        logLine('LEDGER cleared')
        return sendJson(res, 200, { ok: true })
      }

      return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
    }

    try {
      ctx.effect(
        () =>
          server.register({
            kind: 'prefix',
            path: '/api/yubagu',
            handler: (req, res) => {
              Promise.resolve(handler(req, res)).catch((e) => {
                try {
                  sendJson(res, 500, { ok: false, error: e?.message ?? String(e) })
                } catch {
                  /* 已经走了 */
                }
              })
            },
          }),
        'dsh-yubagu: /api/yubagu',
      )
      logLine('已挂 /api/yubagu')
    } catch (e) {
      logLine(`挂 /api/yubagu 失败：${e?.message ?? e}`)
    }
  })
}

/* ───────────────────────── HTTP 小工具 ───────────────────────── */

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}
