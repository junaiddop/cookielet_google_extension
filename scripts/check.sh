#!/usr/bin/env bash
# Static checks: syntax of every script, manifest/locales validity, import graph, popup ⇄ sidepanel parity, unit tests.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "· syntax"
find src test/e2e test/unit -name '*.js' -print0 | xargs -0 -n1 node --check
echo "· manifest + locales"
node -e "const m=require('./manifest.json'); const l=require('./_locales/en/messages.json'); if(!l.extName||!l.extDescription) throw new Error('missing locale keys'); if(m.key||m.update_url) throw new Error('manifest must not carry key/update_url'); console.log('  ok v'+m.version)"
echo "· import graph"
node --input-type=module -e "
import fs from 'node:fs'; import path from 'node:path';
const files=[]; (function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);} })('src');
let bad=0; for (const f of files) for (const m of fs.readFileSync(f,'utf8').matchAll(/from\s+'([^']+)'/g)) { const s=m[1]; if(!s.startsWith('.')||!s.endsWith('.js')||!fs.existsSync(path.resolve(path.dirname(f),s))) { console.log('  BAD import', f, s); bad++; } }
if (bad) process.exit(1); console.log('  ok', files.length, 'files');"
echo "· sidepanel.html parity"
diff <(sed 's/data-ctx="popup"/data-ctx="X"/' src/popup/popup.html) <(sed 's/data-ctx="sidepanel"/data-ctx="X"/' src/popup/sidepanel.html) >/dev/null || { echo "  sidepanel.html differs from popup.html beyond data-ctx"; exit 1; }
echo "  ok"
echo "· unit tests"
node --test test/unit/ 2>&1 | grep -E '^# (tests|pass|fail)'
