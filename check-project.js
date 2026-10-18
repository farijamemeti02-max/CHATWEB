'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const server = read('server.js');
const html = read('index.html');
const live = read('live.js');
const gifts3d = read('gift-3d.js');
const games3d = read('mini-games-3d.js');
const arena = read('battle-arena.html');
const pkg = JSON.parse(read('package.json'));
const required = [
  [server.includes("app.set('trust proxy', 1)"), 'Render-Proxy-Vertrauen für korrekte IP-basierte Admin-Sperre fehlt'],
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
  [html.includes('src="/gift-3d.js"') && gifts3d.includes('window.GameTikGift3D={play,normalizeName}'), '3D-Geschenkmodul ist nicht korrekt eingebunden'],
  [html.includes('src="/mini-games-3d.js"') && games3d.includes('Candy World 3D') && games3d.includes('Neon Racer 3D') && games3d.includes('Space Candy 3D'), '3D-Minispiele fehlen oder sind nicht eingebunden'],
  [html.includes('data-gt-open-games') && html.includes('data-nav="games"'), 'Spiele-Schaltfläche für Desktop/Mobil fehlt'],
  [games3d.includes('id=\"gtmgBattleArena\"') && games3d.includes("location.href='/battle-arena.html'"), 'Battle-Arena-Einstieg im Spielemenü fehlt'],
  [fs.existsSync(path.join(root, 'battle-arena.html')) && arena.includes('CDN-FALLBACK HOTFIX 1.9.78'), 'Battle-Arena 1.9.78 mit CDN-Fallback fehlt'],
  [arena.includes('!window.BABYLON') && arena.includes('Playable 2D fallback') && arena.includes("get('mode')==='2d'") && arena.includes("searchParams.set('mode','2d')"), '2D-Fallback bei nicht verfügbarer Babylon.js-Bibliothek fehlt'],
  [arena.includes('CAREER_KEY') && arena.includes('ACHIEVEMENTS') && arena.includes('challengeSelect'), 'Karriere-, Erfolge- oder Challenge-System der Arena fehlt'],
  [live.includes('LivekitClient.Room') && live.includes("'/api/live/create'"), 'LiveKit-Client-Verbindung fehlt'],
  [Boolean(pkg.dependencies['livekit-server-sdk']), 'LiveKit-Server-SDK fehlt'],
  [server.includes('process.env.PORT || 10000'), 'Render-Port-Fallback fehlt'],
  [server.includes("app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')))"), 'Startseite wird nicht korrekt ausgeliefert'],
  [server.includes("httpServer.listen(PORT, '0.0.0.0'"), 'HTTP-Server bindet nicht an 0.0.0.0 für Render'],
  [server.includes('35 * 1024 * 1024'), '35-MB-Videolimit fehlt'],
  [server.includes("app.get('/api/health'"), 'Health-Check für Render fehlt'],
  [server.includes("app.post('/api/auth/forgot-password'") && server.includes("app.post('/api/auth/reset-password'"), 'Passwort-Reset-API fehlt'],
  [server.includes('https://api.brevo.com/v3/smtp/email') && server.includes('process.env.BREVO_API_KEY'), 'Brevo-HTTPS-Mailversand fehlt'],
  [server.includes('@aws-sdk/client-s3') && server.includes("app.post('/api/me/avatar'") && server.includes('PutObjectCommand') && server.includes('ListObjectsV2Command'), 'Cloudflare-R2-Profilbildspeicherung/-wiederherstellung fehlt'],
  [html.includes('id="forgotPasswordBtn"') && html.includes('id="resetPasswordForm"'), 'Passwort-Reset-Frontend fehlt'],
  [server.includes('await savePersistentState()') && server.includes('account.avatar_url = user.avatar_url'), 'Wartende, dauerhafte Avatar-/Kontospeicherung fehlt'],
  [server.includes('APP_BASE_URL') && server.includes('RENDER_EXTERNAL_URL') && server.includes('sendBrevoEmail'), 'Passwort-Reset-Konfiguration fehlt'],
  [Boolean(pkg.dependencies.pg), 'PostgreSQL-Treiber fehlt'],
  [html.includes('id="gtAccountQuick"') && html.includes('id="authModal"'), 'Sichtbarer Konto-erstellen-/Anmelden-Schnellzugriff fehlt'],
  [html.includes('href="/paypal.html"') && html.includes('href="/admin.html"'), 'Sichtbare PayPal-/Admin-Schnellzugriffe fehlen'],
  [server.includes('function revivePersistentTypes(value)') && server.includes('d = revivePersistentTypes(d || {})'), 'PostgreSQL-JSONB-Wiederherstellung von Set-Werten fehlt'],
];
// Additional structural checks: catch duplicate HTML IDs and missing local assets.
const idMatches = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicateIds = [...new Set(idMatches.filter((id, index) => idMatches.indexOf(id) !== index))];
required.push([duplicateIds.length === 0, duplicateIds.length ? `Doppelte IDs in index.html: ${duplicateIds.slice(0, 10).join(', ')}` : 'Keine doppelten IDs in index.html']);
const localRefs = [...html.matchAll(/(?:src|href)=["']([^"'#?]+)(?:[?#][^"']*)?["']/gi)]
  .map(match => match[1])
  .filter(ref => !/^(?:https?:)?\/\//i.test(ref) && !ref.startsWith('data:') && !ref.startsWith('mailto:') && !ref.startsWith('tel:'));
const missingRefs = [...new Set(localRefs)].filter(ref => {
  // Socket.IO serves this script dynamically from the running Express server.
  if (ref === '/socket.io/socket.io.js' || ref === 'socket.io/socket.io.js') return false;
  const relative = ref.startsWith('/') ? ref.slice(1) : ref;
  return !fs.existsSync(path.join(root, relative));
});
required.push([missingRefs.length === 0, missingRefs.length ? `Fehlende lokale HTML-Dateien: ${missingRefs.slice(0, 10).join(', ')}` : 'Alle lokalen HTML-Dateiverweise vorhanden']);

const failures = required.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) { console.error('Projektprüfung fehlgeschlagen:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log(`Projektprüfung erfolgreich: ${required.length} Kernprüfungen bestanden.`);
