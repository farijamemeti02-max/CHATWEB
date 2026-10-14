# GameTik – Story-Update

## Dateien
- `index.html` – Oberfläche und neonfarbene GameTik-Story-Buttons
- `app.js` – Frontend, Story-Erstellung und Anzeige
- `server.js` – Express-API, Uploads und Ablauf von Storys nach 24 Stunden
- `package.json` – Start- und Syntaxprüfungsbefehle

## Lokal prüfen
Node.js 20 oder neuer installieren, danach im Projektordner:

```bash
npm install
npm run check
npm start
```

## Render / Netlify
- Render Start Command: `npm start`
- Auf Render wird die API unter `https://chatweb-iajl.onrender.com` erwartet, wenn die Webseite auf einer `*.netlify.app`-Adresse läuft.
- Wenn sich die Render-Adresse ändert, muss `API_BASE` oben in `app.js` aktualisiert werden. Alternativ kann vor `app.js` eine Einstellung `window.GAMETIK_API_BASE = 'https://DEIN-RENDER-SERVICE.onrender.com';` gesetzt werden.
- Netlify muss die Frontend-Datei `index.html` und `app.js` veröffentlichen; der Node-Server läuft separat auf Render.

## Wichtige Einschränkungen
Dies ist eine Demo-Version. Nutzer-Sitzungen, Story-Metadaten, Likes, Kommentare und Chat liegen teilweise nur im Arbeitsspeicher und können nach einem Neustart verloren gehen. Upload-Dateien liegen lokal auf dem Render-Service und benötigen für dauerhafte Speicherung einen persistenten Speicher oder einen Objektspeicher. Die 24-Stunden-Ablaufzeit wird serverseitig berechnet; bei Neustart gehen Story-Metadaten verloren.

`npm run check` prüft JavaScript-Syntax, aber ersetzt keinen echten Live-Test mit den Render-Umgebungsvariablen und PayPal-Sandbox-Zugangsdaten.


## Korrektur- und Prüfhinweise (14.10.2026)
- Das GameTik-Logo und das Hamburger-Highlight sind zusätzlich direkt in `index.html` eingebettet. Dadurch erscheinen sie auch dann, wenn nur `index.html` einzeln geöffnet oder hochgeladen wird.
- `npm run check` prüft die Syntax von `server.js` und `app.js`.
- Die Gastprofile, Storys, Chat-Nachrichten, Likes und Videos werden weiterhin nur im Arbeitsspeicher gespeichert; sie sind keine dauerhafte Produktionsdatenbank.
- Ein echter End-to-End-Test gegen die veröffentlichte Render-/Netlify-Instanz wurde nicht ausgeführt.


Logo-Update: Das professionelle GameTik-Logo mit transparenter Krone ist in index.html eingebettet. Die separate Datei gametik-logo-professionell.png liegt zusätzlich im Projekt.


Navigation aktualisiert: Home, Für dich, Freunde, Posteingang und Profil. „Für dich“ und „Freunde“ öffnen derzeit den gemeinsamen Feed mit passender Überschrift; ein eigener Freundeslisten-/Empfehlungsalgorithmus ist in diesem Update nicht enthalten.


Korrektur: Der schwarze Hintergrund der Edelsteinkrone wurde transparent gemacht. Die Krone ist in index.html eingebettet; die separate PNG liegt zusätzlich als gametik-neon-edelsteinkrone-transparent.png bei.


## Deployment / CORS

- Set `ALLOWED_ORIGINS` on the backend to a comma-separated list of exact custom frontend origins if you use a custom domain, for example `https://example.com,https://www.example.com`. Netlify subdomains are allowed by default.
- Set `GAMETIK_API_BASE` in the frontend before `app.js` only if the API uses a different URL. By default the frontend uses the configured Render API URL when hosted elsewhere.
- The demo stores members, posts, stories, chat messages and gifts in memory. They can be lost when the server restarts. Uploaded files require persistent disk storage in production.
- `npm run check` checks the syntax of `server.js` and `app.js`; it does not replace a live integration test.
