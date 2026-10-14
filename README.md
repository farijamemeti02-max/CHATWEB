# GameTik – Foto/Video, Storys, Reaktionen und Bewertungen

## Dateien
- `index.html` – Frontend
- `app.js` – Frontend-Logik
- `server.js` – Express API
- `package.json` – Start und Syntaxprüfung

## Lokal prüfen
Node.js 20 oder neuer installieren, dann `npm install`, `npm run check` und `npm start`.

## Neue Funktionen
- Feed akzeptiert Foto (JPG/PNG/WebP) oder Video (MP4/WebM/MOV), maximal 35 MB je Datei.
- Eigene Feed-Beiträge können gelöscht werden; der Server prüft die Eigentümerschaft.
- Eigene Storys können gelöscht werden und laufen nach 24 Stunden ab.
- Reaktionen: Herz, Gefällt mir, I Love You und Dislike.
- Bewertungen von 1 bis 10; Durchschnitt und Anzahl werden angezeigt.

## Wichtig
Dies ist weiterhin eine Demo ohne Datenbank. Nutzer, Beiträge, Reaktionen und Bewertungen liegen im Arbeitsspeicher und können nach Server-Neustarts verloren gehen. Upload-Dateien liegen lokal im Render-Service; für dauerhafte Speicherung wird persistenter Speicher oder Objektspeicher benötigt. Ein echter Live-Test gegen Render/Netlify wurde nicht durchgeführt.

## Follow-Button-Update
- Follow/Unfollow ist im Feed bei Video- und Fotobeiträgen sichtbar.
- Follow/Unfollow ist auch bei Beiträgen im Entdecken-Bereich sichtbar.
- Beim Anzeigen einer Story anderer Nutzer wird ebenfalls ein Folgen-Button angezeigt.
- Der Button benötigt eine angemeldete Sitzung. Eigene Inhalte zeigen keinen Folgen-Button.
- Die öffentliche Profilansicht anderer Nutzer ist in dieser Demo noch keine separate Profilseite; der Folgen-Button erscheint dort, wo fremde Nutzerinhalte dargestellt werden.

## Blockieren und Admin-Kontrolle
- Nutzer können andere Nutzer in Storys, Feed und Entdecken blockieren. Inhalte zwischen blockierenden Nutzern werden aus Feed/Storys/Mitgliederliste gefiltert.
- Der Administrator kann unter `/admin.html` Nutzer sperren/entsperren, Nutzer löschen sowie Beiträge und Storys entfernen. Admin-Anmeldung benötigt `ADMIN_USERNAME` und `ADMIN_PASSWORD` (mindestens 12 Zeichen) in Render.
- Aktueller Speicher ist weiterhin RAM-basiert. Sperren, Konten und Inhalte sind nach Serverneustart nicht dauerhaft; für Produktion eine Datenbank ergänzen.


## Eigene Musik zu Beiträgen
- Beim Hochladen eines Fotos oder Videos kann optional eine Musik-/Audiodatei hinzugefügt werden.
- Unterstützte Formate: MP3, M4A/MP4, AAC, WAV, OGG, WebM und FLAC.
- Die Medien- und Musikdatei dürfen jeweils maximal 35 MB groß sein.
- Die Musik wird im Feed als eigener Audio-Player unter dem Beitrag angezeigt.
- Syntaxprüfung: `node --check server.js` und `node --check app.js`.
- Hinweis: Die Demo speichert Metadaten im Arbeitsspeicher und Uploads auf dem lokalen Service-Dateisystem; für dauerhafte Produktion ist persistenter Speicher erforderlich.


## Kamera und MP3-Upload
- Beim Beitrag und in der Story-Erstellung gibt es Kamera-Buttons für Foto und Video. Auf Mobilgeräten öffnet der Browser die native Kamera; der Nutzer muss den Zugriff erlauben. Die Galerie-/Dateiauswahl bleibt ebenfalls verfügbar.
- Eigene Musik akzeptiert ausschließlich MP3 (`audio/mpeg` / `.mp3`), serverseitig validiert.
- Kamera-Capture ist abhängig von Browser und Gerät; die Seite muss über HTTPS geöffnet werden, damit Browserfunktionen zuverlässig verfügbar sind.

## Dokument-Anhänge (14.10.2026)
- Beiträge unterstützen optional einen Dokument-Anhang: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, RTF oder ZIP.
- Ein Dokument kann allein oder zusammen mit einem Foto/Video veröffentlicht werden.
- Serverseitige MIME-Filter und Dateigrößenlimit von 35 MB pro Datei gelten auch für Dokumente.
- Dokumente werden im Feed als Anhang mit Öffnen-/Download-Link angezeigt.
- Syntaxprüfung: `npm run check`.


## Navigation, Kontakte und Chat-Werkzeuge
- Storys lassen sich im Story-Viewer per Wischgeste nach links/rechts wechseln; Pfeiltasten bleiben verfügbar.
- Im privaten Chat gibt es lokale Aktionen zum Archivieren, Leeren der aktuellen Ansicht und Stummschalten für 1 Stunde, 8 Stunden, 24 Stunden, 7 Tage oder dauerhaft. Diese Einstellungen liegen im Browser und löschen keine Serverdaten.
- Der Live-Chat nutzt Socket.IO.
- Sprach-/Videoanruf-Schaltflächen sind als UI vorhanden; echte Anrufe sind noch nicht implementiert. Dafür muss eine WebRTC-Signalisierung mit Offer/Answer/ICE und Berechtigungsablauf ergänzt und live getestet werden.
- Kontakte und Chats werden in dieser Demo nicht dauerhaft in einer Datenbank gespeichert.


## Navigation-Update: fünf Hauptseiten
Die Hauptnavigation ist auf fünf übersichtliche Bereiche reduziert: Home, Entdecken, Erstellen, Nachrichten und Profil. Die Feed-Unterbereiche Home, Für dich und Freunde liegen als dezente Unterauswahl auf der Home-Seite.


## Fünf-Seiten-Navigation (14.10.2026)
- Die fünf Hauptbereiche sind Home, Entdecken, Erstellen, Nachrichten und Profil. Es wird jeweils nur der ausgewählte Bereich angezeigt.
- Touch-Gesten: nach links/rechts zwischen den Hauptbereichen wechseln; vertikale Wischgesten können ebenfalls zum vorherigen/nächsten Bereich wechseln.
- Desktop: Navigationsbuttons bleiben verfügbar; vertikales Mausrad auf dem Seitenhintergrund kann zwischen Bereichen wechseln. Innerhalb interaktiver/scrollbarer Inhalte bleibt normales Scrollen erhalten.
- Die Ansicht springt beim Seitenwechsel an den Seitenanfang. Der aktive Bereich wird in der Navigation markiert.
- JavaScript-Syntax mit `node --check` geprüft; kein vollständiger Live-/Gerätetest durchgeführt.


## Live-Streams mit WebRTC / SFU (LiveKit)
- Das Feed-Panel enthält einen Live-Bereich: Streams starten/ansehen, Kamera/Mikrofon beim Host, Teilnehmerzahl, Live-Chat und PayPal-Geschenke.
- Medien laufen über LiveKit (SFU); der Browser-SDK wird aus dem jsDelivr-CDN geladen. Die Backend-API erzeugt getrennte Host-/Viewer-Tokens. API-Secrets bleiben ausschließlich in Render-Umgebungsvariablen.
- In Render müssen `LIVEKIT_URL` (LiveKit-WebSocket-URL, üblicherweise `wss://...`), `LIVEKIT_API_KEY` und `LIVEKIT_API_SECRET` gesetzt sein. Ohne diese Angaben bleibt Live deaktiviert.
- Für PayPal müssen `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE=sandbox` (zuerst testen), `PAYPAL_CURRENCY=EUR` und `APP_BASE_URL` auf die öffentlich erreichbare GameTik-Webseite (HTTPS) gesetzt sein. Erst nach erfolgreich bestätigter PayPal-Capture-API-Antwort wird das Geschenk gespeichert. Keine Client-seitige Zahlungsbestätigung wird vertraut.
- Testmünzen sind nicht implementiert; die Geschenkbuttons starten echte PayPal-Checkout-Bestellungen mit den Preisen aus `giftCatalog`. Erst mit PayPal-Sandbox-Konten testen, dann bewusst auf `PAYPAL_MODE=live` wechseln.
- Live-Räume, Chat-/Geschenk-Metadaten und Benutzer-Sessions liegen weiterhin im Arbeitsspeicher und gehen bei Neustarts verloren. Für dauerhafte Produktion braucht GameTik eine Datenbank, Rate Limits, Moderations-/Meldesystem und dauerhaften Dateispeicher.
- `npm run check` prüft die JavaScript-Syntax. Das ersetzt keinen Ende-zu-Ende-Test mit echten LiveKit- und PayPal-Zugangsdaten.

## Render-Umgebungsvariablen
Kopiere `.env.example` als Vorlage (nicht als echte `.env` hochladen) und trage die geheimen Werte ausschließlich in Render unter Environment ein. Niemals Secrets in GitHub committen.


## Navigation, Kamera und Zahlungen (aktualisiert)
- Seitenwechsel erfolgt über sichtbare Klick-Navigation; Swipe-/Wheel-Seitenwechsel wurde entfernt. Normales Scrollen innerhalb langer Inhalte bleibt aktiv, damit Formulare und Beiträge erreichbar sind.
- Die Kamera öffnet eine echte Browser-Vorschau via `getUserMedia`; Fotos werden per Canvas aufgenommen und Videos per MediaRecorder aufgezeichnet. Funktioniert nur über HTTPS/localhost und mit Geräteberechtigung.
- `paypal.html` ist eine separate PayPal-/Geschenke-Seite und verwendet die vorhandene serverseitige Bestellroute.
- Admin Login ist über `admin.html` verlinkt. Admin-Zugangsdaten bleiben serverseitig zu konfigurieren.
