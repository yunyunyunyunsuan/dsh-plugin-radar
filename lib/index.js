/**
 * dsh-plugin-radar — 主机端插件。
 * 定时扫描 GitHub topic:dsh-plugin 仓库，缓存 README 摘要，
 * 通过 ctx.webServer 暴露 JSON API 给浏览器端卡片面板。
 */

import { promises as fsp, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

export const name = 'dsh-plugin-radar'
export const inject = ['webServer']

const SEARCH_URL =
  'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=updated&order=desc&per_page=100'

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

/** 从 README 提取第一条有意义的简介段落。 */
function extractSummary(readme, fallback) {
  if (readme) {
    const lines = readme.split('\n')
    for (let raw of lines) {
      const line = raw.trim()
      if (!line) continue
      if (line.startsWith('#')) continue
      if (line.startsWith('```')) break
      if (line.startsWith('<')) continue
      if (line.startsWith('![') || line.startsWith('[!')) continue
      if (line.startsWith('|')) continue
      if (/^\[[^\]]+\]\([^)]*\)$/.test(line)) continue
      if (/^(English|中文)\s*\|/i.test(line)) continue
      const text = line
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`>]/g, '')
        .trim()
      if (text.length < 12) continue
      return text.length > 220 ? text.slice(0, 220) + '…' : text
    }
  }
  const d = (fallback || '').trim()
  return d || '（暂无简介）'
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(data)
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
      } catch (e) {
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
    pushWindowDays: 7,
    maxRepos: 100,
    readmeMaxChars: 6000,
    profile: 'web',
    pnpmBin: 'pnpm',
    githubToken: process.env.GITHUB_TOKEN || '',
    ...config,
  }
  const token = cfg.githubToken
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

  const log = (msg) => ctx.logger?.info?.(`[plugin-radar] ${msg}`)

  async function loadCache() {
    try {
      const raw = await fsp.readFile(cacheFile, 'utf8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.items)) {
        state.items = data.items
        state.fetchedAt = data.fetchedAt || 0
        log(`cache loaded: ${state.items.length} plugins`)
      }
    } catch {
      /* 无缓存，首次扫描填充 */
    }
  }

  async function saveCache() {
    try {
      await fsp.mkdir(path.dirname(cacheFile), { recursive: true })
      await fsp.writeFile(
        cacheFile,
        JSON.stringify({ fetchedAt: state.fetchedAt, items: state.items }, null, 2),
      )
    } catch (e) {
      log(`cache save failed: ${e.message}`)
    }
  }

  async function fetchReadme(fullName) {
    const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
      headers: ghHeaders(token, 'application/vnd.github.raw+json'),
    })
    if (!res.ok) return ''
    const text = await res.text()
    return text.slice(0, cfg.readmeMaxChars)
  }

  async function scan() {
    if (state.refreshing) return
    state.refreshing = true
    state.lastError = ''
    try {
      log('scanning GitHub topic:dsh-plugin …')
      const res = await fetch(SEARCH_URL, { headers: ghHeaders(token) })
      if (!res.ok) throw new Error(`search api ${res.status}`)
      const data = await res.json()
      const repos = (data.items || []).slice(0, cfg.maxRepos)
      const oldByName = new Map(state.items.map((it) => [it.fullName, it]))
      const items = []
      // 有限并发抓 README（pushedAt 未变的复用缓存）
      const queue = [...repos]
      const workers = Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const repo = queue.shift()
          if (!repo) break
          const prev = oldByName.get(repo.full_name)
          let readme = prev && prev.pushedAt === repo.pushed_at ? prev.readme : undefined
          if (readme === undefined) {
            try {
              readme = await fetchReadme(repo.full_name)
            } catch {
              readme = prev?.readme || ''
            }
          }
          items.push({
            fullName: repo.full_name,
            name: repo.name,
            description: repo.description || '',
            stars: repo.stargazers_count || 0,
            createdAt: repo.created_at,
            pushedAt: repo.pushed_at,
            url: repo.html_url,
            topics: repo.topics || [],
            readme: readme || '',
            summary: extractSummary(readme, repo.description),
          })
        }
      })
      await Promise.all(workers)
      items.sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1))
      state.items = items
      state.fetchedAt = Date.now()
      await saveCache()
      log(`scan done: ${items.length} plugins`)
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
      for (const v of readdirSync(nvmDir)) {
        candidates.push(path.join(nvmDir, v, 'bin', 'pnpm'))
      }
    } catch {}
    candidates.push('/opt/homebrew/bin/pnpm', '/usr/local/bin/pnpm', '/usr/bin/pnpm')
    for (const c of candidates) {
      try {
        const r = spawnSync(c, ['--version'], { stdio: 'pipe' })
        if (r.status === 0) {
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
    return {
      ok: true,
      already: false,
      mode,
      packageName,
      message: '安装完成，刷新页面后生效',
      needsReload: true,
    }
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
    ]

    const timer = setInterval(() => void scan(), cfg.refreshIntervalHours * 3600_000)

    void (async () => {
      await loadCache()
      const stale = Date.now() - state.fetchedAt > cfg.refreshIntervalHours * 3600_000
      if (stale) await scan()
    })()

    log(`ready (refresh every ${cfg.refreshIntervalHours}h, cache: ${cacheFile})`)
    return () => {
      clearInterval(timer)
      for (const dispose of routes) dispose()
    }
  })
}
