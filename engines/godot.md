# Godot engine guide

Stack: **Godot 4 (standard build)**, **GDScript**. GDScript is the default because Web (WASM) is a first-class publish
target and Godot 4 cannot export C# to the web. (A C# variant exists for runs that never target Web.)

## Project shape

- `project.godot` — config, input actions, display, physics. **Match `config_version` and `config/features` to the
  installed toolchain** (`godot --version`); on an existing project preserve them. For 3D, set
  `3d/physics_engine="Jolt Physics"` and a fixed `physics_ticks_per_second`.
- **Renderer follows the targets** (see *Targets*): `forward_plus` only when every target is desktop; `mobile`
  when Android/iOS are in; `gl_compatibility` whenever Web is in. Pick it at project creation — switching later
  costs a re-tune of lights, shadows and post effects.
- `scripts/*.gd` runtime behavior · `scenes/*.tscn` scenes · `assets/` **only** files the running game loads ·
  `export_presets.cfg` (see *Targets*) · `build/` publish output (git-ignored).
- Build gate, in this order: `godot --headless --check-only -s <file>` for every changed script (parse and static
  type errors), `godot --headless --import` after asset changes, then the headless smoke test that loads and
  instantiates every scene, then `godot --headless --quit` (RID-leak warnings on exit are benign).

The user watches by running the project themselves (`godot --path .`) or by opening the published web build —
keep it building and importing cleanly so each run reflects current state.

## Scenes are generated at build time, not by hand

Write scenes as **GDScript `SceneTree` scripts** that run once headless and emit a `.tscn`:
`godot --headless --script scenes/build_main.gd`. A builder builds the node hierarchy, sets properties, attaches
scripts, packs, and `quit()`s — it contains **no** runtime logic. Build **leaf scenes first**, parents after.

The serialization rules below are silent-failure — they pass `--check-only` and drop nodes or bloat files only in
the saved `.tscn`:

- **Owner chain:** every node must have `owner` set to the scene root or it won't serialize. After building, walk
  the tree and set `child.owner = root` on all descendants — but **do not recurse into instantiated GLB/`.tscn`
  nodes** (those have a non-empty `scene_file_path`). Recursing into a GLB inlines all its meshes as text → 100MB+ `.tscn`.
- **Validate the pack:** count nodes before packing, `instantiate()` the `PackedScene` after, and compare counts;
  gate `ResourceSaver.save()` on the match. A silent drop otherwise looks like success.
- **Attach scripts last**, after the hierarchy is built; a node's typed reference can change class when its script
  is set.

```gdscript
func pack_and_save(root: Node, path: String) -> void:
    _set_owner_recursive(root, root)                 # skip nodes with scene_file_path set
    var expected := _count_nodes(root)
    var packed := PackedScene.new()
    if packed.pack(root) != OK: quit(1); return
    var test := packed.instantiate(); var got := _count_nodes(test); test.free()
    if got < expected: push_error("nodes dropped"); quit(1); return
    ResourceSaver.save(packed, path)
    quit(0)
```

GLB models: instantiate the `PackedScene`, measure the `MeshInstance3D` AABB to scale, and use a **primitive**
collision shape (Box/Sphere/Capsule) from the AABB — never `create_trimesh_shape()`/`create_convex_shape()` on
imported meshes (drops to <1 FPS).

## GDScript traps (pass `--check-only`, fail at runtime)

- **`:=` infers `Variant`** from `instantiate()`, array/dictionary element access, and the polymorphic math
  functions (`abs`, `clamp`, `lerp`, `min`, `max`, …). Then every member access on it is a runtime lookup and typos
  surface only when executed. Declare the type: `var model: Node3D = scene.instantiate()`, `var hp: float = clamp(...)`.
- **`load()` returns `Resource`**: `var scene: PackedScene = load("res://x.glb")`, never `var scene := load(...)`.
- **`preload()` resolves at parse time**: a script that `preload`s a file the run hasn't generated yet fails
  `--check-only`. Use `load()` for anything created in the same run, `preload` only for hand-written assets.
- **`await` inside `_process` advances the movie frame counter** under `--write-movie`; keep capture-time logic
  synchronous, or drive it from a `SceneTree` script.
- **`@onready` runs at `_ready`**, not at construction: nodes created by a builder script have no `@onready` values
  until they enter a tree.
- Don't name a method `get_path`, `get_name`, `set_owner`, or any other `Node` built-in; the override is silent.
- Frame-rate-independent damping: `speed *= exp(-rate * delta)`, not `speed *= (1.0 - drag)` per tick.

## Quirks worth knowing (silent-failure)

- **`ArrayMesh` needs generated normals** (`SurfaceTool.generate_normals()`) to *receive* shadows. Without them,
  or with `cull_mode = CULL_DISABLED` as a "safety net", shadows silently vanish — fix winding instead.
- **MultiMeshInstance3D + GLB** loses the mesh on pack/save; use individual instances. `material_override` on
  GLB-internal nodes also won't serialize (owner is skipped) — use a procedural `ArrayMesh` when a custom material is needed.
- **Raycasts don't reliably hit `ConcavePolygonShape3D`** (trimesh) — use a shape query or sample terrain height analytically.
- **`.gdignore`** in a directory makes the importer skip it silently — only `screenshots/` should have one, never `assets/`.
- **Compatibility renderer** (Web): no SDFGI/SSR/volumetric fog, one directional shadow, `glow` is expensive;
  keep lighting to a sun + ambient and bake looks into materials.

## Targets

Runs carry a target list (`web`, `linux`, `windows`, `macos`, later `android`, `ios`, `stream`). Apply the
constraints while building; Studio does the packaging afterwards with `godot --headless --export-release <Preset>`.

- **Web**: `gl_compatibility` renderer; the single-threaded export (`variant/thread_support=false`) is the default
  — it runs on any static host, itch.io and the store fronts; the threaded one needs COOP/COEP headers. Keep the
  `.pck` small: no unused imports, textures ≤ 1K, audio Ogg. Mouse + keyboard and touch both work; don't rely on
  right-click (browser menu) or on `Input.warp_mouse`.
- **macOS / Android / iOS (arm64)**: set `rendering/textures/vram_compression/import_etc2_astc=true` in
  `project.godot` or the export refuses to run ("Cannot export for universal or arm64 if ETC2 ASTC texture format is
  disabled"). macOS is exported from Linux as a universal `.zip` with Godot's built-in ad-hoc signature — required for
  Apple Silicon to launch it at all; without notarization the first launch is right-click → Open.
- **Desktop**: `forward_plus` is fine if Web is not in the list; keep a fixed 1280×720 default window with
  `stretch/mode="canvas_items"` so HUD scales.
- **Mobile (later)**: `mobile` renderer, touch controls, `stretch/aspect="expand"`, portrait/landscape declared.

`export_presets.cfg` must exist in the project with these **exact preset names** and outputs so publishing needs no editor:

```ini
[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
export_path="build/web/index.html"
[preset.0.options]
variant/thread_support=false
html/canvas_resize_policy=2
html/focus_canvas_on_start=true

[preset.1]
name="Linux"
platform="Linux"
runnable=true
export_filter="all_resources"
export_path="build/linux/game.x86_64"
[preset.1.options]
binary_format/architecture="x86_64"

[preset.2]
name="Windows"
platform="Windows Desktop"
runnable=true
export_filter="all_resources"
export_path="build/windows/game.exe"
[preset.2.options]
binary_format/architecture="x86_64"
```

Before calling a web target done, run the export yourself once (`godot --headless --export-release Web
build/web/index.html`) and check the export log for "No export template found" (templates missing or version
mismatch) and for `rendering_method` warnings; Studio then hosts `build/web/` and screenshots it in a headless
browser as proof.

## Capture (proof video)

Hardware **Vulkan/GL** gives correct rendering and is required for video; software rendering (`llvmpipe`) can
still record with the movie writer, just slowly (~10 fps render, 30 fps playback).

Capture deterministically with Godot's movie writer from a dedicated capture `SceneTree` script under `test/`:

```bash
# under xvfb-run -a -s '-screen 0 1280x720x24' on a headless Linux box
godot --headless --import
godot --write-movie screenshots/result/frame.avi --fixed-fps 30 --quit-after 450 --script test/presentation.gd
ffmpeg -y -i screenshots/result/frame.avi -c:v libx264 -pix_fmt yuv420p -movflags +faststart screenshots/result/video.mp4
```

`--fixed-fps` makes motion deterministic (450 frames @30fps = 15s). **Pre-position the camera** in the builder or
`_initialize` (the first movie frame renders before `_process`). Drive capture-time input from the script, not
live keys. The clip must show the behavior progressing across the whole window — no dead time, no single looped frame.
