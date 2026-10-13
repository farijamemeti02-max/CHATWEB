# GAMETIK — Demo ohne Datenbank und ohne geheime Schlüssel

Diese Version ist eine **Testversion**. Sie benötigt weder `DATABASE_URL` noch `JWT_SECRET` und richtet keine Datenbank ein.

## Funktionen
- Nickname-Gastzugang ohne E-Mail und Passwort
- Profilbild-Upload bis 3 MB (JPG, PNG, WebP)
- Video-Upload bis 35 MB pro Video (MP4, WebM, MOV)
- Video-Feed, Likes, Kommentare und Folgen
- Öffentlicher Live-Chat mit Socket.IO
- Virtuelle Demo-Geschenke
- Optionaler externer PayPal-Spendenlink

## Lokal starten
Benötigt Node.js 20 oder neuer.

```bash
npm install
npm run check
npm start
```

Danach `http://localhost:10000` öffnen.

## Auf Render veröffentlichen
1. Den **gesamten Inhalt dieses Ordners** in dein GitHub-Repository hochladen.
2. Auf Render einen neuen **Web Service** mit diesem Repository verbinden.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Keine Datenbank und keinen `JWT_SECRET` eintragen.
6. Optional kann in Render → Environment die Variable `PAYPAL_DONATION_URL` gesetzt werden. Verwende einen HTTPS-PayPal-Spendenlink.
7. Nach dem Deploy `/api/health` öffnen. Erwartete Antwort enthält `"ok":true`.

Die Datei `render.yaml` enthält absichtlich keine Datenbank- oder Secret-Key-Variablen.

## PayPal und virtuelle Geschenke
- Der PayPal-Button kann einen **externen Spendenlink** öffnen.
- Die virtuellen Geschenke in dieser Version sind nur Demo-Einträge. Sie buchen **kein Geld** ab.
- Automatische bezahlte Geschenke mit bestätigter Zahlung benötigen PayPal-API-Zugangsdaten auf dem Server und eine echte serverseitige Bestätigung. Diese Funktion ist in der schlüssellosen Version ausdrücklich deaktiviert.

## Wichtige Grenzen
- Sitzungen, Videos im Feed, Likes, Kommentare, Chat und Geschenke liegen im Arbeitsspeicher. Nach Neustart oder Redeploy werden diese Daten zurückgesetzt.
- Hochgeladene Dateien liegen lokal im Service-Ordner. Auf Render können sie bei Neustart oder Redeploy verloren gehen, wenn kein dauerhafter Speicher eingerichtet ist.
- Der Nickname ist kein geschütztes Konto. Es gibt keine Passwort-Wiederherstellung und keine dauerhafte Identität.
- Diese Version eignet sich zum Testen, nicht als dauerhaftes Produktivsystem.

## Tests
`npm run check` prüft die JavaScript-Syntax von Server und Browser-Code. Ein erfolgreicher Syntaxcheck ist kein Live-Test auf Render und bestätigt keine echte PayPal-Zahlung.


## Private Nachrichten (GAMETIK)
- Öffne **Chat** und wähle **Privat chatten**.
- Wähle ein anderes aktuell angemeldetes Mitglied aus der Liste.
- Nachrichten werden nur an den ausgewählten Empfänger und den Absender zugestellt; sie werden nicht im öffentlichen Chat ausgestrahlt.
- Die aktuelle Version nutzt absichtlich keinen Datenbankserver. Nutzer, Mitgliederliste und private Nachrichten liegen im Arbeitsspeicher und gehen beim Neustart/Schlafzustand des Servers verloren. Die Nutzerliste zeigt daher nur Sitzungen, die derzeit auf diesem Server existieren.
- Nickname-only ist keine sichere Identitätsprüfung: Andere Personen können denselben Nickname erneut wählen. Für echte private Kommunikation mit dauerhaft gespeicherten Nachrichten braucht das Projekt später eine Datenbank und ein verlässliches Login.


## Zusätzliche Korrekturen bei der Codeprüfung
- Upload-Dateiendungen werden passend zum erlaubten MIME-Typ festgelegt, damit Video- und Bilddateien keine falsche Dateiendung erhalten.
- Folgen ist nur für tatsächlich aktive Nutzer möglich; ungültige Nutzer-IDs werden abgewiesen.
- Unerwartete Serverfehler erhalten HTTP 500 statt pauschal HTTP 400.
