'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'public', 'battle-arena.html');
const canonicalHtmlPath = path.resolve(root, '..', 'battle-arena.html');
const serverPath = path.join(root, 'server.js');
const packagePath = path.join(root, 'package.json');
const html = fs.readFileSync(htmlPath, 'utf8');
const serverSource = fs.readFileSync(serverPath, 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);

test('Battle Arena HTML contains the main controls and matching client', () => {
  assert.ok(html.includes('id="renderCanvas"'));
  assert.ok(html.includes('id="soundBtn"'));
  assert.ok(html.includes('id="onlineBtn"'));
  assert.ok(html.includes('rearStadiumArc'));
  assert.ok(html.includes('function ensureAudio()'));
  assert.ok(html.includes('function animateFighter('));
  assert.ok(html.includes('function applyOnlineState(packet)'));
  assert.ok(html.includes("socket.emit('matchmaking:join')"));
});

test('HTML IDs are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate id attribute found');
});

test('Inline browser JavaScript parses successfully', () => {
  assert.ok(inline, 'Inline script block not found');
  assert.doesNotThrow(() => new vm.Script(inline[1], { filename: 'battle-arena.inline.js' }));
});

test('Online server JavaScript parses and declares authoritative combat handlers', () => {
  assert.doesNotThrow(() => new vm.Script(serverSource, { filename: 'server.js' }));
  for (const eventName of ['matchmaking:join', 'battle:input', 'battle:attack', 'battle:dodge', 'battle:rematch']) {
    assert.ok(serverSource.includes(`'${eventName}'`), `Missing server event ${eventName}`);
  }
  assert.ok(serverSource.includes('target.hp = Math.max(0, target.hp - hit.damage)'));
});

test('Standalone server dependencies and start script are declared', () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(pkg.scripts.start, 'node server.js');
  assert.ok(pkg.dependencies.express);
  assert.ok(pkg.dependencies['socket.io']);
});


test('Canonical HTML is identical to the HTML served by the online server', () => {
  assert.equal(fs.readFileSync(canonicalHtmlPath, 'utf8'), html);
});
