/**
 * dsh-plugin-radar — 浏览器端。
 * 挂载到 shell.overlay（框架级浮动层）：左下角「插件雷达」卡片面板，
 * 数据来自主机端 /plugin-radar/api/*，支持关键词搜索与一键安装。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-radar',
  factory: (require) => {
    const React = require('react')
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
      pill: {
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: 999,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 16px',
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        color: colors.text,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        fontFamily: 'inherit',
      },
      panel: {
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: 999,
        pointerEvents: 'auto',
        width: 400,
        maxWidth: 'calc(100vw - 32px)',
        height: 'min(620px, calc(100vh - 96px))',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 16,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
        overflow: 'hidden',
        color: colors.text,
        fontSize: 13,
        fontFamily: 'inherit',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 14px 10px',
        borderBottom: `1px solid ${colors.border}`,
        flex: 'none',
      },
      iconBtn: {
        border: 'none',
        background: 'transparent',
        color: colors.textDim,
        cursor: 'pointer',
        borderRadius: 8,
        width: 28,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        flex: 'none',
      },
      searchWrap: { padding: '10px 14px 8px', flex: 'none' },
      tabBar: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 14px 10px',
        flex: 'none',
      },
      tab: {
        border: 'none',
        background: 'transparent',
        color: colors.textFaint,
        fontSize: 12,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      tabActive: {
        color: colors.text,
        background: colors.accentBg,
      },
      dayBtn: {
        border: `1px solid ${colors.border}`,
        background: 'transparent',
        color: colors.textFaint,
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      dayBtnActive: {
        color: colors.accent,
        borderColor: colors.accent,
        background: colors.accentBg,
      },
      search: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 12px',
        borderRadius: 10,
        border: `1px solid ${colors.border}`,
        background: 'rgba(0,0,0,0.25)',
        color: colors.text,
        fontSize: 13,
        outline: 'none',
        fontFamily: 'inherit',
      },
      list: { flex: 1, overflowY: 'auto', padding: '0 14px 14px' },
      card: {
        border: `1px solid ${colors.border}`,
        background: colors.bgCard,
        borderRadius: 12,
        padding: '11px 12px',
        marginBottom: 10,
      },
      cardTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
      },
      badgeNew: {
        flex: 'none',
        fontSize: 10,
        fontWeight: 700,
        color: '#0b0d12',
        background: colors.amber,
        borderRadius: 6,
        padding: '1px 6px',
        letterSpacing: 0.4,
      },
      meta: { color: colors.textFaint, fontSize: 11, flex: 'none' },
      summary: {
        color: colors.textDim,
        fontSize: 12,
        lineHeight: 1.55,
        margin: '7px 0 9px',
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      cardFoot: { display: 'flex', alignItems: 'center', gap: 8 },
      linkBtn: {
        fontSize: 12,
        color: colors.textDim,
        textDecoration: 'none',
        padding: '5px 10px',
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
      },
      installBtn: {
        marginLeft: 'auto',
        fontSize: 12,
        fontWeight: 600,
        color: '#fff',
        background: colors.accent,
        border: 'none',
        borderRadius: 8,
        padding: '6px 14px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      installedTag: {
        marginLeft: 'auto',
        fontSize: 12,
        fontWeight: 600,
        color: colors.green,
        background: colors.greenBg,
        borderRadius: 8,
        padding: '6px 12px',
      },
      footNote: {
        flex: 'none',
        padding: '8px 14px',
        borderTop: `1px solid ${colors.border}`,
        color: colors.textFaint,
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      },
      center: {
        padding: '36px 20px',
        textAlign: 'center',
        color: colors.textDim,
        fontSize: 13,
        lineHeight: 1.8,
      },
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

    function PluginCard({ item, onOpen }) {
      const [state, setState] = useState(item.installed ? 'installed' : 'idle')
      const [message, setMessage] = useState('')
      const [hover, setHover] = useState(false)

      const install = async () => {
        if (state === 'installing' || state === 'installed') return
        setState('installing')
        setMessage('')
        try {
          const res = await fetch(`${API}/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName: item.fullName }),
          })
          const data = await res.json()
          if (data.ok) {
            setState('installed')
            setMessage(data.message || '安装完成')
          } else {
            setState('error')
            setMessage(data.message || '安装失败')
          }
        } catch (e) {
          setState('error')
          setMessage(String(e.message || e))
        }
      }

      return h(
        'div',
        {
          style: { ...styles.card, ...(hover ? { background: colors.bgCardHover } : null) },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
        },
        h(
          'div',
          { style: styles.cardTitle },
          isNew(item.pushedAt) && h('span', { style: styles.badgeNew }, 'NEW'),
          h(
            'span',
            {
              style: {
                fontWeight: 600,
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
              title: item.fullName,
            },
            item.name,
          ),
          h('span', { style: { ...styles.meta, marginLeft: 'auto' } }, `★ ${item.stars}`),
          h('span', { style: styles.meta }, relTime(item.pushedAt)),
        ),
        h('div', { style: styles.summary, title: item.summary }, item.summary),
        message &&
          h(
            'div',
            {
              style: {
                fontSize: 11,
                marginBottom: 8,
                color: state === 'error' ? colors.red : colors.green,
              },
            },
            message,
          ),
        h(
          'div',
          { style: styles.cardFoot },
          h(
            'a',
            { style: styles.linkBtn, href: item.url, target: '_blank', rel: 'noreferrer' },
            'GitHub ↗',
          ),
          state === 'installed'
            ? h('span', { style: styles.installedTag }, '✓ 已安装')
            : h(
                'button',
                {
                  style: {
                    ...styles.installBtn,
                    opacity: state === 'installing' ? 0.6 : 1,
                    cursor: state === 'installing' ? 'default' : 'pointer',
                  },
                  onClick: install,
                  disabled: state === 'installing',
                },
                state === 'installing' ? '安装中…' : state === 'error' ? '重试安装' : '一键安装',
              ),
        ),
      )
    }

    function MarketPanel({ onClose }) {
      const [data, setData] = useState({
        items: [],
        fetchedAt: 0,
        refreshing: false,
        lastError: '',
        pushWindowDays: 7,
      })
      const [query, setQuery] = useState('')
      const [tab, setTab] = useState('feed')
      const [days, setDays] = useState(0)
      const [loading, setLoading] = useState(true)
      const autoRefreshed = useRef(false)

      const load = useCallback(async () => {
        try {
          const res = await fetch(`${API}/list`)
          const json = await res.json()
          setData(json)
          return json
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
        await load()
      }, [load])

      useEffect(() => {
        void (async () => {
          const json = await load()
          if (json && !json.items.length && !json.refreshing && !autoRefreshed.current) {
            autoRefreshed.current = true
            void refresh()
          }
        })()
        const timer = setInterval(load, 30000)
        return () => clearInterval(timer)
      }, [load, refresh])

      const windowDays = data.pushWindowDays || 7
      const activeDays = days || windowDays
      const tokens = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])
      const base = useMemo(() => {
        if (tab === 'all') return data.items
        const cutoff = Date.now() - activeDays * 86400_000
        return data.items.filter((it) => new Date(it.pushedAt).getTime() >= cutoff)
      }, [data.items, tab, activeDays])
      const filtered = useMemo(() => base.filter((it) => matchQuery(it, tokens)), [base, tokens])
      const feedCount = useMemo(() => {
        const cutoff = Date.now() - windowDays * 86400_000
        return data.items.filter((it) => new Date(it.pushedAt).getTime() >= cutoff).length
      }, [data.items, windowDays])

      return h(
        'div',
        { style: styles.panel },
        h(
          'div',
          { style: styles.header },
          h('span', { style: { fontSize: 15 } }, '🧩'),
          h('span', { style: { fontWeight: 600, fontSize: 14 } }, '插件雷达'),
          h(
            'span',
            { style: { color: colors.textFaint, fontSize: 11 } },
            data.refreshing ? '扫描 GitHub 中…' : `${data.items.length} 个插件`,
          ),
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            {
              style: { ...styles.iconBtn, ...(data.refreshing ? { opacity: 0.4 } : null) },
              title: '立即扫描 GitHub 最新插件',
              onClick: () => !data.refreshing && refresh(),
            },
            '⟳',
          ),
          h('button', { style: styles.iconBtn, title: '收起', onClick: onClose }, '✕'),
        ),
        h(
          'div',
          { style: styles.searchWrap },
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
            {
              style: { ...styles.tab, ...(tab === 'feed' ? styles.tabActive : null) },
              onClick: () => setTab('feed'),
            },
            `最新 · ${feedCount}`,
          ),
          h(
            'button',
            {
              style: { ...styles.tab, ...(tab === 'all' ? styles.tabActive : null) },
              onClick: () => setTab('all'),
            },
            `全部 · ${data.items.length}`,
          ),
          tab === 'feed' &&
            h(
              'span',
              { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
              [3, 7].map((d) =>
                h(
                  'button',
                  {
                    key: d,
                    style: { ...styles.dayBtn, ...(activeDays === d ? styles.dayBtnActive : null) },
                    onClick: () => setDays(d),
                  },
                  `${d} 天`,
                ),
              ),
            ),
        ),
        h(
          'div',
          { style: styles.list },
          loading && h('div', { style: styles.center }, '加载中…'),
          !loading && data.lastError &&
            h('div', { style: { ...styles.center, color: colors.red } }, `扫描出错：${data.lastError}`),
          !loading && !data.items.length && !data.lastError &&
            h(
              'div',
              { style: styles.center },
              data.refreshing ? '正在扫描 GitHub，首次约需半分钟…' : '暂无数据，点右上角 ⟳ 扫描',
            ),
          !loading &&
            !!data.items.length &&
            !filtered.length &&
            h(
              'div',
              { style: styles.center },
              query
                ? `没有匹配「${query}」的插件`
                : tab === 'feed'
                  ? `近 ${activeDays} 天没有新插件，切到「全部」看看`
                  : '暂无收录',
            ),
          filtered.map((item) => h(PluginCard, { key: item.fullName, item })),
        ),
        h(
          'div',
          { style: styles.footNote },
          h('span', null, '每 12 小时自动扫描 GitHub · topic:dsh-plugin'),
          h('span', { style: { flex: 1 } }),
          data.fetchedAt > 0 &&
            h('span', null, `上次 ${new Date(data.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`),
        ),
      )
    }

    function MarketWidget() {
      const [open, setOpen] = useState(false)
      const [newCount, setNewCount] = useState(0)

      useEffect(() => {
        let alive = true
        fetch(`${API}/list`)
          .then((r) => r.json())
          .then((json) => {
            if (!alive || !json.items) return
            const cutoff = Date.now() - (json.pushWindowDays || 7) * 86400_000
            setNewCount(json.items.filter((it) => new Date(it.pushedAt).getTime() >= cutoff).length)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [open])

      if (!open) {
        return h(
          'button',
          { style: styles.pill, onClick: () => setOpen(true) },
          h('span', null, '🧩'),
          h('span', null, '插件雷达'),
          newCount > 0 &&
            h(
              'span',
              {
                style: {
                  background: colors.accent,
                  color: '#fff',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '1px 7px',
                },
              },
              newCount > 99 ? '99+' : newCount,
            ),
        )
      }
      return h(MarketPanel, { onClose: () => setOpen(false) })
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'plugin-radar', order: 90 },
          MarketWidget,
        ),
      )
    }

    return { apply, inject }
  },
})
