/**
 * dsh-plugin-radar — 主机端插件。
 * 分层收录：全量浅收（名称/简介/星数），近 3 天更新的深收 README 摘要（信息流）。
 * 扩展能力（翻译、AI 摘要）按需调用使用者自己 DSH 配置的模型额度，插件零 API 成本。
 */

import { promises as fsp, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-plugin-radar'
export const inject = ['webServer', 'llm']

const searchUrl = (sort, page) =>
  `https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=${sort}&order=desc&per_page=100&page=${page}`
/** 按创建日分片搜索（绕过 search api 只返回前 1000 条的硬限制） */
const shardUrl = (date, page) =>
  `https://api.github.com/search/repositories?q=topic:dsh-plugin+created:${date}&sort=created&order=asc&per_page=100&page=${page}`

function isoDay(d) {
  return d.toISOString().slice(0, 10)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 搜索请求节流：两次请求之间的最小间隔（保守 5s，避开次级限流） */
const SEARCH_GAP_MS = 5000

/** 带限流退避的搜索请求：429/403 带 Retry-After 按其等待重试，次级限流退避重试。 */
async function fetchSearch(url, token, log) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res
    try {
      res = await fetch(url, { headers: ghHeaders(token) })
    } catch (e) {
      log(`search network error: ${e.message}`)
      await sleep(5000)
      continue
    }
    if (res.status === 403 || res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 0)
      const wait = retryAfter > 0 ? retryAfter * 1000 : 30_000 * (attempt + 1)
      log(`rate limited (${res.status}), wait ${Math.round(wait / 1000)}s`)
      await sleep(wait)
      continue
    }
    if (res.status === 422) return { list: [], done: true }
    if (!res.ok) throw new Error(`search api ${res.status}`)
    return { list: (await res.json()).items || [], done: false }
  }
  rateLimited = true
  return { list: [], done: true, gaveUp: true }
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function ghHeaders(token, accept = 'application/vnd.github+json') {
  const h = {
    Accept: accept,
    'User-Agent': 'dsh-plugin-radar',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function hasCjk(s) {
  return /[一-鿿]/.test(s || '')
}

/** 从本机 git 凭据中读取 GitHub token（配置 githubToken/GITHUB_TOKEN 优先）。 */
function gitCredentialToken() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const m = out.match(/^password=(.+)$/m)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

/** 从 README 提取第一条有意义的简介段落。 */
function extractSummary(readme, fallback) {
  if (readme) {
    for (const raw of readme.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      if (line.startsWith('#')) continue
      if (line.startsWith('```')) break
      if (line.startsWith('<')) continue
      if (line.startsWith('![') || line.startsWith('[!')) continue
      if (line.startsWith('|')) continue
      const text = line
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/[*_`>]/g, '')
        .trim()
      if (text.length < 12) continue
      // HTML 标签被剥掉后的属性碎片行（src="…"）
      if (/^[a-z-]+="/i.test(text)) continue
      // 裸 URL / 附件链接 / 短链接行（🌐 官网：https://…）不是简介
      if (/^https?:\/\/\S+$/.test(text)) continue
      if (text.length < 60 && /:\/\//.test(text)) continue
      if (/join our community/i.test(text)) continue
      // 语言切换行（English | 中文 / 🌐 中文 · English 等，允许前导符号）
      const probe = text.replace(/^[^\p{L}\p{N}]+/u, '')
      if (/^(english|中文|简体中文)/i.test(probe) && text.length < 40 && /[|·•/]/.test(text)) continue
      return text.length > 220 ? text.slice(0, 220) + '…' : text
    }
  }
  const d = (fallback || '').trim()
  return d || '（暂无简介）'
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => {
      buf += c
      if (buf.length > 64 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(buf ? JSON.parse(buf) : {})
      } catch {
        reject(new Error('invalid json body'))
      }
    })
    req.on('error', reject)
  })
}

function run(cmd, args, cwd, timeoutMs = 180_000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ code: -1, log: out + '\n[timeout]' })
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, log: out + `\n[spawn error] ${e.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, log: out })
    })
  })
}

export function apply(ctx, config = {}) {
  const cfg = {
    refreshIntervalHours: 12,
    pushWindowDays: 3,
    deepScanDays: 3,
    maxRepos: 6000,
    pagesPerSort: 30,
    readmeMaxChars: 6000,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    profile: 'web',
    pnpmBin: 'pnpm',
    githubToken: process.env.GITHUB_TOKEN || '',
    ...config,
  }
  const token = cfg.githubToken || gitCredentialToken()
  const cacheFile = path.join(dshHome(), 'plugin-radar-cache.json')
  const profileDir = path.join(dshHome(), 'profiles', cfg.profile)
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  const profilePkgFile = path.join(profileDir, 'package.json')

  let rateLimited = false
  const state = {
    fetchedAt: 0,
    refreshing: false,
    lastError: '',
    progress: '',
    items: /** @type {Array<any>} */ ([]),
  }
  /** 增量扫描游标：按 created 分片，避免每次全量重扫 */
  const scanCursor = { lastCreatedDay: '' }
  const translations = new Map()
  const aiSummaries = new Map()

  const log = (msg) => {
    ctx.logger?.info?.(`[plugin-radar] ${msg}`)
    try {
      process.stdout.write(`[plugin-radar] ${msg}\n`)
    } catch {}
  }

  async function loadCache() {
    try {
      const data = JSON.parse(await fsp.readFile(cacheFile, 'utf8'))
      if (Array.isArray(data.items)) {
        state.items = data.items
        state.fetchedAt = data.fetchedAt || 0
        log(`cache loaded: ${state.items.length} plugins`)
      }
      if (data.translations) for (const [k, v] of Object.entries(data.translations)) translations.set(k, v)
      if (data.aiSummaries) for (const [k, v] of Object.entries(data.aiSummaries)) aiSummaries.set(k, v)
      if (data.scanCursor && data.scanCursor.lastCreatedDay) scanCursor.lastCreatedDay = data.scanCursor.lastCreatedDay
    } catch {
      /* 无缓存，首次扫描填充 */
    }
  }

  async function saveCache() {
    try {
      await fsp.mkdir(path.dirname(cacheFile), { recursive: true })
      await fsp.writeFile(
        cacheFile,
        JSON.stringify(
          {
            fetchedAt: state.fetchedAt,
            items: state.items,
            translations: Object.fromEntries([...translations.entries()].slice(-500)),
            aiSummaries: Object.fromEntries([...aiSummaries.entries()].slice(-500)),
            scanCursor,
          },
          null,
          2,
        ),
      )
    } catch (e) {
      log(`cache save failed: ${e.message}`)
    }
  }

  /** 调用使用者自己配置的模型（一次性问答，取纯文本）。 */
  async function askLlm(system, userText, maxTokens = 500) {
    const messages = [
      createUserMessage({
        content: [{ type: 'text', text: userText }],
        source: { kind: 'plugin', plugin: 'dsh-plugin-radar' },
      }),
    ]
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: cfg.provider,
      model: cfg.model,
      messages,
      system,
      maxTokens,
      temperature: 0.2,
    })) {
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error(finish.failure?.message || `模型调用失败 (${finish.kind})`)
    }
    const text = assembler
      .blocks()
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!text) throw new Error(`模型未返回文本 (finish: ${finish.kind})`)
    return text
  }

  async function translateText(text) {
    const cached = translations.get(text)
    if (cached) return { text: cached, cached: true }
    const out = await askLlm(
      '你是软件领域的专业翻译。把用户给的 GitHub 仓库简介/段落翻译成自然、准确的简体中文。只输出译文，不要解释，不要引号。',
      text.slice(0, 2000),
      600,
    )
    if (out) {
      translations.set(text, out)
      void saveCache()
    }
    return { text: out, cached: false }
  }

  async function summarizeItem(fullName) {
    const item = state.items.find((it) => it.fullName === fullName)
    if (!item) throw new Error('插件不在收录中')
    const cached = aiSummaries.get(fullName)
    if (cached && cached.pushedAt === item.pushedAt) return { summary: cached.summary, cached: true }
    const corpus = (item.readme || '').slice(0, 5000) || item.description || item.summary
    if (!corpus.trim()) throw new Error('该仓库没有可供摘要的内容')
    const out = await askLlm(
      '你在为 DeepSeek Harness（dsh）的插件信息流写中文摘要。根据用户给的 GitHub 仓库 README，用简体中文输出：第一行一句话说清这个插件是干什么的；然后最多 4 个要点（每行以「· 」开头）列核心功能或亮点。总长度不超过 220 字。只输出摘要本身。',
      `仓库：${fullName}\n\n${corpus}`,
      700,
    )
    if (out) {
      aiSummaries.set(fullName, { pushedAt: item.pushedAt, summary: out })
      void saveCache()
    }
    return { summary: out || '（摘要生成失败）', cached: false }
  }

  async function fetchReadme(fullName) {
    const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
      headers: ghHeaders(token, 'application/vnd.github.raw+json'),
    })
    if (!res.ok) return ''
    return (await res.text()).slice(0, cfg.readmeMaxChars)
  }

  async function scan() {
    if (state.refreshing) return
    state.refreshing = true
    state.lastError = ''
    rateLimited = false
    try {
      log('scanning GitHub topic:dsh-plugin (updated head + incremental created-shards) …')
      const byName = new Map()
      // ① 最近更新头部：保证已收录仓库的排序/信息及时刷新
      for (let page = 1; page <= 10; page++) {
        const { list, done } = await fetchSearch(searchUrl('updated', page), token, log)
        for (const repo of list) byName.set(repo.full_name, repo)
        if (done || list.length < 100) break
        await sleep(SEARCH_GAP_MS)
      }
      log(`updated head: ${byName.size}`)
      // ② 按创建日分片做增量收录：从上次游标的后一天开始，逐日抓到昨天
      //    （GitHub search api 只回前 1000，分片是绕过它的全量手段）
      const TOPIC_BIRTH = '2026-08-11'
      const startDay = scanCursor.lastCreatedDay || TOPIC_BIRTH
      const start = new Date(`${startDay}T00:00:00Z`)
      if (scanCursor.lastCreatedDay) start.setUTCDate(start.getUTCDate() + 1)
      const today = new Date()
      const yesterday = new Date(today.getTime() - 86400_000)
      let lastDone = scanCursor.lastCreatedDay
      for (let d = new Date(start); d <= yesterday; d.setUTCDate(d.getUTCDate() + 1)) {
        const day = isoDay(d)
        state.progress = `分片 ${day} · 已收 ${byName.size}`
        for (let page = 1; page <= 10; page++) {
          const r = await fetchSearch(shardUrl(day, page), token, log)
          for (const repo of r.list) byName.set(repo.full_name, repo)
          if (r.done || r.list.length < 100) break
          await sleep(SEARCH_GAP_MS)
        }
        lastDone = day
        log(`shard ${day} done | total ${byName.size} rateLimited=${rateLimited}`)
        if (rateLimited) { log('分片循环：命中限流，游标停在本日，下次续扫'); break }
        if (byName.size >= cfg.maxRepos) { log('达到 maxRepos，停'); break }
        await sleep(SEARCH_GAP_MS)
      }
      if (lastDone) scanCursor.lastCreatedDay = lastDone
      state.progress = ''
      const oldByName = new Map(state.items.map((it) => [it.fullName, it]))
      // 全量累计：老条目保留 + 新抓的按 fullName 合并覆盖（maxRepos 只做兜底，正常不截断）
      const merged = new Map(oldByName)
      for (const repo of byName.values()) merged.set(repo.full_name, repo)
      let allRepos = [...merged.values()]
      if (allRepos.length > cfg.maxRepos) {
        allRepos = allRepos.sort((a, b) => {
          const at = a.pushed_at || a.pushedAt || ''
          const bt = b.pushed_at || b.pushedAt || ''
          return at < bt ? 1 : -1
        }).slice(0, cfg.maxRepos)
      }
      // 深收窗口外的仓库沿用旧 README 缓存（不消耗抓取预算）
      const cutoff = Date.now() - cfg.deepScanDays * 86400_000

      const items = []
      const needFetch = []
      for (const raw of allRepos) {
        // 老条目（已是 item 结构）直接沿用；新抓的（repo 结构）走规范化
        const isItem = !!raw.fullName && raw.summary !== undefined
        const repo = isItem
          ? { full_name: raw.fullName, name: raw.name, description: raw.description, stargazers_count: raw.stars, created_at: raw.createdAt, pushed_at: raw.pushedAt, html_url: raw.url, topics: raw.topics }
          : raw
        const prev = oldByName.get(repo.full_name)
        const inWindow = new Date(repo.pushed_at).getTime() >= cutoff
        const reuse = prev && prev.pushedAt === repo.pushed_at && prev.readme !== undefined
        const base = {
          fullName: repo.full_name,
          name: repo.name,
          description: repo.description || '',
          stars: repo.stargazers_count || 0,
          createdAt: repo.created_at,
          pushedAt: repo.pushed_at,
          url: repo.html_url,
          topics: repo.topics || [],
          readme: '',
          summary: '',
          deep: false,
        }
        if (reuse) {
          base.readme = prev.readme
          base.summary = prev.summary
          // 深收标记以「近窗口内且有 README」为准，旧缓存没有 deep 字段时重新判定
          base.deep = inWindow && !!prev.readme
          items.push(base)
        } else if (prev && !inWindow) {
          // 窗口外的老条目直接沿用缓存，不重复生成摘要
          base.readme = prev.readme || ''
          base.summary = prev.summary || extractSummary('', repo.description)
          base.deep = false
          items.push(base)
        } else if (inWindow) {
          needFetch.push([base, repo])
          items.push(base)
        } else {
          base.summary = extractSummary('', repo.description)
          items.push(base)
        }
      }
      // 只有近窗口内、且没缓存的才抓 README
      const queue = [...needFetch]
      const workers = Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const [base, repo] = queue.shift()
          try {
            base.readme = await fetchReadme(repo.full_name)
          } catch {
            base.readme = ''
          }
          base.summary = extractSummary(base.readme, repo.description)
          base.deep = !!base.readme
        }
      })
      await Promise.all(workers)
      // 按更新时间倒序落库（最新在前）
      items.sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1))
      state.items = items
      state.fetchedAt = Date.now()
      await saveCache()
      log(`scan done: ${items.length} plugins (${needFetch.length} deep-collected)`)
    } catch (e) {
      state.lastError = e.message
      log(`scan failed: ${e.message}`)
    } finally {
      state.refreshing = false
      state.progress = ''
    }
  }

  async function installedSet() {
    const set = new Set()
    try {
      const pkg = JSON.parse(await fsp.readFile(profilePkgFile, 'utf8'))
      for (const k of Object.keys(pkg.dependencies || {})) set.add(k.toLowerCase())
    } catch {}
    try {
      const yml = await fsp.readFile(patchFile, 'utf8')
      for (const m of yml.matchAll(/name:\s*'([^']+)'/g)) set.add(m[1].toLowerCase())
      for (const m of yml.matchAll(/name:\s*([^\s#]+)/g)) set.add(m[1].replace(/['"]/g, '').toLowerCase())
    } catch {}
    return set
  }

  let pnpmPath = null
  function resolvePnpm() {
    if (pnpmPath) return pnpmPath
    const candidates = [cfg.pnpmBin, 'pnpm']
    try {
      const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
      for (const v of readdirSync(nvmDir)) candidates.push(path.join(nvmDir, v, 'bin', 'pnpm'))
    } catch {}
    candidates.push('/opt/homebrew/bin/pnpm', '/usr/local/bin/pnpm', '/usr/bin/pnpm')
    for (const c of candidates) {
      try {
        if (spawnSync(c, ['--version'], { stdio: 'pipe' }).status === 0) {
          pnpmPath = c
          log(`pnpm resolved: ${c}`)
          return c
        }
      } catch {}
    }
    return null
  }

  async function resolveSpec(fullName) {
    // 先 raw.githubusercontent，失败则 GitHub API（raw 更易被墙）
    const tryUrls = [
      `https://raw.githubusercontent.com/${fullName}/HEAD/package.json`,
      `https://api.github.com/repos/${fullName}/contents/package.json`,
    ]
    let pkg = null
    for (const url of tryUrls) {
      try {
        const res = await fetch(url, { headers: ghHeaders(token, url.includes('api.github') ? 'application/vnd.github.raw+json' : 'application/vnd.github+json') })
        if (res.ok) {
          pkg = JSON.parse(await res.text())
          break
        }
      } catch {}
    }
    // 拿不到 package.json → 大概率不是 JS 包（如 Python 包），装上会拖垮 dsh 启动，拒绝
    if (!pkg || !pkg.name) {
      return { mode: 'invalid', spec: '', packageName: '', reason: '该仓库没有 package.json，不是可直接安装的 DSH 插件（可能是 Python/其他语言项目）' }
    }
    // git+https 形式：你的网络下比 github: 直连稳；包名错的问题由 install 里校正解决
    const gitSpec = `git+https://github.com/${fullName}.git`
    try {
      const npmRes = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, { signal: AbortSignal.timeout(4000) })
      if (npmRes.ok) return { mode: 'npm', spec: pkg.name, packageName: pkg.name }
    } catch {}
    return { mode: 'git', spec: gitSpec, packageName: pkg.name }
  }

  /** 检查已安装插件是否有上游更新：对比 package.json 记录的版本/提交与远端最新 */
  async function checkUpdates() {
    const list = await installedList()
    const byName = new Map(state.items.map((it) => [it.name.toLowerCase(), it]))
    const byShort = new Map(state.items.map((it) => [it.fullName.split('/')[1].toLowerCase(), it]))
    const out = []
    for (const it of list) {
      const lower = it.name.toLowerCase()
      const hit = byName.get(lower) || byShort.get(lower)
      let hasUpdate = false
      let latest = ''
      if (/^git\+https/.test(it.source) || /^github:/.test(it.source)) {
        // git 源：对比 pushedAt 与本地记录的 install 时间不可知，简化——只要收录里 pushedAt 比缓存新即提示
        hasUpdate = false // git 源难以精确判断版本，留给 npm 判断
        latest = hit?.pushedAt || ''
      } else {
        // npm 源：拉 registry 最新版本号对比（3s 超时，防个别包卡住拖垮整个列表）
        try {
          const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(it.name)}/latest`, {
            headers: { 'User-Agent': 'dsh-plugin-radar' },
            signal: AbortSignal.timeout(3000),
          })
          if (r.ok) {
            const j = await r.json()
            latest = j.version || ''
            const cur = String(it.source).replace(/^[\^~>=\s]+/, '')
            hasUpdate = latest && cur && latest !== cur
          }
        } catch {}
      }
      out.push({ ...it, hasUpdate, latestVersion: latest })
    }
    return out
  }

  async function install(fullName) {
    const resolved = await resolveSpec(fullName)
    if (resolved.mode === 'invalid') {
      return { ok: false, packageName: fullName.split('/')[1], message: resolved.reason }
    }
    const { mode, spec, packageName } = resolved
    const installed = await installedSet()
    if (installed.has(packageName.toLowerCase())) {
      return { ok: true, already: true, packageName, message: '已安装过，无需重复安装' }
    }
    const bin = resolvePnpm()
    if (!bin) {
      return { ok: false, packageName, message: '找不到 pnpm，请在插件配置里设置 pnpmBin 为完整路径' }
    }
    log(`installing ${spec} via ${bin} …`)
    const add = await run(bin, ['add', spec], profileDir)
    if (add.code !== 0) {
      return { ok: false, packageName, message: 'pnpm add 失败', log: add.log.slice(-2000) }
    }
    // git 源时 pnpm 会用 URL 末段当依赖 key（如 hol-guard.git），校正成真实包名，保证与 patch.yml 一致
    if (mode === 'git') {
      try {
        const pkgJson = JSON.parse(await fsp.readFile(profilePkgFile, 'utf8'))
        const deps = pkgJson.dependencies || {}
        const wrongKey = Object.keys(deps).find((k) => k !== packageName && (k === `${packageName}.git` || k === fullName.split('/')[1] + '.git' || String(deps[k]).includes(fullName)))
        if (wrongKey) {
          deps[packageName] = deps[wrongKey]
          delete deps[wrongKey]
          await fsp.writeFile(profilePkgFile, JSON.stringify(pkgJson, null, 2), 'utf8')
          log(`dep key corrected: ${wrongKey} -> ${packageName}`)
        }
      } catch (e) {
        log(`dep key correct failed: ${e.message}`)
      }
    }
    const id = packageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
    const row = `\n- insert:\n    - id: ${id}\n      name: '${packageName.replace(/'/g, "''")}'\n`
    await fsp.appendFile(patchFile, row, 'utf8')
    return { ok: true, already: false, mode, packageName, message: '安装完成，刷新页面后生效', needsReload: true }
  }

  /** 已安装插件清单：合并 package.json 依赖与 patch.yml 启用行 */
  async function installedList() {
    const map = new Map()
    try {
      const pkg = JSON.parse(await fsp.readFile(profilePkgFile, 'utf8'))
      for (const [name, ver] of Object.entries(pkg.dependencies || {})) {
        map.set(name.toLowerCase(), { name, source: String(ver) })
      }
    } catch {}
    return [...map.values()]
  }

  /** 一键卸载：从 package.json 移除依赖 + 清掉 patch.yml 里的启用行 + pnpm remove */
  async function uninstall(packageName) {
    const lower = packageName.toLowerCase()
    if (lower === 'dsh-plugin-radar') {
      return { ok: false, message: '不能卸载插件雷达自己' }
    }
    const installed = await installedSet()
    if (!installed.has(lower)) {
      return { ok: false, message: '该插件未安装' }
    }
    // ① 从 patch.yml 删掉对应 insert 行
    try {
      const yml = await fsp.readFile(patchFile, 'utf8')
      const lines = yml.split('\n')
      const out = []
      let skipBlock = false
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/^\s*-\s+insert:/.test(line)) {
          // 预读这个 insert 块后续几行，若含 name: '<pkg>' 则整块跳过
          const block = [line]
          let j = i + 1
          while (j < lines.length && !/^\s*-\s+insert:/.test(lines[j]) && !/^-\s/.test(lines[j])) {
            block.push(lines[j])
            j++
          }
          const blockText = block.join('\n')
          if (new RegExp(`name:\\s*'${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(blockText)) {
            i = j - 1
            continue
          }
        }
        out.push(line)
      }
      await fsp.writeFile(patchFile, out.join('\n'), 'utf8')
    } catch (e) {
      log(`patch yml clean failed: ${e.message}`)
    }
    // ② pnpm remove（仅当它在 package.json 依赖里）
    const bin = resolvePnpm()
    if (bin) {
      const inPkg = (await installedList()).some((it) => it.name.toLowerCase() === lower)
      if (inPkg) {
        log(`pnpm remove ${packageName} …`)
        await run(bin, ['remove', packageName], profileDir, 120_000)
      }
    }
    return { ok: true, message: '已卸载，刷新页面后彻底移除', needsReload: true }
  }

  ctx.effect(() => {
    const routes = [
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/list',
        handler: async (_req, res) => {
          try {
            const installed = await installedSet()
            sendJson(res, 200, {
              fetchedAt: state.fetchedAt,
              refreshing: state.refreshing,
              lastError: state.lastError,
              progress: state.progress,
              total: state.items.length,
              intervalHours: cfg.refreshIntervalHours,
              pushWindowDays: cfg.pushWindowDays,
              items: state.items.map((it) => ({
                ...it,
                installed:
                  installed.has(it.fullName.split('/')[1].toLowerCase()) ||
                  installed.has(it.name.toLowerCase()),
              })),
            })
          } catch (e) {
            sendJson(res, 500, { error: e.message })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/refresh',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          await scan()
          sendJson(res, 200, {
            ok: !state.lastError,
            count: state.items.length,
            lastError: state.lastError,
            fetchedAt: state.fetchedAt,
          })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/install',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const body = await readBody(req)
            if (!body.fullName || !/^[\w.-]+\/[\w.-]+$/.test(body.fullName)) {
              return sendJson(res, 400, { ok: false, message: 'fullName 格式不正确' })
            }
            const result = await install(body.fullName)
            sendJson(res, result.ok ? 200 : 500, result)
          } catch (e) {
            sendJson(res, 500, { ok: false, message: e.message })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/translate',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const body = await readBody(req)
            const text = String(body.text || '').slice(0, 4000)
            if (!text.trim()) return sendJson(res, 400, { error: 'text is empty' })
            const result = await translateText(text)
            sendJson(res, 200, result)
          } catch (e) {
            sendJson(res, 500, { error: e.message })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/summarize',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const body = await readBody(req)
            if (!body.fullName || !/^[\w.-]+\/[\w.-]+$/.test(body.fullName)) {
              return sendJson(res, 400, { error: 'fullName 格式不正确' })
            }
            const result = await summarizeItem(body.fullName)
            sendJson(res, 200, result)
          } catch (e) {
            sendJson(res, 500, { error: e.message })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/installed',
        handler: async (_req, res) => {
          try {
            const list = await installedList()
            // checkUpdates 最多 8s，超时就放弃更新标记（保证列表一定能返回）
            const updates = await Promise.race([
              checkUpdates(),
              new Promise((resolve) => setTimeout(() => resolve([]), 8000)),
            ])
            const updMap = new Map(updates.map((u) => [u.name.toLowerCase(), u]))
            const byName = new Map(state.items.map((it) => [it.name.toLowerCase(), it]))
            const byShort = new Map(state.items.map((it) => [it.fullName.split('/')[1].toLowerCase(), it]))
            const enriched = list.map((it) => {
              const lower = it.name.toLowerCase()
              const hit = byName.get(lower) || byShort.get(lower) || byShort.get(it.name.split('/').pop().toLowerCase())
              const upd = updMap.get(lower) || {}
              return {
                ...it,
                summary: hit?.summary || '', fullName: hit?.fullName || '', stars: hit?.stars ?? null,
                isSelf: lower === 'dsh-plugin-radar',
                hasUpdate: !!upd.hasUpdate, latestVersion: upd.latestVersion || '',
              }
            })
            sendJson(res, 200, { items: enriched })
          } catch (e) {
            sendJson(res, 500, { error: e.message })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/update',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const body = await readBody(req)
            if (!body.name) return sendJson(res, 400, { ok: false, message: 'name 不能为空' })
            const bin = resolvePnpm()
            if (!bin) return sendJson(res, 500, { ok: false, message: '找不到 pnpm' })
            log(`pnpm update ${body.name} …`)
            const r = await run(bin, ['update', body.name], profileDir, 180_000)
            if (r.code !== 0) return sendJson(res, 500, { ok: false, message: '更新失败', log: r.log.slice(-1500) })
            sendJson(res, 200, { ok: true, message: '已更新到最新版，刷新页面生效', needsReload: true })
          } catch (e) {
            sendJson(res, 500, { ok: false, message: e.message })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/uninstall',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
          try {
            const body = await readBody(req)
            if (!body.name || typeof body.name !== 'string') {
              return sendJson(res, 400, { ok: false, message: 'name 不能为空' })
            }
            const result = await uninstall(body.name.trim())
            sendJson(res, result.ok ? 200 : 500, result)
          } catch (e) {
            sendJson(res, 500, { ok: false, message: e.message })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/plugin-radar/api/config',
        handler: async (req, res) => {
          if (req.method === 'GET') {
            return sendJson(res, 200, { refreshIntervalHours: cfg.refreshIntervalHours, pushWindowDays: cfg.pushWindowDays })
          }
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'GET/POST only' })
          try {
            const body = await readBody(req)
            const h = Number(body.refreshIntervalHours)
            if (!Number.isFinite(h) || h < 0.5 || h > 720) {
              return sendJson(res, 400, { ok: false, message: 'refreshIntervalHours 需在 0.5 ~ 720 之间' })
            }
            cfg.refreshIntervalHours = h
            restartTimer()
            sendJson(res, 200, { ok: true, refreshIntervalHours: cfg.refreshIntervalHours })
          } catch (e) {
            sendJson(res, 500, { ok: false, message: e.message })
          }
        },
      }),
    ]

    // 定时器可随配置调整重建
    let timer = setInterval(() => void scan(), cfg.refreshIntervalHours * 3600_000)
    function restartTimer() {
      clearInterval(timer)
      timer = setInterval(() => void scan(), cfg.refreshIntervalHours * 3600_000)
      log(`refresh interval -> ${cfg.refreshIntervalHours}h`)
    }

    void (async () => {
      await loadCache()
      const stale = Date.now() - state.fetchedAt > cfg.refreshIntervalHours * 3600_000
      if (stale) await scan()
    })()

    log(
      `ready v2-shard (scan every ${cfg.refreshIntervalHours}h, deep ≤${cfg.deepScanDays}d, model: ${cfg.provider}/${cfg.model})`,
    )
    return () => {
      clearInterval(timer)
      for (const dispose of routes) dispose()
    }
  })
}
