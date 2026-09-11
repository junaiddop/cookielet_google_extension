/**
 * Tiny static server for the e2e fixtures (no dependencies).
 *
 *   node test/e2e/serve.js            # serves test/fixtures on http://127.0.0.1:8899
 *   PORT=9000 node test/e2e/serve.js
 *
 * Also usable programmatically: `import { start } from './serve.js'; const srv = await start(8899);`
 *
 * Optional: FIXTURE_EXTRA_ROOT maps `/js/` to another directory (e.g. the popup
 * builder's `js-build/` folder) so the real Cookielet `consent.js` can be tested.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', 'fixtures');
const EXTRA = process.env.FIXTURE_EXTRA_ROOT ? path.resolve(process.env.FIXTURE_EXTRA_ROOT) : null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.gif': 'image/gif'
};

function handler(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (urlPath === '/') urlPath = '/index.html';

  // Fake collect endpoint so fixtures can "send hits" to a same-origin URL when
  // the real Google hosts are unreachable (the extension only observes Google hosts,
  // so this exists purely to keep fixtures from erroring offline).
  if (urlPath.startsWith('/__collect')) { res.writeHead(204, { 'access-control-allow-origin': '*' }); res.end(); return; }

  let base = ROOT;
  if (EXTRA && urlPath.startsWith('/js/')) { base = EXTRA; urlPath = urlPath.slice(3); }
  const file = path.normalize(path.join(base, urlPath));
  if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + urlPath); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}

export function start(port = Number(process.env.PORT) || 8899, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.on('error', reject);
    srv.listen(port, host, () => resolve({ server: srv, url: 'http://' + host + ':' + port, close: () => new Promise((r) => srv.close(r)) }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then((s) => console.log('fixtures served at', s.url, 'from', ROOT, EXTRA ? '(+ /js/ -> ' + EXTRA + ')' : ''));
}

