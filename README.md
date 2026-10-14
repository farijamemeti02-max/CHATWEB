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
- In der Filebase-Version werden neue Uploads (Videos, Fotos und Profilbilder) im privaten S3-Bucket gespeichert, sofern alle fünf `S3_*`-Umgebungsvariablen korrekt gesetzt sind. Ohne diese Konfiguration schlagen Uploads mit einer verständlichen Fehlermeldung fehl.
- PayPal-API-Zugangsdaten gehören ausschließlich in Render Environment, niemals in GitHub oder in den Browser-Code.


## Eigene Videos löschen
- Im Feed erscheint bei deinen eigenen Videos die Schaltfläche **Video löschen**.
- Nach einer Bestätigung wird das Video aus dem Feed entfernt und die zugehörige Datei aus Filebase gelöscht, sofern der Beitrag in der aktuellen Serversitzung existiert und Filebase erreichbar ist.
- Der Server erlaubt das Löschen ausschließlich dem Besitzer des Videos. Andere Nutzer erhalten HTTP 403.
- Video-Metadaten liegen weiterhin im Arbeitsspeicher und können bei Neustart oder Redeploy verloren gehen. Das externe Speichern der Mediendatei macht den Beitragseintrag selbst noch nicht dauerhaft.


## Profil, Fotos und Bewertungen
- Profilbild hochladen bis 3 MB (JPG/PNG/WebP).
- Profilbeschreibung bearbeiten (bis 300 Zeichen).
- Foto-Beiträge veröffentlichen bis 8 MB (JPG/PNG/WebP).
- Beiträge können gelikt und kommentiert werden.
- Angemeldete Gastprofile können Beiträge von 1 bis 10 bewerten; pro Profil zählt die jeweils letzte Bewertung.
- Die Anwendung nutzt weiterhin Arbeitsspeicher für Profile, Beiträge, Kommentare, Likes und Bewertungen; diese Daten sind nicht dauerhaft und werden bei Neustarts zurückgesetzt.


## Filebase S3 storage

The server stores uploaded videos, photos, and avatars in the configured private Filebase S3 bucket. The server proxies `/media/*` reads so the Filebase access key and secret never reach the browser. Configure these Render environment variables:

- `S3_ENDPOINT=https://s3.filebase.io`
- `S3_BUCKET=gametik-media`
- `S3_REGION=auto`
- `S3_ACCESS_KEY_ID` = Filebase access key ID
- `S3_SECRET_ACCESS_KEY` = Filebase secret access key

The Filebase credentials must stay in Render environment variables, never in GitHub or frontend JavaScript. Uploaded media files persist in Filebase. **Important limitation:** this version still keeps user accounts, sessions, posts, likes, comments, chats, and payment order metadata in RAM. Those records reset when Render restarts. A PostgreSQL database (e.g. Neon) and backup job are still required before the whole platform is persistent. The current health endpoint reports `database: not-configured` and the object-storage status separately.
