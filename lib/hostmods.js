/**
 * lib/hostmods.js —— 宿主共享包的加载兜底
 *
 * 为什么需要它：
 *   从**插件自己的目录**里 bare import `@deepseek-ai/schemastery` / `@deepseek-ai/dsh-llm`
 *   可能失败（ERR_MODULE_NOT_FOUND）——这些包住在**宿主 app 的 node_modules**，
 *   Node 从本插件所在的链接目录解析不到。
 *
 * 策略：先试 bare import（将来宿主改了布局也能自动跟上），
 *       再按候选根目录逐个试绝对路径 —— 全部失败就返回 null，让插件降级而不是崩。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/** 由当前进程推断宿主安装根（桌面端 execPath 形如 <app>\DeepSeek Harness.exe）。 */
function rootsFromProcess() {
  const out = []
  try {
    const exe = process.execPath.replace(/\\/g, '/')
    const dir = exe.slice(0, exe.lastIndexOf('/'))
    out.push(`${dir}/resources/app/dsh/node_modules`)
    out.push(`${dir}/../resources/app/dsh/node_modules`)
    out.push(`${dir}/node_modules`)
  } catch {
    /* 推断失败就跳过 */
  }
  return out
}

/** 候选 node_modules 根，按「越可能命中越靠前」排序。全部从环境推断，不留绝对路径。 */
export function candidateRoots() {
  const out = []
  const seen = new Set()
  const push = (p) => {
    if (!p) return
    const k = p.replace(/\\/g, '/').toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(p)
    }
  }

  for (const r of rootsFromProcess()) push(r)

  // 显式指定优先
  if (process.env.DSH_ROOT) push(`${process.env.DSH_ROOT.replace(/\\/g, '/')}/node_modules`)

  // 常见的宿主 / profile 位置
  const home = (() => {
    try {
      return homedir().replace(/\\/g, '/')
    } catch {
      return ''
    }
  })()
  if (home) {
    push(`${home}/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules`)
    push(`${home}/.dsh/profiles/desktop/node_modules`)
    push(`${home}/.dsh/node_modules`)
    push(`${home}/.local/share/deepseek-harness/resources/app/dsh/node_modules`)
    push(`${home}/Library/Application Support/DeepSeek Harness/resources/app/dsh/node_modules`)
  }
  push('/opt/deepseek-harness/resources/app/dsh/node_modules')
  push('/usr/local/lib/deepseek-harness/resources/app/dsh/node_modules')

  return out
}

/** 把本地路径转成 import() 能吃的 file URL（空格等要编码）。 */
function toFileUrl(p) {
  const norm = p.replace(/\\/g, '/')
  return (
    'file:///' +
    norm
      .split('/')
      .map(encodeURIComponent)
      .join('/')
      .replace(/%3A/gi, ':')
  )
}

/**
 * 逐个候选加载一个包，返回模块命名空间；全失败返回 null。
 * @param {string} pkg 包名，如 `@deepseek-ai/dsh-llm`
 * @param {string} entry 包内相对入口，如 `lib/index.js`
 */
export async function loadHostModule(pkg, entry) {
  try {
    const mod = await import(pkg)
    if (mod) return mod
  } catch {
    /* 落到绝对路径 */
  }
  for (const root of candidateRoots()) {
    const abs = `${root}/${pkg}/${entry}`
    try {
      if (!existsSync(abs.replace(/\//g, '\\'))) continue
    } catch {
      continue
    }
    try {
      const mod = await import(toFileUrl(abs))
      if (mod) return mod
    } catch {
      /* 试下一个候选 */
    }
  }
  return null
}

/** 取 schemastery 的 z（default 导出即 z 本体）。 */
export async function loadSchemastery() {
  for (const entry of ['lib/index.mjs', 'lib/index.cjs']) {
    const mod = await loadHostModule('@deepseek-ai/schemastery', entry)
    if (!mod) continue
    const z = mod.default ?? mod
    if (typeof z?.object === 'function') return z
  }
  return null
}

/** 取 dsh-llm 的 createUserMessage（named export）。 */
export async function loadCreateUserMessage() {
  const mod = await loadHostModule('@deepseek-ai/dsh-llm', 'lib/index.js')
  if (!mod || typeof mod.createUserMessage !== 'function') return null
  return mod.createUserMessage
}
