'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const server = read('server.js');
const html = read('index.html');
const live = read('live.js');
const pkg = JSON.parse(read('package.json'));
const required = [
  [server.includes("app.post('/api/live/create'"), 'Live-Stream-Erstellung fehlt'],
  [server.includes("app.post('/api/live/:id/join'"), 'Live-Join-Route fehlt'],
  [server.includes("app.post('/api/live/:id/end'"), 'Live-Ende-Route fehlt'],
  [server.includes("app.post('/api/live/:id/game/start'") && server.includes("app.post('/api/live/:id/game/stop'"), 'LIVE-Spielstart/-ende fehlt'],
  [server.includes("liveRoom.game.hostPoints") && server.includes("room.game.communityPoints"), 'LIVE-Spiel-Punktelogik fehlt'],
  [server.includes("app.get('/api/live/:id/count'"), 'Live-Zuschauerroute fehlt'],
  [server.includes("app.post('/api/payments/paypal/create-order'"), 'PayPal-Order-Route fehlt'],
  [server.includes("app.post('/api/payments/paypal/capture-order'"), 'PayPal-Capture-Route fehlt'],
  [server.includes("const viewer = getSession(req);"), 'Story-Session-Fix fehlt'],
  [html.includes('id="livePanel"') && html.includes('src="/live.js"'), 'Live-Frontend fehlt'],
  [html.includes('id="liveGamePanel"') && html.includes('id="liveGameTimer"') && html.includes('id="liveGameHostPoints"') && html.includes('id="liveGameCommunityPoints"'), 'LIVE-Spielanzeige fehlt'],
  [live.includes('live:game-state') && live.includes('/game/start'), 'LIVE-Spiel-Frontend fehlt'],
  [live.includes('LivekitClient.Room') && live.includes("'/api/live/create'"), 'LiveKit-Client-Verbindung fehlt'],
  [Boolean(pkg.dependencies['livekit-server-sdk']), 'LiveKit-Server-SDK fehlt'],
  [server.includes('process.env.PORT || 10000'), 'Render-Port-Fallback fehlt'],
  [server.includes("app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')))"), 'Startseite wird nicht korrekt ausgeliefert'],
  [server.includes("httpServer.listen(PORT, '0.0.0.0'"), 'HTTP-Server bindet nicht an 0.0.0.0 für Render'],
  [server.includes('35 * 1024 * 1024'), '35-MB-Videolimit fehlt'],
  [server.includes("app.get('/api/health'"), 'Health-Check für Render fehlt'],
];
const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) { console.error('Projektprüfung fehlgeschlagen:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log(`Projektprüfung erfolgreich: ${required.length} Kernprüfungen bestanden.`);
