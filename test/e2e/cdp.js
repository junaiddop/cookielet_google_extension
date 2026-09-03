/**
 * Minimal Chrome DevTools Protocol client over `--remote-debugging-pipe`.
 *
 * Zero dependencies (Node 18+). Launches a Chromium build headlessly with the
 * unpacked extension loaded, and exposes just enough of CDP to:
 *   - find the extension's service worker target and evaluate JS inside it
 *   - open pages, wait, evaluate JS in them, capture console output
 *
 * Branded Google Chrome refuses `--load-extension`; use Chromium / Chrome for
 * Testing (e.g. the Playwright cache build). Set CHROME_BIN to override.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const candidates = [];
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        candidates.push(path.join(pw, d, sub));
      }
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('No Chromium binary found. Set CHROME_BIN (branded Chrome cannot load unpacked extensions).');
  return found;
}

class CdpBrowser {
  constructor(proc, profileDir) {
    this.proc = proc;
    this.profileDir = profileDir;
    this.nextId = 0;
    this.pending = new Map();
    this.eventListeners = [];
    this.stderr = '';
    let buf = '';
    proc.stdio[4].on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\0')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { continue; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        } else {
          for (const l of this.eventListeners) l(msg);
        }
      }
    });
    proc.stderr.on('data', (d) => { this.stderr += d; if (this.stderr.length > 200000) this.stderr = this.stderr.slice(-100000); });
  }

  send(method, params, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const msg = { id, method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      this.pending.set(id, { resolve, reject });
      this.proc.stdio[3].write(JSON.stringify(msg) + '\0');
    });
  }

  on(fn) { this.eventListeners.push(fn); return () => { this.eventListeners = this.eventListeners.filter((l) => l !== fn); }; }

  async targets() { return (await this.send('Target.getTargets')).targetInfos; }

  /** Wait for the extension service worker whose URL ends with `swPath`. */
  async serviceWorker(swPath, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let info = null;
    while (!info && Date.now() < deadline) {
      info = (await this.targets()).find((t) => t.type === 'service_worker' && t.url.endsWith(swPath));
      if (!info) await sleep(200);
    }
    if (!info) throw new Error('extension service worker not found (' + swPath + ')');
    const { sessionId } = await this.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
    const extensionId = new URL(info.url).host;
    return new CdpSession(this, sessionId, info, extensionId);
  }

  async openPage(url) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new CdpPage(this, sessionId, { targetId, url });
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Network.enable');
    if (url && url !== 'about:blank') await page.navigate(url);
    return page;
  }

  async close() {
    try { this.proc.kill('SIGKILL'); } catch (e) { /* already gone */ }
    await sleep(300);
    try { fs.rmSync(this.profileDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

class CdpSession {
  constructor(browser, sessionId, info, extensionId) {
    this.browser = browser; this.sessionId = sessionId; this.info = info; this.extensionId = extensionId;
  }
  send(method, params) { return this.browser.send(method, params, this.sessionId); }
  /** Evaluate an expression (may return a promise) and get its JSON value. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

class CdpPage extends CdpSession {
  constructor(browser, sessionId, info) {
    super(browser, sessionId, info, null);
    this.console = [];
    this.requests = [];
    this.off = browser.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.consoleAPICalled') {
        this.console.push(msg.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
      } else if (msg.method === 'Network.requestWillBeSent') {
        this.requests.push(msg.params.request.url);
      } else if (msg.method === 'Page.loadEventFired') {
        this.loaded = true;
      }
    });
  }
  async navigate(url) {
    this.loaded = false;
    await this.send('Page.navigate', { url });
    const deadline = Date.now() + 15000;
    while (!this.loaded && Date.now() < deadline) await sleep(50);
  }
  async close() {
    this.off();
    try { await this.browser.send('Target.closeTarget', { targetId: this.info.targetId }); } catch (e) { /* ignore */ }
  }
}

/**
 * Launch Chromium headless with the unpacked extension at `extensionDir`.
 * Extra args (e.g. --host-resolver-rules) can be passed via opts.args.
 */
export async function launch(extensionDir, opts = {}) {
  const bin = opts.chrome || findChrome();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookielet-e2e-'));
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
    '--user-data-dir=' + profileDir, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir,
    ...(opts.args || []), 'about:blank'
  ];
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const browser = new CdpBrowser(proc, profileDir);
  await browser.send('Target.setDiscoverTargets', { discover: true });
  return browser;
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export { B64 };
