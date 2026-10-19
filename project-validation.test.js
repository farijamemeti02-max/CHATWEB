'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const server = read('server.js');
const live = read('live.js');

test('GameTik candy slot keeps five reels and three rows', () => {
  assert.ok(html.includes('id="liveCasinoReels"'));
  assert.ok(html.includes('aria-label="Fünf Walzen mit je drei Symbolen"'));
  assert.ok(live.includes('Array.from({length:15}'));
  assert.ok(server.includes('grid = Array.from({length:15}'));
});
test('Planet symbols use dimensional planet styling instead of text placeholders', () => {
  for (const name of ['ERDE','MARS','JUPITER','SATURN','NEPTUN','URANUS','PLUTO','SONNE','GALAXIE']) assert.ok(html.includes(name));
  assert.ok(html.includes('gt-casino-symbol.gt-planet:before'));
  assert.ok(fs.existsSync(path.join(root, 'gametik-crown-bonus.svg')));
});
test('Crown bonus awards ten free spins and crown surprise is one-time server-side', () => {
  assert.ok(server.includes('logoCount >= 3'));
  assert.ok(server.includes("app.post('/api/candy/crown-open'"));
  assert.ok(server.includes('candyCrownClaims.delete(token)'));
  assert.ok(live.includes('gtFreeSpinIntro'));
  assert.ok(live.includes('/api/candy/crown-open'));
});
test('Live gift renderer remains event-driven and available', () => {
  const gifts = read('gift-3d.js');
  assert.ok(html.includes('<script src="/gift-3d.js" defer></script>'));
  assert.ok(gifts.includes('new T.WebGLRenderer'));
  assert.ok(live.includes('GameTikGift3D?.play'));
});
test('Core JavaScript parses and CyberNinja 2.8.2 is retained', () => {
  for (const file of ['server.js','live.js','gift-3d.js']) assert.doesNotThrow(() => new vm.Script(read(file), {filename:file}));
  assert.ok(fs.existsSync(path.join(root, 'GameTik-Battle-Arena-2.8.2-CyberNinja-EMBEDDED.html')));
});
test('admin.html remains present and server serves the project root', () => {
  assert.ok(fs.existsSync(path.join(root, 'admin.html')));
  assert.ok(server.includes('const publicDir = __dirname;'));
});
