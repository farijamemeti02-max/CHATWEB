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


## PayPal-Einrichtung (Render)

Auf Render unter **Environment** setzen:
- `PAYPAL_MODE=sandbox` zum Testen (später `live`)
- `PAYPAL_CLIENT_ID` = Client ID der passenden PayPal-App
- `PAYPAL_CLIENT_SECRET` = Secret derselben App
- `PAYPAL_CURRENCY=EUR`
- `APP_BASE_URL=https://DEINE-NETLIFY-DOMAIN.netlify.app` (die Seite, auf der `index.html` und `app.js` laufen; ohne abschließenden Schrägstrich)
- Optional `PAYPAL_DONATION_URL=https://www.paypal.com/donate/...` für den externen Spendenlink. Wenn die PayPal-API-Zugangsdaten noch fehlen, öffnet der Spendenbutton diesen HTTPS-Link als Fallback; virtuelle Geschenke benötigen weiterhin die API-Zugangsdaten.

Geschenke: Herz 0,99 €, Stern 1,99 €, Feuer 2,99 €, Krone 4,99 €. Der integrierte Spenden-Checkout erstellt eine freiwillige Spende über 5,00 € mit PayPal. Der Server bestätigt Geschenke/Spenden erst nach erfolgreicher PayPal-Capture-Bestätigung. Bei getrenntem Netlify-Frontend und Render-Backend muss `APP_BASE_URL` auf die Netlify-Frontend-Adresse zeigen, damit PayPal nach der Freigabe zur Seite mit dem Rückkehr-Handler zurückkehrt. Der Handler ruft den Capture-Endpunkt über die Render-API auf.

**Wichtig:** Diese Version speichert Benutzer, Nachrichten, Videos, Story-Metadaten und Zahlungen weiterhin im Arbeitsspeicher. Render-Neustarts können Metadaten verlieren; lokale Uploads brauchen persistenten Speicher. Die neue Sichtbarkeit schützt private Videos nur im Video-API-Feed, nicht durch ein dauerhaftes Kontensystem. Vor öffentlichem Produktivbetrieb sind Datenbank, dauerhafte Dateispeicherung, echte Registrierung/Passwort-Login, Moderation und ein Live-PayPal-Test nötig.


## Administrator-Anmeldung
- Admin-Seite: `https://DEIN-RENDER-SERVICE.onrender.com/admin.html` (oder gleiche Domain wie das Backend).
- In Render unter **Environment** `ADMIN_USERNAME` und `ADMIN_PASSWORD` setzen. Das Passwort muss mindestens 12 Zeichen lang sein. Beispiel: `ADMIN_USERNAME=TheGameTika`; verwende für `ADMIN_PASSWORD` ein eigenes, langes Passwort.
- Keine Admin-Zugangsdaten in GitHub, HTML oder Chat schreiben. Nach dem Speichern den Render-Service neu deployen/restarten.
- Das Admin-Dashboard zeigt aktuelle Demo-Sitzungen, Videos und verbuchte Geschenke; Videos können gelöscht werden. Da die Demo-Daten im Arbeitsspeicher liegen, ist dies noch keine dauerhafte Produktionsverwaltung.
- API-Routen für Admins sind durch einen separaten, acht Stunden gültigen Admin-Token geschützt.

## Sicherheits- und Funktionskorrekturen (14.10.2026)
- Admin-Anmeldung begrenzt fehlgeschlagene Versuche pro IP (maximal 10 innerhalb des Zeitfensters); erfolgreiche Anmeldung setzt den Zähler zurück.
- Zusätzliche Sicherheits-Header für MIME-Sniffing, Referrer, Framing und Browser-Berechtigungen.
- Admin-Dashboard zeigt nun auch Storys an und ermöglicht deren Löschung.
- Syntaxprüfung für `server.js`, `app.js`, Inline-JavaScript und JSON von `package.json` wurde lokal erfolgreich ausgeführt.
- ZIP-Integrität wurde geprüft.

## Noch nicht live verifiziert
- PayPal-Transaktionen wurden nicht mit echten Sandbox-Zugangsdaten ausgeführt.
- Ein vollständiger Laufzeittest mit installierten npm-Abhängigkeiten und Verbindung zu Render/Netlify war in dieser Umgebung nicht möglich.
- Nutzer, Beiträge, Story-Metadaten, Chats, Geschenke und Bestellstatus liegen derzeit teilweise im Arbeitsspeicher. Neustarts können diese Daten verlieren. Vor einem produktiven Einsatz müssen PostgreSQL/Neon und persistenter Objektspeicher (z. B. Cloudflare R2) integriert werden; Backups sind ebenfalls noch nicht automatisiert.
- Admin-Anmeldung und Dashboard sind ein grundlegender Moderationsbereich, kein vollständiges Rollen-/Meldesystem.
