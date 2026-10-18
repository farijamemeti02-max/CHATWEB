REALISTISCHE 3D-KÄMPFER FÜR GAMETIK — ASSET-CHECKLISTE
=====================================================

Erwartete Dateien (nicht in diesem Paket enthalten):
- player.glb — fotorealistischer menschlicher Kämpfer, Texturen im GLB eingebettet, humanoides Skelett.
- enemy.glb — zweiter Kämpfer mit ähnlicher Skalierung und humanoidem Skelett.

Beide Dateien gehören hierhin: public/assets/fighters/player.glb und public/assets/fighters/enemy.glb (bzw. relativ zum bereitgestellten battle-arena.html: assets/fighters/...). Die Seite lädt sie über /assets/fighters/player.glb und /assets/fighters/enemy.glb.

Für die geforderten Bewegungen müssen die Dateien getrennte, gebackene Animation-Clips enthalten. Empfohlene Clip-Namen (Groß-/Kleinschreibung egal):
- Idle / CombatIdle
- Walk / Run
- Jab / StraightPunch
- Hook / PunchCombo
- Uppercut
- Kick / FrontKick / Roundhouse
- Block / Guard
- Dodge / Sidestep
- Hit / Stagger
- KO / Knockout / Fall

Die Loader-Erkennung unterstützt häufige Namensvarianten, aber Animationen mit fremdem Skelett müssen korrekt auf das Modell retargetet und vor dem Export getestet werden. Eine einzelne allgemeine Attack-Animation ersetzt keine präzisen Jab-/Hook-/Kick-Clips.

Asset-Recherche (Lizenz vor Übernahme am jeweiligen Download prüfen):
- https://models.codelove.in/ — kostenlose GLB-Bibliothek; gemischte MIT/CC0/CC-BY-Lizenzen, Modellqualität und humanoide Clips einzeln prüfen.
- https://app.cinevva.com/tools/animations — CC0-Bewegungen; Retargeting/Export-Funktionen und mögliche Tarifgrenzen prüfen.
- https://www.innerscene.com/tools/library/3d-parts/human-base-mesh-with-editable-53-bone-rig-8e7c8ab1 — CC0-Rig-Basismodell, aber ausdrücklich ohne Animation; kein fertiger fotorealistischer Kämpfer.

WICHTIG: Ein Rig allein ist nicht fotorealistisch und erstellt keine Kampfanimationen. Für echtes Konsolenspiel-Niveau braucht es hochauflösende, texturierte menschliche Modelle plus passende Kampfanimationen. Die hier vorhandene Szene liefert Licht, Schatten, Kamera, HUD und Combat-Logik, nicht automatisch diese fehlenden Assets.
