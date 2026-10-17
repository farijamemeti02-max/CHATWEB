GameTik Battle Arena — Neon Combat 3.0.0
======================================

Diese Version erweitert die vorhandene battle-arena.html und ergänzt einen getrennten Socket.IO-Mehrspieler-Server. Sie ersetzt nicht den restlichen GameTik-Produktionsserver.

Umgesetzt in battle-arena.html
------------------------------
- Visuelles Upgrade nach der gelieferten Referenz: abgerundete Stadionrippen, mehrere Neonringe, holografische Tafeln, Metall-/Glasflächen, blau-pinke Akzentlichter, Partikel sowie optionales Bloom-/FXAA-Post-Processing.
- Futuristische prozedurale Kämpfer mit geschichteter Exosuit-Rüstung, leuchtendem Visier und Energieklinge; externe rigged GLB-Dateien bleiben optional.
- Neuer Sound-Schalter. Nach der ersten Benutzerinteraktion laufen ein synthetisches Arena-Ambiente und generierte Kampfgeräusche (Angriff, Treffer, Block, Ausweichen, Spezial und KO). Es werden keine externen Audiodateien benötigt.
- Kampfkorrekturen: Ausweichen kann einen Treffer zum richtigen Zeitpunkt vermeiden; die KI nähert sich entlang X und Z; diagonale Bewegung wird normalisiert; Combos laufen als zeitlich getrennte Jab-/Haken-/Trittfolge; alte verzögerte Angriffe können durch einen Runden-Neustart keinen neuen Kampf beschädigen.
- Zusätzliche prozedurale Lauf-, KO- und Siegesposen für die eingebauten Ersatzfiguren. Bei vorhandenen rigged GLB-Modellen werden passend benannte Animationsclips bevorzugt.
- Trefferpartikel verwenden wiederverwendete Materialien, um unnötige Material-Erzeugung bei wiederholten Treffern zu reduzieren.
- Fehlermeldungen für fehlende Babylon.js-Bibliothek und nicht unterstütztes WebGL, Fallback für die Raster-Materialbibliothek und Hinweise bei WebGL-Kontextverlust/-Wiederherstellung.
- Online-Matchmaking-Schaltfläche, Socket.IO-Verbindung, Serverzustand-Synchronisierung, Treffer-/Block-/Ausweichereignisse und beidseitig bestätigtes Rematch.

Separater Online-Server
-----------------------
Im Ordner online-server/ liegt ein eigenständiger Express-/Socket.IO-Dienst. Er soll nicht über die vorhandene GameTik-server.js kopiert oder darübergeschrieben werden. Er enthält Matchmaking für zwei Spieler und berechnet Bewegung, Energie, Blocken, Ausweichen, Angriffe, Treffer und KO serverseitig.

Einrichtung und Hosting stehen in online-server/README.md. Wird die Arena auf einer anderen Domain gehostet, muss sie mit ?server=https%3A%2F%2FDEIN-ONLINE-SERVER verbunden werden; ALLOWED_ORIGINS muss die Webseite erlauben.

Dateien / Voraussetzungen
-------------------------
- battle-arena.html: vollständige Arena-Oberfläche und Clientlogik.
- online-server/server.js: separater Online-Spielserver.
- online-server/package.json: Node.js-Abhängigkeiten Express und Socket.IO.
- online-server/public/battle-arena.html: identische HTML-Datei, damit der separate Server die Arena auch direkt ausliefern kann.
- GLB-Dateien sind nicht in diesem Paket enthalten. Optional werden /assets/fighters/player.glb und /assets/fighters/enemy.glb geladen. Für die bestmögliche Animation müssen sie ein Skelett und passende Animation-Clips enthalten.

Was tatsächlich geprüft wurde
-----------------------------
- Die zusammengeführte Inline-JavaScript-Datei aus battle-arena.html besteht node --check.
- online-server/server.js besteht node --check.
- `cd online-server && npm run check`: 6 von 6 automatisierten statischen Tests bestanden (HTML-Steuerelemente, eindeutige IDs, JavaScript-Syntax, Online-Handler/Abhängigkeiten und Abgleich der beiden HTML-Kopien).
- HTML-Element-IDs wurden auf Duplikate geprüft; keine Duplikate gefunden.
- Der Paketinstallationsversuch für die npm-Abhängigkeiten lief in der Arbeitsumgebung in ein Timeout. Deshalb wurde der Dienst hier nicht live gestartet; Matchmaking zwischen zwei Browsern, WebSocket-Verbindung, echtes WebGL-Rendering und Android-/Render-Laufzeittests sind NICHT als bestanden bestätigt.

Bekannte Grenzen
----------------
- Die Online-Funktion ist ein Multiplayer-Prototyp, kein ausgereiftes kommerzielles Anti-Cheat-, Reconnect-, Ranking- oder Skalierungssystem.
- Die 3D-Kämpfer ohne vorhandene GLB-Dateien sind prozedural zusammengesetzte Spielfiguren und keine photorealistischen Motion-Capture-Modelle.
- Babylon.js wird über CDNs geladen. Für das Laden der 3D-Bibliotheken ist Internet erforderlich.
- Vor dem Einbau in das GameTik-Hauptprojekt eine Sicherung erstellen. Nur battle-arena.html austauschen; den vorhandenen GameTik-Produktionsserver nicht durch online-server/server.js ersetzen.
