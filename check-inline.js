'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
if (!scripts.length) {
  console.log('Keine Inline-Scripts gefunden.');
  process.exit(0);
}
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gametik-inline-'));
let failed = false;
try {
  scripts.forEach((match, index) => {
    const file = path.join(tempDir, `inline-${index + 1}.js`);
    fs.writeFileSync(file, match[2], 'utf8');
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failed = true;
      console.error(`Inline-JavaScript ${index + 1}: Syntaxfehler`);
      if (result.stderr) console.error(result.stderr.trim());
    } else {
      console.log(`Inline-JavaScript ${index + 1}: OK`);
    }
  });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
if (failed) process.exit(1);
