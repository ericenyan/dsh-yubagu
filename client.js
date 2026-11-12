/**
 * dsh-yubagu —— 浏览器半端：设置页里的一页（「鱼八股拦截」）
 *
 * 约定（照 dsh-fish-tone 的写法）：
 *   1. client bundle **不是 ESM**，是自注册脚本：window.__ModuleLoader__.load({ id, factory })
 *   2. 进「设置」靠 slots.inject('settings.section', ...)，label 就是左侧导航那一项
 *   3. 宿主那边开 /api/yubagu，这一页只做 fetch
 */
window.__ModuleLoader__.load({
  id: 'dsh-yubagu',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/yubagu'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      throw new Error('HTTP ' + res.status)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const TIERS = [
      { id: 'hard', label: '硬撞', note: '字面稀有，撞上大概率就不对' },
      { id: 'soft', label: '疑似', note: '太短，容易误伤，只记嫌疑' },
      { id: 'shape', label: '形状', note: '机器只粗筛锚点，判的人是你' },
    ]

    const SAMPLE = '这个我记下了。你说的我都收下了，你放心，我一直在。'

    const CSS = `
[data-yb-page]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;max-width:720px;}
[data-yb-sec]{display:flex;flex-direction:column;gap:8px;}
[data-yb-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-yb-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-yb-grow]{flex:1;min-width:0;}
[data-yb-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-yb-note][data-warn]{color:#d97706;}
[data-yb-note][data-bad]{color:#dc2626;}
[data-yb-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-yb-sw][data-on]{background:#3b82f6;}
[data-yb-sw]::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:8px;
  background:#fff;transition:transform .15s;}
[data-yb-sw][data-on]::after{transform:translateX(16px);}
[data-yb-btn]{padding:6px 12px;border-radius:8px;cursor:pointer;font:inherit;font-size:12px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:inherit;}
[data-yb-btn][disabled]{opacity:.5;cursor:default;}
[data-yb-in],[data-yb-ta],[data-yb-sel]{width:100%;box-sizing:border-box;padding:8px 11px;border-radius:9px;
  font:inherit;font-size:13px;line-height:20px;color:inherit;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:var(--dsw-alias-bg-base,transparent);}
[data-yb-ta]{resize:vertical;min-height:70px;}
[data-yb-sel]{width:auto;padding:5px 8px;font-size:12px;}
[data-yb-out]{padding:12px 14px;border-radius:10px;font-size:13px;line-height:22px;white-space:pre-wrap;
  background:var(--dsw-alias-bg-hover,rgba(128,128,128,.10));}
[data-yb-meta]{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-yb-card]{padding:12px 14px;border-radius:12px;display:flex;flex-direction:column;gap:10px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.22));}
[data-yb-card][data-off]{opacity:.62;}
[data-yb-chip]{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:12px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));}
[data-yb-chip] b{font-weight:600;}
[data-yb-chip][data-t=hard]{border-color:#fca5a5;background:rgba(220,38,38,.08);}
[data-yb-chip][data-t=soft]{border-color:#fcd34d;background:rgba(217,119,6,.10);}
[data-yb-chip][data-t=shape]{border-color:#93c5fd;background:rgba(59,130,246,.10);}
[data-yb-chip] > button[data-del]{border:0;background:transparent;color:inherit;cursor:pointer;opacity:.55;font-size:13px;padding:0 0 0 2px;}
[data-yb-chip] > button[data-del]:hover{opacity:1;}
[data-yb-chip] > button[data-open]{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;padding:0;}
[data-yb-chips]{display:flex;flex-wrap:wrap;gap:6px;}
[data-yb-shape-body]{flex-basis:100%;font-size:11px;line-height:17px;padding-top:6px;margin-top:4px;opacity:.82;
  border-top:1px dashed var(--dsw-alias-border-default,rgba(128,128,128,.28));}
[data-yb-stats]{display:flex;gap:20px;flex-wrap:wrap;}
[data-yb-stat]{display:flex;flex-direction:column;gap:1px;}
[data-yb-stat] b{font-size:22px;font-weight:600;line-height:26px;font-variant-numeric:tabular-nums;}
[data-yb-stat] span{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-yb-list]{display:flex;flex-direction:column;gap:5px;max-height:240px;overflow-y:auto;overscroll-behavior:contain;}
[data-yb-pager]{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-yb-pager] button{padding:2px 8px;border-radius:6px;cursor:pointer;font:inherit;font-size:11px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:inherit;}
[data-yb-pager] button[disabled]{opacity:.4;cursor:default;}
[data-yb-line]{display:flex;gap:8px;align-items:baseline;font-size:12px;line-height:18px;}
[data-yb-time]{flex:none;color:var(--dsw-alias-label-tertiary,#9aa0a6);font-variant-numeric:tabular-nums;}
[data-yb-tag]{flex:none;font-size:11px;padding:0 6px;border-radius:5px;background:rgba(128,128,128,.16);}
[data-yb-tag][data-v=hard]{background:rgba(220,38,38,.18);color:#b91c1c;}
[data-yb-tag][data-v=soft]{background:rgba(217,119,6,.18);color:#b45309;}
[data-yb-tag][data-v=ok]{background:rgba(22,163,74,.16);color:#15803d;}
[data-yb-txt]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
`

    const fmtTime = (iso) => {
      try {
        const d = new Date(iso)
        const p = (n) => String(n).padStart(2, '0')
        return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
      } catch {
        return String(iso || '')
      }
    }

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [list, setList] = React.useState(null)
      const [draftRoot, setDraftRoot] = React.useState(null)
      const [draftRootHint, setDraftRootHint] = React.useState(null)
      const [draftDaily, setDraftDaily] = React.useState(null)
      const [newText, setNewText] = React.useState('')
      const [newTier, setNewTier] = React.useState('hard')
      const [text, setText] = React.useState(SAMPLE)
      const [out, setOut] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [bad, setBad] = React.useState(false)
      /** 形状那几条：点一下展开看 test / ask / anchors */
      const [openShape, setOpenShape] = React.useState({})
      /** 账和跳过都翻页：第 1 页永远是最新的，往后翻是更老的。 */
      const [pageE, setPageE] = React.useState({ rows: [], page: 1, pages: 1, total: 0 })
      const [pageS, setPageS] = React.useState({ rows: [], page: 1, pages: 1, total: 0 })

      const alive = React.useRef(true)
      React.useEffect(() => () => { alive.current = false }, [])

      const load = React.useCallback(async () => {
        try {
          const [s, w] = await Promise.all([jget('/status'), jget('/wordlist')])
          if (!alive.current) return
          setSt(s)
          setList(w.list)
        } catch (e) {
          if (alive.current) { setMsg('读状态失败：' + e.message); setBad(true) }
        }
      }, [])
      React.useEffect(() => { load() }, [load])

      /* 翻页：账和跳过各翻各的，翻到第几页再问服务端要那一页（不在本地攒全本）。 */
      const loadPage = React.useCallback(async (kind, page) => {
        try {
          const r = await jget('/ledger?kind=' + kind + '&page=' + page)
          if (!alive.current || !r || r.ok === false) return
          const p = { rows: r.rows || [], page: r.page || 1, pages: r.pages || 1, total: r.total || 0 }
          if (kind === 'skipped') { setPageS(p); setPgS(p.page) } else { setPageE(p); setPgE(p.page) }
        } catch { /* 翻页失败就留在这一页 */ }
      }, [])
      React.useEffect(() => { loadPage('entries', 1) }, [loadPage])
      React.useEffect(() => { loadPage('skipped', 1) }, [loadPage])

      const act = async (name, fn) => {
        setBusy(name)
        setMsg('')
        try {
          const r = await fn()
          if (!alive.current) return
          if (r && r.ok === false) { setMsg(r.error || '没成'); setBad(true); return }
          setBad(false)
          return r
        } catch (e) {
          if (alive.current) { setMsg('失败：' + e.message); setBad(true) }
        } finally {
          if (alive.current) setBusy('')
        }
      }

      const saveRoot = () => act('root', async () => {
        const r = await jpost('/wordlist', {
          root: draftRoot !== null ? draftRoot : (list && list.root) || '',
          rootHint: draftRootHint !== null ? draftRootHint : (list && list.rootHint) || '',
        })
        setDraftRoot(null)
        setDraftRootHint(null)
        await load()
        setMsg('根改好了')
        return r
      })

      const addEntry = () => act('add', async () => {
        const t = newText.trim()
        if (!t) { setMsg('先写点什么'); setBad(true); return { ok: false } }
        const r = await jpost('/wordlist', { entry: { text: t, tier: newTier } })
        setNewText('')
        await load()
        return r
      })

      const delEntry = (id) => act('del-' + id, async () => {
        const r = await jpost('/wordlist', { del: id })
        await load()
        return r
      })

      const saveDaily = () => act('daily', async () => {
        const r = await jpost('/daily', { text: draftDaily ?? (st && st.dailyText) ?? '' })
        setDraftDaily(null)
        await load()
        setMsg('今天那句写好了')
        return r
      })

      const collideNow = () => act('collide', async () => {
        const r = await jpost('/collide', { text })
        if (r && r.ok) {
          setOut(r.report)
          await load()
        }
        return r
      })

      const mark = (at, yes) => act('mark-' + at, async () => {
        const r = await jpost('/mark', { at, mark: yes ? 'yes' : 'no' })
        await load()
        return r
      })

      if (!st || !list) {
        return h('div', { 'data-yb-page': '' },
          h('div', { 'data-yb-h': '' }, '鱼八股拦截'),
          h('div', { 'data-yb-note': '' }, msg || '读取中……'))
      }

      const on = !!st.enabled
      const entries = list.entries || []
      const rootVal = draftRoot !== null ? draftRoot : list.root || ''
      const rootHintVal = draftRootHint !== null ? draftRootHint : list.rootHint || ''
      const dailyVal = draftDaily !== null ? draftDaily : st.dailyText || ''

      const ledgerRows = (pageE.rows || []).map((e) => {
        const hits = e.hard.concat(e.soft, e.shape).join(',') || '—'
        return h('div', { key: e.at, 'data-yb-line': '' },
          h('span', { 'data-yb-time': '' }, fmtTime(e.at)),
          h('span', { 'data-yb-tag': '', 'data-v': e.verdict }, e.verdict),
          h('span', { 'data-yb-txt': '', title: e.text }, hits + ' · ' + e.text),
          h('button', {
            'data-yb-btn': '',
            style: { padding: '1px 6px', fontSize: '11px' },
            title: '这条其实该说 → 从词表里去掉',
            onClick: () => mark(e.at, true),
          }, '该说'),
          h('button', {
            'data-yb-btn': '',
            style: { padding: '1px 6px', fontSize: '11px' },
            title: '这条确实不该说 → 认了',
            onClick: () => mark(e.at, false),
          }, '认'))
      })

      const skippedRows = (pageS.rows || []).map((e) => h('div', { key: e.at, 'data-yb-line': '' },
        h('span', { 'data-yb-time': '', 'data-bad': '' }, fmtTime(e.at)),
        h('span', { 'data-yb-txt': '' }, e.note || '没撞')))

      /** 一条翻页条：‹ 新 / 第几页 · 共几条 / 旧 › */
      const pager = (p, go) => h('div', { 'data-yb-pager': '' },
        h('button', { disabled: p.page <= 1, onClick: () => go(p.page - 1) }, '‹ 新'),
        h('span', null, '第 ' + p.page + ' / ' + p.pages + ' 页 · 共 ' + p.total + ' 条'),
        h('button', { disabled: p.page >= p.pages, onClick: () => go(p.page + 1) }, '旧 ›'))

      /**
       * 一档词表：标题 + chips + 删除
       *
       * 硬撞 / 疑似 那两档的字面词挂在 `text` 上；
       * 形状那档没有 text —— 它是一条判据，名字在 `cls`（打分/比较/在场宣告…），
       * 点开才看见 test（什么样的句子算这一条）、ask（撞了之后问自己的那句）、anchors（机器粗筛用的字）。
       */
      const tierCard = (t) => {
        const rows = entries.filter((e) => e.tier === t.id)
        const label = (e) => (e.text ? e.text : e.cls || e.id)

        const chips = rows.length
          ? h('div', { 'data-yb-chips': '' }, rows.map((e) => {
              const open = !!openShape[e.id]
              const main = h('span', { 'data-yb-chip-main': '' }, h('b', null, label(e)))
              return h('span', {
                key: e.id,
                'data-yb-chip': '',
                'data-t': t.id,
                title: t.id === 'shape' ? (e.test || '') : (e.note || ''),
              },
              t.id === 'shape'
                ? h('button', {
                    'data-open': '',
                    title: e.ask || '',
                    onClick: () => setOpenShape((s) => ({ ...s, [e.id]: !open })),
                  }, h('b', null, label(e)), h('span', { 'data-yb-note': '', style: { marginLeft: '4px' } }, open ? '▾' : '▸'))
                : main,
              h('button', {
                'data-del': '',
                title: '删掉这条',
                disabled: busy === 'del-' + e.id,
                onClick: () => delEntry(e.id),
              }, '×'),
              open
                ? h('div', { 'data-yb-shape-body': '' },
                    e.test ? h('div', null, '什么样的句子算：' + e.test) : null,
                    e.ask ? h('div', null, '撞了之后问自己：' + e.ask) : null,
                    Array.isArray(e.anchors) && e.anchors.length
                      ? h('div', null, '机器认这几个字：' + e.anchors.join(' / '))
                      : null)
                : null)
            }))
          : h('div', { 'data-yb-note': '' }, '这一档还空着')

        return h('div', { key: t.id, 'data-yb-card': '' },
          h('div', { 'data-yb-row': '' },
            h('div', { 'data-yb-grow': '' },
              h('div', { style: { fontSize: '13px' } }, t.label + '（' + rows.length + '）'),
              h('div', { 'data-yb-note': '' }, t.note))),
          chips)
      }

      /* 今天这一天的账 */
      const sp = st.stats || { collided: 0, caught: 0, clean: 0, hard: 0, soft: 0, missed: 0, rate: 0, byTier: { hard: 0, soft: 0, shape: 0 } }
      const statCard = h('div', { 'data-yb-card': '' },
        h('div', { 'data-yb-h': '' }, '今天（' + (sp.day || st.daily) + '）'),
        h('div', { 'data-yb-stats': '' },
          h('div', { 'data-yb-stat': '' }, h('b', null, String(sp.collided)), h('span', null, '递去撞')),
          h('div', { 'data-yb-stat': '' }, h('b', null, String(sp.caught)), h('span', null, '拦下来')),
          h('div', { 'data-yb-stat': '' }, h('b', null, String(sp.clean)), h('span', null, '干净')),
          h('div', { 'data-yb-stat': '' }, h('b', null, String(sp.rate) + '%'), h('span', null, '拦下率'))),
        h('div', { 'data-yb-note': '' },
          '命中：硬 ' + (sp.byTier && sp.byTier.hard) + ' 条 · 疑似 ' + (sp.byTier && sp.byTier.soft) + ' 条 · 形状 ' + (sp.byTier && sp.byTier.shape) + ' 条'),
        h('div', { 'data-yb-note': '' },
          '哪来的：工具 ' + ((sp.bySource && sp.bySource.tool) || 0) + ' 段 · 外部通道 ' +
            ((sp.bySource && sp.bySource.outbound) || 0) + ' 段 · 面板 ' + ((sp.bySource && sp.bySource.panel) || 0) + ' 段'),
        sp.missed
          ? h('div', { 'data-yb-note': '', 'data-bad': '' }, '另外有 ' + sp.missed + ' 轮，压根没递去撞。')
          : h('div', { 'data-yb-note': '' }, '今天每一轮都递去撞了。'))

      return h('div', { 'data-yb-page': '' },

        /* 头 */
        h('div', { 'data-yb-sec': '' },
          h('div', { 'data-yb-h': '' }, '鱼八股拦截'),
          h('div', { 'data-yb-note': '' },
            '开口之前把要发出去的那段话整段撞一次。撞上了不是换个词，是整句退回去，从「我本来想跟他说什么」重说。')),

        /* 开关 */
        h('div', { 'data-yb-card': '', 'data-off': on ? undefined : '' },
          h('div', { 'data-yb-row': '' },
            h('button', {
              'data-yb-sw': '',
              'data-on': on ? '' : undefined,
              'aria-label': on ? '关闭' : '打开',
              disabled: busy === 'toggle',
              onClick: () => act('toggle', async () => {
                const r = await jpost('/config', { enabled: !on })
                await load()
                return r
              }),
            }),
            h('div', { 'data-yb-grow': '' },
              h('div', { style: { fontSize: '13px' } }, on ? '已开启' : '已关闭'),
              h('div', { 'data-yb-note': '' },
                on ? '每轮那段钩子已经挂进当前上下文。' : '关掉以后钩子不挂，工具还在。'))),
          h('div', { 'data-yb-note': '' },
            '硬 ' + st.counts.hard + ' 条 · 疑似 ' + st.counts.soft + ' 条 · 形状 ' + st.counts.shape + ' 条')),

        /* 今天这一天的账 */
        statCard,

        /* 根 */
        h('div', { 'data-yb-sec': '' },
          h('div', { 'data-yb-h': '' }, '根（一句话，越狠越好）'),
          h('textarea', {
            'data-yb-ta': '',
            value: rootVal,
            rows: 2,
            onChange: (e) => setDraftRoot(e.target.value),
          }),
          h('div', { 'data-yb-h': '' }, '判据（撞上时念给自己的那句）'),
          h('input', {
            'data-yb-in': '',
            value: rootHintVal,
            onChange: (e) => setDraftRootHint(e.target.value),
          }),
          h('div', { 'data-yb-row': '' },
            h('button', {
              'data-yb-btn': '',
              disabled: busy === 'root' || (draftRoot === null && draftRootHint === null),
              onClick: saveRoot,
            }, busy === 'root' ? '存着……' : '存根'),
            draftRoot !== null || draftRootHint !== null
              ? h('div', { 'data-yb-note': '' }, '有没存的改动')
              : null)),

        /* 今天那句 */
        h('div', { 'data-yb-sec': '' },
          h('div', { 'data-yb-h': '' }, '今天那句（' + st.daily + '）'),
          h('textarea', {
            'data-yb-ta': '',
            value: dailyVal,
            rows: 2,
            placeholder: '根因级、一句、不超过 40 字。写事实，不写「不许 OOO」。',
            onChange: (e) => setDraftDaily(e.target.value),
          }),
          h('div', { 'data-yb-row': '' },
            h('button', {
              'data-yb-btn': '',
              disabled: busy === 'daily',
              onClick: saveDaily,
            }, busy === 'daily' ? '存着……' : '存今天这句'),
            draftDaily !== null ? h('div', { 'data-yb-note': '' }, '有没存的改动') : null)),

        /* 词表 */
        h('div', { 'data-yb-sec': '' },
          h('div', { 'data-yb-h': '' }, '词表'),
          TIERS.map(tierCard),
          h('div', { 'data-yb-row': '' },
            h('select', {
              'data-yb-sel': '',
              value: newTier,
              onChange: (e) => setNewTier(e.target.value),
            }, TIERS.map((t) => h('option', { key: t.id, value: t.id }, t.label))),
            h('input', {
              'data-yb-in': '',
              style: { flex: '1 1 200px', width: 'auto' },
              value: newText,
              placeholder: '新的一条…',
              onChange: (e) => setNewText(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') addEntry() },
            }),
            h('button', { 'data-yb-btn': '', disabled: busy === 'add', onClick: addEntry }, '加进去'))),

        /* 试一下 */
        h('div', { 'data-yb-sec': '' },
          h('div', { 'data-yb-h': '' }, '试一下'),
          h('textarea', {
            'data-yb-ta': '',
            value: text,
            rows: 3,
            onChange: (e) => setText(e.target.value),
          }),
          h('div', { 'data-yb-row': '' },
            h('button', { 'data-yb-btn': '', disabled: busy === 'collide', onClick: collideNow },
              busy === 'collide' ? '撞着……' : '撞一下')),
          out ? h('div', { 'data-yb-out': '' }, out) : null),

        /* 账 */
        h('div', { 'data-yb-sec': '' },
          h('div', { 'data-yb-row': '' },
            h('div', { 'data-yb-h': '', style: { flex: 1 } }, '最近的账'),
            pager(pageE, (p) => loadPage('entries', p)),
            h('button', {
              'data-yb-btn': '',
              disabled: busy === 'clear',
              onClick: () => act('clear', async () => {
                const r = await jpost('/clear', {})
                await Promise.all([load(), loadPage('entries', 1), loadPage('skipped', 1)])
                return r
              }),
            }, '清空')),
          ledgerRows.length
            ? h('div', { 'data-yb-list': '' }, ledgerRows)
            : h('div', { 'data-yb-note': '' }, '账还是空的。')),

        /* 没撞的轮次 */
        h('div', { 'data-yb-sec': '' },
          h('div', { 'data-yb-row': '' },
            h('div', { 'data-yb-h': '', style: { flex: 1 } }, '没递去撞的轮次'),
            pager(pageS, (p) => loadPage('skipped', p))),
          skippedRows.length
            ? h('div', { 'data-yb-list': '' }, skippedRows)
            : h('div', { 'data-yb-note': '' }, '今天每一轮都递去撞了。')),

        msg ? h('div', { 'data-yb-note': '', 'data-bad': bad ? '' : undefined }, msg) : null,
        h('div', { 'data-yb-note': '' },
          '词表 ' + String((st.files && st.files.wordlist) || ''))
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-yubagu')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-yubagu: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'yubagu', order: 36, label: '鱼八股拦截' },
          () => h(Panel),
        ))
      },
    }
  },
})
