# GAMETIK — korrigierte Testversion

## Projektdateien
Die Dateien `server.js`, `index.html` und `app.js` müssen zusammen im selben Projektordner liegen. `package.json` und `render.yaml` gehören ebenfalls in das Repository.

## Funktionen
- Gastzugang per Nickname (kein dauerhaftes Passwortkonto)
- Profilbild-Upload bis 3 MiB (JPG, PNG, WebP)
- Video-Upload bis 35 MiB (serverseitig begrenzt; akzeptierte Typen MP4, WebM, MOV)
- Feed, Likes, Kommentare und Folgen
- Öffentlicher und privater Chat per Socket.IO
- Virtuelle Geschenke nach bestätigter PayPal-Zahlung
- Optionaler externer PayPal-Spendenlink

## Lokal testen
Benötigt Node.js 20 oder neuer:
```bash
npm install
npm run check
npm start
```
Dann `http://localhost:10000` öffnen.

## Render
Build Command: `npm install`
Start Command: `npm start`
Health Check Path: `/api/health`

Für echte PayPal-Checkout-Zahlungen müssen diese Umgebungsvariablen im Render-Dashboard gesetzt werden (keine Secrets in GitHub speichern):
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_MODE` = `sandbox` zum Testen oder `live` erst nach vollständiger Prüfung
- Optional `PAYPAL_CURRENCY` (Standard EUR)
- Optional `APP_BASE_URL` falls die externe URL nicht automatisch erkannt wird
- Optional `PAYPAL_DONATION_URL` für einen separaten Spendenlink

Zuerst PayPal-Sandbox-Zahlungen testen. Der Server berücksichtigt die HTTPS-Proxy-Header von Render für PayPal-Rückleitungen. Nicht unterstützte Upload-Dateitypen werden mit HTTP 415 zurückgewiesen. Der Server stellt nur `index.html` und `app.js` öffentlich bereit; Quell- und Konfigurationsdateien werden nicht über statische Dateien ausgeliefert. Ein Syntaxcheck ist kein echter PayPal- oder Live-Deployment-Test.

## Wichtige Einschränkungen
- Der Nickname-Gastzugang ist kein geschütztes Benutzerkonto; es gibt kein Passwort und keine Passwort-Wiederherstellung.
- Sitzungen, Videos-Metadaten, Likes, Kommentare, Chat-Nachrichten, Geschenke und Bestell-Metadaten werden teilweise im Arbeitsspeicher gehalten. Ein Serverneustart kann diese Daten verlieren.
- Hochgeladene Dateien liegen im lokalen `uploads`-Ordner; auf Render können sie bei Redeploy/Neustart verloren gehen, sofern kein persistenter Datenträger eingerichtet ist.
- PayPal-API-Zugangsdaten gehören ausschließlich in Render Environment, niemals in GitHub oder in den Browser-Code.
