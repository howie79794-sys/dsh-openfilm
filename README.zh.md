# OpenFilm 视频工坊（`dsh-openfilm`）

**为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）专属打造的 OpenFilm AI 视频工坊。**

本插件来源于开源项目 [OpenFilm](https://www.npmjs.com/package/openfilm)——影片是"把素材、画面和声音剪在一起的网页"，写成 `film.html`。在这个基础上，插件针对 DSH 做了专属优化和功能增强，让在 DSH 里做视频像原生功能一样顺手：不切窗口、不手动导出，一切都在你工作的地方发生。

[English README](README.md)

## 功能

- **openfilm 工具（模型可调）**：环境探测、新建/打开项目、项目列表、影片自检（`look`）、画板读取与修改、后台渲染、渲染进度。
- **侧栏内嵌 Studio**：实时看片、随时手改，全程不用离开 DSH。
- **画板指改（"指着说"）**：在 DSH 对话里说「画布上那个写着『开场』的便签」「第 8 秒那段」，agent 按文字/ID 匹配画布节点精确修改，Studio 里立刻可见。
- **渲染进 DSH 后台任务面板**：渲染以 DSH 后台任务出现，有日志、进度和取消；jobs 服务不可用时自动退回插件内置任务表。
- **对话内成果卡片**：渲染进度条、完成封面帧，一键「在 Finder 中显示」「打开 Studio」。
- **支持截图与语音的面板小聊天**：Studio 视图底部可折叠对话条——打字、粘贴截图说"这里要改"、或按麦克风说话（语音转写复用 `dsh-voice-polish`，装了才显示）。消息直接进入当前 DSH 会话，回复和工具过程实时流回。

## 环境要求

- Node 18+ 与 `openfilm` 命令：`npm i -g openfilm`
- 渲染需要 `ffmpeg`（macOS：`brew install ffmpeg`）

一切都在本地运行。插件的 HTTP 路由只监听本机环回地址。

## 安装

```sh
dsh plugin --profile web add howie79794-sys/dsh-openfilm
```

或从 DSH 网页端：**插件 → 发现**，或用本仓库地址走 **插件 → 添加插件**。

## 与 OpenFilm 的关系

`dsh-openfilm` 是独立作者开发的 DSH 插件。它包装并配合开源 OpenFilm CLI 工作，不是 OpenFilm 或 DeepSeek 的官方产品。插件自带 OpenFilm 影片编写手册（若你用 `openfilm` 命令装过同名 skill，以你自装的为准）。

## 许可

MIT
