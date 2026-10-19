'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = __dirname;
const requiredCore = ['server.js', 'app.js', 'index.html', 'live.js', 'gift-3d.js', 'mini-games-3d.js', 'package.json'];
const jsFiles = ['server.js', 'app.js', 'live.js', 'gift-3d.js', 'mini-games-3d.js'];
let failed = false;
console.log('GameTik: Projektprüfung (fehlende Kerndateien gelten als Fehler)');
const missing = requiredCore.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  failed = true;
  console.error('[FEHLER] Fehlende Kerndateien:\n- ' + missing.join('\n- '));
}
for (const file of jsFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (result.status === 0) console.log('[OK] Syntax ' + file);
  else { failed = true; console.error('[FEHLER] Syntax ' + file + '\n' + (result.stderr || result.stdout || 'Unbekannter Syntaxfehler')); }
}
for (const file of ['index.html', 'admin.html', 'paypal.html', 'battle-arena.html', 'gametik_cyberninja_arena.html', 'GameTik-Battle-Arena-2.8.0-CyberNinja.html', 'GameTik-Battle-Arena-2.8.1-CyberNinja-FIX.html', 'GameTik-Battle-Arena-2.8.2-CyberNinja-EMBEDDED.html']) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const html = fs.readFileSync(full, 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  for (let i = 0; i < scripts.length; i++) {
    const attrs = scripts[i][1], source = scripts[i][2];
    if (!source.trim() || /\bsrc\s*=/i.test(attrs)) continue;
    const temp = path.join(root, `.gametik-check-${process.pid}-${i}.js`);
    fs.writeFileSync(temp, source);
    const result = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
    fs.rmSync(temp, { force: true });
    if (result.status === 0) console.log(`[OK] Inline-JS ${file} #${i + 1}`);
    else { failed = true; console.error(`[FEHLER] Inline-JS ${file} #${i + 1}\n${result.stderr || result.stdout}`); }
  }
}
// Detect duplicate HTML IDs on the main pages; duplicate IDs make DOM targeting unreliable.
for (const file of ['index.html', 'paypal.html']) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const html = fs.readFileSync(full, 'utf8');
  const ids = [...html.matchAll(/\bid\s*=\s*[\"']([^\"']+)[\"']/gi)].map(match => match[1]);
  const seen = new Set(); const duplicates = new Set();
  for (const id of ids) { if (seen.has(id)) duplicates.add(id); seen.add(id); }
  if (duplicates.size) { failed = true; console.error(`[FEHLER] Doppelte HTML-IDs in ${file}: ${[...duplicates].join(', ')}`); }
  else console.log(`[OK] Keine doppelten HTML-IDs in ${file}`);
}
// Dependency preflight: syntax-only checks can pass even when the server cannot start.
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dependencies = Object.keys(pkg.dependencies || {});
  const unavailable = dependencies.filter(name => {
    try { require.resolve(name, { paths: [root] }); return false; }
    catch { return true; }
  });
  if (unavailable.length) {
    failed = true;
    console.error('[FEHLER] Nicht installierte Projekt-Abhängigkeiten:\n- ' + unavailable.join('\n- ') + '\nFühre im Projektordner npm install aus.');
  } else {
    console.log(`[OK] Alle ${dependencies.length} npm-Abhängigkeiten sind auflösbar`);
  }
} catch (e) {
  failed = true;
  console.error('[FEHLER] Abhängigkeiten konnten nicht geprüft werden: ' + e.message);
}

// Verify local static src/href references; Socket.IO's client JS is served dynamically by Socket.IO.
for (const file of ['index.html', 'admin.html', 'paypal.html']) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const html = fs.readFileSync(full, 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  for (const ref of new Set(refs)) {
    if (/^(?:https?:|data:|#|mailto:|tel:|javascript:)/i.test(ref)) continue;
    const clean = ref.split(/[?#]/, 1)[0].replace(/^\//, '');
    if (!clean || clean.startsWith('api/') || clean.startsWith('socket.io/')) continue;
    if (!fs.existsSync(path.join(root, clean))) {
      failed = true;
      console.error(`[FEHLER] Lokale Datei fehlt: ${file} -> ${ref}`);
    }
  }
}

try { JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); console.log('[OK] package.json JSON'); }
catch (e) { failed = true; console.error('[FEHLER] package.json: ' + e.message); }
const checker = path.join(__dirname, 'check-project.js');
if (fs.existsSync(checker)) {
  const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
