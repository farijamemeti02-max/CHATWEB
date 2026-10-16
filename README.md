## Update 1.9.83 – Battle-Arena-Touchsteuerung

- Beim Ergebnisdialog wird die mobile Touch-Steuerung explizit ausgeblendet und liegt auch per Ebenenreihenfolge hinter dem Ergebnisfenster.
- Nach „Noch einmal“ wird die Touch-Steuerung wieder eingeblendet.
- Der 2D-Sicherheitsmodus blendet die Steuerung bei Rundenende ebenfalls aus und stellt sie nach einem Neustart wieder her.
- „← Zurück“ navigiert zur GameTik-Startseite.
- `npm run check` und zusätzliche Syntax-/HTML-/SVG-Prüfungen wurden ausgeführt. Ein echter Smartphone-/Render-/PayPal-/LiveKit-End-to-End-Test ist nicht Teil dieser statischen Prüfungen.

# GameTik – Foto/Video, Storys, Reaktionen und Bewertungen

## Dateien
- `index.html` – Frontend
- `app.js` – Frontend-Logik
- `server.js` – Express API
- `package.json` – Start und Syntaxprüfung

## Lokal prüfen
Node.js 20 oder neuer installieren, dann `npm install`, `npm run check` und `npm start`.

Der Express-Startcode ist bereits in `server.js` integriert: `process.env.PORT` wird für Render verwendet, `GET /` liefert die eigentliche GameTik-Startseite und `httpServer.listen(PORT, '0.0.0.0')` startet den HTTP-Server einschließlich Socket.IO. Den einfachen Beispieltext `Hello World!` verwenden wir absichtlich nicht als Startseiten-Antwort, weil dadurch die GameTik-Webseite ersetzt würde.

## Passwort zurücksetzen per E-Mail (Brevo HTTPS API)
- In Render unter **Environment** diese Variablen setzen: `BREVO_API_KEY`, `SMTP_FROM` und `APP_BASE_URL`.
- `BREVO_API_KEY` ist der geheime **Brevo API-v3-Schlüssel**, nicht das SMTP-Passwort. Niemals in GitHub committen.
- `SMTP_FROM` muss eine bei Brevo bestätigte Absenderadresse enthalten, zum Beispiel `GameTik <name@deine-domain.de>`.
- `APP_BASE_URL` muss die vollständige HTTPS-Adresse der GameTik-Webseite sein, ohne abschließenden Pfad.
- Die Reset-E-Mail enthält die direkte GameTik-Adresse als Text statt eines anklickbaren Brevo-Tracking-Buttons, damit ein defekter Tracking-Redirect den Reset nicht blockiert.
- Der Link ist einmalig und 60 Minuten gültig. Nach erfolgreicher Passwortänderung werden bestehende Sitzungen abgemeldet.
- Die Funktion muss nach dem Deploy mit echten Render-Variablen live getestet werden.

## Cloudflare R2
- Der Server nutzt R2 für neue Profilbilder, Story-Medien und Feed-Anhänge, wenn `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` und `R2_SECRET_ACCESS_KEY` gesetzt sind. `R2_REGION` ist normalerweise `auto`.
- Wenn R2 nicht vollständig konfiguriert ist, verwendet die Anwendung lokale Uploads; diese sind auf Render ohne Persistent Disk nicht dauerhaft.
- R2 speichert Medienobjekte, aber nicht automatisch Konten und App-Daten. Dafür bleibt `DATA_DIR` auf einer Render Persistent Disk nötig.

## Neue Funktionen
- Feed akzeptiert Foto (JPG/PNG/WebP) oder Video (MP4/WebM/MOV), maximal 35 MB je Datei.
- Eigene Feed-Beiträge können gelöscht werden; der Server prüft die Eigentümerschaft.
- Eigene Storys können gelöscht werden und laufen nach 24 Stunden ab.
- Reaktionen: Herz, Gefällt mir, I Love You und Dislike.
- Bewertungen von 1 bis 10; Durchschnitt und Anzahl werden angezeigt.

## Registrierung, Anmeldung und dauerhafte Speicherung
- Nutzer können ein Konto mit Benutzername, E-Mail und Passwort registrieren und sich später anmelden.
- Passwörter werden mit `scrypt` plus individuellem Salt gehasht; Klartextpasswörter werden nicht gespeichert.
- Konten, Sitzungen, Profile, Social-Beziehungen, Beiträge und weitere App-Zustände werden als JSONB-Datensatz in Neon PostgreSQL gespeichert, wenn `DATABASE_URL` gesetzt ist.
- Lokale JSON-Dateien dienen nur als Fallback/Import beim erstmaligen Anlegen des Datenbankdatensatzes; ein lokales Render-Dateisystem ist ohne Persistent Disk nicht dauerhaft.
- Medien werden in Cloudflare R2 gespeichert, wenn die R2-Variablen vollständig konfiguriert sind.

### Render dauerhaft konfigurieren (wichtig)
In diesem Projekt ist Neon PostgreSQL die dauerhafte Datenbank. Prüfe, dass `DATABASE_URL` in Render auf die richtige Neon-Datenbank zeigt und `/api/health` `ok: true` sowie `database: "postgresql-connected"` meldet. Render-Logs müssen `GameTik state loaded from PostgreSQL` oder `GameTik PostgreSQL state table initialized` zeigen. R2 speichert Medien; Neon speichert Konten und App-Zustand.

### Grenzen
Diese dateibasierte Speicherung ist für einen kleinen Testbetrieb gedacht und nicht für mehrere gleichzeitig laufende Serverinstanzen. Für einen großen öffentlichen Dienst sollten PostgreSQL und ein dauerhafter Objektspeicher verwendet werden. Vorhandene Gastkonten werden nicht automatisch in registrierte Konten umgewandelt. Ein echter Live-Test gegen Render/Netlify wurde nicht durchgeführt.

## Follow-Button-Update
- Follow/Unfollow ist im Feed bei Video- und Fotobeiträgen sichtbar.
- Follow/Unfollow ist auch bei Beiträgen im Entdecken-Bereich sichtbar.
- Beim Anzeigen einer Story anderer Nutzer wird ebenfalls ein Folgen-Button angezeigt.
- Der Button benötigt eine angemeldete Sitzung. Eigene Inhalte zeigen keinen Folgen-Button.
- Die öffentliche Profilansicht anderer Nutzer ist in dieser Demo noch keine separate Profilseite; der Folgen-Button erscheint dort, wo fremde Nutzerinhalte dargestellt werden.

## Blockieren und Admin-Kontrolle
- Nutzer können andere Nutzer in Storys, Feed und Entdecken blockieren. Inhalte zwischen blockierenden Nutzern werden aus Feed/Storys/Mitgliederliste gefiltert.
- Der Administrator kann unter `/admin.html` Nutzer sperren/entsperren, Nutzer löschen sowie Beiträge und Storys entfernen. Admin-Anmeldung benötigt `ADMIN_USERNAME` und `ADMIN_PASSWORD` (mindestens 12 Zeichen) in Render.
- Konten und ein Teil der Inhalte werden dateibasiert in `DATA_DIR/gametik-state.json` gespeichert. Für dauerhafte Speicherung auf Render muss `DATA_DIR` auf eine tatsächlich gemountete, beschreibbare Persistent Disk zeigen.


## Geschenk-Icons
- Die vier gelieferten SVG-Dateien `gift-heart.svg`, `gift-star.svg`, `gift-fire.svg` und `gift-crown.svg` werden in der Hauptseite, im LIVE-Bereich und auf `paypal.html` als lokale Dateien verwendet.

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


## Optionales LIVE-Spiel (Countdown, Punkte und Geschenke)
- Im Live-Bereich gibt es jetzt ein freiwillig startbares Spiel mit 1-, 3-, 5- oder 10-Minuten-Runden. Nur der Host kann die Runde starten oder beenden.
- Der Server führt den Countdown und sendet den Spielstand an alle verbundenen Live-Zuschauer. Likes geben dem Community-Team je 1 Punkt.
- Nur nach erfolgreicher serverseitiger PayPal-Capture-Bestätigung werden bezahlte Geschenke gewertet: Herz 99, Stern 199, Feuer 299 und Krone 499 Punkte für das Streamer-Team. Ein Klick auf einen Geschenkbutton allein gibt keine Punkte.
- Der Spielstand wird im Arbeitsspeicher gehalten und wird nach einem Server-Neustart zurückgesetzt. Diese Runde ist ein Streamer-gegen-Community-Spiel, noch kein 1-gegen-1-Kamera-Duell.

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

## 1:1-Sprach- und Videoanrufe

Die Chat-Oberfläche enthält jetzt eine WebRTC-Signalisierung über Socket.IO für Anrufeinladung, Annehmen/Ablehnen, SDP-Angebot/Antwort, ICE-Kandidaten, Auflegen sowie lokale Mikrofon-/Kamerasteuerung. Beide Nutzer müssen angemeldet und online sein. Browser-Kamera/Mikrofon benötigen HTTPS und Zustimmung.

Die Verbindung verwendet aktuell einen öffentlichen STUN-Server als Minimal-Konfiguration. Manche NATs/Netzwerke benötigen zusätzlich einen TURN-Dienst; dafür muss ein eigener TURN-Dienst konfiguriert und getestet werden. Die Funktion ist syntaktisch geprüft, aber noch nicht mit zwei echten Geräten im veröffentlichten Render-/Netlify-System end-to-end getestet.


## Ergänzungen (14.10.2026)
- Live-Streams können über Web Share geteilt werden; ein Link mit `?live=<ID>` öffnet den Stream automatisch.
- Gäste können öffentliche Live-Streams ansehen, Live liken und im jeweiligen Live-Chat schreiben, ohne ein Konto anzulegen. Private Anrufe und private Nachrichten bleiben Gästen gesperrt.
- Live-Likes werden im laufenden Serverprozess gezählt; sie sind nicht dauerhaft in einer Datenbank gespeichert. Vor größerem öffentlichen Betrieb sollte ein IP-/Session-Rate-Limit ergänzt werden.
- Teilen nutzt die native Teilen-Funktion des Geräts; WhatsApp hat einen direkten Link. TikTok und Instagram lassen das Teilen von externen Links nicht in allen Browsern automatisch zu.
- Kameraeffekte sind visuelle CSS-Filter, keine KI-Hautretusche. 4K ist nur ein best-effort Kameraprofil und hängt von Gerät, Browser, Uploadbandbreite und LiveKit ab; es wird nicht garantiert.
- Folgen/Entfolgen, Blockieren, Bild-/Video-Reaktionen und Bewertungen 1–10 verwenden die bestehenden API-Funktionen.


## Live-Stummschaltung (v1.3.0)
- Der Host kann sein Mikrofon während des Streams stummschalten und wieder aktivieren.
- Zuschauer und Gäste können den Stream-Ton lokal stummschalten bzw. wieder einschalten.
- LiveKit-Zugriffsrechte erlauben Zuschauern nur das Abonnieren; nur der Host darf Audio/Video veröffentlichen.
- Der Stream wird nicht beendet, wenn der Host das Mikrofon stummschaltet.


## Live-Overlay-Update
- Live-Chat-Nachrichten werden zusätzlich über dem Stream eingeblendet.
- Tippen/Klicken auf die Live-Bühne erzeugt animierte Herzen und sendet einen Like-Request.
- Zusätzliche Farblooks sowie Regler für Beauty-Look, Helligkeit und Sättigung wurden ergänzt.
- Hinweis: Diese CSS-Effekte verändern die lokale Vorschau; sie werden nicht automatisch in die von LiveKit übertragenen Videodaten eingerechnet. Für echte, für Zuschauer sichtbare Beauty-Verarbeitung ist eine Canvas/WebGL-Verarbeitung der Kamera vor dem Publish erforderlich.
- 4K bleibt von Gerät, Browser, Upload und LiveKit-Plan abhängig.

## GameTik Studio-Mixer (LIVE)

Im LIVE-Host-Bereich gibt es einen optionalen Web-Audio-Mixer mit Mikrofon-Lautstärke, Hall (Reverb), Delay, Kompressor sowie Radio-/Roboter-Klangfärbung. Der Mixer verarbeitet den Mikrofon-Ton im Browser und veröffentlicht den bearbeiteten Ton über LiveKit. Er benötigt eine HTTPS-Seite und die Mikrofonfreigabe des Browsers. Bei Mobilgeräten können Bluetooth-Headsets, Energiesparmodi oder Browserbeschränkungen die Audioverarbeitung beeinflussen.

**Hinweis zu AutoTune:** Die Auswahl „AutoTune-Stil“ in dieser Version ist eine klangliche Färbung und keine echte Tonhöhenkorrektur wie bei professioneller Auto-Tune-Software. Für echte Tonhöhenkorrektur ist ein separater Pitch-Correction-DSP erforderlich.


## Fix v3.7: virtuelle Geschenk-Icons
Die vier virtuellen Geschenk-Icons (Herz, Stern, Feuer, Krone) sind direkt in `index.html` eingebettet. Dadurch werden sie auch angezeigt, wenn der Hosting-Deploy den Ordner `assets/` nicht korrekt ausliefert. Die Original-SVG-Dateien bleiben zusätzlich im Ordner `assets/`.

## GameTik Community: Suche, Folgen und Freundschaftsanfragen
- In Entdecken gibt es eine Nutzer-Suche über `@Benutzername`.
- Nutzer können direkt gefolgt werden.
- Freundschaftsanfragen können gesendet, angenommen und abgelehnt werden.
- Die Freundesliste zeigt bestätigte Freundschaften; eigene Follower und gefolgte Nutzer sind getrennt aufrufbar.
- Ein eigener Anfragen-Button zeigt die Anzahl offener eingehender Freundschaftsanfragen.
- Hinweis: Diese Demo verwaltet Nutzer, Follows und Freundschaftsanfragen derzeit im Arbeitsspeicher. Daten gehen bei einem Render-Neustart verloren. Für dauerhafte Accounts und Kontakte muss eine Datenbank angebunden werden.

## Fehlerbehebung DATA_DIR (Prüfung 14.10.2026)
- Wenn `DATA_DIR=/var/data` nicht beschreibbar ist, versucht der Server einen beschreibbaren lokalen Ordner und danach einen Ordner im temporären Systemverzeichnis.
- In diesem Ausweichmodus kann der Server starten, aber Dateien sind auf Render nicht dauerhaft. Der Endpunkt `/api/health` zeigt `mode`, `storagePath` und `persistentStorage` an.
- Für dauerhafte Speicherung muss bei Render eine Persistent Disk tatsächlich an `/var/data` gemountet sein und `DATA_DIR=/var/data` gesetzt sein. Nur die Environment-Variable allein erzeugt keine Disk und keine Schreibrechte.


## Version 1.9.26 – 3D-LIVE-Geschenke

- Neue Datei `gift-3d.js`: rendert animierte 3D-Meshes (Herz, Stern, Feuer, Krone und Süßigkeiten) als transparentes WebGL-Overlay über dem LIVE-Video.
- Die vorhandenen Geschenk-Schaltflächen und deren Zahlungs-/Versandlogik bleiben die funktionale Quelle. Die 3D-Animation ist ein visueller Effekt und bestätigt keine Zahlung.
- Three.js wird beim ersten Geschenk dynamisch von jsDelivr geladen; dafür ist eine Internetverbindung nötig. Wenn die Bibliothek nicht erreichbar ist, bleibt der bestehende Geschenkbereich nutzbar.
- `admin.html` wurde nicht geändert.

## Battle Arena – Projektintegration 1.9.79
- `battle-arena.html` nutzt die Arena-Fassung 1.9.78 mit 3D-Modus über Babylon.js und einem vereinfachten 2D-Fallback, falls die externe 3D-Bibliothek nicht geladen werden kann.
- Der Einstieg „Battle Arena 3D“ bleibt im vorhandenen GameTik-3D-Spielemenü und öffnet `/battle-arena.html`.
- Die Arena enthält Trainingskampf, Touch-Steuerung, Schwierigkeitswahl, Pause/Neustart, Kampfstatistik, Challenges, Karriere-XP und Erfolge. Karrierewerte werden lokal in diesem Browser gespeichert und nicht serverübergreifend synchronisiert.
- Diese Integration wurde statisch geprüft. Ein echter Android-/Browser-Test, ein Test auf Render und eine Prüfung aller Geräte-/CDN-Konstellationen sind nicht erfolgt. `admin.html` bleibt unverändert.



## Battle Arena 1.9.83 – Start-Fallback
Wenn Babylon.js zwar geladen wird, WebGL aber auf dem Gerät nicht initialisiert werden kann oder die 3D-Szene beim Start fehlschlägt, startet jetzt ein eigenständiger 2D-Sicherheitsmodus mit sichtbaren Kämpfern, Timer und Grundsteuerung. Die 3D-Ansicht muss weiterhin auf echten Geräten getestet werden.


## Battle Arena 1.9.85 – Full 3D
Die Battle Arena lädt Babylon.js über mehrere CDN-Quellen, bevor sie startet. Es gibt keinen automatischen Wechsel in eine 2D-Spielansicht. Wenn WebGL oder alle CDNs ausfallen, wird ein klarer 3D-Fehlerhinweis angezeigt. Die Arena nutzt weiterhin prozedural aufgebaute 3D-Kämpfer und ihre Animations-/Kampfschleife.
