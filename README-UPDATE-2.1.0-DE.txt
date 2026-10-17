GameTik Battle Arena – Update 2.1.0

Basis: die vom Nutzer hochgeladene battle-arena.html. Es wurde ausschließlich diese Arena-Datei geändert; dies ist KEIN vollständiges GameTik-Projekt und enthält keinen Ersatz für server.js, package.json, index.html, admin.html, LIVE oder PayPal.

Korrekturen/Verbesserungen:
- WASD und Touch-Bewegung sind relativ zur aktuellen Blickrichtung des Kämpfers berechnet. Vorwärts bewegt den Spieler zum Gegner, statt pauschal auf der Welt-Z-Achse nach hinten.
- Angriffe bringen den Kämpfer kontrolliert nach vorn; Tritt, schwere Angriffe und Spezialangriff erhalten mehr Reichweite.
- Trittbewegung wurde stärker gestreckt und zeitlich verlängert.
- KOMBO führt eine vierteilige Sequenz aus: Jab, Haken, Uppercut und Tritt. Der zusätzliche Schlag ist zeitlich getrennt.
- Ausweichen bewegt sich schräg aus der direkten Angriffslinie und funktioniert in der Arena-Ebene.
- Versionsanzeige auf 2.1.0 aktualisiert.
- Vorhandene Neon-Arena, Rüstungsfiguren, Steuerungen, Lebens-/Energiebalken, KI und Spielablauf wurden als Basis erhalten.

Prüfungen:
- Inline-JavaScript mit Node.js node --check: bestanden.
- Dateigröße und ZIP-Integrität werden nach Erstellung geprüft.
- Kein echter Android-/Browser-/WebGL-Test und kein Render-Deployment in dieser Umgebung durchgeführt.
- Externe Babylon.js-CDNs bleiben erforderlich. Die optionale GLB-Datei unter /assets/fighters/ ist weiterhin nicht im Paket enthalten; ohne diese bleibt die eingebaute prozedurale Figur aktiv.

Einbau:
- In der bestehenden GameTik-Projektstruktur nur die bestehende battle-arena.html durch diese Datei ersetzen.
- Keine anderen Dateien überschreiben. Insbesondere admin.html, server.js, package.json, LIVE und PayPal nicht ersetzen.
