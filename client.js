/**
 * dsh-openfilm — Client 半边。
 *
 * 1. 侧栏面板「OpenFilm」（main slot, key: 'openfilm'）+ 侧栏图标
 *    （sidebar.panellist）：环境状态、项目列表、新建影片、内嵌 Studio、
 *    渲染进度（含取消）。
 * 2. 对话内成果卡片（tool.call.toolview, key: 'openfilm'）：openfilm 工具
 *    调用在聊天流里的专属卡片——渲染进度、封面帧、打开 MP4 / Studio 按钮。
 * 数据全部来自 Host 的 /openfilm/api/* 环回路由。
 */
window.__ModuleLoader__.load({
  id: 'dsh-openfilm',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const PANEL_ID = 'openfilm';
    const API = '/openfilm/api';
    const NS = 'openfilm';

    const dict = {
      zh: {
        panel: 'OpenFilm',
        subtitle: 'AI 视频工坊',
        refresh: '刷新',
        openExternal: '在浏览器打开',
        notInstalled: '本机还没装 openfilm，先在终端运行：npm i -g openfilm（渲染还需要 ffmpeg）',
        ffmpegMissing: '缺少 ffmpeg：brew install ffmpeg',
        newFilm: '新影片名字',
        create: '新建并打开',
        projects: '项目',
        noProjects: '还没有影片项目',
        open: '打开',
        render: '渲染 MP4',
        rendering: '渲染中…',
        cancel: '取消',
        cancelling: '正在取消…',
        cancelled: '已取消',
        renderDone: '渲染完成',
        renderFailed: '渲染失败',
        openInStudio: '在 Studio 中编辑',
        back: '← 项目列表',
        studioClosed: 'Studio 未运行',
        chatDesktop: 'Studio 里的 AI 聊天需要 OpenFilm 桌面版（它会自动发现 DeepSeek Harness 并接成聊天 agent）',
        chatTitle: '跟 DSH 说（指着面板里的东西）',
        chatEmpty: '在这里对着画布/影片下指令：比如「画布上那个『开场』便签改一下」。回复和工作过程会显示在这里，也会进主对话。',
        chatPlaceholder: '指着说：那个便签/第几秒那段…（Enter 发送）',
        chatMic: '按一下开始说话，再按一下结束并转写',
        chatAttach: '附截图（也可直接粘贴或拖进来）',
        chatImageRemove: '移除这张图',
        chatImageLimit: '一次最多 4 张图',
        chatImageTooBig: '图片超过 12MB',
        chatImageFailed: '读取图片失败',
        chatSend: '发送',
        chatStop: '停止',
        chatReady: 'Studio 聊天：DeepSeek Harness 已可连接（桌面版）',
        chatNeedDsh: 'OpenFilm 桌面版已连接，但没找到 DSH 的 dsh 命令',
        chatDownload: '下载 OpenFilm 桌面版',
        loading: '加载中…',
        // 卡片
        cardRender: '渲染影片',
        cardOpen: '打开影片项目',
        cardStatus: '查看状态',
        cardLook: '自检',
        cardProjects: '项目列表',
        cardShow: '在 Finder 中显示',
        cardOpenStudio: '打开 Studio',
        cardOpenMp4: '打开 MP4',
      },
      en: {
        panel: 'OpenFilm',
        subtitle: 'AI video studio',
        refresh: 'Refresh',
        openExternal: 'Open in browser',
        notInstalled: 'openfilm is not installed. Run: npm i -g openfilm (ffmpeg needed for rendering)',
        ffmpegMissing: 'ffmpeg missing: brew install ffmpeg',
        newFilm: 'New film name',
        create: 'Create & open',
        projects: 'Projects',
        noProjects: 'No film projects yet',
        open: 'Open',
        render: 'Render MP4',
        rendering: 'Rendering…',
        cancel: 'Cancel',
        cancelling: 'Cancelling…',
        cancelled: 'Cancelled',
        renderDone: 'Render finished',
        renderFailed: 'Render failed',
        openInStudio: 'Edit in Studio',
        back: '← Projects',
        studioClosed: 'Studio is not running',
        chatDesktop: 'AI chat inside Studio needs the OpenFilm desktop app (it finds DeepSeek Harness and connects it as a chat agent)',
        chatTitle: 'Talk to DSH (point at things in the panel)',
        chatEmpty: 'Give orders about the canvas/film here, e.g. "change the Opening note on the canvas". Replies and work steps show here too, and land in the main chat.',
        chatPlaceholder: 'Point and say: that note / second 8… (Enter to send)',
        chatMic: 'Tap to talk, tap again to transcribe',
        chatAttach: 'Attach a screenshot (or paste / drop it)',
        chatImageRemove: 'Remove image',
        chatImageLimit: 'Up to 4 images at a time',
        chatImageTooBig: 'Image over 12MB',
        chatImageFailed: 'Failed to read image',
        chatSend: 'Send',
        chatStop: 'Stop',
        chatReady: 'Studio chat: DeepSeek Harness ready (desktop app)',
        chatNeedDsh: 'OpenFilm desktop app connected, but the DSH dsh command was not found',
        chatDownload: 'Get the OpenFilm desktop app',
        loading: 'Loading…',
        cardRender: 'Render film',
        cardOpen: 'Open film project',
        cardStatus: 'Check status',
        cardLook: 'Self-check',
        cardProjects: 'Projects',
        cardShow: 'Reveal in Finder',
        cardOpenStudio: 'Open Studio',
        cardOpenMp4: 'Open MP4',
      },
    };

    function FilmIcon({ size = 18 }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('path', { d: 'M3.5 8.5 20 6.2l.4 2.8L4 11.3z' }),
        h('rect', { x: '3.5', y: '10.5', width: '17', height: '9.5', rx: '1.5' }),
        h('path', { d: 'm9.5 6.9 .3 2M15 6.1l.3 2' }),
        h('path', { d: 'M11 13.2 15 15.2 11 17.2z', fill: 'currentColor', stroke: 'none' }),
      );
    }

    const btn = {
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px',
      fontSize: 12, color: 'var(--dsw-alias-label-secondary)', background: 'transparent',
      border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
    };
    const primaryBtn = {
      ...btn, color: 'var(--dsw-alias-accent-text, inherit)',
      borderColor: 'var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))',
    };

    async function api(path, options) {
      const response = await fetch(API + path, {
        ...options,
        headers: options && options.body ? { 'content-type': 'application/json' } : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }

    /** 渲染任务状态徽标 + 进度条（面板和卡片共用）。 */
    function RenderStatus({ job, t, onCancel }) {
      const running = job.state === 'running' || job.state === 'cancelling'
      const tone = job.state === 'done' ? 'var(--dsw-alias-label-success, #34a853)'
        : job.state === 'failed' || job.state === 'cancelled' ? 'var(--dsw-alias-label-danger, #d93025)'
        : 'var(--dsw-alias-label-secondary)'
      const label = job.state === 'done' ? `✓ ${t('renderDone')}`
        : job.state === 'failed' ? `✗ ${t('renderFailed')}`
        : job.state === 'cancelled' ? t('cancelled')
        : job.state === 'cancelling' ? t('cancelling')
        : t('rendering')
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: tone } },
          h('span', null, label),
          job.progress ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, job.progress) : h('span', { style: { flex: 1 } }),
          running && onCancel ? h('button', { type: 'button', style: btn, onClick: onCancel }, t('cancel')) : null,
        ),
        running ? h('div', {
          'aria-hidden': true,
          style: { height: 3, borderRadius: 2, background: 'var(--dsw-alias-border-l1)', overflow: 'hidden' },
        }, h('div', {
          style: {
            width: '38%', height: '100%', borderRadius: 2,
            background: 'var(--dsw-alias-accent-solid, var(--dsw-alias-label-secondary))',
            animation: 'openfilm-indet 1.2s ease-in-out infinite alternate',
          },
        })) : null,
        h('style', null, '@keyframes openfilm-indet{from{transform:translateX(-60%)}to{transform:translateX(160%)}}'),
      )
    }

    // ── 面板小聊天：与当前 DSH 会话同源，看工作过程、打字/语音发指令 ──
    function SideChatBar({ t }) {
      const [open, setOpen] = useState(false)
      const [items, setItems] = useState([])
      const [agentStatus, setAgentStatus] = useState(null)
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [micOn, setMicOn] = useState(false)
      const [recording, setRecording] = useState(false)
      const [images, setImages] = useState([])
      const recorder = useRef(null)
      const fileInput = useRef(null)
      const scrollBox = useRef(null)
      const polling = useRef(false)

      const poll = useCallback(async () => {
        if (polling.current) return
        polling.current = true
        try {
          const data = await api('/sidechat')
          setItems(data.items || [])
          setAgentStatus(data.agentStatus)
        } catch { /* 下轮再试 */ }
        finally { polling.current = false }
      }, [])

      useEffect(() => {
        if (!open) return undefined
        void poll()
        const timer = setInterval(() => { void poll() }, 1200)
        return () => clearInterval(timer)
      }, [open, poll])

      useEffect(() => {
        if (scrollBox.current) scrollBox.current.scrollTop = scrollBox.current.scrollHeight
      }, [items])

      useEffect(() => {
        // 语音输入：探测 dsh-voice-polish 的环回路由（装了才显示麦克风）
        fetch('/api/voice-polish/status').then((r) => setMicOn(r.ok)).catch(() => setMicOn(false))
      }, [])

      async function send() {
        const value = text.trim()
        if ((!text.trim() && images.length === 0) || busy) return
        setBusy(true); setError(null)
        try {
          await api('/sidechat/send', {
            method: 'POST',
            body: JSON.stringify({
              text: value,
              images: images.map((image) => ({ data: image.data, mediaType: image.mediaType, name: image.name })),
            }),
          })
          setText('')
          setImages([])
          void poll()
        } catch (e) { setError(e.message) }
        finally { setBusy(false) }
      }

      /** 读取一张图：File/Blob → {data: base64, mediaType, name, preview: dataURL}。 */
      async function addImageFile(file) {
        if (!file || !String(file.type || '').startsWith('image/')) return
        if (images.length >= 4) { setError(t('chatImageLimit')); return }
        if (file.size > 12 * 1024 * 1024) { setError(t('chatImageTooBig')); return }
        try {
          const buffer = await file.arrayBuffer()
          const bytes = new Uint8Array(buffer)
          const data = toBase64(bytes)
          setImages((current) => [...current, {
            data,
            mediaType: file.type,
            name: file.name || `screenshot.${file.type.split('/')[1] || 'png'}`,
            preview: `data:${file.type};base64,${data}`,
          }])
        } catch (e) { setError(`${t('chatImageFailed')}: ${e.message}`) }
      }

      function onPaste(event) {
        const items = event.clipboardData && event.clipboardData.items
        if (!items) return
        for (const item of items) {
          if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
            const file = item.getAsFile()
            if (file) { event.preventDefault(); void addImageFile(file) }
          }
        }
      }

      function onDrop(event) {
        const files = event.dataTransfer && event.dataTransfer.files
        if (!files || !files.length) return
        let took = false
        for (const file of files) {
          if (String(file.type || '').startsWith('image/')) { took = true; void addImageFile(file) }
        }
        if (took) event.preventDefault()
      }

      async function startRecording() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
          const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
          recorder.current = rec
          const chunks = []
          rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
          rec.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop())
            setRecording(false)
            try {
              const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
              const buffer = await blob.arrayBuffer()
              const pcm = await webmToPcm16k(buffer)
              const response = await fetch('/api/voice-polish/dictate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ audioBase64: toBase64(new Uint8Array(pcm)) }),
              })
              const data = await response.json()
              if (data && data.polished) setText((current) => (current ? `${current} ${data.polished}` : data.polished))
              else if (data && data.raw) setText((current) => (current ? `${current} ${data.raw}` : data.raw))
              else if (data && data.error) setError(data.error)
            } catch (e) { setError(`语音转写失败：${e.message}`) }
          }
          rec.start()
          setRecording(true)
        } catch (e) { setError(`麦克风不可用：${e.message}`) }
      }

      function stopRecording() {
        if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
      }

      const running = agentStatus === 'running'

      return h('div', {
        style: { flex: 'none', borderTop: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', display: 'flex', flexDirection: 'column' },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' } },
          h('button', {
            type: 'button', style: { ...btn, flex: 1, justifyContent: 'center' },
            onClick: () => setOpen((value) => !value),
          }, open ? `▾ ${t('chatTitle')}` : `▴ ${t('chatTitle')}`),
          running ? h('button', {
            type: 'button', style: btn,
            onClick: () => { void api('/sidechat/cancel', { method: 'POST', body: JSON.stringify({}) }).catch(() => {}) },
          }, t('chatStop')) : null,
        ),
        open ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px 10px' } },
          h('div', {
            ref: scrollBox,
            style: {
              height: 180, overflowY: 'auto', borderRadius: 8, padding: 8,
              background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)',
              fontSize: 12, lineHeight: 1.5,
            },
          },
            items.length === 0 ? h('div', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, t('chatEmpty')) : null,
            ...items.map((item, index) => h('div', { key: index, style: { marginBottom: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
              item.role === 'user' ? h('div', { style: { color: 'var(--dsw-alias-label-primary)' } }, `🧑 ${item.imageCount ? `[${item.imageCount}🖼] ` : ''}${item.text}`) :
              item.role === 'assistant' ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, `${item.done === false ? '⏳ ' : '🤖 '}${item.text}${item.done === false ? '▍' : ''}`) :
              item.role === 'tool' ? h('div', { style: { color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace, monospace', fontSize: 11 } }, `⚙ ${item.text}`) :
              h('div', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, `· ${item.text}`),
            )),
          ),
          error ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, error) : null,
          images.length ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 2 } },
            ...images.map((image, index) => h('div', { key: index, style: { position: 'relative' } },
              h('img', { src: image.preview, alt: image.name, style: { height: 44, width: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)' } }),
              h('button', {
                type: 'button', 'aria-label': t('chatImageRemove'),
                style: { position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 10, lineHeight: '16px', padding: 0, textAlign: 'center', color: '#fff', background: 'rgba(0,0,0,.65)' },
                onClick: () => setImages((current) => current.filter((_, i) => i !== index)),
              }, '✕'),
            )),
          ) : null,
          h('div', { style: { display: 'flex', gap: 6 } },
            h('textarea', {
              value: text,
              placeholder: t('chatPlaceholder'),
              rows: 2,
              onChange: (event) => setText(event.target.value),
              onPaste,
              onDrop,
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
              },
              style: {
                flex: 1, minWidth: 0, resize: 'none', padding: '6px 9px', fontSize: 12,
                color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)',
                border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, outline: 'none',
                fontFamily: 'inherit',
              },
            }),
            h('input', {
              ref: fileInput, type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' },
              onChange: (event) => {
                for (const file of event.target.files || []) void addImageFile(file)
                event.target.value = ''
              },
            }),
            h('button', {
              type: 'button', style: btn, title: t('chatAttach'), 'aria-label': t('chatAttach'),
              onClick: () => fileInput.current && fileInput.current.click(),
            }, '📎'),
            micOn ? h('button', {
              type: 'button', style: recording ? { ...primaryBtn, color: '#d93025' } : btn,
              title: t('chatMic'), 'aria-label': t('chatMic'),
              onClick: () => (recording ? stopRecording() : void startRecording()),
            }, recording ? '●' : '🎙') : null,
            h('button', { type: 'button', style: primaryBtn, disabled: busy || (!text.trim() && images.length === 0), onClick: () => void send() }, t('chatSend')),
          ),
        ) : null,
      )
    }

    /** MediaRecorder 的 webm/opus 转 16k 单声道 PCM WAV（voice-polish 只吃这个格式）。 */
    async function webmToPcm16k(buffer) {
      const audioContext = new AudioContext({ sampleRate: 16000 })
      try {
        const decoded = await audioContext.decodeAudioData(buffer)
        const channel = decoded.getChannelData(0)
        const data = new Uint8Array(44 + channel.length * 2)
        // 关键：DataView 必须罩住整段缓冲（头 + 采样）；只罩 44 字节头会在写采样时越界抛 RangeError。
        const view = new DataView(data.buffer)
        const writeString = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)) }
        writeString(0, 'RIFF'); view.setUint32(4, 36 + channel.length * 2, true); writeString(8, 'WAVE')
        writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
        view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
        writeString(36, 'data'); view.setUint32(40, channel.length * 2, true)
        let offset = 44
        for (let i = 0; i < channel.length; i += 1) {
          const sample = Math.max(-1, Math.min(1, channel[i]))
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
          offset += 2
        }
        return data.buffer
      } finally { void audioContext.close() }
    }

    /** 分块 base64：长录音/大图一次性展开会撑爆调用栈。 */
    function toBase64(bytes) {
      let binary = ''
      const step = 0x8000
      for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
      return btoa(binary)
    }

    // ── 侧栏面板 ────────────────────────────────────────────
    function OpenFilmPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => dict.zh[key];
      const [status, setStatus] = useState(null);
      const [projects, setProjects] = useState([]);
      const [active, setActive] = useState(null); // { studioUrl, projectPath, name }
      const [newName, setNewName] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [job, setJob] = useState(null); // jobView
      const jobTimer = useRef(null);

      const refresh = useCallback(async () => {
        try {
          const [nextStatus, nextProjects] = await Promise.all([api('/status'), api('/projects')]);
          setStatus(nextStatus);
          setProjects(nextProjects.projects || []);
          setError(null);
        } catch (e) { setError(e.message); }
      }, []);

      useEffect(() => { void refresh(); }, [refresh]);

      useEffect(() => {
        if (!job || (job.state !== 'running' && job.state !== 'cancelling')) return undefined;
        jobTimer.current = setInterval(async () => {
          try { setJob(await api(`/render/${encodeURIComponent(job.id)}`)); } catch { /* 下轮再试 */ }
        }, 2000);
        return () => clearInterval(jobTimer.current);
      }, [job && job.id, job && job.state]);

      async function openFilm(name, folder) {
        setBusy(true); setError(null);
        try {
          const result = await api('/open', { method: 'POST', body: JSON.stringify({ name, folder }) });
          setActive({
            studioUrl: result.studioUrl,
            projectPath: result.projectPath,
            name: name || (result.projectPath || '').split('/').pop(),
          });
          await refresh();
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
      }

      async function startRender(folder) {
        setBusy(true); setError(null); setJob(null);
        try { setJob((await api('/render', { method: 'POST', body: JSON.stringify({ folder }) })).job); }
        catch (e) { setError(e.message); }
        finally { setBusy(false); }
      }

      async function cancelRender() {
        if (!job) return;
        try { setJob((await api('/render-cancel', { method: 'POST', body: JSON.stringify({ jobId: job.id }) })).result); }
        catch { /* 下轮轮询会看到终态 */ }
      }

      // ── Studio 视图 ──
      if (active) {
        return h('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-base)' } },
          h('div', {
            style: {
              flex: 'none', display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 12px',
              borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
            },
          },
            h('button', { type: 'button', style: btn, onClick: () => { setActive(null); setJob(null); } }, t('back')),
            h('span', { style: { fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, active.name || 'film'),
            h('span', { style: { flex: 1 } }),
            job && (job.state === 'running' || job.state === 'cancelling') ? null
              : h('button', { type: 'button', style: primaryBtn, disabled: busy, onClick: () => void startRender(active.projectPath) }, t('render')),
            h('button', {
              type: 'button', style: btn, title: t('openExternal'),
              onClick: () => window.open(active.studioUrl, '_blank', 'noopener'),
            }, '⧉'),
          ),
          job ? h('div', {
            style: {
              flex: 'none', padding: '8px 12px',
              borderBottom: '1px solid var(--dsw-alias-border-l1)',
              maxHeight: 110, overflowY: 'auto',
            },
          },
            h(RenderStatus, { job, t, onCancel: cancelRender }),
            job.state === 'done' && job.thumb ? h('img', { src: job.thumb, alt: '', style: { marginTop: 6, width: '100%', borderRadius: 6, display: 'block' } }) : null,
            job.state === 'failed' ? h('pre', { style: { margin: '4px 0 0', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' } }, (job.log || '').slice(-700)) : null,
          ) : null,
          h('iframe', {
            src: active.studioUrl,
            title: 'OpenFilm Studio',
            style: { flex: 1, width: '100%', minHeight: 0, border: 'none', display: 'block', background: 'var(--dsw-alias-bg-base)' },
          }),
          h(SideChatBar, { t }),
        );
      }

      // ── 项目列表视图 ──
      return h('div', {
        style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' },
      },
        h('div', {
          style: {
            flex: 'none', display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 12px',
            borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
          },
        },
          h('span', { style: { fontWeight: 700, letterSpacing: '.08em', fontSize: 13 } }, 'OPENFILM'),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('subtitle')),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: btn, onClick: () => void refresh() }, '⟳ ', t('refresh')),
        ),
        h('div', { style: { flex: '1 1 0', minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
          error ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, error) : null,
          !status ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('loading'))
          : [
            h('div', { key: 'status', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', display: 'flex', flexDirection: 'column', gap: 2 } },
              h('span', null, `${status.installed ? `openfilm ${status.version}` : 'openfilm ✗'}`),
              status.installed && !status.ffmpeg ? h('span', null, t('ffmpegMissing')) : null,
              !status.installed ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, t('notInstalled')) : null,
              status.installed && !status.studio.running ? h('span', null, t('studioClosed')) : null,
              status.installed && status.studio.app
                ? h('span', null, status.studio.dshCli ? `✓ ${t('chatReady')}` : t('chatNeedDsh'))
                : status.installed ? h('span', null,
                    `${t('chatDesktop')} `,
                    h('a', {
                      href: 'https://github.com/openfilm/openfilm/releases',
                      target: '_blank', rel: 'noopener noreferrer',
                      style: { color: 'inherit', textDecoration: 'underline' },
                    }, t('chatDownload')),
                  ) : null,
            ),
            status.installed ? h('div', {
              key: 'new', style: { display: 'flex', gap: 8 },
            },
              h('input', {
                value: newName,
                placeholder: t('newFilm'),
                onChange: (event) => setNewName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && newName.trim() && !busy) void openFilm(newName.trim());
                },
                style: {
                  flex: 1, minWidth: 0, height: 30, padding: '0 9px', fontSize: 12,
                  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)',
                  border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, outline: 'none',
                },
              }),
              h('button', {
                type: 'button', style: primaryBtn, disabled: busy || !newName.trim(),
                onClick: () => void openFilm(newName.trim()),
              }, t('create')),
            ) : null,
            status.installed && projects.length ? h('div', {
              key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 4 },
            },
              h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } }, t('projects')),
              ...projects.map((project) => h('div', {
                key: project.path,
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
                  background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8,
                },
              },
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, project.name),
                  h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, project.path),
                ),
                h('button', {
                  type: 'button', style: primaryBtn, disabled: busy,
                  title: t('openInStudio'),
                  onClick: () => void openFilm(null, project.path),
                }, t('open')),
              )),
            ) : status.installed ? h('div', { key: 'empty', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('noProjects')) : null,
          ],
        ),
      );
    }

    // ── 对话内卡片：openfilm 工具调用的专属视图 ──────────────
    function blockArgs(block) {
      const args = block && block.args
      if (args && typeof args.complete === 'function') {
        const out = {}
        for (const key of ['action', 'name', 'folder', 'range', 'jobId']) {
          try { if (args.complete(key)) out[key] = args.text(key) } catch { /* skip */ }
        }
        return out
      }
      return args && typeof args === 'object' ? args : {}
    }

    function blockText(block) {
      const content = block && block.content
      if (!Array.isArray(content)) return ''
      return content.filter((part) => part && part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')
    }

    function OpenFilmToolRow(props) {
      const block = props.block
      const args = blockArgs(block)
      const text = blockText(block)
      const t = (key) => dict.zh[key] // 卡片文案：跟随浏览器语言可再扩展
      const jobId = (text.match(/^job: (\S+)$/m) || [])[1]
      const output = (text.match(/^output: (\S+)$/m) || [])[1]
      const [job, setJob] = useState(null)

      useEffect(() => {
        if (!jobId) return undefined
        let stop = false
        let timer = null
        const poll = async () => {
          try {
            const next = await api(`/render/${encodeURIComponent(jobId)}`)
            if (stop) return
            setJob(next)
            if (next.state !== 'running' && next.state !== 'cancelling') return
          } catch { /* 下轮再试 */ }
          if (!stop) timer = setTimeout(poll, 2500)
        }
        void poll()
        return () => { stop = true; if (timer) clearTimeout(timer) }
      }, [jobId])

      const action = args.action || ''
      const title = action === 'render' || action === 'render-status' ? t('cardRender')
        : action === 'open' ? t('cardOpen')
        : action === 'look' ? t('cardLook')
        : action === 'projects' ? t('cardProjects')
        : action === 'status' ? t('cardStatus')
        : 'OpenFilm'
      const summary = args.name || args.folder || (job && job.project ? job.project.split('/').pop() : '') || ''
      const isError = Boolean(block && block.isError)
      const state = job ? job.state : (isError ? 'failed' : null)

      async function reveal(path) {
        try { await api('/reveal', { method: 'POST', body: JSON.stringify({ path }) }) } catch { /* 忽略 */ }
      }
      async function openStudio() {
        try {
          const studio = await api('/studio')
          if (studio.url) window.open(studio.url, '_blank', 'noopener')
        } catch { /* 忽略 */ }
      }

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px',
          background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 10, color: 'var(--dsw-alias-label-primary)',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { display: 'inline-flex', color: 'var(--dsw-alias-label-secondary)' } }, h(FilmIcon, { size: 16 })),
          h('span', { style: { fontWeight: 600, fontSize: 13 } }, title),
          summary ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, summary) : null,
        ),
        text && !jobId ? h('pre', {
          style: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', maxHeight: 120, overflowY: 'auto' },
        }, text) : null,
        jobId && job ? h(RenderStatus, { job, t }) : null,
        job && job.state === 'done'
          ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
              job.thumb ? h('img', { src: job.thumb, alt: '', style: { width: 128, borderRadius: 6, display: 'block', flex: 'none' } }) : null,
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
                (job.output || output) ? h('button', { type: 'button', style: primaryBtn, onClick: () => void reveal(job.output || output) }, t('cardShow')) : null,
                h('button', { type: 'button', style: btn, onClick: () => void openStudio() }, t('cardOpenStudio')),
              ),
            )
          : null,
        state === 'failed' && job ? h('pre', {
          style: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', maxHeight: 110, overflowY: 'auto' },
        }, (job.log || '').slice(-600)) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = Object.entries(dict).map(([locale, d]) => ctx.locale.register(NS, locale, d));
          return () => { for (const dispose of disposers) dispose(); };
        }, 'openfilm: dictionaries');

        const t = ctx.locale.bind(NS);

        ctx.effect(() => {
          const disposePanel = ctx.slots.inject('main', () =>
            ctx.slots.register(
              { name: 'main', key: PANEL_ID, locale: NS, label: () => t('panel') },
              (props) => h(OpenFilmPanel, { ...props, t }),
            ));
          const disposeIcon = ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 13, locale: NS, label: () => t('panel') },
              FilmIcon,
            ));
          const disposeToolview = ctx.slots.inject('tool.call.toolview', () =>
            ctx.slots.register(
              { name: 'tool.call.toolview', key: 'openfilm' },
              OpenFilmToolRow,
            ));
          return () => {
            disposeToolview();
            disposeIcon();
            disposePanel();
          };
        }, 'openfilm: panel + sidebar icon + toolview');
      },
    };
  },
});
