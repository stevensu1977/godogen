# Godogen Studio — web UI

Vite + React 18 + TypeScript front end for Studio runs. It consumes only the contract in
`../shared/src/index.ts` (`@godogen/shared`): `RunSummary`, `Artifact`, and the `StudioEvent` SSE stream.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on `:5173`, proxies `/api` to the Node server on `:4700`. |
| `npm run dev:mock` | Same, but `/api` is served from fixtures by a Vite plugin — no server needed. |
| `npm run build` | Production bundle to `dist/`. three.js is split into its own chunk and only loaded when a GLB viewer opens. |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `mock/` and the Vite config. |
| `node scripts/shot.mjs <url> <out.png> [--wait ms] [--click css] [--eval js]` | Headless Chromium screenshot over the DevTools protocol; prints page console. |

Run `npm install` from `studio/` (the workspace root) so `@godogen/shared` links.

## Structure

```
src/
  main.tsx, App.tsx          router (/ and /runs/:id), top bar
  styles.css                 single dark stylesheet, CSS variables, per-phase duck keyframes
  lib/api.ts                 typed fetch wrappers + URL builders for the HTTP API
  lib/runState.ts            reducer: StudioEvent stream -> timeline items, artifacts, phase, cost
  lib/useRunStream.ts        loads run + artifacts, owns the EventSource, reconnect/close rules
  lib/markdown.tsx           small safe markdown renderer for assistant messages
  lib/format.ts              money/duration/bytes, phase + status labels, tool icons, language map
  components/RunList.tsx     run cards (status pill, phase, cost, live elapsed, artifact count)
  components/NewRunForm.tsx  brief / title / engine / agent / budget -> POST /api/runs
  components/RunView.tsx     header + two panes
  components/RunHeader.tsx   title, status, agent indicator, cost/turns/elapsed/artifacts, Cancel
  components/AgentIndicator.tsx  the SVG duck; class = current Phase, CSS animates per phase
  components/Timeline.tsx    messages (streaming), tool rows (collapsible), phase separators,
                             log lines, needs_input reply box, finished card, auto-follow + jump pill
  components/ArtifactPanel.tsx   tabs All/Code/Images/Video/3D, thumbnail grid, viewer routing,
                             "NEW" highlight for artifacts that arrived over the live stream
  viewers/CodeViewer.tsx     prism-react-renderer + extra grammars (C#, GDScript, bash, ini, glsl, toml)
  viewers/ImageViewer.tsx    fit / 1:1 toggle
  viewers/VideoViewer.tsx    <video controls>
  viewers/ModelViewer.tsx    @react-three/fiber + drei: useGLTF, Bounds auto-fit, Grid, OrbitControls
mock/
  plugin.ts                  Vite middleware implementing the API from fixtures
  fixtures.ts                two runs + scripted event steps
  files/                     real artifact files served at /api/runs/:id/files/<path>
scripts/shot.mjs             CDP screenshot helper used for verification
```

### Stream handling

- `EventSource` on `/api/runs/:id/events`. History replays first (events in the initial burst are
  marked non-live so they don't trigger "new artifact" highlights), then the stream goes live.
- Reconnects are the browser's: it resends `Last-Event-ID`; the reducer drops any `seq` it has seen.
- On `run.finished` the UI closes the EventSource itself. The server ends the stream for finished
  runs, and without this the browser would reconnect forever.
- Message deltas merge by `messageId`; `tool.result` attaches to its `tool.call`; consecutive
  identical `phase` events collapse into one separator.
- The open artifact is `?artifact=<id>` in the URL, so viewers can be deep-linked. `Esc` closes.

## Mock mode

`STUDIO_MOCK=1` makes `vite.config.ts` register `mock/plugin.ts` instead of the proxy. The plugin
keeps an in-memory store:

- **`run-duckov`** (finished): its whole history is materialised at startup; `GET …/events` replays
  every frame and closes the stream.
- **`run-pond`** (live): plays `LIVE_INTRO` once, then `liveLoop()` forever with real delays —
  thinking → blender → godot → capturing → reviewing, tool calls with results, cost updates,
  artifact `added`/`updated` events, a warning log every other pass, and a `needs_input` on pass 2.
  `POST …/reply` resumes it (or it resumes on its own after 60 s so the demo never stalls);
  `POST …/cancel` emits `run.finished(cancelled)`.
- `POST /api/runs` creates a new run that plays the same script for two loops and finishes.
- `GET …/files/<path>` serves `mock/files/<path>` with correct MIME types (`model/gltf-binary`,
  `image/png`, `video/mp4`, text) and honours `Range` so video seeking works. Both fixture runs
  share the same file tree.

Fixture files (copied from the duckov project): `assets/models/duck_player.glb`,
`assets/models/props/crate.glb`, `screenshots/01_raid_start.png`,
`screenshots/06_compound_door_kill.png`, `screenshots/duckov_raid.mp4`, `scripts/Player.cs`.

## Verified

- `npm run typecheck` and `npm run build` pass.
- Under `npm run dev:mock`, headless Chromium (`--headless=new --use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`, driven by `scripts/shot.mjs` because `--virtual-time-budget` never
  settles while an SSE stream is open) rendered: the run list, the live run (streaming timeline,
  phase separators, needs_input box, Cancel, artifact grid with PNG thumbnails), the finished run,
  the 3D viewer with `duck_player.glb` (console: `WebGL 2.0 … GLB loaded … 18 meshes, 2776 tris`),
  the C# code viewer, the image viewer, the video viewer (`readyState 4, 1280×720`), and the
  New-run modal.
- `reply`, `cancel` and `create` round-trips checked with curl against the mock.
- Not verified: against the real server on `:4700` (being written in parallel) and in a real,
  GPU-backed browser session (orbit/zoom interaction was not exercised headlessly).
