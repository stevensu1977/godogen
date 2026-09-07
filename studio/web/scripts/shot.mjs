#!/usr/bin/env node
/**
 * Headless screenshot via the Chrome DevTools Protocol (no puppeteer; uses Node's built-in WebSocket).
 * Lets the page run for a while (SSE streams never go idle, so --virtual-time-budget can't be used)
 * and prints the page's console so 3D-loader / WebGL logs are visible.
 *
 *   node scripts/shot.mjs <url> <out.png> [--wait ms] [--click css] [--eval js] [--chrome path]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args[0]; const out = args[1];
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const wait = Number(opt('--wait', '6000'));
const click = opt('--click'); const evalJs = opt('--eval');
const chrome = opt('--chrome', ['/snap/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync));
if (!url || !out || !chrome) { console.error('usage: shot.mjs <url> <out.png> [--wait ms] [--click css] [--eval js]'); process.exit(2); }

const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1440,900',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=Translate',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/studio-shot-${port}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let version;
  for (let i = 0; i < 60 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(250); } }
  if (!version) throw new Error('chromium did not expose the devtools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (!/vite\]|DevTools|Future Flag/.test(text)) console.log(`[console.${msg.params.type}] ${text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') console.log('[exception]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description ?? '');
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(wait);
  if (click) { await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(click)})?.click()` }); await sleep(1500); }
  if (evalJs) { const r = await send('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true }); console.log('[eval]', JSON.stringify(r.result?.result?.value)); await sleep(1500); }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`wrote ${out}`);
  ws.close();
} finally {
  proc.kill('SIGKILL');
}
