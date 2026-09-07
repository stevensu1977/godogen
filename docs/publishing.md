# Publishing: one-click packaging as an agent capability

GoScene runs end with a **publish** step: the customer picks targets, the agent builds the game with those
targets in mind from the first line of code, and Studio packages, hosts and verifies each target. The result of
a run is not "a project that builds" but a playable URL, downloadable binaries, store-ready bundles, or a
streaming session.

## Targets and what gates them

| Target | GDScript | C# | Built where | Hard requirements |
|---|---|---|---|---|
| Web (WASM) | yes | **no** (Godot 4 cannot export C# to the web) | Linux host | Compatibility renderer; single-threaded export needs no special headers, threaded needs COOP/COEP |
| Linux / Windows | yes | yes | Linux host | Windows code signing optional |
| macOS | yes | yes | export from Linux (unsigned zip) or macOS runner for signing/notarization | Apple Developer account for signing |
| Android | yes | yes (experimental since 4.2) | Linux host | JDK 17, Android SDK cmdline-tools, keystore; Play account for AAB upload |
| iOS | yes | yes (experimental since 4.2) | **macOS runner** (EC2 Mac, Mac mini, or a hosted runner such as Codemagic) | Apple Developer account; TestFlight via App Store Connect API |
| Stream (pixel streaming) | yes | yes | GPU host (e.g. g5) per session | WebRTC pipeline; billed per online minute |

Because Web is a first-class target, **GoScene generates Godot games in GDScript by default**. C# stays available
(`publish.sh --engine godot-csharp`) for customers who explicitly do not need Web. Where C# bought compile-time
checking (`dotnet build`), GDScript uses `godot --headless --check-only -s <script>` per script plus the headless
load-and-instantiate smoke test; the GDScript-specific traps live in `engines/godot.md`.

## How a run carries its targets

1. **Brief**: the run request has `targets: ["web", "linux", "windows", ...]`. Studio appends a fixed
   "Targets" block to the brief so the model applies the target constraints while building (renderer, input,
   UI scaling, export presets), not afterwards.
2. **Engine guide**: `engines/godot.md` states the per-target constraints and the `export_presets.cfg` the
   project must contain. The agent creates the presets as part of the project, so `godot --headless
   --export-release <Preset> <path>` works without an editor.
3. **Publish** (`POST /api/runs/:id/publish`): Studio, not the model, runs one packager per target on the
   run's workspace, writes to `workspace/build/<target>/`, records `publish.result` events, exposes outputs as
   artifacts, and hosts the web build at `/play/<runId>/` with COOP/COEP headers so both single- and
   multi-threaded exports run.
4. **Proof per target**: Web — Studio opens the hosted URL in headless Chromium, waits for the canvas to render,
   saves a screenshot artifact and the console log; failures (missing templates, wrong renderer, JS errors)
   surface as a failed `publish.result` the customer and the agent can act on. Desktop — the binary exists and
   `--headless --quit` exits cleanly. Mobile/iOS/stream — see phases below.
5. **Credentials** (keystores, Apple certificates, cloud keys) are held by Studio's server, never exposed to the
   model. The model can request "publish", not read secrets.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | GDScript-first guide; Web + Linux + Windows packagers; hosted playable URL; headless-browser verification | **in progress** |
| 2 | Android APK/AAB; verification on AWS Device Farm devices | planned |
| 3 | iOS and signed macOS via a macOS runner; TestFlight distribution | planned |
| 4 | Pixel streaming sessions on GPU hosts (also the only browser route for C# games) | planned |

## Phase 1 details

- Packagers run the **standard** Godot binary (`STUDIO_GODOT_BIN`, default `~/godot-agent/.tools/godot/godot`) for
  GDScript projects and the .NET build (`godot` on PATH) when a `.csproj` is present. Export templates must
  match the binary version (`~/.local/share/godot/export_templates/<version>/`).
- Preset names are fixed: `Web`, `Linux`, `Windows`, `macOS`. If a project lacks `export_presets.cfg`, Studio
  writes a default one (single-threaded Web, x86_64 Linux/Windows) before exporting.
- Outputs: `build/web/index.html` (+ wasm/pck/js), `build/linux/<name>.x86_64`, `build/windows/<name>.exe`, each
  also zipped for download. `build/` is git-ignored; the publish commit records only the presets.
- Hosting: the Studio server serves `build/web/` at `/play/<runId>/` with `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Production puts the same files behind
  CloudFront/S3 with those response headers.
- Verification: headless Chromium (`--use-angle=swiftshader`) loads the URL, waits up to 60 s for the Godot
  canvas and for the engine's "Godot Engine v…" console line, screenshots to `screenshots/publish/web.png`.

## Pitfalls, verified on real machines (2026-09-07)

Everything below was hit while publishing Duck Dash (GDScript) and Duckov (C#) from this Linux host to a Mac
running macOS 15. Each one either failed silently or with a message that pointed elsewhere.

### Godot export (any target)

| Symptom | Cause | Fix (Studio does this) |
|---|---|---|
| Web preset missing / `godot` refuses Web export | The `godot` on PATH is the .NET build, which cannot export Web at all | GDScript runs get the standard build as `godot` via a PATH shim; C# runs never target Web |
| "Cannot export for universal or arm64 if ETC2 ASTC texture format is disabled" | arm64 targets (macOS universal, Android, iOS) need `rendering/textures/vram_compression/import_etc2_astc=true` | Set in `project.godot` before export |
| Preset options revert after a failed export | Godot rewrites `export_presets.cfg` on export | Upsert the managed option keys every publish instead of writing presets once |
| "Invalid bundle identifier: Identifier is missing" | macOS export needs `application/bundle_identifier` | Preset sets `ai.goscene.game` (customer-specific later) |

### C# / .NET specifics

| Symptom | Cause | Fix |
|---|---|---|
| Export "completed with warnings", app crashes or shows "can't be opened"; `Resources/` has only `.pck` | No `.sln` next to the `.csproj`: Godot skips the .NET publish but still writes a package | Create `<Project>.sln` (`dotnet new sln` + `dotnet sln add`); treat "Export .NET Project" errors as failure |
| `dotnet: not found`, hostfxr crash in the packager | Packager env lacked `~/.dotnet` | Packagers use the same env as engines (DOTNET_ROOT, PATH) |
| "No export template found" for the .NET build | .NET Godot needs its own templates (`…_mono_export_templates.tpz` → `export_templates/<ver>.stable.mono/`) | Install both template sets |

### macOS signing from Linux (the expensive one)

| Symptom on the Mac | Cause | Fix |
|---|---|---|
| Terminal launch prints only `killed`; kernel log: "AMFI could not load its entitlements: failed parsing DER entitlements" | Godot's built-in ad-hoc signer emits a DER entitlements blob AMFI rejects. `codesign --verify --deep --strict` still says "valid" — it does not check that blob | Export with `codesign/codesign=0`, then re-sign the `.app` with `rcodesign sign --code-signature-flags runtime -e entitlements.plist` (ad-hoc, recursive) and re-zip |
| "'rcodesign' doesn't support signing applications with embedded dynamic libraries" | Godot refuses its own rcodesign mode for .NET apps | Same: sign outside Godot with rcodesign directly |
| Process killed at launch even with a valid signature (.NET) | Hardened runtime blocks CoreCLR's JIT and dylib loading | Entitlements: `allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`, `disable-library-validation` |
| "Apple could not verify … is free of malware" | Not notarized (needs an Apple Developer ID; phase 3) | User: System Settings → Privacy & Security → Open Anyway. macOS 15 removed the right-click → Open bypass |
| `xattr -cr` says "Operation not permitted" | `com.apple.provenance` cannot be removed; the quarantine flag usually already is | Use `xattr -dr com.apple.quarantine <app>` |
| Path shows `/private/var/folders/…/AppTranslocation/…` in logs | App Translocation: still quarantined, launched from Downloads | Remove quarantine or move the app out of Downloads |
| The customer downloaded a package that later turned out broken | A publish reported success before the failure mode was known | Desktop packages need a post-export launch check like the web one (open item) |

How to read a signature without a Mac: `rcodesign print-signature-info <binary>` shows flags (`ADHOC | RUNTIME`),
the `Entitlements` and `DER Entitlements` slots, and works on nested dylibs too.

### Web

| Symptom | Cause | Fix |
|---|---|---|
| Game stuck on the loading bar, console "SharedArrayBuffer is not defined" | Threaded export served without COOP/COEP | Single-threaded export by default; `/play/` sends COOP/COEP anyway |
| Nothing renders headlessly | Software WebGL | `--use-angle=swiftshader` and wait for the "Godot Engine v…" console line |

## Open decisions

- macOS runner for iOS: EC2 Mac (hourly, 24 h minimum) vs hosted CI minutes. Hosted is cheaper at low volume.
- When pixel streaming enters: it is the only route that keeps C# games in the browser, but the most expensive
  to operate.
