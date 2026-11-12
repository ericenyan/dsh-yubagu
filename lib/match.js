/**
 * lib/match.js —— 字面那一层（纯函数，能离线测）
 *
 * 分工：
 *   hard  字面稀有 → 撞上就是「大概率不对」，通知小模型，不给它裁决权
 *   soft  太短会误伤 → 只记「疑似」
 *   shape 字面抓不住 → 只拿锚点粗筛，定罪靠人（或小模型）
 */

/** 「行，」只算句首两字；其余按子串。规则挂在 id 上，不挂在词上。 */
const HEAD_ONLY = new Set(['w30'])

/** 句首的界线：开头、换行、句末标点、逗号/分号/冒号之后（允许夹空格）。 */
const BOUNDARY_CHARS = new Set(['\n', '。', '！', '？', '…', '，', ',', '；', ';', '：', ':'])

/** at 这个位置算不算「句首」——往前跳过空格，看第一个非空格字符是不是界线。 */
function atHead(text, at) {
  if (at <= 0) return true
  let i = at - 1
  while (i >= 0 && /\s/.test(text[i])) i -= 1
  return i < 0 || BOUNDARY_CHARS.has(text[i])
}

/**
 * 一条词在文本里出现没有。
 * @param {string} text
 * @param {{id:string,text:string}} entry
 * @returns {number} 命中位置；没撞到是 -1
 */
export function hitOne(text, entry) {
  const needle = String(entry?.text ?? '')
  if (!needle) return -1
  if (!HEAD_ONLY.has(entry?.id)) return text.indexOf(needle)

  // 句首限定：逐个出现位置看前面是不是界线，别只认第一个（第一个常在句中）
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at < 0) return -1
    if (atHead(text, at)) return at
    from = at + 1
  }
}

/** 命中的上下文，给面板看，别只给个 id。 */
function excerpt(text, at, len) {
  const a = Math.max(0, at - 10)
  const b = Math.min(text.length, at + len + 10)
  return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\n/g, ' ') + (b < text.length ? '…' : '')
}

/**
 * 撞一次。没有模型，没有语义，只有字。
 *
 * @param {string} text 要撞的那段话
 * @param {object} list 词表（entries 数组）
 * @returns {{verdict:'ok'|'soft'|'hard', hard:Array, soft:Array, shape:Array}}
 */
export function collide(text, list) {
  const src = String(text ?? '')
  const out = { verdict: 'ok', hard: [], soft: [], shape: [] }
  if (!src.trim()) return out

  for (const e of list?.entries ?? []) {
    const tier = e?.tier
    if (tier === 'shape') {
      const anchors = Array.isArray(e.anchors) ? e.anchors : []
      const found = anchors.filter((a) => a && src.includes(a))
      if (found.length) {
        out.shape.push({ id: e.id, cls: e.cls, test: e.test, ask: e.ask, anchors: found })
      }
      continue
    }
    const at = hitOne(src, e)
    if (at < 0) continue
    const item = {
      id: e.id,
      cls: e.cls,
      text: e.text,
      tier,
      where: excerpt(src, at, String(e.text).length),
      note: e.note,
    }
    if (tier === 'hard') out.hard.push(item)
    else out.soft.push(item)
  }

  out.verdict = out.hard.length ? 'hard' : out.soft.length || out.shape.length ? 'soft' : 'ok'
  return out
}

/**
 * 把撞的结果压成一段能直接读的话。
 * @param {ReturnType<typeof collide>} r
 * @param {object} list
 */
export function renderCollision(r, list) {
  const lines = []
  if (r.hard.length) {
    lines.push('硬撞上（大概率不对）：')
    for (const h of r.hard) lines.push(`  · [${h.id} ${h.cls}] 「${h.text}」 → ${h.where}`)
  }
  if (r.soft.length) {
    lines.push('疑似（太短，可能误伤）：')
    for (const s of r.soft) lines.push(`  · [${s.id} ${s.cls}] 「${s.text}」${s.note ? `（${s.note}）` : ''}`)
  }
  if (r.shape.length) {
    lines.push('形状嫌疑（机器只粗筛，你自己判）：')
    for (const s of r.shape) lines.push(`  · [${s.id} ${s.cls}] 锚点 ${s.anchors.join('/')} —— ${s.ask}`)
  }
  if (!lines.length) lines.push('干净。')
  const root = String(list?.root ?? '').trim()
  if (root && r.verdict !== 'ok') lines.push('', `根：${root}`)
  return lines.join('\n')
}

/**
 * 小模型那一道：只问「哪几条形状在」，不问好不好。
 * @param {string} text
 * @param {Array} shapes
 */
export function buildJudgePrompt(text, shapes) {
  const body = shapes.map((s) => `- ${s.id}｜${s.test}｜自问：${s.ask}`).join('\n')
  return [
    '下面这段是我准备说出口的话。它可能带鱼八股。',
    '只看这几条形状，逐条判断在不在，不要评价文笔，也不要用你自己的口味。',
    '',
    '形状清单：',
    body,
    '',
    '要判的话：',
    '"""',
    String(text ?? '').slice(0, 4000),
    '"""',
    '',
    '只回一个 JSON：{"ids":["s01"],"why":"一句话说为什么"}',
    '一条都不在就回 {"ids":[],"why":""}。不要别的话。',
  ].join('\n')
}

/** 从模型输出里抠出 {ids,why}；抠不出就当没判。 */
export function parseJudge(raw) {
  const s = String(raw ?? '')
  const i = s.indexOf('{')
  const j = s.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try {
    const o = JSON.parse(s.slice(i, j + 1))
    const ids = Array.isArray(o?.ids) ? o.ids.filter((x) => typeof x === 'string') : []
    return { ids, why: typeof o?.why === 'string' ? o.why : '' }
  } catch {
    return null
  }
}
