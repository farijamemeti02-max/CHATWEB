'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html'), server = read('server.js'), live = read('live.js'), paypal = read('paypal.html');
const checks = [
  ['Einstellungen-Menü', html.includes('id="gtSettingsToggle"') && html.includes('id="gtSettingsMenu"')],
  ['5×3 GameTik-Automat', html.includes('gt-casino-reels') && live.includes('Array.from({length:15}') && server.includes("grid = Array.from({length:15}")],
  ['GAMETIK-Bonus und Freispiele', server.includes('logoCount >= 3') && server.includes('candyFreeSpins')],
  ['200 Premium-Geschenkstufen', paypal.includes('price<=1000;price+=5') && server.includes('GAMETIK-GIFT-')],
  ['Story-Kreise im Posteingang', html.includes('gt-inbox-stories')],
  ['Kamera-3D-Optik', html.includes('camera-action .camera-icon:before')],
  ['Controller öffnet Spielemenü', html.includes('function openGames()') && html.includes('/battle-arena.html')],
];
let failed = false;
for (const [name, ok] of checks) { console.log(`${ok ? 'OK' : 'FEHLER'} ${name}`); if (!ok) failed = true; }
if (failed) process.exitCode = 1;
