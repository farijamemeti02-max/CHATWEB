GameTik Battle Arena — Kampfkorrekturen (historische Referenz 1.9.52)
=====================================================================

Die früheren prozeduralen Kampfkorrekturen wurden in Neon Combat 3.0.0 weitergeführt.

Kampfänderungen im aktuellen Build:
- Angriffsschaden wird beim tatsächlichen Kontaktzeitpunkt geprüft.
- Ein aktives Ausweichen kann Treffer vermeiden, sofern die Ausweichphase den Kontaktzeitpunkt abdeckt.
- Jab, Haken, Uppercut, Knie, Tritt, Spin und Spezialangriff nutzen getrennte Zeit-/Schadenswerte.
- Kombo führt Jab, Haken und Tritt mit zeitlichen Abständen aus, statt direkt hintereinander an Cooldowns zu scheitern.
- Die KI verfolgt den Spieler anhand der zweidimensionalen Distanz und bewegt sich entlang X- und Z-Achse.
- Angriffe, die vor einem Rundenneustart ausgelöst wurden, können wegen eines Runden-Tokens nicht nachträglich Schaden in der neuen Runde auslösen.
- Treffer, Block, Ausweichen, Spezial und KO verfügen über generierte Audioeffekte.

Das Bewegungssystem der Ersatzfigur ist prozedural. Es enthält keine neu aufgenommenen Motion-Capture-Daten. Bei rigged GLB-Modellen hängen die verfügbaren Animationen weiterhin vom Modell und den darin enthaltenen Animation-Clips ab.

Prüfstatus Neon Combat 3.0.0: Inline-JavaScript und Online-Server-JavaScript wurden syntaktisch mit Node.js geprüft. Der Live-Browser-/Android-Test und der Mehrspieler-Netzwerktest sind noch offen.
