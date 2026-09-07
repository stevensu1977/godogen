/**
 * Fixture data for `npm run dev:mock`. Two runs: one finished (full history replayed instantly) and
 * one live (scripted events emitted with delays, looping through blender -> godot -> capturing).
 * Files referenced by artifacts live under mock/files/<path>.
 */
import type { Artifact, Phase, RunSummary, StudioEvent } from '@godogen/shared';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
/** A StudioEvent without the envelope the store fills in. */
export type Ev = DistributiveOmit<StudioEvent, 'seq' | 'runId' | 'ts'>;
/** A scripted step: wait `delay` ms, then emit `ev`. */
export interface Step { delay: number; ev: Ev }

const T0 = Date.parse('2026-09-07T03:10:00Z');
const iso = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();

const art = (id: string, kind: Artifact['kind'], path: string, bytes: number, title: string, at: number, toolCallId?: string): Artifact => ({
  id, kind, path, bytes, title, updatedAt: iso(at), toolCallId,
});

export const ART = {
  duck: art('a-duck', 'model', 'assets/models/duck_player.glb', 83620, 'duck_player.glb', 420, 'tc-blender-1'),
  crate: art('a-crate', 'model', 'assets/models/props/crate.glb', 12928, 'crate.glb', 480, 'tc-blender-2'),
  player: art('a-player', 'code', 'scripts/Player.cs', 6479, 'Player.cs', 300, 'tc-write-1'),
  shot1: art('a-shot1', 'image', 'screenshots/01_raid_start.png', 1_100_000, '01_raid_start.png', 1500, 'tc-cap-1'),
  shot6: art('a-shot6', 'image', 'screenshots/06_compound_door_kill.png', 1_200_000, '06_compound_door_kill.png', 1560, 'tc-cap-1'),
  video: art('a-video', 'video', 'screenshots/duckov_raid.mp4', 22_425_299, 'duckov_raid.mp4', 1700, 'tc-cap-2'),
};

const BRIEF_FINISHED =
  'A top-down extraction shooter starring a duck. Raid a compound, loot crates, survive the firefight and reach the extraction point before the countdown ends. Low-poly Blender props, Godot 4 with C#.';
const BRIEF_LIVE =
  'A cozy duck pond management game: feed ducks, build nests, fend off a fox at night. Godot 4, C#, Blender for the duck and pond props. Ship a 60s trailer.';

export const RUNS: Record<string, RunSummary> = {
  'run-duckov': {
    id: 'run-duckov',
    title: 'Duckov: extraction raid',
    brief: BRIEF_FINISHED,
    engine: 'godot',
    agent: 'claude',
    status: 'finished',
    phase: 'done',
    createdAt: iso(0),
    startedAt: iso(2),
    finishedAt: iso(1830),
    costUsd: 18.42,
    turns: 96,
    workspace: '/srv/studio/runs/run-duckov',
    sessionId: 'sess-7f3a',
    artifactCount: 6,
  },
  'run-pond': {
    id: 'run-pond',
    title: 'Duck pond keeper',
    brief: BRIEF_LIVE,
    engine: 'godot',
    agent: 'codex',
    status: 'running',
    phase: 'thinking',
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    costUsd: 0,
    turns: 0,
    workspace: '/srv/studio/runs/run-pond',
    artifactCount: 0,
  },
};

const msg = (messageId: string, text: string, chunk = 18): Step[] => {
  const steps: Step[] = [];
  for (let i = 0; i < text.length; i += chunk) {
    steps.push({ delay: 45, ev: { type: 'message', messageId, delta: text.slice(i, i + chunk) } });
  }
  steps.push({ delay: 10, ev: { type: 'message', messageId, delta: '', final: true } });
  return steps;
};
const phase = (p: Phase, detail?: string, delay = 200): Step => ({ delay, ev: { type: 'phase', phase: p, detail } });
const call = (toolCallId: string, tool: string, title: string, input: Record<string, unknown>, delay = 300): Step => ({
  delay, ev: { type: 'tool.call', toolCallId, tool, title, input },
});
const result = (toolCallId: string, output: string, durationMs: number, ok = true, delay = 900): Step => ({
  delay, ev: { type: 'tool.result', toolCallId, ok, output, durationMs },
});
const cost = (costUsd: number, turns: number, delay = 100): Step => ({ delay, ev: { type: 'cost', costUsd, turns, inputTokens: turns * 4200, outputTokens: turns * 900 } });
const artifact = (a: Artifact, change: 'added' | 'updated' = 'added', delay = 100): Step => ({ delay, ev: { type: 'artifact', artifact: a, change } });
const log = (text: string, level: 'info' | 'warn' | 'error' = 'info', delay = 100): Step => ({ delay, ev: { type: 'log', level, text } });

/** History of the finished run; replayed instantly (delays ignored). */
export const FINISHED_HISTORY: Step[] = [
  { delay: 0, ev: { type: 'run.started', run: { ...RUNS['run-duckov'], status: 'running', phase: 'thinking', costUsd: 0, turns: 0, artifactCount: 0 } } },
  phase('thinking'),
  ...msg('m1', "I'll build this as a Godot 4 C# project. Plan:\n\n1. **Blender** — low-poly duck player, crates, compound walls.\n2. **Godot** — top-down controller, raid loop, extraction timer.\n3. **Capture** — scripted playthrough recorded to MP4.\n\nStarting with the project skeleton."),
  phase('reading', 'engines/godot.md'),
  call('tc-read-1', 'Read', 'Read engines/godot.md', { file_path: 'engines/godot.md' }),
  result('tc-read-1', '# Godot guide\n\nStack: Godot 4.3 mono, C# ...\n(212 lines)', 41),
  phase('writing', 'scripts/Player.cs'),
  call('tc-write-1', 'Write', 'Write scripts/Player.cs', { file_path: 'scripts/Player.cs', content: 'using Godot;\n\npublic partial class Player : CharacterBody3D { ... }' }),
  result('tc-write-1', 'Wrote 180 lines to scripts/Player.cs', 12),
  artifact(ART.player),
  cost(1.12, 9),
  phase('blender', 'duck_player.blend'),
  call('tc-blender-1', 'Bash', 'blender -b -P tools/make_duck.py', { command: 'blender -b -P tools/make_duck.py -- --out assets/models/duck_player.glb' }),
  result('tc-blender-1', 'Blender 4.2.0\nRead prefs\n[make_duck] body: 412 verts\n[make_duck] exported assets/models/duck_player.glb (83.6 KB)\nBlender quit', 6120),
  artifact(ART.duck),
  call('tc-blender-2', 'Bash', 'blender -b -P tools/make_props.py', { command: 'blender -b -P tools/make_props.py -- --out assets/models/props' }),
  result('tc-blender-2', '[make_props] crate.glb 12.9 KB\n[make_props] barrel.glb 9.1 KB\nBlender quit', 4380),
  artifact(ART.crate),
  cost(4.8, 27),
  phase('godot', 'dotnet build'),
  call('tc-build-1', 'Bash', 'dotnet build', { command: 'dotnet build -c Debug' }),
  result('tc-build-1', 'Duckov -> /srv/studio/runs/run-duckov/.godot/mono/temp/bin/Debug/Duckov.dll\n\nBuild succeeded.\n    0 Warning(s)\n    0 Error(s)', 9420),
  call('tc-godot-1', 'Bash', 'godot --headless --import', { command: 'godot --headless --path . --import' }),
  result('tc-godot-1', 'Godot Engine v4.3.stable.mono\nImporting: res://assets/models/duck_player.glb\nImporting: res://assets/models/props/crate.glb\n', 7130),
  ...msg('m2', 'Build is clean and imports succeed. The duck uses a 3-bone waddle rig; crates are plain static bodies. Next: run the scripted raid and record it.'),
  phase('capturing', 'xvfb-run godot --write-movie'),
  call('tc-cap-1', 'Bash', 'godot --write-movie (screenshots)', { command: 'xvfb-run -a godot --path . --write-movie screenshots/frame.png --fixed-fps 30 -- --scripted-raid' }),
  result('tc-cap-1', 'Recording to screenshots/frame_%06d.png\n[raid] start\n[raid] pickup medkit\n[raid] compound door kill\n[raid] extracted 00:38', 61200),
  artifact(ART.shot1),
  artifact(ART.shot6),
  call('tc-cap-2', 'Bash', 'ffmpeg -> duckov_raid.mp4', { command: 'ffmpeg -y -framerate 30 -i screenshots/frame_%06d.png -c:v libx264 -pix_fmt yuv420p screenshots/duckov_raid.mp4' }),
  result('tc-cap-2', 'frame= 1846 fps=212 q=-1.0 Lsize=   21899kB time=00:01:01.53 bitrate=2915.6kbits/s speed=7.1x', 8700),
  artifact(ART.video),
  cost(15.9, 88),
  phase('reviewing'),
  call('tc-rev-1', 'Read', 'Read screenshots/06_compound_door_kill.png', { file_path: 'screenshots/06_compound_door_kill.png' }),
  result('tc-rev-1', '[image 1280x720]', 30),
  ...msg('m3', 'Reviewed the capture: tracers read clearly, the extraction countdown is legible, and the duck waddle sells the movement. One warning in the log about a missing collision layer on barrels — fixed by setting layer 2.\n\n**Deliverable:** `screenshots/duckov_raid.mp4` (61s).'),
  log('budget: 18.42 / 25.00 USD'),
  cost(18.42, 96),
  phase('done'),
  { delay: 0, ev: { type: 'run.finished', status: 'finished', costUsd: 18.42, turns: 96, durationMs: 1828_000, summary: 'Extraction raid shipped: duck player, compound, 61s recorded raid.' } },
];

/** Live run: played once from the start, then `LIVE_LOOP` repeats forever. */
export const LIVE_INTRO: Step[] = [
  { delay: 0, ev: { type: 'run.started', run: RUNS['run-pond'] } },
  phase('thinking', undefined, 600),
  ...msg('l1', "Reading the brief. A pond keeper with a day/night cycle and a fox threat — I'll scope it to: feeding, three nest slots, one fox encounter per night, and a scripted 60s trailer.\n\nSetting up the Godot project first."),
  phase('reading', 'engines/godot.md'),
  call('tl-read-1', 'Read', 'Read engines/godot.md', { file_path: 'engines/godot.md' }),
  result('tl-read-1', '# Godot guide\n\nStack: Godot 4.3 mono ...', 38),
  phase('writing', 'scripts/Player.cs'),
  call('tl-write-1', 'Write', 'Write scripts/Player.cs', { file_path: 'scripts/Player.cs', content: 'using Godot;\n...' }),
  result('tl-write-1', 'Wrote 180 lines to scripts/Player.cs', 15),
  artifact({ ...ART.player, id: 'l-player', updatedAt: new Date().toISOString() }),
  cost(0.84, 6),
];

let loopN = 0;
/** One loop iteration; artifact ids are suffixed so each pass adds fresh cards. */
export function liveLoop(): Step[] {
  loopN += 1;
  const n = loopN;
  const now = () => new Date().toISOString();
  return [
    phase('thinking', undefined, 1200),
    ...msg(`lm-${n}`, n === 1
      ? 'Modelling the duck and a crate in Blender now. Keeping polycount low so the pond can hold twenty ducks.'
      : `Pass ${n}: the fox path clipped through the reeds. Regenerating the reed props with a wider collision margin and re-capturing.`),
    phase('blender', 'make_duck.py'),
    call(`tl-blender-${n}`, 'Bash', 'blender -b -P tools/make_duck.py', { command: 'blender -b -P tools/make_duck.py -- --out assets/models/duck_player.glb' }, 500),
    result(`tl-blender-${n}`, `Blender 4.2.0\n[make_duck] body: 412 verts, wings: 2x96\n[make_duck] exported assets/models/duck_player.glb (83.6 KB)\nBlender quit`, 5800 + n * 100, true, 4000),
    artifact({ ...ART.duck, id: n === 1 ? 'l-duck' : `l-duck`, updatedAt: now() }, n === 1 ? 'added' : 'updated'),
    call(`tl-props-${n}`, 'Bash', 'blender -b -P tools/make_props.py', { command: 'blender -b -P tools/make_props.py' }, 500),
    result(`tl-props-${n}`, '[make_props] crate.glb 12.9 KB\nBlender quit', 3100, true, 3000),
    artifact({ ...ART.crate, id: 'l-crate', updatedAt: now() }, n === 1 ? 'added' : 'updated'),
    cost(2.1 * n + 0.84, 6 + 14 * n),
    phase('godot', 'dotnet build'),
    call(`tl-build-${n}`, 'Bash', 'dotnet build', { command: 'dotnet build -c Debug' }, 400),
    result(`tl-build-${n}`, 'Build succeeded.\n    0 Warning(s)\n    0 Error(s)', 8800, true, 5000),
    call(`tl-import-${n}`, 'Bash', 'godot --headless --import', { command: 'godot --headless --path . --import' }, 400),
    result(`tl-import-${n}`, 'Godot Engine v4.3.stable.mono\nImporting: res://assets/models/duck_player.glb\n', 6900, true, 4000),
    log(n % 2 === 0 ? 'WARNING: node "Fox" has no collision layer set' : 'import ok: 2 models', n % 2 === 0 ? 'warn' : 'info'),
    phase('capturing', 'xvfb-run godot --write-movie'),
    call(`tl-cap-${n}`, 'Bash', 'godot --write-movie', { command: 'xvfb-run -a godot --path . --write-movie screenshots/frame.png --fixed-fps 30 -- --trailer' }, 400),
    result(`tl-cap-${n}`, '[trailer] dawn\n[trailer] feeding\n[trailer] fox at 00:41\n[trailer] end 01:00', 61000, true, 7000),
    artifact({ ...ART.shot1, id: 'l-shot1', updatedAt: now() }, n === 1 ? 'added' : 'updated'),
    artifact({ ...ART.shot6, id: 'l-shot6', updatedAt: now() }, n === 1 ? 'added' : 'updated', 1500),
    call(`tl-ffmpeg-${n}`, 'Bash', 'ffmpeg -> trailer.mp4', { command: 'ffmpeg -y -framerate 30 -i screenshots/frame_%06d.png screenshots/duckov_raid.mp4' }, 400),
    result(`tl-ffmpeg-${n}`, 'frame= 1800 fps=230 Lsize= 21899kB time=00:01:00.00', 7800, true, 4000),
    artifact({ ...ART.video, id: 'l-video', updatedAt: now() }, n === 1 ? 'added' : 'updated'),
    cost(2.1 * n + 3.3, 6 + 14 * n + 9),
    phase('reviewing'),
    call(`tl-rev-${n}`, 'Read', 'Read screenshots/06_compound_door_kill.png', { file_path: 'screenshots/06_compound_door_kill.png' }, 800),
    result(`tl-rev-${n}`, '[image 1280x720]', 25, true, 2500),
    ...(n === 2
      ? [
          { delay: 800, ev: { type: 'needs_input', prompt: 'The fox encounter reads as too aggressive for a cozy game. Keep it, soften it (fox just steals an egg), or remove it?', options: ['Keep', 'Soften', 'Remove'] } as Ev },
          phase('waiting_input', undefined, 100),
        ]
      : []),
  ];
}
