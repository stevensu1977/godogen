import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { PublishResult, PublishTarget } from '@goscene/shared';

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOT = process.env.STUDIO_SHOT_SCRIPT ?? resolve(HERE, '..', '..', 'web', 'scripts', 'shot.mjs');

/** Standard build for GDScript projects, .NET build when a .csproj is present (templates must match the version). */
export function godotBinaryFor(workspace: string): string {
  const csproj = readdirSync(workspace).some(f => f.endsWith('.csproj'));
  if (csproj) return process.env.STUDIO_GODOT_MONO_BIN ?? 'godot';
  return process.env.STUDIO_GODOT_BIN ?? join(homedir(), 'godot-agent', '.tools', 'godot', 'godot');
}

const PRESETS: Record<'web' | 'linux' | 'windows' | 'macos', { name: string; platform: string; path: string; options: string }> = {
  web:     { name: 'Web',     platform: 'Web',             path: 'build/web/index.html',   options: 'variant/thread_support=false\nhtml/canvas_resize_policy=2\nhtml/focus_canvas_on_start=true\n' },
  linux:   { name: 'Linux',   platform: 'Linux',           path: 'build/linux/game.x86_64', options: 'binary_format/architecture="x86_64"\n' },
  windows: { name: 'Windows', platform: 'Windows Desktop', path: 'build/windows/game.exe',  options: 'binary_format/architecture="x86_64"\n' },
  macos:   { name: 'macOS',   platform: 'macOS',           path: 'build/macos/game.zip',    options: 'binary_format/architecture="universal"\ncodesign/codesign=0\nnotarization/notarization=0\n' },
};

/** Ensure export_presets.cfg has the presets we need; append missing ones without touching the agent's. */
export function ensurePresets(workspace: string, targets: PublishTarget[]): string[] {
  const file = join(workspace, 'export_presets.cfg');
  let text = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const added: string[] = [];
  let next = (text.match(/\[preset\.(\d+)\]/g) ?? []).length;
  for (const t of targets) {
    const p = PRESETS[t as keyof typeof PRESETS]; if (!p) continue;
    if (new RegExp(`^name="${p.name}"`, 'm').test(text)) continue;
    text += `${text && !text.endsWith('\n') ? '\n' : ''}\n[preset.${next}]\nname="${p.name}"\nplatform="${p.platform}"\nrunnable=true\nadvanced_options=false\ndedicated_server=false\ncustom_features=""\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path="${p.path}"\npatches=PackedStringArray()\nencryption_include_filters=""\nencryption_exclude_filters=""\nencrypt_pck=false\nencrypt_directory=false\nscript_export_mode=2\n\n[preset.${next}.options]\n${p.options}`;
    next++; added.push(p.name);
  }
  if (added.length) writeFileSync(file, text);
  return added;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise(res => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, DISPLAY: '' } });
    let out = '';
    const push = (d: Buffer) => { out += d.toString(); if (out.length > 200_000) out = out.slice(-200_000); };
    child.stdout.on('data', push); child.stderr.on('data', push);
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', code => { clearTimeout(t); res({ code, out }); });
    child.on('error', e => { clearTimeout(t); res({ code: -1, out: out + '\n' + e.message }); });
  });
}

async function zipDir(workspace: string, relDir: string, relZip: string): Promise<void> {
  mkdirSync(dirname(join(workspace, relZip)), { recursive: true });
  await execFileP('zip', ['-qr', join(workspace, relZip), relDir], { cwd: workspace });
}

export interface PublishContext { workspace: string; runId: string; playBase: string; log: (text: string) => void }

export async function publishTarget(ctx: PublishContext, target: PublishTarget): Promise<PublishResult> {
  const t0 = Date.now();
  const done = (ok: boolean, extra: Partial<PublishResult>, log: string): PublishResult => ({ target, ok, log: log.slice(-20_000), durationMs: Date.now() - t0, finishedAt: new Date().toISOString(), ...extra });
  const preset = PRESETS[target as keyof typeof PRESETS];
  if (!preset) return done(false, {}, `${target}: not implemented yet (phase ${target === 'android' ? 2 : target === 'ios' ? 3 : 4} in docs/publishing.md)`);
  const godot = godotBinaryFor(ctx.workspace);
  if (target === 'web' && godot === (process.env.STUDIO_GODOT_MONO_BIN ?? 'godot') && readdirSync(ctx.workspace).some(f => f.endsWith('.csproj')))
    return done(false, {}, 'web: Godot 4 cannot export C# projects to the web. Use the GDScript guide (engine godot) or the stream target.');
  const outAbs = join(ctx.workspace, preset.path);
  mkdirSync(dirname(outAbs), { recursive: true });
  ctx.log(`${target}: godot --headless --export-release ${preset.name} ${preset.path}`);
  const imp = await run(godot, ['--headless', '--path', ctx.workspace, '--import'], ctx.workspace, 300_000);
  const exp = await run(godot, ['--headless', '--path', ctx.workspace, '--export-release', preset.name, preset.path], ctx.workspace, 600_000);
  let log = `$ godot --headless --import\n${tailText(imp.out)}\n\n$ godot --headless --export-release ${preset.name} ${preset.path}\n${exp.out}`;
  const produced = existsSync(outAbs) && statSync(outAbs).size > 0;
  if (exp.code !== 0 || !produced || /No export template found|ERROR: Could not export|Failed to export/.test(exp.out))
    return done(false, {}, log + `\n\nexport exit=${exp.code}, output ${produced ? 'exists' : 'missing'}`);
  const outDir = dirname(preset.path);
  const archive = `build/${target}.zip`;
  try { await zipDir(ctx.workspace, outDir, archive); } catch (e: any) { log += `\nzip failed: ${e.message}`; }
  if (target !== 'web') return done(true, { path: preset.path, archive }, log);

  // Web: host it and prove it renders in a headless browser.
  const url = `${ctx.playBase}/play/${encodeURIComponent(ctx.runId)}/`;
  const shotRel = 'screenshots/publish/web.png';
  mkdirSync(join(ctx.workspace, 'screenshots', 'publish'), { recursive: true });
  const shot = await run('node', [SHOT, url, join(ctx.workspace, shotRel), '--wait', '25000'], ctx.workspace, 120_000);
  log += `\n\n$ headless chromium ${url}\n${shot.out}`;
  const booted = /Godot Engine v/.test(shot.out);
  const jsError = /(Uncaught|Error:|SharedArrayBuffer is not defined|Failed to load)/.test(shot.out) && !booted;
  const hasShot = existsSync(join(ctx.workspace, shotRel));
  return done(booted && hasShot && !jsError, { path: preset.path, archive, url: `/play/${encodeURIComponent(ctx.runId)}/`, screenshot: hasShot ? shotRel : undefined }, log + (booted ? '\n\nengine booted in the browser' : '\n\nengine did not report booting (no "Godot Engine v…" console line)'));
}

function tailText(s: string, n = 3000) { return s.length > n ? '…' + s.slice(-n) : s; }
