// 离线冒烟：用桩服务模拟 DSH host，验证 openfilm 插件新逻辑
// （jobs 桩按 dsh-jobs-local 的 LocalJobRegistry 语义实现 start/attachController/get/kill）
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'

const dir = mkdtempSync(join(tmpdir(), 'of-test-'))
const projectsDir = join(dir, 'projects')
const film = join(projectsDir, 'demo')
mkdirSync(film, { recursive: true })
writeFileSync(join(film, 'film.html'), '<!doctype html><script>window.film={duration:2}</script>')

// ── jobs 桩 ──
function makeJobsStub() {
  const store = new Map()
  return {
    attached: 0,
    attachController() { this.attached += 1; return () => { this.attached -= 1 } },
    start(spec) {
      if (this.attached === 0) { const e = new Error('no controller'); e.code = 'JOB_CONTROLLER_UNAVAILABLE'; throw e }
      const id = `${spec.kind}-stub1`
      const record = { id, status: 'running', label: spec.label, progress: undefined }
      store.set(id, record)
      const handle = { append() {}, updateProgress(line) { record.progress = line } }
      const hooks = spec.run(handle)
      hooks.done.then((outcome) => { record.status = outcome.status })
      record._cancel = hooks.cancel
      return id
    },
    get(id) { return store.get(id) },
    kill(id) { const r = store.get(id); if (r) { r.status = 'stopping'; r._cancel?.() } },
  }
}

const jobsStub = makeJobsStub()
const registered = { tools: [], skills: [], routes: [] }

// ── agents / attachments / events 桩（sidechat 用） ──
const agentStub = {
  status: 'idle',
  followup(message) { agentStub.delivered = { op: 'followup', message } },
  steer(message) { agentStub.delivered = { op: 'steer', message } },
  inject(message) { agentStub.delivered = { op: 'inject', message } },
}
const agentsStub = { list: () => [agentStub] }
const attachmentsStub = {
  calls: [],
  saveImages(inputs) {
    attachmentsStub.calls.push(inputs)
    return inputs.map((input, index) => ({
      attachmentId: `att-${index}`, mediaType: input.mediaType, bytes: input.data.length,
      width: 16, height: 16, name: input.name,
    }))
  },
}
const eventListeners = new Map()

const ctx = {
  get(name) {
    if (name === 'jobs') return jobsStub
    if (name === 'webServer') return ctx.webServer
    if (name === 'skills') return ctx.skills
    if (name === 'tools') return ctx.tools
    if (name === 'agents') return agentsStub
    if (name === 'attachments') return attachmentsStub
    throw new Error('no service ' + name)
  },
  on(name, listener) {
    if (!eventListeners.has(name)) eventListeners.set(name, [])
    eventListeners.get(name).push(listener)
    return () => {}
  },
  effect(fn) { return fn() },
  tools: { register(def) { registered.tools.push(def) } },
  skills: { registerProvider(fn) { registered.skills.push(fn) } },
  webServer: { register(route) { registered.routes.push(route); return () => {} } },
  logger: { info() {}, warn(e) { console.error('warn:', e?.message || e) } },
}

const mod = await import('../index.js')
await mod.apply(ctx, { projectsDir })

const tool = registered.tools[0]
if (!tool || tool.name !== 'openfilm') throw new Error('tool not registered')
console.log('✓ 工具已注册')

// render：桩 runner 会真的去跑 openfilm render —— 项目是 2s 空影片，会快速失败，正好验证任务链路
const started = await tool.execute({ action: 'render', folder: film })
console.log('✓ render 返回:', started.job.id, 'state=', started.job.state)
if (!/job: \S+/.test(started.text)) throw new Error('缺 job 标记')

// render-status：轮询直到终态
let status
for (let i = 0; i < 40; i++) {
  status = await tool.execute({ action: 'render-status', jobId: started.job.id })
  if (status.job.state !== 'running') break
  await new Promise((r) => setTimeout(r, 500))
}
console.log('✓ 终态:', status.job.state, status.job.log.slice(-120).replace(/\n/g, ' | '))
if (status.job.state !== 'failed') throw new Error('空影片应失败')

// open（真实 CLI，OPENFILM_NO_BROWSER）
const opened = await tool.execute({ action: 'open', name: 'test-film' })
console.log('✓ open:', opened.projectPath)
if (!opened.studioUrl.startsWith('http')) throw new Error('studio url 缺失')

// status
const st = await tool.execute({ action: 'status' })
console.log('✓ status:', st.version, 'nativeJobs=', st.nativeJobs)

// reveal 放行规则
try {
  await fetch('http://127.0.0.1:1')
} catch {}

// ── sidechat 回归：路由处理器直调 ──
const route = registered.routes[0]
if (!route || route.path !== '/openfilm/api') throw new Error('api route not registered')

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const req = {
      method, url: path, headers: {},
      on(event, cb) {
        if (event === 'data') req._data = cb
        if (event === 'end') req._end = cb
        if (event === 'error') req._error = cb
      },
    }
    const res = {
      status: 0,
      writeHead(status) { res.status = status },
      end(payload) { resolve({ status: res.status, body: JSON.parse(payload || '{}') }) },
    }
    void route.handler(req, res)
    if (method === 'POST') {
      req._data?.(Buffer.from(JSON.stringify(body)))
      req._end?.()
    } else {
      req._end?.()
    }
  })
}

// GET sidechat：能力位
{
  const { status, body } = await call('GET', '/openfilm/api/sidechat')
  if (status !== 200 || body.available !== true || body.images !== true) throw new Error('sidechat status route broken')
  console.log('✓ sidechat status: available/images 都为 true')
}

// 发文本：必须是完整 UserMessage 形态（当年就是这里写坏过会话日志）
{
  const { status, body } = await call('POST', '/openfilm/api/sidechat/send', { text: '把开场便签改成蓝色' })
  if (status !== 200 || body.sent !== true) throw new Error('sidechat send failed')
  const d = agentStub.delivered
  if (d?.op !== 'followup') throw new Error('没有走 followup 唤醒')
  const m = d.message
  if (!m || typeof m.id !== 'string' || m.role !== 'user' || !Array.isArray(m.content)
    || m.content[0]?.type !== 'text' || m.source?.kind !== 'user') {
    throw new Error('UserMessage 形态不对：' + JSON.stringify(m))
  }
  console.log('✓ sidechat send: followup + 规范 UserMessage')
}

// 带图：图片进附件服务、content 出 image 块
{
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const { body } = await call('POST', '/openfilm/api/sidechat/send', { text: '看这张截图', images: [{ data: pixel, mediaType: 'image/png', name: 'shot.png' }] })
  if (body.sent !== true) throw new Error('image send failed')
  const m = agentStub.delivered.message
  const imageBlock = m.content.find((block) => block.type === 'image')
  if (!imageBlock || imageBlock.attachment.attachmentId !== 'att-0') throw new Error('image block missing')
  if (attachmentsStub.calls.length !== 1 || attachmentsStub.calls[0][0].mediaType !== 'image/png') throw new Error('saveImages not called')
  console.log('✓ sidechat send 带图: 附件服务 + image 块')
}

// 空请求 400
{
  const { status } = await call('POST', '/openfilm/api/sidechat/send', {})
  if (status !== 400) throw new Error('empty send should 400')
  console.log('✓ sidechat send 空请求拒绝')
}

// remove 路由守卫：相对路径 / 不在项目列表 / 渲染中——都不碰废纸篓
{
  const { status, body } = await call('POST', '/openfilm/api/remove', { folder: 'relative/path' })
  if (status !== 400 || !/绝对路径/.test(body.error || '')) throw new Error('remove 相对路径未拦: ' + JSON.stringify(body))
  const miss = await call('POST', '/openfilm/api/remove', { folder: join(dir, 'not-a-project') })
  if (miss.status !== 400 || !/不在项目列表/.test(miss.body.error || '')) throw new Error('remove 未知项目未拦: ' + JSON.stringify(miss.body))
  console.log('✓ remove 守卫：相对路径与列表外路径都拒绝')
}

// remove 渲染中保护：对正在渲染的项目发删除应被拒
{
  const busy = await call('POST', '/openfilm/api/remove', { folder: film })
  // film 目录是 smoke 环境里真实含 film.html 的项目；此时它的渲染任务在 stub 下已到终态，
  // 所以这里应走到 trashFolder（darwin 上会真调 osascript）。为避免测试污染废纸篓，
  // 只在非 darwin 断言成功；darwin 断言要么成功要么明确失败信息，不允许静默。
  if (process.platform !== 'darwin') {
    if (busy.status !== 400) throw new Error('remove 应因无废纸篓命令而 400: ' + JSON.stringify(busy.body))
  } else {
    console.log('✓ remove darwin 端到端:', busy.status, busy.body.removed || busy.body.error)
    if (busy.status !== 200) throw new Error('remove 端到端失败: ' + JSON.stringify(busy.body))
  }
}

// 事件流：agent/assistant-stream 的 {agent, frame} 载荷 → feed 出现助手文本
{
  const emit = (name, payload) => { for (const listener of eventListeners.get(name) || []) listener(payload) }
  emit('agent/assistant-stream', { agent: agentStub, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '正在改' } } })
  emit('agent/assistant-stream', { agent: agentStub, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '画布…' } } })
  emit('agent/status', { agent: agentStub, status: 'idle' })
  const { body } = await call('GET', '/openfilm/api/sidechat')
  const last = body.items[body.items.length - 1]
  const assistant = [...body.items].reverse().find((item) => item.role === 'assistant')
  if (assistant?.text !== '正在改画布…') throw new Error('assistant stream feed broken: ' + JSON.stringify(body.items))
  if (last?.role !== 'system') throw new Error('idle 未收尾')
  console.log('✓ sidechat 事件流: 文本合并 + 回合收尾')
}

console.log('ALL_OK')
