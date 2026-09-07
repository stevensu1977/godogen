# GoScene (formerly GoScene)

An orchestrator and web UI around godogen runs. Claude Code (via the Agent SDK) or Codex (`codex exec --json`)
remains the agent; Studio publishes the godogen runtime into a fresh workspace, hands the model a brief,
translates the engine's native events into one small event model, watches the workspace for artifacts
(code, images, videos, GLB models) and streams everything to a React UI. No live screen capture: the UI shows a
phase-driven "agent at work" animation plus the real artifacts as they appear.

```
studio/
  shared/   the contract: StudioEvent union, RunSummary, Artifact, Phase, HTTP API (src/index.ts)
  server/   Node 22 + Hono: run manager, engines (claude, codex), workspace watcher, SSE, artifact files, importer
  web/      Vite + React + TypeScript: run list, run view (timeline / artifacts / three.js GLB viewer), mock mode
```

## Run it

```bash
cd studio && npm install
npm run dev:server            # http://localhost:4700  (runs live in ~/godogen-runs, override STUDIO_RUNS_ROOT)
npm run dev:web               # http://localhost:5173  (proxies /api to 4700)
```

Requirements on the host: the `claude` CLI logged in (Bedrock works: `CLAUDE_CODE_USE_BEDROCK=1`), and whatever
the engine guide needs (Godot .NET on PATH, .NET 9 in `~/.dotnet`, Blender at `BLENDER_BIN`, xvfb, ffmpeg).
Default Claude model is `global.anthropic.claude-fable-5-1`; override with `STUDIO_CLAUDE_MODEL` or per run.

Create a run from the UI or with curl:

```bash
curl -s -X POST localhost:4700/api/runs -H 'content-type: application/json' \
  -d '{"title":"Duckov","engine":"godot","agent":"claude","budgetUsd":20,"brief":"<the brief>"}'
```

Import an existing godogen run (workspace + `claude -p --output-format stream-json` logs) to browse it in the UI:

```bash
cd studio/server && npm run import -- ~/duckov ~/duckov/run.stream.jsonl "Duckov" ~/duckov/run2.stream.jsonl
```

## Follow-up turns

A run is a workspace plus a series of turns. Turn 1 is the brief; the composer under the timeline sends further
instructions (`POST /api/runs/:id/turns`) while the run is not running. The engine session is resumed (Claude
`resume`, Codex `exec resume`) so the agent keeps its memory of earlier turns; events append to the same log with a
`turn.started` marker, cost accumulates across turns, and `run.finished` closes each turn rather than the run.

## One commit per turn

When a turn ends, Studio stages everything in the workspace and commits it as `Turn N: <instruction>` with the
full instruction, status and cost in the body (author `GoScene`, override with `STUDIO_GIT_AUTHOR`). The
short hash lands on the turn (`turns_history[].commit`), in the `run.finished` event and on the timeline card, so
every turn is a reviewable, revertable step regardless of whether the agent committed anything itself. A clean
tree logs "nothing to commit". Published workspaces track `assets/` and ignore `screenshots/`, `.godot/`, build output.

## History and restore

The History tab lists the workspace's git log (Studio turn commits are labelled with their turn; the agent's own
commits show their author). Clicking a commit opens a modal with the full message, per-file additions/deletions and
the unified diff (binary assets excluded, large diffs truncated). "Restore to this commit" rewrites the working tree
to that commit's files and records it as a new `Restore to …` commit, so history is never lost; the artifact list is
rescanned, a `workspace.restored` marker lands on the timeline, and the next turn's instruction is prefixed with a
note telling the agent that later changes are gone. Not available while a turn is running.

## Event model

Eight event types, defined once in `shared/src/index.ts`, persisted per run as append-only `events.jsonl`, served
over SSE with replay from `Last-Event-ID`: `run.started`, `run.finished`, `message` (streamed text), `phase`
(thinking / reading / command / writing / blender / godot / capturing / reviewing / done / failed), `tool.call`,
`tool.result`, `artifact`, `cost`, `needs_input`, `log`. Engines never leak their native formats past
`server/src/engines/*`; the UI never consumes anything else. An AG-UI or other protocol adapter, if ever
wanted, is an output mapping from these events.

## Verified (2026-09-07, this host)

- Imported the four Duckov session logs: 785 events, 69 artifacts (17 GLB, 19 images, 3 videos, 29 code files).
- Live smoke run through the Agent SDK (brief: Blender crate GLB only): 55 s, $0.32, streamed text deltas,
  9 tool calls with results, phases blender/reading/writing, watcher reported `tools/make_crate.py` and
  `assets/models/crate.glb` within a second of creation, SSE closed with an `end` frame.
- Files route serves `model/gltf-binary`, byte ranges for MP4, and refuses path traversal.

## Not done yet

- `needs_input` / `POST reply`: engines run unattended within a turn; steering happens between turns via the composer.
- Codex engine mapping is written against the `codex exec --json` item shapes but has not been run.
- Budget guard only sees cost at the end of a Claude run (the SDK reports total cost in the result); a
  per-turn estimate from token usage would be needed to cancel mid-run.
- One run per process at a time is fine; concurrency is bounded only by the host.
