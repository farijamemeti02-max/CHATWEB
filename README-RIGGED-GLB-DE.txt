GameTik Battle Arena – Rigged-GLB-Unterstützung 1.9.48

Enthalten
- battle-arena.html: aktualisierte eigenständige Battle-Arena.
- assets/fighters/README.txt: genaue Ablageorte und Anforderungen für die echten 3D-Modelle.

Wichtig
Diese Lieferung enthält noch KEINE fertigen GLB-Charaktermodelle oder professionellen Motion-Capture-Animationen. Die vorhandene Exosuit-Figur bleibt als sicherer Fallback aktiv, bis die passenden GLB-Dateien in assets/fighters liegen. Es wurden keine Admin-, PayPal-, Server- oder LIVE-Dateien geändert.

Neue Funktionen
- Babylon.js GLB-Loader wird eingebunden.
- Optionale Modelle werden unter /assets/fighters/player.glb und /assets/fighters/enemy.glb geladen.
- AnimationGroups werden anhand üblicher Namen für Idle, Walk, Punch, Kick, Block, Dodge, Hit und KO zugeordnet.
- Wenn ein GLB fehlt oder nicht geladen werden kann, bleibt der bisherige Kämpfer erhalten.
- Kameraabstand und Zielpunkt passen sich an die Entfernung und Position der Kämpfer an.
- Bestehende Touch-Steuerung, Tastatur, HUD, Lebensbalken und Rundenlogik bleiben erhalten.

Prüfung
- Inline-JavaScript wurde mit `node --check` geprüft: bestanden.
- Kein echter Browser-, Android- oder Render-Laufzeittest durchgeführt.

Babylon.js Dokumentation für den GLB-/Animationsworkflow:
https://doc.babylonjs.com/features/featuresDeepDive/animation/animatedCharacter/
