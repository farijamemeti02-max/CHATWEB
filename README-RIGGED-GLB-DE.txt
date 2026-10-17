GameTik Battle Arena — Rigged-GLB-Modelle
========================================

In Neon Combat 3.0.0 sind GLB-Modelle optional. Wenn verfügbar, werden diese URLs geladen:
- /assets/fighters/player.glb
- /assets/fighters/enemy.glb

Wenn die Dateien fehlen oder nicht korrekt laden, nutzt die Arena die eingebaute prozedurale Ersatzfigur und schreibt eine Meldung in die Browser-Konsole.

Voraussetzungen für gute Animationen:
- GLB-Datei mit sichtbaren Meshes und brauchbarer Höhe/Skalierung.
- Für Skeletanimationen ein gültiges Skeleton plus Animation-Clips.
- Die Clipnamen sollten gebräuchliche Wörter enthalten, z. B. idle/stand, walk/run, punch/jab, hook/cross, uppercut, kick/heavy, spin, special/power, block/guard, dodge/evade, hit/hurt sowie ko/death.
- Die lokale Vorderseite und die Position des Skeletts können je nach Modell variieren. Bei falscher Richtung/Skalierung ist eine Anpassung des jeweiligen Modells oder der Importlogik nötig.

Die GLB-Dateien selbst wurden nicht mitgeliefert und konnten daher nicht geöffnet, auf Skeleton/Clips geprüft oder für das echte Spiel getestet werden. Es werden keine externen Modelle in diesem Paket vorgetäuscht.
