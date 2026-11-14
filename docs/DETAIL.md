# OpenFilm 视频工坊（dsh-openfilm · 临时名）

在 DeepSeek Harness 里做 AI 视频：agent 按 [OpenFilm](https://www.npmjs.com/package/openfilm) 的规范把影片写成 `film.html`（每个镜头都是一个网页，画时刻 t），你在侧栏「OpenFilm」面板里内嵌的 Studio 中实时观看、随时手改，最后一键本地渲染导出 MP4。

## 功能

- **openfilm 工具**（模型可调）：`status` 环境探测、`open` 新建/打开项目、`projects` 列表、`look` 自检、`canvas` / `canvas-apply` 读改画板、`render` 后台渲染、`render-status` 查进度。
- **面板小聊天**：Studio 视图底部一个可折叠对话条——打字或按麦克风说话（语音转写复用 dsh-voice-polish，装了才显示麦克风），消息直接进入当前 DSH 会话；DSH 的回复和工具操作过程实时流回这个对话条。看片在 Studio、说话在面板，不用切窗口。
- **指着说（全程在 DSH 对话里）**：你在侧栏面板的 Studio 里看片、看画布，在对话里（主聊天或面板小聊天）指「画布上那个写着『开场』的便签」「第 8 秒那段」，agent 用 `canvas` 按文字/ID 匹配节点后 `canvas-apply` 精确修改（Studio 里立刻可见），或用 `look` 看指定时间段的帧后改 film.html。不需要 OpenFilm 桌面版。
- **渲染接入 DSH 后台任务面板**：渲染出现在 DSH 的任务（jobs）面板里，有日志、进度行和取消；jobs 服务不可用时自动退回插件内置任务表。
- **对话内成果卡片**：聊天流里 openfilm 工具调用的专属卡片——渲染进度条、完成后显示封面帧，一键「在 Finder 中显示」「打开 Studio」。
- **openfilm skill**：随插件提供 OpenFilm 的影片编写手册（含「指着说」工作流）；若本机已通过 `openfilm` 命令安装了同名 skill，以你自装的为准。
- **侧栏面板**：环境状态、项目列表、新建影片、内嵌 Studio 编辑器、渲染进度（可取消）。

## Studio 配色

内嵌的 OpenFilm Studio 是它自己的界面（默认深色）。它支持浅色：在面板里的 Studio 设置（齿轮）里把主题切成「浅色」或「跟随系统」即可，面板会记住这个选择（存在本机浏览器里）。

## Studio 里的 AI 聊天（可选）

OpenFilm Studio 自带 AI 聊天面板，官方已支持把 DeepSeek Harness 接成聊天 agent。该聊天宿主在 OpenFilm 桌面版里（npm CLI 版 Studio 没有），属于可选路径：**不装它也可以「指着说」**——上面的画布/时间指着工作流全程在 DSH 对话里完成。插件面板会检测这条链路的状态并给出引导。

## 前置条件

- `npm i -g openfilm`（Node 24+）
- 渲染导出需要 `ffmpeg`（macOS：`brew install ffmpeg`）
- 生成配音/音乐/AI 素材需要的外部服务 key 在 Studio 的 Settings → Services 里配置，插件不经手密钥。

## 用法

1. 对话里直接说「用 OpenFilm 做一个 XX 宣传片」，agent 会打开/新建项目并开始写 `film.html`。
2. 侧栏打开「OpenFilm」面板，点项目右侧「打开」，Studio 就嵌在面板里，agent 的每次改动都会实时落上去。
3. 想出片时点「渲染 MP4」（或让 agent 调 `openfilm` 工具），完成后 MP4 在项目目录下。

## 配置（cordis.patch.yml）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 停用插件 |
| `openfilmCommand` | `openfilm` | openfilm 可执行命令 |
| `projectsDir` | `~/Movies/OpenFilm/Projects` | 新影片项目库目录 |
| `studioBase` | 自动探测 | Studio 地址（一般不用填） |

## 已知限制

- Studio 面板为 iframe 内嵌：跟随本机 Studio 的界面，主题在 Studio 自己的设置里切（浅色/深色/跟随系统，面板会记住）。
- 渲染任务状态存于 Host 进程内存，DSH 重启后任务记录消失（已产出的 MP4 文件不受影响）；jobs 面板里的记录同样随进程存活。

---
*名称与介绍为开发期临时版本，正式上架插件市场前会确认一版。*
