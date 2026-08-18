/**
 * dsh-plugin-radar — 浏览器端。
 * 挂载到 shell.overlay：左下角「插件雷达」卡片流 + 居中详情弹窗。
 * 翻译 / AI 摘要按需调用，由主机端走使用者自己 DSH 配置的模型额度处理。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-radar',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const { useState, useEffect, useMemo, useCallback, useRef } = React
    const h = React.createElement

    const API = '/plugin-radar/api'

    const colors = {
      bg: 'rgba(18, 20, 27, 0.92)',
      bgCard: 'rgba(255, 255, 255, 0.04)',
      bgCardHover: 'rgba(255, 255, 255, 0.07)',
      border: 'rgba(255, 255, 255, 0.09)',
      text: 'rgba(235, 238, 245, 0.95)',
      textDim: 'rgba(235, 238, 245, 0.55)',
      textFaint: 'rgba(235, 238, 245, 0.38)',
      accent: '#6e8bff',
      accentBg: 'rgba(110, 139, 255, 0.16)',
      green: '#4ade80',
      greenBg: 'rgba(74, 222, 128, 0.12)',
      red: '#f87171',
      amber: '#fbbf24',
    }

    const styles = {
      dock: {
        pointerEvents: 'auto', flex: 'none',
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
        borderRadius: 12,
        border: `1px solid ${colors.border}`, background: colors.bg,
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        color: colors.text, fontSize: 13, fontWeight: 500, cursor: 'grab',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)', fontFamily: 'inherit',
        touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
      },
      panel: {
        display: 'flex', flexDirection: 'column', borderRadius: 16,
        border: `1px solid ${colors.border}`, background: colors.bg,
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.55)', overflow: 'hidden',
        color: colors.text, fontSize: 13, fontFamily: 'inherit',
        position: 'relative',
      },
      header: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 10px',
        borderBottom: `1px solid ${colors.border}`, flex: 'none',
      },
      iconBtn: {
        border: `1px solid transparent`, background: 'transparent', color: colors.textDim, cursor: 'pointer',
        borderRadius: 12, width: 56, height: 56, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 30, flex: 'none',
      },
      searchWrap: { padding: '10px 14px 8px', flex: 'none' },
      search: {
        width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10,
        border: `1px solid ${colors.border}`, background: 'rgba(0,0,0,0.25)',
        color: colors.text, fontSize: 13, outline: 'none', fontFamily: 'inherit',
      },
      tabBar: { display: 'flex', alignItems: 'center', gap: 4, padding: '0 14px 10px', flex: 'none' },
      // 统一的按钮基座：所有可点的小按钮同一字号/字重/描边/圆角
      chipBase: {
        border: `1px solid ${colors.border}`, background: 'transparent', color: colors.textFaint,
        fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 8,
        cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.5, whiteSpace: 'nowrap',
      },
      // 统一的选中态：同一套高亮（描边/底色/文字色），不分 tab 还是选项
      chipActive: { color: colors.text, borderColor: colors.accent, background: colors.accentBg },
      tab: {
        border: 'none', background: 'transparent', color: colors.textFaint, fontSize: 12,
        fontWeight: 600, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
      },
      tabActive: { color: colors.text, background: colors.accentBg },
      dayBtn: {
        border: `1px solid ${colors.border}`, background: 'transparent', color: colors.textFaint,
        fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
      },
      dayBtnActive: { color: colors.text, borderColor: colors.accent, background: colors.accentBg },
      sortSel: {
        background: 'rgba(0,0,0,0.25)', color: colors.textDim, border: `1px solid ${colors.border}`,
        borderRadius: 8, fontSize: 11, padding: '3px 6px', outline: 'none', cursor: 'pointer',
        fontFamily: 'inherit',
      },
      starInput: {
        width: 52, boxSizing: 'border-box', padding: '3px 6px', borderRadius: 8,
        border: `1px solid ${colors.border}`, background: 'rgba(0,0,0,0.25)',
        color: colors.text, fontSize: 11, outline: 'none', fontFamily: 'inherit',
      },
      list: { flex: 1, overflowY: 'auto', padding: '0 14px 14px' },
      card: {
        border: `1px solid ${colors.border}`, background: colors.bgCard, borderRadius: 12,
        padding: '11px 12px', marginBottom: 10, cursor: 'pointer', transition: 'background 0.15s',
      },
      cardTitle: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
      badgeNew: {
        flex: 'none', fontSize: 10, fontWeight: 700, color: '#0b0d12', background: colors.amber,
        borderRadius: 6, padding: '1px 6px', letterSpacing: 0.4,
      },
      meta: { color: colors.textFaint, fontSize: 11, flex: 'none' },
      summary: {
        color: colors.textDim, fontSize: 12, lineHeight: 1.55, margin: '7px 0 9px',
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      },
      cardFoot: { display: 'flex', alignItems: 'center', gap: 8 },
      linkBtn: {
        fontSize: 12, color: colors.textDim, textDecoration: 'none', padding: '5px 10px',
        borderRadius: 8, border: `1px solid ${colors.border}`,
      },
      installBtn: {
        marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: '#fff', background: colors.accent,
        border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit',
      },
      installedTag: {
        marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: colors.green,
        background: colors.greenBg, borderRadius: 8, padding: '6px 12px',
      },
      disclaimer: {
        flex: 'none', padding: '6px 14px', color: colors.textFaint, fontSize: 10.5,
        lineHeight: 1.5, borderTop: `1px solid ${colors.border}`,
      },
      footNote: {
        flex: 'none', padding: '8px 14px', borderTop: `1px solid ${colors.border}`,
        color: colors.textFaint, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
      },
      center: { padding: '36px 20px', textAlign: 'center', color: colors.textDim, fontSize: 13, lineHeight: 1.8 },
      overlay: {
        position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(8, 9, 13, 0.6)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'auto', padding: 24, boxSizing: 'border-box',
        transform: 'translateZ(0)',
      },
      modal: {
        // 4:3 比例，上下左右留 4vh/4vw 空间
        width: 'min(92vw, calc((92vh) * 4 / 3))',
        height: 'min(92vh, calc((92vw) * 3 / 4))',
        display: 'flex', flexDirection: 'column',
        borderRadius: 18, border: `1px solid ${colors.border}`, background: 'rgba(20, 22, 30, 0.97)',
        boxShadow: '0 24px 72px rgba(0,0,0,0.6)', overflow: 'hidden',
        color: colors.text, fontSize: 13, fontFamily: 'inherit',
      },
      modalBody: { flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column' },
      modalSection: { marginBottom: 16, flex: 'none' },
      modalLabel: {
        fontSize: 11, fontWeight: 700, color: colors.textFaint, letterSpacing: 0.6,
        marginBottom: 6, textTransform: 'uppercase',
      },
      aiBox: {
        border: `1px solid ${colors.accentBg}`, background: 'rgba(110,139,255,0.07)',
        borderRadius: 12, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.7,
        color: colors.text, whiteSpace: 'pre-wrap',
      },
      smallBtn: {
        fontSize: 12, color: colors.accent, background: colors.accentBg, border: 'none',
        borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
      },
      readmeBox: {
        fontSize: 12.5, lineHeight: 1.7, color: colors.textDim, whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', background: 'rgba(0,0,0,0.22)', border: `1px solid ${colors.border}`,
        borderRadius: 12, padding: '14px 16px', overflowY: 'auto', minHeight: 200,
      },
      topicTag: {
        display: 'inline-block', fontSize: 10.5, color: colors.textFaint,
        border: `1px solid ${colors.border}`, borderRadius: 999, padding: '1px 8px', margin: '0 4px 4px 0',
      },
    }

    function hasCjk(s) {
      return /[一-鿿]/.test(s || '')
    }

    function relTime(iso) {
      if (!iso) return ''
      const diff = Date.now() - new Date(iso).getTime()
      const m = Math.floor(diff / 60000)
      if (m < 1) return '刚刚'
      if (m < 60) return `${m} 分钟前`
      const hrs = Math.floor(m / 60)
      if (hrs < 24) return `${hrs} 小时前`
      const d = Math.floor(hrs / 24)
      if (d < 30) return `${d} 天前`
      return iso.slice(0, 10)
    }

    function absTime(iso) {
      if (!iso) return ''
      return new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    }

    function isNew(iso) {
      return iso && Date.now() - new Date(iso).getTime() < 48 * 3600 * 1000
    }

    function matchQuery(item, tokens) {
      if (!tokens.length) return true
      const hay = [item.name, item.fullName, item.description, item.summary, item.readme, (item.topics || []).join(' ')]
        .join('\n')
        .toLowerCase()
      return tokens.every((t) => hay.includes(t))
    }

    async function post(path, body) {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.message || `请求失败 (${res.status})`)
      return data
    }

    function InstallButton({ item, size }) {
      const [state, setState] = useState(item.installed ? 'installed' : 'idle')
      const [message, setMessage] = useState('')
      const install = async (e) => {
        e.stopPropagation()
        if (state === 'installing' || state === 'installed') return
        setState('installing')
        setMessage('')
        try {
          const data = await post('/install', { fullName: item.fullName })
          if (data.ok) {
            setState('installed')
            setMessage(data.message || '安装完成')
          } else {
            setState('error')
            setMessage(data.message || '安装失败')
          }
        } catch (err) {
          setState('error')
          setMessage(String(err.message || err))
        }
      }
      const st = size === 'large'
        ? { ...styles.installBtn, fontSize: 13, padding: '8px 20px' }
        : styles.installBtn
      return h(
        React.Fragment,
        null,
        state === 'installed'
          ? h('span', { style: size === 'large' ? { ...styles.installedTag, fontSize: 13, padding: '8px 16px' } : styles.installedTag }, '✓ 已安装')
          : h(
              'button',
              {
                style: { ...st, opacity: state === 'installing' ? 0.6 : 1 },
                onClick: install,
                disabled: state === 'installing',
                title: message,
              },
              state === 'installing' ? '安装中…' : state === 'error' ? '重试安装' : '一键安装',
            ),
        message && state === 'error' && h('span', { style: { fontSize: 11, color: colors.red } }, message),
      )
    }

    function PluginCard({ item, onOpen, timeMode, seenSet, hideNew }) {
      const [hover, setHover] = useState(false)
      // 时间戳跟当前模式走：新建模式看 createdAt，更新模式看 pushedAt（有区分）
      const useCreated = timeMode === 'created'
      const stamp = useCreated ? item.createdAt : item.pushedAt
      const stampLabel = useCreated ? '创建于' : '更新于'
      // NEW = 近 48h 且还没点开看过（推荐页等可整体隐藏）
      const showNew = !hideNew && isNew(stamp) && !(seenSet && seenSet.has(item.fullName))
      return h(
        'div',
        {
          style: { ...styles.card, ...(hover ? { background: colors.bgCardHover } : null) },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onClick: () => onOpen(item),
        },
        h(
          'div',
          { style: styles.cardTitle },
          showNew && h('span', { style: styles.badgeNew }, 'NEW'),
          h(
            'span',
            {
              style: { fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              title: item.fullName,
            },
            item.name,
          ),
          h('span', { style: { ...styles.meta, marginLeft: 'auto' } }, `★ ${item.stars}`),
          h('span', { style: styles.meta, title: absTime(stamp) }, `${stampLabel} ${relTime(stamp)}`),
        ),
        h('div', { style: styles.summary, title: item.summary }, item.summary),
        h(
          'div',
          { style: styles.cardFoot },
          h(
            'a',
            {
              style: styles.linkBtn, href: item.url, target: '_blank', rel: 'noreferrer',
              onClick: (e) => e.stopPropagation(),
            },
            'GitHub ↗',
          ),
          h(InstallButton, { item }),
        ),
      )
    }

    /** 虚拟滚动列表：5000+ 卡片只渲染可视区，滚动流畅。 */
    const CARD_H = 148 // 卡片（含间距）的近似高度
    function VirtualList({ items, onOpen, timeMode, seenSet }) {
      const ref = useRef(null)
      const [range, setRange] = useState({ start: 0, end: 40 })
      const onScroll = useCallback(() => {
        const el = ref.current
        if (!el) return
        const start = Math.max(0, Math.floor(el.scrollTop / CARD_H) - 6)
        const end = Math.ceil((el.scrollTop + el.clientHeight) / CARD_H) + 6
        setRange((r) => (r.start === start && r.end === end ? r : { start, end }))
      }, [])
      useEffect(() => {
        const el = ref.current
        if (el) el.scrollTop = 0
        onScroll()
      }, [items.length])
      const slice = items.slice(range.start, range.end)
      return h(
        'div',
        { ref, style: { flex: 1, overflowY: 'auto', padding: '0 14px 14px' }, onScroll },
        h('div', { style: { height: range.start * CARD_H } }),
        slice.map((item) => h(PluginCard, { key: item.fullName, item, onOpen, timeMode, seenSet })),
        h('div', { style: { height: Math.max(0, (items.length - range.end) * CARD_H) } }),
      )
    }

    /** 底部：自定义扫描间隔 */
    function ScanFooter({ fetchedAt, intervalHours }) {
      const [hours, setHours] = useState(String(intervalHours || 12))
      const [saved, setSaved] = useState(false)
      useEffect(() => {
        setHours(String(intervalHours || 12))
      }, [intervalHours])
      const save = async () => {
        const v = parseFloat(hours)
        if (!Number.isFinite(v) || v < 0.5 || v > 720) return
        try {
          const res = await fetch(`${API}/config`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshIntervalHours: v }),
          })
          if (res.ok) {
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
          }
        } catch {}
      }
      return h(
        'div',
        { style: styles.footNote },
        h('span', null, '每'),
        h('input', {
          style: { ...styles.starInput, width: 44, textAlign: 'center' },
          value: hours,
          onChange: (e) => { setHours(e.target.value); setSaved(false) },
          onBlur: save,
          onKeyDown: (e) => e.key === 'Enter' && save(),
          title: '扫描间隔（小时，0.5~720，回车或失焦生效）',
        }),
        h('span', null, saved ? '小时自动扫描 GitHub ✓' : '小时自动扫描 GitHub · topic:dsh-plugin'),
        h('span', { style: { flex: 1 } }),
        fetchedAt > 0 &&
          h('span', null, `上次扫描 ${new Date(fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`),
      )
    }

    /** 已安装插件管理视图 */
    function InstalledView({ onOpen }) {
      const [list, setList] = useState(null)
      const [busy, setBusy] = useState('')
      const [msg, setMsg] = useState('')
      const load = useCallback(async () => {
        try {
          const res = await fetch(`${API}/installed`)
          const json = await res.json()
          setList(json.items || [])
        } catch (e) {
          setList([])
        }
      }, [])
      useEffect(() => { void load() }, [load])
      const remove = async (name) => {
        if (!window.confirm(`确定卸载 ${name}？`)) return
        setBusy(name)
        setMsg('')
        try {
          const data = await post('/uninstall', { name })
          setMsg(data.message || (data.ok ? '已卸载' : '卸载失败'))
          if (data.ok) await load()
        } catch (e) {
          setMsg(String(e.message || e))
        } finally {
          setBusy('')
        }
      }
      const doUpdate = async (name) => {
        setBusy('u:' + name)
        setMsg('')
        try {
          const data = await post('/update', { name })
          setMsg(data.message || (data.ok ? '已更新' : '更新失败'))
          if (data.ok) await load()
        } catch (e) {
          setMsg(String(e.message || e))
        } finally {
          setBusy('')
        }
      }
      if (list === null) return h('div', { style: styles.center }, '读取已安装插件…')
      if (!list.length) return h('div', { style: styles.center }, '还没有通过 profile 安装任何插件')
      return h(
        'div',
        null,
        msg && h('div', { style: { fontSize: 11, color: colors.amber, margin: '0 0 10px' } }, msg),
        list.map((it) =>
          h(
            'div',
            { key: it.name, style: { ...styles.card, cursor: 'default' } },
            h(
              'div',
              { style: styles.cardTitle },
              h('span', { style: { fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: it.name }, it.name),
              it.stars !== null && h('span', { style: { ...styles.meta, marginLeft: 'auto' } }, `★ ${it.stars}`),
            ),
            !!it.summary && h('div', { style: styles.summary }, it.summary),
            h(
              'div',
              { style: styles.cardFoot },
              it.fullName
                ? h('a', { style: styles.linkBtn, href: `https://github.com/${it.fullName}`, target: '_blank', rel: 'noreferrer' }, 'GitHub ↗')
                : h('span', { style: styles.meta }, it.source || ''),
              it.isSelf
                ? h('span', { style: { ...styles.installedTag, marginLeft: 'auto' } }, '本插件')
                : h(
                    React.Fragment,
                    null,
                    it.hasUpdate
                      ? h(
                          'button',
                          {
                            style: { ...styles.installBtn, background: colors.amber, color: '#0b0d12', marginLeft: 'auto', opacity: busy === 'u:' + it.name ? 0.5 : 1 },
                            disabled: busy === 'u:' + it.name,
                            title: `有新版本 ${it.latestVersion}，点击更新`,
                            onClick: () => doUpdate(it.name),
                          },
                          busy === 'u:' + it.name ? '更新中…' : `↑ 更新${it.latestVersion ? ' ' + it.latestVersion : ''}`,
                        )
                      : null,
                    h(
                      'button',
                      {
                        style: { ...styles.installBtn, background: 'rgba(248,113,113,0.18)', color: colors.red, marginLeft: it.hasUpdate ? 8 : 'auto', opacity: busy === it.name ? 0.5 : 1 },
                        disabled: busy === it.name,
                        onClick: () => remove(it.name),
                      },
                      busy === it.name ? '卸载中…' : '一键删除',
                    ),
                  ),
            ),
          ),
        ),
      )
    }

    /** 推荐安装视图（热门精选 + 作者私货） */
    function RecommendView({ items, onOpen }) {
      // 精选：按关键词在收录里找热门（换肤/IDE 界面/视觉/桌面等），只推真是 dsh 插件且可安装的
      const picks = useMemo(() => {
        const themes = [
          { tag: '界面美化 / 换肤', match: ['皮肤', '换肤', '主题', 'theme', 'skin'] },
          { tag: 'IDE 化界面', match: ['ide', 'workbench', '分屏', '布局'] },
          { tag: '视觉方案', match: ['视觉', 'vision', '看图', 'ocr', 'eyes'] },
          { tag: '桌面 / 启动器', match: ['桌面', 'desktop', 'launcher', '图标', 'tray'] },
          { tag: '记忆 / 知识库', match: ['记忆', '知识库', 'memory', 'knowledge', 'rag'] },
        ]
        const out = []
        const usedFull = new Set()
        // 只推：① 真是 dsh 插件（名字/简介/topics 提到 dsh/deepseek-harness）② 可一键安装（hasPkg=true）
        const installable = items.filter((it) => {
          if (it.hasPkg !== true) return false
          const id = `${it.name} ${it.description} ${(it.topics || []).join(' ')}`.toLowerCase()
          return id.includes('dsh') || id.includes('deepseek-harness') || id.includes('deepseek harness')
        })
        for (const { tag, match } of themes) {
          const hit = installable
            .filter((it) => !usedFull.has(it.fullName))
            .filter((it) => {
              const hay = `${it.name} ${it.description} ${(it.topics || []).join(' ')}`.toLowerCase()
              return match.some((m) => hay.includes(m.toLowerCase()))
            })
            .sort((a, b) => b.stars - a.stars)
            .slice(0, 3)
          for (const it of hit) usedFull.add(it.fullName)
          if (hit.length) out.push({ tag, items: hit })
        }
        return out
      }, [items])

      return h(
        'div',
        null,
        // 作者私货：插件雷达本身
        h(
          'div',
          {
            style: {
              ...styles.card, cursor: 'default',
              border: `1px solid ${colors.accent}`, background: 'rgba(110,139,255,0.08)',
            },
          },
          h(
            'div',
            { style: styles.cardTitle },
            h('span', { style: styles.badgeNew }, '作者'),
            h('span', { style: { fontWeight: 600, fontSize: 13 } }, 'dsh-plugin-radar'),
            h('span', { style: { ...styles.meta, marginLeft: 'auto' } }, '本插件'),
          ),
          h('div', { style: styles.summary }, '你正在用的这个插件雷达就是我的手笔——定时扫 GitHub 全部 dsh 插件、卡片流推送、一键安装。觉得好用的话，欢迎去仓库点个 Star ⭐'),
          h(
            'div',
            { style: styles.cardFoot },
            h('a', { style: styles.linkBtn, href: 'https://github.com/yunyunyunyunsuan/dsh-plugin-radar', target: '_blank', rel: 'noreferrer' }, '去 Star ⭐'),
          ),
        ),
        picks.map(({ tag, items: list }) =>
          h(
            'div',
            { key: tag, style: { marginBottom: 14 } },
            h('div', { style: { ...styles.modalLabel, marginBottom: 8 } }, tag),
            list.map((it) => h(PluginCard, { key: it.fullName, item: it, onOpen, timeMode: 'updated', seenSet: null, hideNew: true })),
          ),
        ),
        !picks.length && h('div', { style: styles.center }, '暂无可推荐的可安装插件\n（只推确认有 package.json 的 JS 插件，等扫描收录更多后出现）'),
      )
    }

    function DetailModal({ item, onClose }) {
      const [tab, setTab] = useState('zh')
      const [translated, setTranslated] = useState('')
      const [translating, setTranslating] = useState(false)
      const [translateErr, setTranslateErr] = useState('')
      const [aiSummary, setAiSummary] = useState('')
      const [aiLoading, setAiLoading] = useState(false)
      const [aiErr, setAiErr] = useState('')

      useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose()
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const source = item.summary || item.description || ''

      const doTranslate = async () => {
        setTranslating(true)
        setTranslateErr('')
        try {
          const data = await post('/translate', { text: source })
          setTranslated(data.text || '')
        } catch (e) {
          setTranslateErr(String(e.message || e))
        } finally {
          setTranslating(false)
        }
      }

      const doSummarize = async () => {
        setAiLoading(true)
        setAiErr('')
        try {
          const data = await post('/summarize', { fullName: item.fullName })
          setAiSummary(data.summary || '')
        } catch (e) {
          setAiErr(String(e.message || e))
        } finally {
          setAiLoading(false)
        }
      }

      const showTranslate = !hasCjk(source)

      return h(
        'div',
        { style: styles.overlay, onClick: onClose },
        h(
          'div',
          { style: styles.modal, onClick: (e) => e.stopPropagation() },
          h(
            'div',
            { style: styles.header },
            isNew(item.pushedAt) && h('span', { style: styles.badgeNew }, 'NEW'),
            h('span', { style: { fontWeight: 700, fontSize: 15 } }, item.name),
            h('span', { style: { ...styles.meta } }, `★ ${item.stars}`),
            h('span', { style: { flex: 1 } }),
            h(
              'a',
              { style: styles.linkBtn, href: item.url, target: '_blank', rel: 'noreferrer' },
              'GitHub ↗',
            ),
            h(InstallButton, { item, size: 'large' }),
            h('button', { style: styles.iconBtn, onClick: onClose }, '✕'),
          ),
          h(
            'div',
            { style: styles.modalBody },
            h(
              'div',
              { style: { ...styles.meta, marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap' } },
              h('span', null, item.fullName),
              h('span', { title: '最近一次 git push / 仓库更新' }, `更新于 ${absTime(item.pushedAt)}`),
              h('span', null, `创建于 ${absTime(item.createdAt)}`),
            ),
            !!(item.topics || []).length &&
              h(
                'div',
                { style: { marginBottom: 14 } },
                item.topics.slice(0, 10).map((t) => h('span', { key: t, style: styles.topicTag }, t)),
              ),

            h(
              'div',
              { style: styles.modalSection },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                h('span', { style: styles.modalLabel }, '简介'),
                showTranslate &&
                  h(
                    'button',
                    {
                      style: { ...styles.smallBtn, opacity: translating ? 0.5 : 1 },
                      disabled: translating,
                      onClick: translated ? () => setTab(tab === 'zh' ? 'original' : 'zh') : doTranslate,
                    },
                    translating ? '翻译中…' : translated ? (tab === 'zh' ? '查看原文' : '查看译文') : '译成中文',
                  ),
              ),
              h(
                'div',
                { style: { fontSize: 13, lineHeight: 1.7, color: colors.text } },
                tab === 'zh' && translated ? translated : source || '（暂无简介）',
              ),
              translateErr && h('div', { style: { fontSize: 11, color: colors.red, marginTop: 6 } }, `翻译失败：${translateErr}`),
              translated && tab === 'zh' &&
                h('div', { style: { fontSize: 10.5, color: colors.textFaint, marginTop: 6 } }, '译文由你本机 DSH 配置的模型生成'),
            ),

            item.deep || item.readme
              ? h(
                  'div',
                  { style: styles.modalSection },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                    h('span', { style: styles.modalLabel }, 'AI 摘要'),
                    !aiSummary &&
                      h(
                        'button',
                        { style: { ...styles.smallBtn, opacity: aiLoading ? 0.5 : 1 }, disabled: aiLoading, onClick: doSummarize },
                        aiLoading ? '生成中…' : '生成中文摘要',
                      ),
                  ),
                  aiSummary
                    ? h('div', { style: styles.aiBox }, aiSummary)
                    : !aiLoading &&
                        h('div', { style: { fontSize: 12, color: colors.textFaint } }, '基于 README 全文，由你本机 DSH 模型生成'),
                  aiErr && h('div', { style: { fontSize: 11, color: colors.red, marginTop: 6 } }, `生成失败：${aiErr}`),
                )
              : h(
                  'div',
                  { style: { ...styles.modalSection, fontSize: 12, color: colors.textFaint } },
                  '该仓库超过详细收录窗口（近 3 天），未抓取 README，暂无 AI 摘要。',
                ),

            !!item.readme &&
              h(
                'div',
                { style: { ...styles.modalSection, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 240, marginBottom: 0 } },
                h('div', { style: styles.modalLabel }, 'README（节选）'),
                h('div', { style: { ...styles.readmeBox, flex: 1 } }, item.readme.slice(0, 4000)),
              ),
          ),
          h(
            'div',
            { style: styles.disclaimer },
            '插件信息来自 GitHub 公开数据，未经安全检测，本插件不对第三方插件的安全性负责，安装前请自行甄别。',
          ),
        ),
      )
    }

    function MarketPanel({ onClose, onOpen, seenSet }) {
      const [data, setData] = useState({
        items: [], fetchedAt: 0, refreshing: false, lastError: '', pushWindowDays: 3,
      })
      // 面板始终与胶囊保持相对位置（贴在它正上方），不做独立自由定位
      // 面板几何：默认 400×620，四条边框都可拖动调整，localStorage 记住
      const [size, setSize] = useState(() => {
        try {
          const s = JSON.parse(localStorage.getItem('plugin-radar-size') || 'null')
          if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) return s
        } catch {}
        return { w: 400, h: 620 }
      })
      const sizeRef = useRef(size)
      sizeRef.current = size
      const panelRef = useRef(null)
      // 拖边调整：dir 含 n/s/e/w（上/下/右/左），向哪个方向拖就往哪个方向扩
      const startResize = useCallback((dir) => (e) => {
        e.preventDefault()
        e.stopPropagation()
        const rect = panelRef.current.getBoundingClientRect()
        const startX = e.clientX
        const startY = e.clientY
        const from = { w: sizeRef.current.w, h: sizeRef.current.h, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
        const MIN_W = 320, MIN_H = 320
        const onMove = (ev) => {
          const dx = ev.clientX - startX
          const dy = ev.clientY - startY
          let { w, h } = { w: from.w, h: from.h }
          if (dir.includes('e')) w = Math.min(Math.max(MIN_W, from.w + dx), window.innerWidth - from.left - 8)
          if (dir.includes('s')) h = Math.min(Math.max(MIN_H, from.h + dy), window.innerHeight - from.top - 8)
          if (dir.includes('w')) w = Math.min(Math.max(MIN_W, from.w - dx), from.right - 8)
          if (dir.includes('n')) h = Math.min(Math.max(MIN_H, from.h - dy), from.bottom - 8)
          panelRef.current.style.width = w + 'px'
          panelRef.current.style.height = h + 'px'
          sizeRef.current = { w, h }
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          setSize({ w: sizeRef.current.w, h: sizeRef.current.h })
          try {
            localStorage.setItem('plugin-radar-size', JSON.stringify({ w: sizeRef.current.w, h: sizeRef.current.h }))
          } catch {}
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }, [])
      // 边框（8px 宽，四角优先）：
      const edge = (dir, st) =>
        h('div', {
          key: dir,
          onPointerDown: startResize(dir),
          style: {
            position: 'absolute', zIndex: 6, touchAction: 'none',
            cursor: dir === 'n' || dir === 's' ? 'ns-resize' : dir === 'e' || dir === 'w' ? 'ew-resize' : dir + '-resize',
            ...st,
          },
        })
      const [query, setQuery] = useState('')
      const [tab, setTab] = useState('feed')
      const [sort, setSort] = useState('time')
      const [feedMode, setFeedMode] = useState('created')
      const [minStars, setMinStars] = useState('')
      const [maxStars, setMaxStars] = useState('')
      const [onlyInstallable, setOnlyInstallable] = useState(false)
      const [loading, setLoading] = useState(true)
      const [installedCount, setInstalledCount] = useState(null)
      const autoRefreshed = useRef(false)

      const load = useCallback(async () => {
        try {
          const res = await fetch(`${API}/list`)
          return await res.json()
        } catch (e) {
          setData((d) => ({ ...d, lastError: String(e.message || e) }))
          return null
        } finally {
          setLoading(false)
        }
      }, [])

      const refresh = useCallback(async () => {
        setData((d) => ({ ...d, refreshing: true }))
        try {
          await fetch(`${API}/refresh`, { method: 'POST' })
        } catch {}
        const json = await load()
        if (json) setData(json)
      }, [load])

      useEffect(() => {
        void (async () => {
          const json = await load()
          if (json) {
            setData(json)
            if (!json.items.length && !json.refreshing && !autoRefreshed.current) {
              autoRefreshed.current = true
              void refresh()
            }
          }
        })()
        const timer = setInterval(async () => {
          const json = await load()
          if (json) setData(json)
        }, 30000)
        // 已安装数量（供 tab 徽标）
        fetch(`${API}/installed`).then((r) => r.json()).then((j) => setInstalledCount((j.items || []).length)).catch(() => {})
        return () => clearInterval(timer)
      }, [load, refresh])

      // 「最近 3 天」窗口固定
      const windowDays = 3
      const tokens = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])
      // 模式选时间字段：新建仓库看 createdAt，更新仓库看 pushedAt
      const stampOf = (it) => (feedMode === 'created' ? it.createdAt : it.pushedAt)
      const base = useMemo(() => {
        if (tab === 'all') return data.items
        const cutoff = Date.now() - windowDays * 86400_000
        return data.items.filter((it) => new Date(stampOf(it)).getTime() >= cutoff)
      }, [data.items, tab, feedMode])
      // 星数范围（留空=不限）
      const minS = minStars === '' ? null : Math.max(0, parseInt(minStars, 10) || 0)
      const maxS = maxStars === '' ? null : Math.max(0, parseInt(maxStars, 10) || 0)
      const filtered = useMemo(() => {
        let list = base.filter((it) => matchQuery(it, tokens))
        if (onlyInstallable) list = list.filter((it) => it.hasPkg === true)
        if (minS !== null) list = list.filter((it) => it.stars >= minS)
        if (maxS !== null) list = list.filter((it) => it.stars <= maxS)
        if (sort === 'stars') return [...list].sort((a, b) => b.stars - a.stars)
        // 按当前模式的时间倒序（两个 tab 统一）
        return [...list].sort((a, b) => (stampOf(a) < stampOf(b) ? 1 : -1))
      }, [base, tokens, sort, feedMode, minS, maxS, onlyInstallable])
      const feedCount = useMemo(() => {
        const cutoff = Date.now() - windowDays * 86400_000
        return data.items.filter((it) => new Date(stampOf(it)).getTime() >= cutoff).length
      }, [data.items, feedMode])

      return h(
        'div',
        {
          ref: panelRef,
          style: {
            ...styles.panel,
            width: size.w,
            height: Math.min(size.h, Math.max(360, window.innerHeight - 160)),
            maxWidth: 'calc(100vw - 32px)',
          },
        },
        // 四边 + 四角拖拽条
        edge('n', { left: 12, right: 12, top: 0, height: 8 }),
        edge('s', { left: 12, right: 12, bottom: 0, height: 8 }),
        edge('w', { left: 0, top: 12, bottom: 12, width: 8 }),
        edge('e', { right: 0, top: 12, bottom: 12, width: 8 }),
        edge('nw', { left: 0, top: 0, width: 14, height: 14 }),
        edge('ne', { right: 0, top: 0, width: 14, height: 14 }),
        edge('sw', { left: 0, bottom: 0, width: 14, height: 14 }),
        edge('se', { right: 0, bottom: 0, width: 14, height: 14 }),
        h(
          'div',
          { style: { ...styles.header, padding: '10px 14px 6px' } },
          data.refreshing
            ? h('span', { style: { color: colors.textFaint, fontSize: 11 } }, '正在扫描 GitHub（约 1-3 分钟）…')
            : h(
                'a',
                {
                  href: 'https://github.com/yunyunyunyunsuan/dsh-plugin-radar',
                  target: '_blank', rel: 'noreferrer',
                  style: {
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 8,
                    border: `1px solid ${colors.accent}`,
                    background: colors.accentBg,
                    color: colors.text,
                    fontSize: 11, fontWeight: 600, textDecoration: 'none',
                    cursor: 'pointer',
                  },
                  title: '去插件雷达的 GitHub 仓库点个 Star ⭐',
                },
                h('span', null, '⭐'),
                h('span', null, 'Star on GitHub'),
                h('span', { style: { fontSize: 10, opacity: 0.7 } }, '↗'),
              ),
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            {
              style: { ...styles.iconBtn, ...(data.refreshing ? { opacity: 0.4 } : null) },
              title: '立即扫描 GitHub 最新插件（增量，约 1-3 分钟；仓库越多略慢，见说明）',
              onClick: () => !data.refreshing && refresh(),
            },
            '⟳',
          ),
          h('button', { style: styles.iconBtn, title: '收起', onClick: onClose }, '✕'),
        ),
        h(
          'div',
          { style: { ...styles.searchWrap, padding: '6px 14px 8px' } },
          h('input', {
            style: styles.search,
            placeholder: '搜索名称 / 简介 / README 关键词…',
            value: query,
            onChange: (e) => setQuery(e.target.value),
          }),
        ),
        h(
          'div',
          { style: styles.tabBar },
          h(
            'button',
            { style: { ...styles.chipBase, ...(tab === 'feed' ? styles.chipActive : null) }, onClick: () => setTab('feed') },
            `最近 3 天 · ${feedCount}`,
          ),
          h(
            'button',
            { style: { ...styles.chipBase, ...(tab === 'all' ? styles.chipActive : null) }, onClick: () => setTab('all') },
            `全部 · ${data.items.length}`,
          ),
          h(
            'button',
            { style: { ...styles.chipBase, ...(tab === 'installed' ? styles.chipActive : null) }, onClick: () => setTab('installed') },
            `已安装插件${installedCount !== null ? ` · ${installedCount}` : ''}`,
          ),
          h(
            'button',
            { style: { ...styles.chipBase, ...(tab === 'recommend' ? styles.chipActive : null) }, onClick: () => setTab('recommend') },
            '推荐插件',
          ),
          // 工具组只在信息流 tab（最近3天/全部）显示：新建/更新仓库 + 星数筛选 + 排序
          (tab === 'feed' || tab === 'all') &&
            h(
              'span',
              { style: { marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' } },
              h(
                'button',
                {
                  style: { ...styles.chipBase, ...(feedMode === 'created' ? styles.chipActive : null) },
                  title: '按仓库创建时间（发现新插件）',
                  onClick: () => setFeedMode('created'),
                },
                '新建仓库',
              ),
              h(
                'button',
                {
                  style: { ...styles.chipBase, ...(feedMode === 'updated' ? styles.chipActive : null) },
                  title: '按最后代码提交时间（看活跃度）',
                  onClick: () => setFeedMode('updated'),
                },
                '更新仓库',
              ),
              h('span', { style: { width: 2 } }),
              h('span', { style: { fontSize: 11, color: colors.textFaint } }, '★'),
              h('input', {
                style: styles.starInput, placeholder: '最低', value: minStars, type: 'number', min: 0,
                onChange: (e) => setMinStars(e.target.value), title: '最低星数（留空不限）',
              }),
              h('span', { style: { fontSize: 11, color: colors.textFaint } }, '–'),
              h('input', {
                style: styles.starInput, placeholder: '最高', value: maxStars, type: 'number', min: 0,
                onChange: (e) => setMaxStars(e.target.value), title: '最高星数（留空不限）',
              }),
              h(
                'select',
                {
                  style: styles.sortSel,
                  value: sort,
                  onChange: (e) => setSort(e.target.value),
                  title: '排序方式',
                },
                h('option', { value: 'time' }, '按时间'),
                h('option', { value: 'stars' }, '★ 高→低'),
              ),
              h(
                'button',
                {
                  style: { ...styles.chipBase, ...(onlyInstallable ? styles.chipActive : null) },
                  title: '只看可一键安装的 JS 插件（有 package.json）',
                  onClick: () => setOnlyInstallable((v) => !v),
                },
                '可安装',
              ),
            ),
        ),
        h(
          'div',
          { style: styles.list },
          tab === 'installed' && h(InstalledView, { onOpen }),
          tab === 'recommend' && h(RecommendView, { items: data.items, onOpen }),
          (tab === 'feed' || tab === 'all') &&
            h(
              React.Fragment,
              null,
              loading && h('div', { style: styles.center }, '加载中…'),
              !loading && data.lastError &&
                h('div', { style: { ...styles.center, color: colors.red } }, `扫描出错：${data.lastError}`),
              !loading && !data.items.length && !data.lastError &&
                h('div', { style: styles.center }, data.refreshing ? '正在扫描 GitHub，首次约需半分钟…' : '暂无数据，点右上角 ⟳ 扫描'),
              !loading && !!data.items.length && !filtered.length &&
                h(
                  'div',
                  { style: styles.center },
                  query ? `没有匹配「${query}」的插件` : tab === 'feed' ? '最近 3 天没有新插件，切到「全部」看看' : '暂无收录',
                ),
              h(VirtualList, { items: filtered, onOpen, timeMode: feedMode, seenSet }),
            ),
        ),
        h(
          'div',
          { style: styles.disclaimer },
          '收录来自 GitHub 公开数据，未经安全检测，本插件不对第三方插件的安全性负责，安装前请自行甄别。',
        ),
        h(ScanFooter, { fetchedAt: data.fetchedAt, intervalHours: data.intervalHours }),
      )
    }

    function MarketWidget() {
      const [open, setOpen] = useState(false)
      const [detail, setDetail] = useState(null)
      const [newCount, setNewCount] = useState(0)
      // 已看过的仓库（NEW 徽标水位线），localStorage 持久化
      const [seen, setSeen] = useState(() => {
        try {
          const arr = JSON.parse(localStorage.getItem('plugin-radar-seen') || '[]')
          return new Set(Array.isArray(arr) ? arr : [])
        } catch {
          return new Set()
        }
      })
      const openDetail = useCallback((item) => {
        setDetail(item)
        setSeen((prev) => {
          if (prev.has(item.fullName)) return prev
          const next = new Set(prev)
          next.add(item.fullName)
          // 只保留最近 2000 条，避免无限膨胀
          const arr = [...next].slice(-2000)
          try { localStorage.setItem('plugin-radar-seen', JSON.stringify(arr)) } catch {}
          return next
        })
      }, [])
      // dock 位置：默认设置上方，用户可拖动，localStorage 记住
      const [pos, setPos] = useState(() => {
        try {
          const s = JSON.parse(localStorage.getItem('plugin-radar-pos') || 'null')
          if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) return s
        } catch {}
        return { x: 28, y: 64 }
      })
      const dragRef = useRef(null)

      // 拖动胶囊 = 拖动整个界面（面板+胶囊在同一容器，容器移动即整体移动，相对位置锁死）
      const onPointerDown = useCallback((e) => {
        if (e.button !== undefined && e.button !== 0) return
        const startX = e.clientX
        const startY = e.clientY
        const fromLeft = pos.x
        const fromBottom = pos.y
        dragRef.current = { moved: false }
        const onMove = (ev) => {
          const dx = ev.clientX - startX
          const dy = ev.clientY - startY
          if (!dragRef.current.moved && Math.hypot(dx, dy) > 6) dragRef.current.moved = true
          if (!dragRef.current.moved) return
          const x = Math.min(Math.max(8, fromLeft + dx), window.innerWidth - 160)
          const y = Math.min(Math.max(8, fromBottom - dy), window.innerHeight - 80)
          setPos({ x, y })
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          if (dragRef.current?.moved) {
            setPos((p) => {
              try { localStorage.setItem('plugin-radar-pos', JSON.stringify(p)) } catch {}
              return p
            })
          }
          setTimeout(() => { dragRef.current = null }, 0)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }, [pos.x, pos.y])

      // 上次打开面板的时间（已读水位线），持久化：角标 = 这之后新建/有更新的仓库数
      const lastSeenRef = useRef((() => {
        const t = parseInt(localStorage.getItem('plugin-radar-last-seen') || '0', 10)
        return Number.isFinite(t) ? t : 0
      })())

      const recount = useCallback(() => {
        fetch(`${API}/list`)
          .then((r) => r.json())
          .then((json) => {
            if (!json.items) return
            const since = lastSeenRef.current
            // 距上次打开以来：新建或是有更新的仓库（任一时间晚于水位线即算）
            const n = json.items.filter((it) => {
              const c = new Date(it.createdAt).getTime()
              const p = new Date(it.pushedAt).getTime()
              return Math.max(c, p) > since
            }).length
            setNewCount(since === 0 ? Math.min(n, 99) : n) // 首次没水位线时封顶 99，避免 4000+ 的压迫感
          })
          .catch(() => {})
      }, [])

      useEffect(() => {
        recount()
        const timer = setInterval(recount, 60000) // 每分钟补一次（扫描完成会带回新数据）
        return () => clearInterval(timer)
      }, [recount])

      // 打开面板即记为已读水位线（持久化），角标清零
      const toggle = useCallback(() => {
        if (dragRef.current?.moved) return // 刚拖完不算点击
        setOpen((o) => {
          if (!o) {
            lastSeenRef.current = Date.now()
            try { localStorage.setItem('plugin-radar-last-seen', String(lastSeenRef.current)) } catch {}
            setNewCount(0)
          }
          return !o
        })
      }, [])

      // 详情弹窗挂到 body 顶层（portal），避免父级 transform/filter 影响 fixed 定位
      const modal =
        detail &&
        ReactDOM.createPortal(h(DetailModal, { item: detail, onClose: () => setDetail(null) }), document.body)

      const dock = h(
        'button',
        {
          style: {
            ...styles.dock,
            ...(open ? { background: colors.accentBg, borderColor: colors.accent } : null),
          },
          onPointerDown: onPointerDown,
          onClick: toggle,
          title: open ? '收起（可拖动换位）' : '展开插件雷达（可拖动换位）',
        },
        h('span', null, '🧩'),
        h('span', null, '插件雷达'),
        !open && newCount > 0 &&
          h(
            'span',
            {
              style: {
                background: colors.accent, color: '#fff', borderRadius: 999,
                fontSize: 11, fontWeight: 700, padding: '1px 7px',
              },
            },
            newCount > 99 ? '99+' : newCount,
          ),
        h('span', { style: { fontSize: 10, color: colors.textFaint, marginLeft: 2 } }, open ? '▾' : '▴'),
      )
      // 胶囊 + 面板装进同一个 fixed 容器：拖动容器即整体移动，相对位置恒定
      return h(
        React.Fragment,
        null,
        h(
          'div',
          {
            style: {
              position: 'fixed', left: pos.x, bottom: pos.y, zIndex: 999,
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
              pointerEvents: 'none',
            },
          },
          // 面板在上、胶囊在下（正常 column，DOM 顺序即视觉顺序）
          open &&
            h(
              'div',
              { style: { pointerEvents: 'auto' } },
              h(MarketPanel, { onClose: () => setOpen(false), onOpen: openDetail, seenSet: seen }),
            ),
          // 胶囊（把手）贴在面板正下方
          h('div', { style: { pointerEvents: 'auto' } }, dock),
        ),
        modal,
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'plugin-radar', order: 90 }, MarketWidget),
      )
    }

    return { apply, inject }
  },
})
