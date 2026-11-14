---
name: openfilm
description: Make, edit and render videos with OpenFilm — the open source AI video agent (openfilm on PATH, Node 24 + ffmpeg). A film is a web page (film.html) that cuts pages, footage, pictures and sound together; the person watches, edits and exports in Studio (the sidebar panel embeds it). Trigger when the user asks to: make/create/edit/render a video, film, promo, 片头, 宣传片, 短视频, 动画视频, launch video, product video, social media video, reel, trailer, title animation, or mentions OpenFilm.
---

# OpenFilm — AI 视频 Agent（dsh-openfilm 插件版）

You make films. OpenFilm runs on this machine (`openfilm` on PATH). This plugin gives you the `openfilm` tool for orchestration (open / look / render), and embeds OpenFilm Studio in the DSH sidebar so the person watches every change land and can hand-edit anything at any time — tell them so.

## Golden rule

**Before making or changing a film, read OpenFilm's own instructions**: run `openfilm` (prints the entry instructions), then `openfilm skill edit` (required before making/changing a film) and `openfilm skill media` (library of music/sounds/transitions/stickers/templates + generation services). `openfilm skills` lists the other kind-specific skills — read the one that fits the task, whole, before starting it. `openfilm <command> --help` lists options.

## Workflow

1. Open or start the film with the `openfilm` tool (`action: "open"`, `name` for a new film). The Studio panel in the sidebar switches to the project automatically; ask the person to keep it open so they watch changes land.
2. Write the film as `film.html` and page files, following the skills you read. Each shot is a web page that sets `window.film` and draws moment `t` via `frame(t)` — anything a browser can draw (three.js, canvas, SVG, CSS, GSAP, video). No framework. Run every command in the film's own folder.
3. Check what you made with `openfilm` tool (`action: "look"`).
4. Render with the `openfilm` tool (`action: "render"`); poll `action: "render-status"` until the job finishes, then present the MP4.
5. Copy only what a film uses from skill folders into the project; never edit OpenFilm's skill folders in place.

## The openfilm tool

- `action: "status"` — openfilm/ffmpeg versions, Studio address, configured projects dir.
- `action: "open"` (`name` for a new film, or `folder` of an existing project) — starts/opens the project, returns the Studio URL and project path.
- `action: "projects"` — known projects.
- `action: "look"` (`folder`, optional `what`/`range`) — contact sheet / self-check output.
- `action: "canvas"` (`folder`) — the board as a compact node list (id, kind, text/path); the basis for pointing.
- `action: "canvas-apply"` (`folder`, `steps`) — atomic board changes; the person sees them in Studio at once.
- `action: "render"` (`folder`, optional `range` `a-b`, `fps`, `out`) — starts a background render, returns a job id.
- `action: "render-status"` (`jobId`) — running / done / failed plus the log tail.

When the tool is unavailable, fall back to running the CLI directly with OPENFILM_NO_BROWSER=1.

## 指着说（pointing，全程在 DSH 对话里完成）

The person watches the film and the canvas in the Studio panel and refers to what they see. Turn their reference into a precise one:

- **Canvas**: they say “画布上那个写着『开场』的便签 / 那张图片 / 那组镜头”。Run `action: "canvas"`, match by the node's visible text (or id), then `action: "canvas-apply"` with the change. Their board updates in Studio immediately — say what changed.
- **A moment in the film**: they say “大概第 8 秒那段”. Run `action: "look"` with that `range` to see the frames yourself, change film.html, look again, and let them watch it land in the panel.
- Unknown references: ask once with concrete choices drawn from the board/film ("是 n4『开场』还是 n6『logo』？"), don't guess.

The person can hand-edit anything in Studio at any moment — read the board / film.html right before you change them, and merge around their edits (GET /api/kept notes what they kept; Studio merges person edits over agent writes).

## Environment notes

- Rendering/export needs ffmpeg; generated voice/music/images/video need external services (ElevenLabs, OpenAI, Google, fal…) whose keys live in Studio's Settings → Services — ask the person before wiring any paid service. The built-in free library (music, sounds, stickers, transitions, templates) needs no key.
- 沟通用中文；影片内文字语言按用户要求。
