import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { PublishResult, PublishTarget } from '@goscene/shared';
import { childEnv } from './engines/types.js';

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
  // Built-in ad-hoc signing (codesign=1) works from Linux and is required for the app to launch on Apple Silicon at all.
  // Not notarized: first launch needs right-click → Open (or `xattr -cr`).
  macos:   { name: 'macOS',   platform: 'macOS',           path: 'build/macos/game.zip',    options: 'binary_format/architecture="universal"\ncodesign/codesign=0\ncodesign/identity=""\nnotarization/notarization=0\napplication/bundle_identifier="ai.goscene.game"\napplication/short_version="1.0"\napplication/version="1.0"\n'
    // codesign=0: Godot's built-in signer writes a DER entitlements blob AMFI cannot parse ("failed parsing DER entitlements" → SIGKILL on
    // Apple Silicon) and refuses rcodesign for apps with embedded dylibs (.NET). Studio re-signs the exported .app with rcodesign instead.
    // .NET (CoreCLR) JITs at runtime and loads its own dylibs: without these entitlements macOS kills the process at launch
    // ("The application can't be opened"). Harmless for GDScript, needed for GDExtension libraries too.
    + 'codesign/entitlements/allow_jit_code_execution=true\ncodesign/entitlements/allow_unsigned_executable_memory=true\ncodesign/entitlements/allow_dyld_environment_variables=true\ncodesign/entitlements/disable_library_validation=true\n' },
};

/** arm64 targets (macOS universal, Android, iOS) refuse to export unless ETC2/ASTC texture import is on. */
export function ensureProjectSettings(workspace: string, targets: PublishTarget[]): string[] {
  const needsAstc = targets.some(t => t === 'macos' || t === 'android' || t === 'ios');
  if (!needsAstc) return [];
  const file = join(workspace, 'project.godot');
  if (!existsSync(file)) return [];
  let text = readFileSync(file, 'utf-8');
  if (/^textures\/vram_compression\/import_etc2_astc=true/m.test(text)) return [];
  text = text.replace(/^textures\/vram_compression\/import_etc2_astc=false\s*$/m, '');
  if (/^\[rendering\]/m.test(text)) text = text.replace(/^\[rendering\]\s*$/m, '[rendering]\n\ntextures/vram_compression/import_etc2_astc=true');
  else text += '\n[rendering]\n\ntextures/vram_compression/import_etc2_astc=true\n';
  writeFileSync(file, text);
  return ['rendering/textures/vram_compression/import_etc2_astc=true'];
}

/**
 * Ensure export_presets.cfg has the presets we need. Missing presets are appended; for existing ones with our names,
 * the Studio-managed option keys are upserted (Godot rewrites the file on export and older attempts may have left
 * stale values) while the agent's other options are kept.
 */
export function ensurePresets(workspace: string, targets: PublishTarget[]): string[] {
  const file = join(workspace, 'export_presets.cfg');
  let text = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const changed: string[] = [];
  let next = (text.match(/\[preset\.(\d+)\]/g) ?? []).length;
  for (const t of targets) {
    const p = PRESETS[t as keyof typeof PRESETS]; if (!p) continue;
    const m = new RegExp(`\\[preset\\.(\\d+)\\]\\s*\\nname="${p.name}"`).exec(text);
    if (!m) {
      text += `${text && !text.endsWith('\n') ? '\n' : ''}\n[preset.${next}]\nname="${p.name}"\nplatform="${p.platform}"\nrunnable=true\nadvanced_options=false\ndedicated_server=false\ncustom_features=""\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path="${p.path}"\npatches=PackedStringArray()\nencryption_include_filters=""\nencryption_exclude_filters=""\nencrypt_pck=false\nencrypt_directory=false\nscript_export_mode=2\n\n[preset.${next}.options]\n${p.options}`;
      next++; changed.push(`${p.name} (added)`);
      continue;
    }
    const idx = m[1];
    const optHead = `[preset.${idx}.options]`;
    const start = text.indexOf(optHead);
    if (start < 0) { text += `\n${optHead}\n${p.options}`; changed.push(`${p.name} (options added)`); continue; }
    const bodyStart = start + optHead.length;
    const nextSection = text.slice(bodyStart).search(/\n\[preset\./);
    const bodyEnd = nextSection < 0 ? text.length : bodyStart + nextSection;
    let body = text.slice(bodyStart, bodyEnd);
    let touched = false;
    for (const line of p.options.split('\n').filter(Boolean)) {
      const key = line.split('=')[0];
      const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}=.*$`, 'm');
      if (re.test(body)) { if (!body.match(re)![0].endsWith(line.slice(key.length))) { body = body.replace(re, line); touched = true; } }
      else { body = body.replace(/\s*$/, '') + `\n${line}\n`; touched = true; }
    }
    if (touched) { text = text.slice(0, bodyStart) + body + text.slice(bodyEnd); changed.push(`${p.name} (options updated)`); }
  }
  if (changed.length) writeFileSync(file, text);
  return changed;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise(res => {
    const child = spawn(cmd, args, { cwd, env: { ...childEnv(), DISPLAY: '' } });
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

/** Godot's .NET export needs a solution file next to the .csproj; the agent often only creates the .csproj. */
export async function ensureSolution(workspace: string): Promise<string | undefined> {
  const csproj = readdirSync(workspace).find(f => f.endsWith('.csproj'));
  if (!csproj) return undefined;
  if (readdirSync(workspace).some(f => f.endsWith('.sln'))) return undefined;
  const name = csproj.replace(/\.csproj$/, '');
  const env = childEnv();
  await execFileP('dotnet', ['new', 'sln', '-n', name, '--force'], { cwd: workspace, env });
  await execFileP('dotnet', ['sln', `${name}.sln`, 'add', csproj], { cwd: workspace, env });
  return `${name}.sln`;
}

const MAC_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
`;

/**
 * Ad-hoc sign the exported macOS bundle with rcodesign (recursively: main binary + every nested Mach-O), with
 * hardened-runtime flags and the entitlements .NET / GDExtension need, then re-zip. Returns a log fragment.
 */
async function resignMacZip(workspace: string, zipRel: string): Promise<{ ok: boolean; log: string }> {
  const rcodesign = process.env.STUDIO_RCODESIGN ?? join(homedir(), '.local', 'bin', 'rcodesign');
  if (!existsSync(rcodesign)) return { ok: false, log: `rcodesign not found at ${rcodesign}; bundle left with Godot's signature` };
  const zipAbs = join(workspace, zipRel);
  const tmp = join(workspace, 'build', '.macsign'); await execFileP('rm', ['-rf', tmp]); mkdirSync(tmp, { recursive: true });
  let log = '';
  try {
    await execFileP('unzip', ['-q', zipAbs, '-d', tmp]);
    const app = readdirSync(tmp).find(f => f.endsWith('.app')); if (!app) return { ok: false, log: 'no .app in export zip' };
    const ent = join(tmp, 'entitlements.plist'); writeFileSync(ent, MAC_ENTITLEMENTS);
    const r = await execFileP(rcodesign, ['sign', '--code-signature-flags', 'runtime', '-e', ent, join(tmp, app)], { maxBuffer: 16 * 1024 * 1024 });
    log += `$ rcodesign sign --code-signature-flags runtime -e entitlements.plist "${app}"\n${(r.stderr + r.stdout).split('\n').slice(-6).join('\n')}\n`;
    await execFileP('rm', ['-f', zipAbs]);
    await execFileP('zip', ['-qry', zipAbs, app], { cwd: tmp });
    log += `re-zipped ${zipRel}`;
    return { ok: true, log };
  } catch (e: any) { return { ok: false, log: log + `\nrcodesign failed: ${e?.stderr || e?.message || e}` }; }
  finally { await execFileP('rm', ['-rf', tmp]).catch(() => undefined); }
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
  let slnNote = '';
  try { const sln = await ensureSolution(ctx.workspace); if (sln) { slnNote = `\ncreated ${sln} (required by the .NET export)\n`; ctx.log(`${target}: created ${sln} for the .NET export`); } } catch (e: any) { slnNote = `\ncould not create a solution file: ${e.message}\n`; }
  ctx.log(`${target}: godot --headless --export-release ${preset.name} ${preset.path}`);
  const imp = await run(godot, ['--headless', '--path', ctx.workspace, '--import'], ctx.workspace, 300_000);
  const exp = await run(godot, ['--headless', '--path', ctx.workspace, '--export-release', preset.name, preset.path], ctx.workspace, 600_000);
  let log = `${slnNote}$ godot --headless --import\n${tailText(imp.out)}\n\n$ godot --headless --export-release ${preset.name} ${preset.path}\n${exp.out}`;
  const produced = existsSync(outAbs) && statSync(outAbs).size > 0;
  if (exp.code !== 0 || !produced || /No export template found|ERROR: Could not export|Failed to export|ERROR: Export \.NET Project|no solution file/.test(exp.out))
    return done(false, {}, log + `\n\nexport exit=${exp.code}, output ${produced ? 'exists' : 'missing'}`);
  const outDir = dirname(preset.path);
  // macOS export is already a zip containing the .app; other targets get zipped here.
  const archive = target === 'macos' ? preset.path : `build/${target}.zip`;
  if (target !== 'macos') { try { await zipDir(ctx.workspace, outDir, archive); } catch (e: any) { log += `\nzip failed: ${e.message}`; } }
  if (target === 'macos') { const rs = await resignMacZip(ctx.workspace, preset.path); log += `\n\n${rs.log}`; if (!rs.ok) return done(false, { path: preset.path }, log); }
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
