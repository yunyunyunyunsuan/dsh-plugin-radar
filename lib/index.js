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

const SEARCH_SORTS = ['updated', 'created', 'stars']
const searchUrl = (sort, page) =>
  `https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=${sort}&order=desc&per_page=100&page=${page}`

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
    maxRepos: 300,
    pagesPerSort: 3,
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

  const state = {
    fetchedAt: 0,
    refreshing: false,
    lastError: '',
    items: /** @type {Array<any>} */ ([]),
  }
  const translations = new Map()
  const aiSummaries = new Map()

  const log = (msg) => ctx.logger?.info?.(`[plugin-radar] ${msg}`)

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
    try {
      log('scanning GitHub topic:dsh-plugin (updated + created + stars, paged) …')
      const byName = new Map()
      let remaining = 99
      outer: for (const sort of SEARCH_SORTS) {
        for (let page = 1; page <= cfg.pagesPerSort; page++) {
          const res = await fetch(searchUrl(sort, page), { headers: ghHeaders(token) })
          if (res.status === 403 || res.status === 429) {
            log(`search api ${res.status} (rate limited), keep ${byName.size} collected so far`)
            break outer
          }
          if (!res.ok) throw new Error(`search api ${res.status}`)
          const data = await res.json()
          const list = data.items || []
          for (const repo of list) byName.set(repo.full_name, repo)
          remaining = Number(res.headers.get('x-ratelimit-remaining') || '99')
          if (list.length < 100 || remaining < 12) break
        }
      }
      const oldByName = new Map(state.items.map((it) => [it.fullName, it]))
      // 深收窗口外的仓库沿用旧 README 缓存（不消耗抓取预算）
      const cutoff = Date.now() - cfg.deepScanDays * 86400_000
      const repos = [...byName.values()]
        .sort((a, b) => (a.pushed_at < b.pushed_at ? 1 : -1))
        .slice(0, cfg.maxRepos)

      const items = []
      const needFetch = []
      for (const repo of repos) {
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
      state.items = items
      state.fetchedAt = Date.now()
      await saveCache()
      log(`scan done: ${items.length} plugins (${needFetch.length} deep-collected)`)
    } catch (e) {
      state.lastError = e.message
      log(`scan failed: ${e.message}`)
    } finally {
      state.refreshing = false
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
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${fullName}/HEAD/package.json`, {
        headers: { 'User-Agent': 'dsh-plugin-radar' },
      })
      if (res.ok) {
        const pkg = JSON.parse(await res.text())
        if (pkg.name) {
          const npmRes = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`)
          if (npmRes.ok) return { mode: 'npm', spec: pkg.name, packageName: pkg.name }
          return { mode: 'github', spec: `github:${fullName}`, packageName: pkg.name }
        }
      }
    } catch {}
    return { mode: 'github', spec: `github:${fullName}`, packageName: fullName.split('/')[1] }
  }

  async function install(fullName) {
    const { mode, spec, packageName } = await resolveSpec(fullName)
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
    const id = packageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
    const row = `\n- insert:\n    - id: ${id}\n      name: '${packageName.replace(/'/g, "''")}'\n`
    await fsp.appendFile(patchFile, row, 'utf8')
    return { ok: true, already: false, mode, packageName, message: '安装完成，刷新页面后生效', needsReload: true }
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
    ]

    const timer = setInterval(() => void scan(), cfg.refreshIntervalHours * 3600_000)

    void (async () => {
      await loadCache()
      const stale = Date.now() - state.fetchedAt > cfg.refreshIntervalHours * 3600_000
      if (stale) await scan()
    })()

    log(
      `ready (scan every ${cfg.refreshIntervalHours}h, deep ≤${cfg.deepScanDays}d, model: ${cfg.provider}/${cfg.model})`,
    )
    return () => {
      clearInterval(timer)
      for (const dispose of routes) dispose()
    }
  })
}
