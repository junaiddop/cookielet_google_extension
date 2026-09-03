import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVT, MSG, POST_SOURCE, POST_SOURCE_HELLO, POST_SOURCE_READY, POST_SOURCE_CMD, PAGE_CMDS } from '../../src/shared/constants.js';

const injector = readFileSync(new URL('../../src/content/page_injector.js', import.meta.url), 'utf8');
const relay = readFileSync(new URL('../../src/content/content_script.js', import.meta.url), 'utf8');
const state = readFileSync(new URL('../../src/background/state.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
const messages = JSON.parse(readFileSync(new URL('../../_locales/en/messages.json', import.meta.url), 'utf8'));

test('injector emits every EVT literal the worker understands', () => {
  for (const evt of Object.values(EVT)) {
    assert.ok(injector.includes("'" + evt + "'"), 'injector emits ' + evt);
    assert.ok(state.includes('EVT.' + evt), 'state.js handles ' + evt);
  }
});

test('handshake / command literals are mirrored in both content scripts', () => {
  for (const lit of [POST_SOURCE, POST_SOURCE_HELLO, POST_SOURCE_READY, POST_SOURCE_CMD]) {
    assert.ok(injector.includes("'" + lit + "'"), 'injector has ' + lit);
    assert.ok(relay.includes("'" + lit + "'"), 'relay has ' + lit);
  }
  assert.ok(relay.includes("'" + MSG.RECORD + "'"));
  assert.ok(relay.includes("'" + MSG.PAGE_CMD + "'"));
  assert.ok(injector.includes("'" + PAGE_CMDS.REPROBE + "'"));
});

test('content scripts are console-silent unless debug and never use innerHTML/eval', () => {
  const consoleCalls = (injector.match(/console\.log/g) || []).length;
  assert.equal(consoleCalls, 1, 'exactly one console.log call site (inside dbg())');
  assert.ok(!/innerHTML|eval\(|new Function|document\.write|createElement\(\s*['"]script/.test(injector));
  assert.ok(!/\bchrome\.(runtime|storage|tabs|scripting|action)\b/.test(injector), 'MAIN world has no chrome.* API');
  assert.ok(!/import |require\(/.test(injector) && !/import |require\(/.test(relay), 'classic scripts');
});

test('manifest is store-shaped', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, 'module');
  assert.ok(manifest.name.startsWith('__MSG_') && messages.extName);
  assert.ok(messages.extDescription.message.length <= 132);
  assert.ok(messages.extName.message.length <= 75);
  assert.ok(!manifest.key && !manifest.update_url);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'sidePanel', 'storage', 'webRequest']);
  assert.equal(manifest.content_scripts.find((c) => c.world === 'MAIN').js[0], 'src/content/page_injector.js');
  assert.ok(manifest.content_scripts.every((c) => c.run_at === 'document_start' && c.all_frames === false));
});
