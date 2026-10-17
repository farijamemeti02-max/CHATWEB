# GameTik Battle Arena — Online Server 3.0.0

Dieses Verzeichnis ist ein **separater** Node.js-/Socket.IO-Dienst für Online-Matches. Es ersetzt nicht den vorhandenen GameTik-Produktionsserver.

## Enthaltene Funktionen

- Matchmaking mit Warteschlange für zwei Spieler
- Serverautoritative Spielerpositionen, Lebenspunkte, Energie, Angriffe und Treffer
- Jab, Haken, Uppercut, Tritt, Spin, Knie und Spezialangriff
- Blocken, Ausweichen, Konterfenster, Treffer-Stun und KO
- Rematch erst nach Ende der Runde und erst, wenn beide Spieler zustimmen
- Health-Check unter `/health`

## Lokal starten

1. Node.js 20 oder neuer installieren.
2. Im Terminal in dieses Verzeichnis wechseln.
3. `npm install` ausführen.
4. `npm start` ausführen.
5. Im Browser `http://localhost:4000` öffnen. Zwei Browserprofile/Geräte öffnen und jeweils **ONLINE-MATCH** anklicken.

## Render als eigenständigen Web Service

- Neues **Web Service** erstellen und dieses Verzeichnis als Root Directory verwenden.
- Build Command: `npm install`
- Start Command: `npm start`
- Node-Version 20 oder neuer verwenden.
- Nach erfolgreichem Start `https://DEIN-DIENST/health` aufrufen. Erwartet wird JSON mit `"ok": true`.
- Arena öffnen über `https://DEIN-DIENST/`.

## Arena auf anderer Domain hosten

Die Online-Arena lädt den Socket.IO-Client vom Server. Beim Klick auf **ONLINE-MATCH** wird standardmäßig die aktuelle Domain verwendet. Wenn die HTML-Seite separat gehostet wird, ergänze die Server-Adresse als URL-Parameter, zum Beispiel:

`https://DEINE-WEBSITE/battle-arena.html?server=https%3A%2F%2FDEIN-DIENST.onrender.com`

Setze dann die Umgebungsvariable `ALLOWED_ORIGINS` im Online-Server auf die vollständige Origin der Website, ohne Pfad, zum Beispiel `https://deine-website.netlify.app`. Mehrere Origins werden kommasepariert angegeben. Für einen öffentlich erreichbaren Produktionsdienst nicht dauerhaft `*` verwenden.

## Wichtige Grenzen

- Der Server ist ein funktionaler Multiplayer-Prototyp und verwendet Socket.IO sowie einfache serverautoritative Spielregeln; er ist **kein** vollständiges Matchmaking-/Anti-Cheat-System für ein großes kommerzielles Spiel.
- Für längere Online-Betriebszeiten, Spieler-Konten, Ranglisten, Speicherung, Reconnects, Moderation und Lastverteilung werden weitere Arbeiten benötigt.
- Für 3D-Kämpfer mit hochwertigen Bewegungen müssen passende rigged GLB-Dateien mit passenden Animation-Clips neben der HTML-Datei unter `/assets/fighters/player.glb` und `/assets/fighters/enemy.glb` liegen. Fehlen sie, benutzt die Arena die eingebauten prozeduralen Figuren.
- Die Arena verwendet Babylon.js-CDNs und benötigt eine Internetverbindung zum Laden dieser Bibliotheken.
- Dieser Dienst ist absichtlich von der existierenden GameTik-`server.js` getrennt, weil diese Produktionsdatei hier nicht vorlag.
