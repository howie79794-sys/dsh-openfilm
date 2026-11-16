/**
 * dsh-openfilm — Host 半边。
 *
 * 1. 把自带的 openfilm skill（own-skills/openfilm）注册进 ctx.skills，
 *    模型和 /skill 命令都能用（用户自己在 ~/.dsh/skills 装的 openfilm skill 优先）。
 * 2. 注册 openfilm 工具给模型：status / open / projects / look / render / render-status。
 *    在 Host 进程里执行，不经过模型的 bash 沙箱。
 * 3. 渲染优先接入 DSH 原生 jobs（ctx.jobs：进度、日志环、取消、任务面板可见），
 *    jobs 服务不可用时退回插件自己的内存任务表。
 * 4. /openfilm/api/* 同源环回路由，供浏览器侧栏面板和对话卡片调同一套操作：
 *    GET  status | projects | studio | render/:id | thumb/:id
 *    POST open | render | render-cancel | reveal
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const API = '/openfilm/api'
const DEFAULT_PROJECTS_DIR = join(homedir(), 'Movies', 'OpenFilm', 'Projects')
const THUMB_DIR = join(homedir(), '.dsh', 'cache', 'dsh-openfilm')
const OPEN_TIMEOUT_MS = 90_000
const LOOK_TIMEOUT_MS = 180_000
const MAX_LOG_TAIL = 12_000

export const name = 'dsh-openfilm'
export const inject = ['webServer', 'skills', 'tools']

const DEFAULTS = {
  enabled: true,
  openfilmCommand: 'openfilm',
  projectsDir: DEFAULT_PROJECTS_DIR,
  studioBase: '', // 留空：从 openfilm 的 run.json / 输出里解析
}

const text = (value) => [{ type: 'text', text: value }]

// ── openfilm 本机数据（~/.openfilm） ────────────────────────
function openfilmHome() {
  return join(homedir(), '.openfilm')
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function studioBase(cfg) {
  if (cfg.studioBase) return cfg.studioBase.replace(/\/$/, '')
  const run = readJsonFile(join(openfilmHome(), 'run.json'))
  const port = run && Number.isFinite(Number(run.port)) ? Number(run.port) : 4747
  const host = run && typeof run.host === 'string' && run.host ? run.host : '127.0.0.1'
  return `http://${host}:${port}`
}

function studioKey() {
  try {
    return readFileSync(join(openfilmHome(), 'key'), 'utf8').trim()
  } catch {
    return null
  }
}

function recentProjects() {
  const studio = readJsonFile(join(openfilmHome(), 'studio.json'))
  const recent = studio && Array.isArray(studio.recent) ? studio.recent : []
  return recent
    .filter((entry) => entry && typeof entry.path === 'string' && existsSync(join(entry.path, 'film.html')))
    .map((entry) => ({ id: entry.id, path: entry.path, openedAt: entry.openedAt || 0 }))
}

/** Studio 正在跑吗：环回地址上探一下 /open。 */
async function studioAlive(base, ms = 1500) {
  try {
    const response = await fetch(`${base}/open`, { signal: AbortSignal.timeout(ms) })
    return response.status < 500
  } catch {
    return false
  }
}

// ── 子进程：解析 openfilm 可执行文件（host 进程的 PATH 不一定带 nvm） ──
function makeRunner(ctx, cfg) {
  let cachedExe
  let cachedEnv

  async function shellResolve(command) {
    return await new Promise((resolvePromise) => {
      const shell = process.platform === 'win32' ? 'cmd' : '/bin/zsh'
      const args = process.platform === 'win32' ? ['/c', `where ${command}`] : ['-lc', `command -v ${command}`]
      const child = spawn(shell, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      child.stdout.on('data', (chunk) => { out += chunk })
      child.on('error', () => resolvePromise(null))
      child.on('close', (code) => resolvePromise(code === 0 && out.trim() ? out.trim().split('\n')[0] : null))
    })
  }

  async function executable() {
    if (cachedExe !== undefined) return cachedExe
    let exe = null
    try {
      const subprocess = ctx.get?.('subprocess')
      if (subprocess && typeof subprocess.resolveExecutable === 'function') {
        exe = await subprocess.resolveExecutable(cfg.openfilmCommand)
      }
    } catch { /* 可选服务，失败不致命 */ }
    if (!exe) exe = await shellResolve(cfg.openfilmCommand)
    cachedExe = exe
    return exe
  }

  async function ffmpegExecutable() {
    return await shellResolve('ffmpeg')
  }

  async function env() {
    if (cachedEnv) return cachedEnv
    const envVars = { ...process.env, OPENFILM_NO_BROWSER: '1' }
    try {
      const subprocess = ctx.get?.('subprocess')
      if (subprocess && typeof subprocess.terminalEnvironment === 'function') {
        const terminal = await subprocess.terminalEnvironment()
        if (terminal && typeof terminal.env === 'object' && terminal.env) Object.assign(envVars, terminal.env)
        else if (terminal && typeof terminal.PATH === 'string') envVars.PATH = terminal.PATH
      }
    } catch { /* 可选服务 */ }
    cachedEnv = envVars
    return envVars
  }

  /** 跑一条 openfilm 命令并收集输出；超时或非零退出抛错（带输出尾部）。 */
  async function run(args, options = {}) {
    const exe = await executable()
    if (!exe) throw new Error(`找不到 ${cfg.openfilmCommand} 命令：本机还没装 OpenFilm（npm i -g openfilm），或在插件配置里改 openfilmCommand`)
    const envVars = await env()
    return await new Promise((resolvePromise, rejectPromise) => {
      const wantsStdin = typeof options.stdin === 'string'
      const child = spawn(exe, args, {
        cwd: options.cwd,
        env: { ...envVars, ...(options.env || {}) },
        stdio: [wantsStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      })
      if (wantsStdin) {
        child.stdin.on('error', () => {})
        child.stdin.end(options.stdin)
      }
      let out = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        rejectPromise(new Error(`openfilm ${args.join(' ')} 超时（${options.timeoutMs || 60_000} ms）`))
      }, options.timeoutMs || 60_000)
      const onChunk = (chunk) => {
        out += chunk.toString('utf8')
        if (out.length > 200_000) out = out.slice(-100_000)
      }
      child.stdout.on('data', onChunk)
      child.stderr.on('data', onChunk)
      child.on('error', (error) => { clearTimeout(timer); rejectPromise(error) })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({ code, output: out.trim() })
      })
    })
  }

  return { executable, ffmpegExecutable, env, run }
}

// ── ffmpeg 检测（60s 缓存） ─────────────────────────────────
function makeFfmpegCheck() {
  let cached
  let checkedAt = 0
  return async function ffmpegOk() {
    const now = Date.now()
    if (cached !== undefined && now - checkedAt < 60_000) return cached
    cached = await new Promise((resolvePromise) => {
      const shell = process.platform === 'win32' ? 'cmd' : '/bin/zsh'
      const args = process.platform === 'win32' ? ['/c', 'where ffmpeg'] : ['-lc', 'command -v ffmpeg']
      const child = spawn(shell, args, { stdio: ['ignore', 'ignore', 'ignore'] })
      child.on('error', () => resolvePromise(false))
      child.on('close', (code) => resolvePromise(code === 0))
    })
    checkedAt = now
    return cached
  }
}

// ── 渲染任务：原生 jobs 优先，内存表兜底 ────────────────────
let jobSeq = 0
const renderRecords = new Map() // jobId → record（两种后端共用）

function trimJobs(jobs) {
  if (renderRecords.size > 30) {
    for (const [id, record] of renderRecords) {
      if (record.state !== 'running' && record.state !== 'cancelling') { renderRecords.delete(id); break }
    }
  }
  return jobs
}

/** 用 ffmpeg 从成品 MP4 抽一帧当封面（尽力而为，失败不影响任务状态）。 */
function makeThumb(runner, jobId, output) {
  void (async () => {
    try {
      if (!output || !existsSync(output)) return
      const ffmpeg = await runner.ffmpegExecutable()
      if (!ffmpeg) return
      mkdirSync(THUMB_DIR, { recursive: true })
      const thumb = join(THUMB_DIR, `${jobId}.jpg`)
      const child = spawn(ffmpeg, ['-y', '-ss', '0.5', '-i', output, '-frames:v', '1', '-vf', 'scale=480:-2', thumb], { stdio: 'ignore' })
      child.on('close', (code) => {
        const record = renderRecords.get(jobId)
        if (record && code === 0 && existsSync(thumb)) record.thumb = thumb
      })
    } catch { /* 封面失败无所谓 */ }
  })()
}

function guessOutput(projectPath, out) {
  if (out && isAbsolute(out)) return out
  return join(projectPath, `${basename(projectPath)}.mp4`)
}

/** 原生 jobs 后端：run 钩子返回 { done, cancel }，日志进 ring。 */
function startNativeRender(jobs, runner, { projectPath, args, range, output }) {
  const jobId = `ofr-${Date.now().toString(36)}-${++jobSeq}`
  const state = { tail: '' }
  let child = null
  let settle
  const done = new Promise((resolvePromise) => { settle = resolvePromise })

  const nativeId = jobs.start({
    kind: 'openfilm-render',
    label: `OpenFilm 渲染 ${basename(projectPath)}${range ? ` ${range}` : ''}`,
    run: (handle) => {
      void (async () => {
        try {
          const exe = await runner.executable()
          const envVars = await runner.env()
          child = spawn(exe, args, { cwd: projectPath, env: envVars, stdio: ['ignore', 'pipe', 'pipe'] })
          const onChunk = (chunk) => {
            const s = chunk.toString('utf8')
            state.tail = (state.tail + s).slice(-MAX_LOG_TAIL)
            try {
              handle.append(s)
              const lines = state.tail.trimEnd().split('\n')
              const last = lines[lines.length - 1]
              if (last) handle.updateProgress(last.slice(0, 200))
            } catch { /* handle 只在任务存活期有效 */ }
          }
          child.stdout.on('data', onChunk)
          child.stderr.on('data', onChunk)
          child.on('error', (error) => settle({ status: 'failed', detail: error.message }))
          child.on('close', (code) => settle(code === 0
            ? { status: 'completed', detail: `输出 ${output}` }
            : { status: 'failed', detail: `exit ${code}` }))
        } catch (error) {
          settle({ status: 'failed', detail: error instanceof Error ? error.message : String(error) })
        }
      })()
      return {
        done,
        cancel: () => { if (child && child.exitCode === null) child.kill('SIGTERM') },
      }
    },
  })

  const record = {
    id: nativeId, native: true, project: projectPath, output,
    state: 'running', startedAt: Date.now(), endedAt: null, exitCode: null,
    get tail() { return state.tail }, thumb: null,
  }
  renderRecords.set(nativeId, record)
  trimJobs(renderRecords)
  void done.then((outcome) => {
    record.state = outcome.status === 'completed' ? 'done' : outcome.status === 'killed' ? 'cancelled' : 'failed'
    record.endedAt = Date.now()
    if (outcome.status === 'completed') makeThumb(runner, nativeId, output)
  })
  return record
}

/** 内存兜底后端。 */
function startInternalRender(runner, { projectPath, args, range, output }) {
  const jobId = `ofr-${Date.now().toString(36)}-${++jobSeq}`
  const record = {
    id: jobId, native: false, project: projectPath, output,
    state: 'running', startedAt: Date.now(), endedAt: null, exitCode: null, tail: '', thumb: null,
  }
  renderRecords.set(jobId, record)
  trimJobs(renderRecords)

  void (async () => {
    try {
      const exe = await runner.executable()
      const envVars = await runner.env()
      const child = spawn(exe, args, { cwd: projectPath, env: envVars, stdio: ['ignore', 'pipe', 'pipe'] })
      record.child = child
      const onChunk = (chunk) => { record.tail = (record.tail + chunk.toString('utf8')).slice(-MAX_LOG_TAIL) }
      child.stdout.on('data', onChunk)
      child.stderr.on('data', onChunk)
      child.on('error', (error) => {
        record.state = 'failed'; record.endedAt = Date.now(); record.tail += `\n${error.message}`
      })
      child.on('close', (code) => {
        record.exitCode = code
        record.state = code === 0 ? 'done' : 'failed'
        record.endedAt = Date.now()
        if (code === 0) makeThumb(runner, jobId, output)
      })
    } catch (error) {
      record.state = 'failed'; record.endedAt = Date.now()
      record.tail += `\n${error instanceof Error ? error.message : String(error)}`
    }
  })()

  return record
}

/** 两种后端统一的对外视图；原生后端从 registry 拿权威状态。 */
function jobView(jobs, record) {
  let state = record.state
  let progress
  if (record.native && jobs) {
    try {
      const view = jobs.get(record.id)
      if (view) {
        if (view.status === 'running') state = 'running'
        else if (view.status === 'stopping') state = 'cancelling'
        else if (view.status === 'completed') state = 'done'
        else if (view.status === 'killed') state = 'cancelled'
        else if (view.status === 'failed') state = 'failed'
        progress = view.progress
      }
    } catch { /* registry 不可读时退回本地记录 */ }
  }
  return {
    id: record.id, state, project: record.project, output: record.output,
    startedAt: record.startedAt, endedAt: record.endedAt,
    exitCode: record.exitCode, progress: progress || null,
    thumb: record.thumb ? `${API}/thumb/${encodeURIComponent(record.id)}` : null,
    log: record.tail,
  }
}

// ── 项目解析 ────────────────────────────────────────────────
function findProject(input, cfg) {
  if (!input || typeof input !== 'string') return null
  const direct = isAbsolute(input) ? input : join(cfg.projectsDir, input)
  if (existsSync(join(direct, 'film.html'))) return { path: resolve(direct) }
  // 容错：名字对上 recent 里的项目
  const hit = recentProjects().find((entry) => basename(entry.path) === input || entry.id === input)
  return hit ? { path: hit.path } : null
}

function listProjects(cfg) {
  const byPath = new Map()
  for (const entry of recentProjects()) byPath.set(resolve(entry.path), { ...entry, recent: true })
  if (existsSync(cfg.projectsDir)) {
    for (const name of readdirSync(cfg.projectsDir)) {
      const path = join(cfg.projectsDir, name)
      try {
        if (!statSync(path).isDirectory()) continue
      } catch { continue }
      if (!existsSync(join(path, 'film.html'))) continue
      const key = resolve(path)
      if (!byPath.has(key)) byPath.set(key, { id: null, path: key, openedAt: 0, recent: false })
    }
  }
  return [...byPath.values()].sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
}

// ── 打开项目：跑 openfilm open，解析 Studio 地址 ────────────
async function openFilm(runner, cfg, { name, folder }) {
  const cwd = cfg.projectsDir
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })
  if (folder && !name) {
    const project = findProject(folder, cfg)
    if (project) {
      const result = await runner.run(['open', project.path], { cwd: project.path, timeoutMs: OPEN_TIMEOUT_MS })
      return openResult(result, project.path)
    }
  }
  const target = name || folder || ''
  const safeName = String(target).trim().replace(/[/\\]/g, '-')
  if (!safeName) throw new Error('open 需要 name（新影片名）或 folder（已有项目）')
  const result = await runner.run(['open', safeName], { cwd, timeoutMs: OPEN_TIMEOUT_MS })
  const projectPath = existsSync(join(cwd, safeName, 'film.html')) ? join(cwd, safeName) : null
  return openResult(result, projectPath)
}

function openResult(result, projectPath) {
  if (result.code !== 0) throw new Error(`openfilm open 失败（exit ${result.code}）：${result.output.slice(-2000)}`)
  const match = result.output.match(/^Studio\s+(https?:\/\/\S+)/m)
  if (!match) throw new Error(`没有从输出里解析到 Studio 地址：${result.output.slice(-2000)}`)
  return { studioUrl: match[1], projectPath }
}

// ── skill 提供方（照 guizang 的做法，rank 低：用户自装的优先） ──
const SKILL_DIR = join(ROOT, 'own-skills')

function parseSkill(file) {
  const raw = readFileSync(file, 'utf8')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return null
  const field = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^["'](.*)["']$/, '$1')
  const name = field('name')
  const description = field('description')
  return name && description ? { name, description, body: raw.slice(m[0].length) } : null
}

function createSkillProvider() {
  const dir = join(SKILL_DIR, 'openfilm')
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) return { name: 'dsh-openfilm', async list() { return [] }, async get() { return undefined } }
  return {
    name: 'dsh-openfilm',
    async list() {
      const skill = parseSkill(file)
      if (!skill) return []
      return [{
        name: skill.name, description: skill.description, path: file,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled', provider: 'dsh-openfilm', rank: 600, locator: dir,
        resourceBase: { kind: 'directory', path: dir },
      }]
    },
    async get(candidate) {
      if (candidate?.locator !== dir) return undefined
      const skill = parseSkill(file)
      if (!skill) return undefined
      return { name: skill.name, description: skill.description, content: skill.body, invocation: { modelInvocable: true, userInvocable: true } }
    },
  }
}

// ── 插件主入口 ──────────────────────────────────────────────
export async function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) }
  if (typeof cfg.projectsDir !== 'string' || !cfg.projectsDir) cfg.projectsDir = DEFAULT_PROJECTS_DIR
  if (!cfg.enabled) {
    ctx.logger?.info?.('[openfilm] 已按配置停用（config.enabled: false）')
    return
  }

  const runner = makeRunner(ctx, cfg)
  const ffmpegOk = makeFfmpegCheck()
  const base = () => studioBase(cfg)

  // ── 原生 jobs 桥：可用就挂一个控制器（宿主层，服务所有 owner） ──
  let jobs
  try {
    const candidate = ctx.get('jobs')
    if (candidate && typeof candidate.start === 'function' && typeof candidate.attachController === 'function') jobs = candidate
  } catch { /* 无 jobs 服务的 profile：走内存兜底 */ }
  if (jobs) ctx.effect(() => jobs.attachController('dsh-openfilm'), 'openfilm: job controller')

  // ── 操作集合：工具和 HTTP 路由共用 ──
  // ── Studio 聊天（agent 宿主）检测：聊天面板需要 OpenFilm 桌面版 ──
  async function studioAppInfo() {
    let app = null
    try {
      const response = await fetch(`${base()}/api/health`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) {
        const health = await response.json()
        if (health && typeof health === 'object') app = health.app === true
      }
    } catch { /* 未运行 */ }
    // DSH 应用自带的 dsh 命令：OpenFilm 桌面版靠它把 DeepSeek Harness 接成聊天 agent
    const candidates = [
      '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',
      join(homedir(), 'Applications', 'DeepSeek Harness.app', 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh'),
    ]
    const dshCli = candidates.find((path) => existsSync(path)) ?? null
    return { app: Boolean(app), dshCli }
  }

  async function opStatus() {
    let version = null
    try {
      const result = await runner.run(['--version'], { timeoutMs: 15_000 })
      if (result.code === 0) version = result.output.split('\n')[0].trim()
    } catch (error) {
      version = null
      ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
    }
    const key = studioKey()
    const alive = key ? await studioAlive(base()) : false
    const chat = await studioAppInfo()
    return {
      installed: version !== null,
      version,
      ffmpeg: await ffmpegOk(),
      studio: { running: alive, base: base(), hasKey: Boolean(key), app: chat.app, dshCli: chat.dshCli },
      projectsDir: cfg.projectsDir,
      nativeJobs: Boolean(jobs),
    }
  }

  async function opOpen(payload) {
    return await openFilm(runner, cfg, { name: payload.name, folder: payload.folder })
  }

  async function opLook(payload) {
    const project = findProject(payload.folder || payload.name, cfg)
    if (!project) throw new Error(`不是 OpenFilm 项目（没有 film.html）：${payload.folder || payload.name || '(空)'}`)
    const args = ['look']
    if (payload.what) args.push(String(payload.what))
    if (payload.range) args.push(String(payload.range))
    const result = await runner.run(args, { cwd: project.path, timeoutMs: LOOK_TIMEOUT_MS })
    return { project: project.path, code: result.code, output: result.output.slice(-MAX_LOG_TAIL) }
  }

  /** 读画板：openfilm canvas 的 JSON 压成 agent 好读的清单（「指着说」的匹配依据）。 */
  async function opCanvas(payload) {
    const project = findProject(payload.folder || payload.name, cfg)
    if (!project) throw new Error(`不是 OpenFilm 项目（没有 film.html）：${payload.folder || payload.name || '(空)'}`)
    const result = await runner.run(['canvas'], { cwd: project.path, timeoutMs: 60_000 })
    if (result.code !== 0) throw new Error(result.output.slice(-1500))
    let board
    try {
      board = JSON.parse(result.output)
    } catch {
      throw new Error(`画板输出不是 JSON：${result.output.slice(-500)}`)
    }
    const nodes = (board.nodes || []).map((node) => {
      const label = node.text || node.path || node.name || node.prompt || node.make || ''
      return { id: node.id, kind: node.kind ?? null, label: String(label).slice(0, 120), x: node.x, y: node.y, group: node.group ?? null, inputs: node.inputs ?? undefined }
    })
    const edges = (board.edges || []).map((edge) => ({ from: edge.from, to: edge.to }))
    const lines = nodes.map((node) => `${node.id}${node.kind ? ` [${node.kind}]` : ''}: ${node.label}`)
    if (edges.length) lines.push(`连线: ${edges.map((edge) => `${edge.from}→${edge.to}`).join(' ')}`)
    return { project: project.path, nodes, edges, text: lines.length ? lines.join('\n') : '（画板是空的）' }
  }

  /** 改画板：steps 直接透传给 openfilm canvas apply（原子：全成或全不）。 */
  async function opCanvasApply(payload) {
    const project = findProject(payload.folder || payload.name, cfg)
    if (!project) throw new Error(`不是 OpenFilm 项目（没有 film.html）：${payload.folder || payload.name || '(空)'}`)
    let steps = payload.steps
    if (typeof steps === 'string') {
      try { steps = JSON.parse(steps) } catch { throw new Error('steps 不是合法 JSON') }
    }
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps 需要是非空的 JSON 步骤数组')
    const result = await runner.run(['canvas', 'apply', '-'], {
      cwd: project.path,
      timeoutMs: 60_000,
      stdin: JSON.stringify(steps),
    })
    if (result.code !== 0) throw new Error(`canvas apply 失败：${result.output.slice(-1500)}`)
    return { project: project.path, output: result.output.trim() }
  }

  function opRender(payload) {
    const project = findProject(payload.folder || payload.name, cfg)
    if (!project) throw new Error(`不是 OpenFilm 项目（没有 film.html）：${payload.folder || payload.name || '(空)'}`)
    const args = ['render']
    const { range, fps, out } = payload
    if (range && /^\d+(\.\d+)?\s*-\s*\d+(\.\d+)?$/.test(range)) args.push(range.replace(/\s+/g, ''))
    if (fps && Number.isFinite(Number(fps))) args.push('--fps', String(fps))
    if (out && isAbsolute(out)) args.push('--out', out)
    const output = guessOutput(project.path, out)
    let record
    if (jobs) {
      try {
        record = startNativeRender(jobs, runner, { projectPath: project.path, args, range, output })
      } catch (error) {
        if (!String(error?.code ?? '').includes('JOB_CONTROLLER_UNAVAILABLE')
          && !String(error?.message ?? '').includes('job controller')) throw error
        record = startInternalRender(runner, { projectPath: project.path, args, range, output })
      }
    } else {
      record = startInternalRender(runner, { projectPath: project.path, args, range, output })
    }
    return jobView(jobs, record)
  }

  function requireRecord(payload) {
    const record = renderRecords.get(String(payload.jobId || ''))
    if (!record) throw new Error(`没有这个渲染任务：${payload.jobId}`)
    return record
  }

  function opRenderStatus(payload) {
    return jobView(jobs, requireRecord(payload))
  }

  function opRenderCancel(payload) {
    const record = requireRecord(payload)
    if (record.state !== 'running' && record.state !== 'cancelling') return jobView(jobs, record)
    if (record.native && jobs) {
      try { jobs.kill(record.id, undefined, '用户取消') } catch { /* registry 会兜底 */ }
      return { ...jobView(jobs, record), state: 'cancelling' }
    }
    if (record.child && record.child.exitCode === null) record.child.kill('SIGTERM')
    return { ...jobView(jobs, record), state: 'cancelling' }
  }

  /** 在 Finder/资源管理器里显示文件：只放行渲染产物和已知项目目录里的东西。 */
  function opReveal(payload) {
    const path = String(payload.path || '')
    if (!isAbsolute(path)) throw new Error('path 要用绝对路径')
    let allowed = false
    for (const record of renderRecords.values()) {
      if (record.output === path) { allowed = true; break }
    }
    if (!allowed) {
      const project = findProject(dirname(path), cfg)
      if (project && project.path === resolve(dirname(path))) allowed = true
    }
    if (!allowed || !existsSync(path)) throw new Error(`不在可放行范围（渲染产物或项目目录内）：${path}`)
    const command = process.platform === 'win32' ? 'explorer' : 'open'
    const child = spawn(command, process.platform === 'win32' ? [path.replace(/\//g, '\\')] : ['-R', path], {
      detached: true, stdio: 'ignore',
    })
    child.on('error', () => {})
    child.unref()
    return { revealed: path }
  }

  function opProjects() {
    return { projects: listProjects(cfg).map((entry) => ({ id: entry.id, name: basename(entry.path), path: entry.path, openedAt: entry.openedAt, recent: entry.recent })) }
  }

  // ── 删除项目：整文件夹移入系统废纸篓（可恢复），只删真实项目 ──
  /** 把绝对路径移入系统废纸篓；平台命令缺失则失败，绝不静默 rm。 */
  function trashFolder(path) {
    const run = (command, args) => new Promise((resolveRun, rejectRun) => {
      const child = spawn(command, args, { stdio: 'ignore' })
      child.on('error', (error) => rejectRun(new Error(`${command} 不可用：${error.message}`)))
      child.on('exit', (code) => { if (code === 0) resolveRun(); else rejectRun(new Error(`${command} 退出码 ${code}`)) })
    })
    if (process.platform === 'darwin') {
      // Finder 的删除 = 移入废纸篓；AppleScript 字符串转义与 JSON 双引号串兼容
      return run('osascript', ['-e', `tell application "Finder" to delete (POSIX file ${JSON.stringify(path)} as alias)`])
    }
    if (process.platform === 'linux') return run('gio', ['trash', path])
    if (process.platform === 'win32') {
      const escaped = path.replace(/'/g, "''")
      return run('powershell', ['-NoProfile', '-Command',
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escaped}','OnlyErrorDialogs','SendToRecycleBin')`])
    }
    return Promise.reject(new Error('当前系统不支持移入废纸篓，请手动删除项目文件夹'))
  }

  async function opRemove(payload) {
    const folder = String(payload.folder || '')
    if (!isAbsolute(folder)) throw new Error('folder 要用绝对路径')
    const project = findProject(folder, cfg)
    if (!project) throw new Error(`不在项目列表里，无法删除：${folder}`)
    for (const record of renderRecords.values()) {
      if (record.project === project.path && (record.state === 'running' || record.state === 'cancelling')) {
        throw new Error('该项目正在渲染，先停止渲染再删除')
      }
    }
    await trashFolder(project.path)
    return { removed: project.path, trashed: true }
  }

  // ── 模型工具 ──
  const params = {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', description: 'status 环境状态 / open 打开或新建项目 / projects 项目列表 / look 自检 / canvas 读画板（指着说的节点清单）/ canvas-apply 改画板 / render 开始渲染 / render-status 查渲染进度', enum: ['status', 'open', 'projects', 'look', 'canvas', 'canvas-apply', 'render', 'render-status'] },
      name: { type: 'string', description: 'open：新影片的名字（在插件项目库里建文件夹）；也可用于其他 action 代替 folder 按名字找项目' },
      folder: { type: 'string', description: '已有项目的绝对路径，或项目库里的目录名' },
      steps: { type: 'string', description: 'canvas-apply 的画板步骤，JSON 数组字符串，如 [{"op":"add","kind":"note","text":"开场"}]，原子应用' },
      range: { type: 'string', description: '渲染区间，如 "2.5-8"' },
      fps: { type: 'number', description: '渲染帧率，默认 30' },
      out: { type: 'string', description: '渲染输出文件的绝对路径（默认项目目录下 <项目名>.mp4）' },
      jobId: { type: 'string', description: 'render 返回的任务 id，用于 render-status' },
    },
  }

  const openfilmTool = {
    name: 'openfilm',
    description: '编排本机的 OpenFilm AI 视频工具：探测环境、打开/新建影片项目（Studio 会切到它，DSH 侧栏面板里可看）、look 自检、把 film.html 渲染成 MP4（接入 DSH 后台任务面板）。做影片的具体方法先读 openfilm skill（或运行 openfilm skill edit / media）。',
    parameters: params,
    timeoutMs: 200_000,
    output: {
      schema: { type: 'object', additionalProperties: true, required: ['ok'], properties: { ok: { type: 'boolean' } } },
      render: (_args, value) => text(typeof value?.text === 'string' ? value.text : JSON.stringify(value, null, 2)),
    },
    async execute(args) {
      const unknown = Object.keys(args || {}).filter((key) => !(key in params.properties))
      if (unknown.length) throw new Error(`未知参数：${unknown.join(', ')}`)
      switch (args.action) {
        case 'status': {
          const status = await opStatus()
          return { ok: true, text: [
            `openfilm ${status.installed ? status.version : '未安装（npm i -g openfilm）'}`,
            `ffmpeg ${status.ffmpeg ? '已安装' : '未安装（brew install ffmpeg）'}`,
            `Studio ${status.studio.running ? `运行中 ${status.studio.base}` : '未运行'}${status.studio.app ? '（桌面版）' : ''}`,
            `Studio 聊天 ${status.studio.app ? (status.studio.dshCli ? '可用：桌面版 + DeepSeek Harness' : '桌面版已连接，但没找到 DSH 的 dsh 命令') : '需要 OpenFilm 桌面版（agent 聊天不在 npm CLI 版 Studio 里）'}`,
            `项目目录 ${status.projectsDir}`,
            `渲染任务 ${status.nativeJobs ? '接入 DSH 后台任务面板' : '插件内置（无 jobs 服务）'}`,
          ].join('\n'), ...status }
        }
        case 'open': {
          if (!args.name && !args.folder) throw new Error('open 需要 name 或 folder')
          const result = await opOpen(args)
          return { ok: true, text: `已打开：${result.projectPath}\nStudio：${result.studioUrl}\n侧栏面板已能预览；接下来读 openfilm 的 skill 再写 film.html。`, ...result }
        }
        case 'projects': {
          const result = opProjects()
          return { ok: true, text: result.projects.length ? result.projects.map((p) => `${p.name} → ${p.path}`).join('\n') : '项目库还是空的', ...result }
        }
        case 'look': {
          if (!args.folder && !args.name) throw new Error('look 需要 folder 或 name')
          const result = await opLook(args)
          return { ok: result.code === 0, text: result.output, ...result }
        }
        case 'canvas': {
          if (!args.folder && !args.name) throw new Error('canvas 需要 folder 或 name')
          const result = await opCanvas(args)
          return { ok: true, text: `画板（${result.project}）：\n${result.text}\n用户「指着」某个节点说需求时，按 id 或文字匹配上面这条；改画板用 action: canvas-apply。`, project: result.project, nodes: result.nodes, edges: result.edges }
        }
        case 'canvas-apply': {
          if (!args.folder && !args.name) throw new Error('canvas-apply 需要 folder 或 name')
          if (!args.steps) throw new Error('canvas-apply 需要 steps（JSON 数组）')
          const result = await opCanvasApply(args)
          return { ok: true, text: `${result.output}\n（用户在 Studio 里立刻能看到变化）` }
        }
        case 'render': {
          if (!args.folder && !args.name) throw new Error('render 需要 folder 或 name')
          const job = opRender(args)
          return { ok: true, text: `渲染已开始（任务 ${job.id}，DSH 任务面板可见）。\njob: ${job.id}\n用 action: render-status 查进度；完成后输出在 ${job.output}。`, job }
        }
        case 'render-status': {
          if (!args.jobId) throw new Error('render-status 需要 jobId')
          const job = opRenderStatus(args)
          const label = job.state === 'done' ? `渲染完成：${job.output}\njob: ${job.id}\noutput: ${job.output}`
            : job.state === 'cancelled' ? `渲染已取消（任务 ${job.id}）\njob: ${job.id}`
            : job.state === 'failed' ? `渲染失败（exit ${job.exitCode ?? '?'}）\n${job.log.slice(-1500)}\njob: ${job.id}`
            : `渲染中…${job.progress ? `\n${job.progress}` : ''}\n${job.log.slice(-800)}\njob: ${job.id}`
          return { ok: job.state !== 'failed', text: label, job }
        }
        default:
          throw new Error(`未知 action：${args.action}`)
      }
    },
  }
  ctx.effect(() => ctx.tools.register(openfilmTool), 'openfilm: tool')

  // ── skill 提供方 ──
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider()), 'openfilm: skill provider')

  // ── 环回路由（侧栏面板和对话卡片用） ──
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[openfilm] 当前 profile 没有 webServer，侧栏面板拿不到数据；工具仍然可用。')
    return
  }

  // connection 服务提供 DSH 的请求准入判定。必须懒取：client-connection 在 await 之后
  // 才 provide connection（与官方 open-in-app 在 handler 里 Reflect.get 同理），
  // 装载期取值会拿到 undefined。无 connection 的极老 profile 退回路由自带 Origin 检查。
  /** 未通过准入就作答请求；true 表示已回绝，调用方不再分发。 */
  function requestRejected(req, res) {
    let connection
    try { connection = ctx.get('connection') } catch { return false }
    if (!connection || typeof connection.requestRejection !== 'function') return false
    let rejection
    try { rejection = connection.requestRejection(req) } catch { rejection = 403 }
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  function sendJson(res, status, body) {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(payload)
  }

  function readJson(req, max = 64 * 1024) {
    return new Promise((resolveJson, rejectJson) => {
      if (req.method !== 'POST') return rejectJson(Object.assign(new Error('method not allowed'), { status: 405 }))
      const origin = req.headers.origin
      if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) {
        return rejectJson(Object.assign(new Error('cross-origin rejected'), { status: 403 }))
      }
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > max) { req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try { resolveJson(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
        catch (error) { rejectJson(Object.assign(error, { status: 400 })) }
      })
      req.on('error', rejectJson)
    })
  }

  const disposer = webServer.register({
    kind: 'prefix',
    path: API,
    handler: (req, res) => {
      // DSH 标准访问准入：webServer.register 的路由宿主不自动做 Host/Origin 检查，
      // 入口先过 connection.requestRejection（与官方 open-in-app 插件同款），401/403 直接短路。
      if (requestRejected(req, res)) return
      void (async () => {
        const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
        const rest = pathname.slice(API.length).replace(/^\/+/, '').split('?')[0]
        try {
          if (req.method === 'GET') {
            if (rest === 'status') return sendJson(res, 200, await opStatus())
            if (rest === 'projects') return sendJson(res, 200, opProjects())
            if (rest === 'studio') {
              const key = studioKey()
              const alive = key ? await studioAlive(base()) : false
              return sendJson(res, 200, { running: alive, base: base(), url: key ? `${base()}/open?key=${encodeURIComponent(key)}` : null })
            }
            if (rest.startsWith('render/')) {
              const id = decodeURIComponent(rest.slice('render/'.length))
              const record = renderRecords.get(id)
              if (!record) return sendJson(res, 404, { error: 'no such job' })
              return sendJson(res, 200, jobView(jobs, record))
            }
            if (rest.startsWith('thumb/')) {
              const id = decodeURIComponent(rest.slice('thumb/'.length))
              const record = renderRecords.get(id)
              const file = record?.thumb
              if (!file || !existsSync(file)) return sendJson(res, 404, { error: 'no thumb' })
              res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(statSync(file).size), 'cache-control': 'no-cache' })
              if (req.method === 'HEAD') return res.end()
              return createReadStream(file).pipe(res)
            }
            if (rest === 'sidechat') {
              return sendJson(res, 200, {
                available: Boolean(agentsService),
                images: Boolean(attachmentsService),
                agentStatus: typeof targetAgent()?.status === 'string' ? targetAgent().status : null,
                items: feed.slice(-80),
              })
            }
            return sendJson(res, 404, { error: 'not found' })
          }
          if (req.method === 'POST') {
            // 上限放到 20MB：面板聊天可以带 base64 截图
            const body = await readJson(req, 20 * 1024 * 1024)
            if (rest === 'open') {
              if (!body.name && !body.folder) return sendJson(res, 400, { error: 'name or folder required' })
              return sendJson(res, 200, { ok: true, ...(await opOpen(body)) })
            }
            if (rest === 'render') {
              if (!body.folder && !body.name) return sendJson(res, 400, { error: 'folder or name required' })
              return sendJson(res, 200, { ok: true, job: opRender(body) })
            }
            if (rest === 'render-cancel') {
              return sendJson(res, 200, { ok: true, result: opRenderCancel(body) })
            }
            if (rest === 'reveal') {
              return sendJson(res, 200, { ok: true, ...opReveal(body) })
            }
            if (rest === 'remove') {
              return sendJson(res, 200, { ok: true, ...(await opRemove(body)) })
            }
            if (rest === 'sidechat/send') {
              const text = typeof body.text === 'string' ? body.text.trim() : ''
              const images = Array.isArray(body.images) ? body.images : []
              if (!text && images.length === 0) return sendJson(res, 400, { error: 'text required' })
              return sendJson(res, 200, { ok: true, ...(await sidechatSend(text || '（看这张截图，帮我改这里）', images)) })
            }
            if (rest === 'sidechat/cancel') {
              return sendJson(res, 200, { ok: true, ...sidechatCancel() })
            }
            return sendJson(res, 404, { error: 'not found' })
          }
          if (req.method === 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return }
          sendJson(res, 405, { error: 'method not allowed' })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger?.warn?.(error instanceof Error ? error : new Error(message))
          sendJson(res, 400, { error: message })
        }
      })()
    },
  })
  ctx.effect(() => disposer, 'openfilm: api routes')

  // ── 面板小聊天：客户端 host.call 直连，消息注入当前 DSH 会话 ──
  // 转录缓冲（截尾保留最近的），事件流来自 agent/assistant-stream 与 durable 事件。
  const feed = []
  const pushFeed = (entry) => {
    feed.push({ at: Date.now(), ...entry })
    if (feed.length > 300) feed.splice(0, feed.length - 300)
  }

  let agentsService
  try {
    const candidate = ctx.get('agents')
    if (candidate && typeof candidate.list === 'function') agentsService = candidate
  } catch { /* 无 agents 服务的 profile：面板聊天禁用 */ }

  let attachmentsService
  try {
    const candidate = ctx.get('attachments')
    if (candidate && typeof candidate.saveImages === 'function') attachmentsService = candidate
  } catch { /* 无附件服务：面板只能发文字 */ }

  /** 目标 agent：优先最早注册的（根会话），没有则 undefined。 */
  function targetAgent() {
    if (!agentsService) return undefined
    const list = agentsService.list()
    return list.length ? list[0] : undefined
  }

  /** 构造符合 dsh-llm `UserMessage` 的完整消息（inject/followup 的入参必须是这个形态）。 */
  function makeUserMessage(content) {
    return {
      id: randomUUID(),
      role: 'user',
      content,
      source: { kind: 'user' },
    }
  }

  /** 把 {data: base64, mediaType, name} 存进 DSH 附件服务，返回可直接放进 content 的 image 块。 */
  async function saveImageBlocks(images) {
    if (!Array.isArray(images) || images.length === 0) return []
    if (!attachmentsService) throw new Error('当前 DSH 没有附件服务，发不了图片')
    const inputs = []
    for (const image of images.slice(0, 4)) {
      if (!image || typeof image.data !== 'string' || typeof image.mediaType !== 'string') continue
      const data = Buffer.from(image.data, 'base64')
      if (data.length < 64) continue
      if (data.length > 12 * 1024 * 1024) throw new Error('图片太大（超过 12MB）')
      inputs.push({ data: new Uint8Array(data), mediaType: image.mediaType, name: typeof image.name === 'string' ? image.name : undefined })
    }
    if (inputs.length === 0) return []
    const refs = await attachmentsService.saveImages(inputs)
    return refs.map((attachment) => ({ type: 'image', attachment }))
  }

  async function sidechatSend(text, images) {
    const agent = targetAgent()
    if (!agent) throw new Error('当前没有活跃的 DSH 会话可接收消息')
    const imageBlocks = await saveImageBlocks(images)
    const content = [{ type: 'text', text: `[OpenFilm 面板] ${text}` }]
    for (const block of imageBlocks) content.push(block)
    const message = makeUserMessage(content)
    // followup = next-turn + 唤醒驱动；steer = next-step + 唤醒；inject 不唤醒，只能垫底。
    // 注意：三者的入参都是完整 UserMessage 对象，传裸数组会写坏会话日志。
    let delivered = false
    for (const op of ['followup', 'steer', 'inject']) {
      if (typeof agent[op] !== 'function') continue
      try { agent[op](message); delivered = true; break } catch { /* 试下一个形态 */ }
    }
    if (!delivered) throw new Error('这个 DSH 版本的 agent 不支持面板注入消息')
    pushFeed({ role: 'user', text, imageCount: imageBlocks.length })
    return { sent: true, agentStatus: typeof agent.status === 'string' ? agent.status : 'unknown' }
  }

  function sidechatCancel() {
    const agent = targetAgent()
    if (!agent || typeof agent.cancel !== 'function') throw new Error('没有可停止的会话')
    agent.cancel({ kind: 'user' })
    pushFeed({ role: 'system', text: '已请求停止当前回合' })
    return { cancelled: true }
  }

  ctx.effect(() => {
    if (!agentsService) return () => {}
    const disposers = []
    // 真实事件契约：'agent/assistant-stream' 的载荷是 { agent, frame }，
    // 文本增量在 frame.type === 'chunk' 且 frame.chunk.type === 'text-delta' 的 frame.chunk.text。
    const onStream = (payload) => {
      try {
        if (!payload || typeof payload !== 'object' || payload.agent !== targetAgent()) return
        const frame = payload.frame
        if (!frame || frame.type !== 'chunk' || !frame.chunk || frame.chunk.type !== 'text-delta') return
        const delta = frame.chunk.text
        if (typeof delta !== 'string' || !delta) return
        const last = feed[feed.length - 1]
        if (last && last.role === 'assistant' && !last.done && Date.now() - last.at < 1500) {
          last.text += delta
          last.at = Date.now()
          if (last.text.length > 8000) last.text = last.text.slice(-8000)
        } else {
          if (last && last.role === 'assistant' && !last.done) last.done = true
          pushFeed({ role: 'assistant', text: delta, done: false })
        }
      } catch { /* 事件形态不同则忽略 */ }
    }
    // 'agent/status'（{ agent, status }）：回到 idle 说明回合结束，收掉未闭合的助手条目。
    const onStatus = (payload) => {
      try {
        if (!payload || payload.agent !== targetAgent()) return
        if (payload.status !== 'idle') return
        const last = feed[feed.length - 1]
        if (last && last.role === 'assistant' && !last.done) {
          last.done = true
          pushFeed({ role: 'system', text: '回合结束' })
        }
      } catch { /* 忽略 */ }
    }
    // 'tools/result' 的载荷是 (exec, result)：工具执行完成时记一条名字。
    const onToolResult = (exec) => {
      try {
        const name = exec?.name ?? exec?.tool?.name ?? 'tool'
        pushFeed({ role: 'tool', text: `${name}` })
      } catch { /* 忽略 */ }
    }
    for (const [name, listener] of [['agent/assistant-stream', onStream], ['agent/status', onStatus], ['tools/result', onToolResult]]) {
      try { disposers.push(ctx.on(name, listener)) } catch { /* 事件不存在 */ }
    }
    return () => { for (const dispose of disposers) { try { dispose() } catch { /* 忽略 */ } } }
  }, 'openfilm: sidechat event feed')

  ctx.provide?.('openfilm.sidechat', {
    status: () => ({ available: Boolean(agentsService), agentStatus: targetAgent()?.status ?? null }),
    send: sidechatSend,
    cancel: sidechatCancel,
    feed: () => ({ items: feed.slice(-80) }),
  })

  ctx.logger?.info?.(`[openfilm] 已装载：项目目录 ${cfg.projectsDir}${jobs ? '，渲染接入 DSH jobs' : ''}${agentsService ? '，面板聊天可用' : ''}`)
}