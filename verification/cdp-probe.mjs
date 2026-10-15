import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROBE = `(() => {
  const text = (id) => { const el = document.getElementById(id); return el ? el.textContent : null; };
  const cls = (id) => { const el = document.getElementById(id); return el ? el.className : null; };
  const styled = (id) => { const el = document.getElementById(id); return el ? (el.getAttribute('style') || '') : null; };
  return JSON.stringify({
    badge: cls('webgpu-badge'),
    hangar: cls('hangar-overlay'),
    hangarTitle: text('hangar-title'),
    errorVisible: cls('error-overlay'),
    errorDetail: text('error-detail'),
    hpTracked: styled('hp-tracker'),
    hpFill: styled('hp-fill'),
    hpValue: text('hp-value'),
    score: text('score-val'),
    canvases: document.querySelectorAll('canvas').length,
    scripts: [...document.scripts].map((s) => s.src ? s.src.split('/').pop() : 'inline'),
    styleSheetCount: document.styleSheets.length,
    cssRulesLoaded: (() => { try { return [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0); } catch (e) { return 'blocked:' + e.name; } })()
  });
})()`;

function resolveBrowserBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--url');
  const expectIndex = args.indexOf('--expect-badge');
  const expectActiveIndex = args.indexOf('--expect-badge-active');
  return {
    url: urlIndex >= 0 ? args[urlIndex + 1] : null,
    expectBadgeActive: expectIndex >= 0 || expectActiveIndex >= 0,
    json: args.includes('--json')
  };
}

async function waitForDevTools(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return true;
    } catch (error) {
      void error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('DevTools endpoint never became ready on port ' + port);
}

async function findPageTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json();
  return targets.find((target) => target.type === 'page') || null;
}

function connect(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 1;
    const events = [];

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: settle, reject: fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(JSON.stringify(message.error)));
        else settle(message.result);
        return;
      }
      events.push(message);
    });
    socket.addEventListener('error', () => reject(new Error('WebSocket error')));
    socket.addEventListener('open', () => {
      const send = (method, params) => new Promise((settle, fail) => {
        const id = nextId++;
        pending.set(id, { resolve: settle, reject: fail });
        socket.send(JSON.stringify({ id, method, params: params || {} }));
      });
      resolve({ send, events, close: () => socket.close() });
    });
  });
}

async function main() {
  const options = parseArgs();
  if (!options.url) throw new Error('missing --url');

  const browserBinary = resolveBrowserBinary();
  if (!browserBinary) {
    process.stderr.write('FAILED: no browser binary found. Set CHROME_BIN or install Brave Browser / Google Chrome at the default macOS locations.\n');
    process.exit(3);
  }

  const profileDir = mkdtempSync(join(tmpdir(), 'skystrike-cdp-'));
  const port = 9300 + Math.floor(Math.random() * 400);

  const child = spawn(browserBinary, [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const deadline = Date.now() + 25000;
  let client = null;
  try {
    await waitForDevTools(port, deadline);
    const target = await findPageTarget(port);
    if (!target) throw new Error('no page target found');
    client = await connect(target.webSocketDebuggerUrl);

    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Page.enable');
    await client.send('Page.navigate', { url: options.url });

    const pageErrors = [];
    let state = null;
    const started = Date.now();
    while (Date.now() - started < 20000) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      for (const event of client.events.splice(0)) {
        if (event.method === 'Runtime.exceptionThrown') {
          pageErrors.push('exception: ' + (event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text));
        }
        if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
          pageErrors.push('log: ' + event.params.entry.text);
        }
      }
      const evaluated = await client.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      const raw = evaluated.result?.value;
      if (raw) {
        state = JSON.parse(raw);
        const badgeActive = (state.badge || '').includes('active');
        const errorShown = (state.errorVisible || '').includes('visible');
        if (badgeActive || errorShown || (state.hpTracked || '').length > 0) break;
      }
    }

    const runtimeErrors = client.events
      .filter((event) => event.method === 'Runtime.exceptionThrown')
      .map((event) => event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    pageErrors.push(...runtimeErrors);

    const result = {
      url: options.url,
      state,
      badgeActive: Boolean(state && (state.badge || '').includes('active')),
      errorVisible: Boolean(state && (state.errorVisible || '').includes('visible')),
      hullTrackerProjected: Boolean(state && (state.hpTracked || '').includes('left:')),
      errors: [...new Set(pageErrors.filter((line) => !line.includes('CVDisplayLink') && !line.includes('SharedImageManager')))]
    };

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(JSON.stringify(result) + '\n');
    }

    if (options.expectBadgeActive && !result.badgeActive) process.exitCode = 1;
  } finally {
    if (client) client.close();
    child.kill('SIGKILL');
    try { rmSync(profileDir, { recursive: true, force: true }); } catch (error) { void error; }
  }
}

main().catch((error) => {
  process.stderr.write('FAILED: ' + error.message + '\n');
  process.exit(2);
});
