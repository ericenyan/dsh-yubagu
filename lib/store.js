/**
 * lib/store.js —— 三个文件，一份账
 *
 *   wordlist.json  词表（人和模型都能写；写入只走面板/工具，不手改内存）
 *   ledger.json    账：每次撞的结果、没撞的那一轮、以及被标「是」的
 *   daily.json     每轮一句总结（按天更新、字数固定、根因级）
 *
 * 位置：插件目录下 data/（跟词表住一起，拷走插件就是拷走全部）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(HERE, '..')
export const DATA_DIR = join(ROOT, 'data')
export const WORDLIST_FILE = join(ROOT, 'wordlist.json')
const LEDGER_FILE = join(DATA_DIR, 'ledger.json')
const DAILY_FILE = join(DATA_DIR, 'daily.json')

/** Windows 路径由 fileURLToPath 处理，不再手动剥前导斜杠。 */

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/* ── 词表 ── */

export function readWordlist() {
  return readJson(WORDLIST_FILE, { entries: [], root: '', rootHint: '', tiers: {} })
}

export function writeWordlist(next) {
  const list = { ...next, updatedAt: new Date().toISOString() }
  list.hardCount = (list.entries || []).filter((e) => e.tier === 'hard').length
  list.softCount = (list.entries || []).filter((e) => e.tier === 'soft').length
  list.shapeCount = (list.entries || []).filter((e) => e.tier === 'shape').length
  writeJson(WORDLIST_FILE, list)
  return list
}

/* ── 账 ── */

const EMPTY_LEDGER = { version: 1, entries: [], skipped: [] }
const MAX_ENTRIES = 500
const MAX_SKIPPED = 200

export function readLedger() {
  const l = readJson(LEDGER_FILE, EMPTY_LEDGER)
  if (!Array.isArray(l.entries)) l.entries = []
  if (!Array.isArray(l.skipped)) l.skipped = []
  return l
}

/**
 * 记一次撞。
 * @param {{verdict:string, hard:Array, soft:Array, shape:Array}} result
 * @param {{text:string, turn?:number, session?:string, source?:string, judged?:object|null}} meta
 */
export function appendCollision(result, meta = {}) {
  const l = readLedger()
  l.entries.push({
    at: new Date().toISOString(),
    source: meta.source || 'tool',
    session: meta.session || '',
    turn: meta.turn ?? null,
    verdict: result?.verdict || 'ok',
    hard: (result?.hard || []).map((x) => x.id),
    soft: (result?.soft || []).map((x) => x.id),
    shape: (result?.shape || []).map((x) => x.id),
    judged: meta.judged || null,
    text: String(meta.text ?? '').slice(0, 400),
  })
  if (l.entries.length > MAX_ENTRIES) {
    const cut = l.entries.slice(0, l.entries.length - MAX_ENTRIES)
    l.entries = l.entries.slice(-MAX_ENTRIES)
    archiveRows(cut)
  }
  writeJson(LEDGER_FILE, l)
  return l.entries[l.entries.length - 1]
}

/** 没递撞的那一轮也留痕（防偷懒），面板上标红。 */
export function appendSkipped(meta = {}) {
  const l = readLedger()
  l.skipped.push({
    at: new Date().toISOString(),
    session: meta.session || '',
    turn: meta.turn ?? null,
    note: meta.note || '',
  })
  if (l.skipped.length > MAX_SKIPPED) {
    const cut = l.skipped.slice(0, l.skipped.length - MAX_SKIPPED)
    l.skipped = l.skipped.slice(-MAX_SKIPPED)
    archiveRows(cut)
  }
  writeJson(LEDGER_FILE, l)
}

/** 某条账回填判定。 */export function stampEntry(at, mark, note = '') {
  const l = readLedger()
  const e = l.entries.find((x) => x.at === at)
  if (!e) return null
  e.mark = mark // 'yes' | 'no'
  e.markNote = String(note || '').slice(0, 200)
  e.markedAt = new Date().toISOString()
  writeJson(LEDGER_FILE, l)
  return e
}

export function clearLedger() {
  writeJson(LEDGER_FILE, EMPTY_LEDGER)
}

/* ── 分页 + 滚动储存 ── */

const ARCHIVE_FILE = join(DATA_DIR, 'archive.jsonl')
const MAX_ARCHIVE_LINES = 5000

/**
 * 一页账。**第 1 页永远是最新的那一页**，往后翻是更老的。
 *
 * @param {Array} list
 * @param {{page?:number, size?:number}} opts
 */
export function pageOf(list, opts = {}) {
  const all = Array.isArray(list) ? list : []
  const size = Math.min(50, Math.max(1, Number(opts.size) || 10))
  const total = all.length
  const pages = Math.max(1, Math.ceil(total / size))
  const page = Math.min(Math.max(1, Number(opts.page) || 1), pages)
  const end = Math.max(0, total - (page - 1) * size)
  const start = Math.max(0, end - size)
  return { rows: all.slice(start, end).reverse(), page, pages, size, total }
}

/**
 * 滚动出去的账，别就这么丢了。
 *
 * 主账只留最近的（entries 500 / skipped 200，面板翻页也撑不爆），
 * 但被挤出去的那些追加进 archive.jsonl，一行一条 —— 想翻旧账还能翻得回来。
 * 文件自己也会滚：超过 MAX_ARCHIVE_LINES 行就只留后面那些。
 */
export function archiveRows(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  if (!list.length) return
  try {
    let lines = []
    if (existsSync(ARCHIVE_FILE)) {
      lines = readFileSync(ARCHIVE_FILE, 'utf8').split('\n').filter(Boolean)
    }
    for (const r of list) lines.push(JSON.stringify(r))
    if (lines.length > MAX_ARCHIVE_LINES) lines = lines.slice(-MAX_ARCHIVE_LINES)
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(ARCHIVE_FILE, `${lines.join('\n')}\n`, 'utf8')
  } catch {
    /* 归档写不了不影响记账 */
  }
}

/* ── 每天那句 ── */

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function readDaily() {
  const d = readJson(DAILY_FILE, { version: 1, byDay: {} })
  if (!d.byDay || typeof d.byDay !== 'object') d.byDay = {}
  return d
}

/** 今天的总结句（没有就空）。跨天自然失效，不靠删除。 */
export function todaySummary() {
  const d = readDaily()
  const cur = d.byDay[todayKey()]
  return cur && typeof cur.text === 'string' ? cur.text : ''
}

export function writeDaily(text, day = todayKey()) {
  const d = readDaily()
  const t = String(text ?? '').trim().slice(0, 80)
  d.byDay[day] = { text: t, at: new Date().toISOString() }
  // 只留最近 30 天
  const keys = Object.keys(d.byDay).sort()
  while (keys.length > 30) delete d.byDay[keys.shift()]
  writeJson(DAILY_FILE, d)
  return d.byDay[day]
}

export function readDailyHistory(limit = 14) {
  const d = readDaily()
  return Object.keys(d.byDay)
    .sort()
    .slice(-limit)
    .map((k) => ({ day: k, ...d.byDay[k] }))
}

/* ── 按天统计 ── */

/**
 * 某一天的账：撞了几段、拦下几段、各档命中多少、有几轮压根没递去撞。
 *
 * 归日按**本地时区**算 —— entries[].at 存的是 ISO(UTC)，直接切前 10 位会在
 * 凌晨 0–8 点错到前一天去。
 */
export function statsForDay(day = todayKey()) {
  const l = readLedger()
  const inDay = (iso) => {
    const t = Date.parse(iso)
    return Number.isFinite(t) && todayKey(new Date(t)) === day
  }

  const rows = l.entries.filter((e) => inDay(e.at))
  const missed = l.skipped.filter((e) => inDay(e.at))

  const byVerdict = { hard: 0, soft: 0, ok: 0 }
  const byTier = { hard: 0, soft: 0, shape: 0 }
  const bySource = {}
  for (const e of rows) {
    const v = e.verdict === 'hard' ? 'hard' : e.verdict === 'soft' ? 'soft' : 'ok'
    byVerdict[v] += 1
    byTier.hard += (e.hard || []).length
    byTier.soft += (e.soft || []).length
    byTier.shape += (e.shape || []).length
    const s = e.source || 'tool'
    bySource[s] = (bySource[s] || 0) + 1
  }

  const collided = rows.length
  const caught = byVerdict.hard + byVerdict.soft
  return {
    day,
    /** 今天递去撞了几段 */
    collided,
    /** 其中拦下来的（硬撞 + 疑似） */
    caught,
    /** 撞了但干净 */
    clean: byVerdict.ok,
    hard: byVerdict.hard,
    soft: byVerdict.soft,
    /** 各档具体命中条数（一段话可能撞好几条） */
    byTier,
    /**
     * 按来源分：`tool` = 模型调工具撞的，`panel` = 面板上试的，
     * `outbound` = 外部发信通道落盘之前拦的那一道。
     * 分它是为了看得见那条路到底有没有在撞。
     */
    bySource,
    /** 有几轮压根没递去撞 */
    missed: missed.length,
    rate: collided ? Math.round((caught / collided) * 100) : 0,
  }
}
