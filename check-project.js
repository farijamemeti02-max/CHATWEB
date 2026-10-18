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
  [fs.existsSync(path.join(root, 'battle-arena.html')) && arena.includes('FULL 3D ANIMATION 1.9.86'), 'Battle-Arena 1.9.86 mit vollständiger 3D-Kennzeichnung fehlt'],
  [arena.includes('cdn.babylonjs.com/babylon.js') && arena.includes('cdn.jsdelivr.net/npm/babylonjs@7.54.3/babylon.js') && arena.includes('window.__bootArena'), 'Mehrfach-CDN-Lader für Babylon.js fehlt'],
  [arena.includes('show3DError(engineError') && arena.includes('show3DError(sceneError') && !arena.includes('activateSafe2D(engineError') && !arena.includes('activateSafe2D(sceneError'), 'Arena darf bei Fehlern nicht auf 2D umschalten'],
  [arena.includes('CAREER_KEY') && arena.includes('ACHIEVEMENTS') && arena.includes('challengeSelect'), 'Karriere-, Erfolge- oder Challenge-System der Arena fehlt'],
  [arena.includes('fighterCharacters') && arena.includes('data-character') && arena.includes('applyCharacter'), 'Freischaltbare 3D-Charaktere fehlen'],
  [arena.includes('CHARACTER_KEY') && arena.includes('updateCharacterChoices') && arena.includes('updateStyleChoices'), 'Charakter-/Outfit-Freischaltung oder Speicherung fehlt'],
  [arena.includes('Online-Ranglisten akzeptieren erst Ergebnisse aus servergeprüften Online-Duellen'), 'Hinweis auf servergeprüfte Online-Ergebnisse fehlt'],
  [arena.includes("$('exitBtn').onclick=()=>{location.assign('/');};"), 'Zuverlässige Zurück-Navigation zur GameTik-Startseite fehlt'],
  [arena.includes("$('resultRematchBtn').onclick=restart") && arena.includes("$('restartBtn').onclick=restart"), 'Erneut-spielen-/Neue-Runde-Buttons sind nicht mit Neustart verbunden'],
  [arena.includes('.resultOverlay:not(.hidden) ~ .touch{display:none!important}') && arena.includes('id="touchControls"') && arena.includes('touchControls.hidden=true'), 'Touch-Steuerung wird bei Ergebnisanzeige nicht sicher ausgeblendet'],
  [arena.includes('touchControls.hidden=false'), 'Touch-Steuerung wird nach Neustart nicht korrekt wiederhergestellt'],
  [arena.includes('.resultOverlay{position:absolute;inset:0;z-index:20;') && arena.includes('.touch{display:none;position:absolute;inset:auto 12px 12px;justify-content:space-between;align-items:end;pointer-events:none;z-index:5}'), 'Ergebnisfenster liegt nicht sicher über der Touch-Steuerung'],
  [arena.includes('button[data-action=\"restart\"]{grid-column:3;grid-row:2;border-radius:14px;width:100%;min-width:0;max-width:100%;height:48px;padding:0 3px;'), 'Mobile Neustart-Schaltfläche kann aus ihrer Grid-Spalte überlaufen'],
  [pkg.version === '1.9.86', 'Projektversion ist nicht auf 1.9.86 aktualisiert'],
  [live.includes('LivekitClient.Room') && live.includes("'/api/live/create'"), 'LiveKit-Client-Verbindung fehlt'],
  [Boolean(pkg.dependencies['livekit-server-sdk']), 'LiveKit-Server-SDK fehlt'],
  [server.includes('process.env.PORT || 10000'), 'Render-Port-Fallback fehlt'],
  [server.includes("app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')))"), 'Startseite wird nicht korrekt ausgeliefert'],
  [server.includes("httpServer.listen(PORT, '0.0.0.0'"), 'HTTP-Server bindet nicht an 0.0.0.0 für Render'],
  [server.includes('35 * 1024 * 1024'), '35-MB-Videolimit fehlt'],
  [server.includes("app.get('/api/arena/ranked-status'") && server.includes("enabled: false") && server.includes("app.post('/api/arena/ranked-result'") && server.includes('accepted: false'), 'Online-Ranglisten nehmen keine ungeprüften Browser-Ergebnisse an'],
  [arena.includes('id="characterOverlay"') && arena.includes('id="characterBtn"') && arena.includes('data-character="titan"'), 'Charakterauswahl ist nicht vollständig eingebunden'],
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
const arenaIds = [...arena.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicateArenaIds = [...new Set(arenaIds.filter((id, index) => arenaIds.indexOf(id) !== index))];
required.push([duplicateArenaIds.length === 0, duplicateArenaIds.length ? `Doppelte IDs in battle-arena.html: ${duplicateArenaIds.slice(0, 10).join(', ')}` : 'Keine doppelten IDs in battle-arena.html']);
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
