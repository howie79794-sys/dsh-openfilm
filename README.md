# OpenFilm Video Workshop (`dsh-openfilm`)

**OpenFilm AI video making, built specifically for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).**

This plugin originates from the open-source project [OpenFilm](https://www.npmjs.com/package/openfilm) — films are "web pages that cut footage, pictures and sound together", written as `film.html`. On top of that foundation it adds DSH-specific optimizations and enhancements, so making videos inside DSH feels native: no window switching, no manual exports, everything lands where you already work.

[中文说明](README.zh.md)

## What it does

- **`openfilm` tool (model-callable)** — environment check, open/create projects, project list, film self-check (`look`), canvas read/apply, background render, render status.
- **Project management in the sidebar panel** — delete a project with a confirmation dialog; the folder goes to the system Trash, recoverable anytime.
- **Embedded Studio in the DSH sidebar** — watch the film live and hand-edit anything at any moment, without leaving DSH.
- **Canvas pointing ("point and say")** — say things like "the note labeled 开场 on the canvas" or "the shot at second 8" in your DSH chat; the agent matches canvas nodes by text/ID and edits them precisely, and Studio reflects the change immediately.
- **Render jobs in the DSH task panel** — rendering shows up as a DSH background job with logs, progress and cancel; falls back to the plugin's built-in job table when the jobs service is absent.
- **Tool-call cards in chat** — render progress bars, cover frame on completion, one-click "reveal in Finder" / "open in Studio".
- **Sidechat with screenshots and voice** — a collapsible chat bar under the Studio view: type, paste a screenshot and say "change this", or dictate (speech-to-text reuses `dsh-voice-polish` when installed). Messages go straight into your current DSH session; replies and tool activity stream back into the bar.

## Requirements

- Node 18+ and the `openfilm` CLI: `npm i -g openfilm`
- `ffmpeg` for rendering (macOS: `brew install ffmpeg`)

Everything runs locally. The plugin's HTTP routes listen on loopback only.

## Install

```sh
dsh plugin --profile web add howie79794-sys/dsh-openfilm
```

Or from the DSH web UI: **Plugins → Discover**, or **Plugins → Add plugin** with this repository.

## Relation to OpenFilm

`dsh-openfilm` is a DSH plugin by an independent author. It wraps and complements the open-source OpenFilm CLI; it is not an official OpenFilm or DeepSeek product. The OpenFilm skill manual ships with the plugin (if you installed the `openfilm` CLI's own skill, yours takes precedence).

## License

MIT
