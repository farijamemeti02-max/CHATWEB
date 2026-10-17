GAMETIK BATTLE ARENA 2.8.0 — CYBER-NINJA
========================================

LIEFERUMFANG
------------
- battle-arena.html: aktualisierte Arena auf Basis der bisherigen GameTik-Arena 2.7.0
- assets/fighters/cyberninja.glb: der neue 3D-Kämpfer
- preview/gametik_cyberninja_preview.png: Bildvorschau

WAS ENTHALTEN IST
-----------------
- Ein gemeinsames Samurai-Cyborg-Modell für Spieler und Gegner.
- Spielerfarbe Neon-Pink, Gegnerfarbe Cyan/Neon-Blau (Materialtönung in der Arena).
- 20 Gelenke und 12 GLB-Animationsclips:
  GT_Idle, GT_Walk, GT_Run, GT_Jump, GT_Jab, GT_Hook, GT_Uppercut,
  GT_Kick, GT_Block, GT_Dodge, GT_Hit und GT_SwordSlash.
- GLB-Datei für Web/Babylon.js optimiert.
- Ursprünglich ca. 75 MB; jetzt ca. 9,24 MiB.
- Geometrie von ca. 1.994.358 auf 199.435 Dreiecke reduziert (rund 90 % weniger).
- Texturen von 4096 x 4096 auf 2048 x 2048 reduziert.
- Die Arena lädt dasselbe Modell zweimal und verwendet getrennte Skelett-/Animationsinstanzen.
- Wenn die GLB-Datei nicht geladen werden kann, bleibt die bisherige Ersatzfigur als Fallback verfügbar.

INSTALLATION IN GITHUB / NETLIFY / RENDER
-----------------------------------------
1. Sichere zuerst deine vorhandene battle-arena.html.
2. Ersetze nur die bisherige Arena-Datei mit dieser battle-arena.html.
3. Kopiere assets/fighters/cyberninja.glb in den öffentlich ausgelieferten Ordner:
      public/assets/fighters/cyberninja.glb
   Lege die Unterordner an, falls sie noch nicht existieren.
4. Lade beide Dateien zu GitHub hoch und veröffentliche das Projekt wie gewohnt.
5. Prüfe die Arena nach dem Deploy. Im Netzwerk-Tab des Browsers sollte
   /assets/fighters/cyberninja.glb mit Status 200 geladen werden.

Bitte NICHT überschreiben: index.html, admin.html, server.js, package.json,
PayPal-/Backend-Dateien oder andere GameTik-Seiten. Diese Lieferung ändert
nur die Battle-Arena und fügt die GLB-Datei hinzu.

TECHNISCHER STATUS / EHRLICHER HINWEIS
--------------------------------------
Die GLB-Struktur wurde geprüft: gültiger GLB-2.0-Container, Mesh-Indizes,
20 Gelenke, Gewichte und alle Animationsreferenzen vorhanden. Die Arena-JavaScript-
Datei hat eine Syntaxprüfung bestanden. Eine echte WebGL-Laufzeitprüfung auf deinem
Hosting/Handy steht noch aus.

Das Skelett wurde automatisch aus den Abmessungen des Cyber-Ninja-Modells geschätzt.
Die Animationsposen sind Prototypen und keine professionell handanimierten Bewegungen.
Vor dem Einsatz in einer öffentlichen Online-Arena müssen insbesondere Schwertschlag,
Block, Trefferreaktion, Gelenkverformungen und Kollisionen im echten Spiel getestet
und gegebenenfalls nachjustiert werden. Schadensberechnung, Trefferboxen und Online-
Synchronisierung hängen weiterhin von der vorhandenen GameTik-Kampflogik ab.

LIZENZ
------
Vor dem öffentlichen oder kommerziellen Veröffentlichen bitte die Lizenz der originalen
Downloadseite prüfen. „Free Download“ bedeutet nicht automatisch, dass jede Form der
Weiterverteilung oder kommerziellen Nutzung erlaubt ist.
