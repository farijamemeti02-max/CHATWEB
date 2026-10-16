GameTik Battle Arena – Fotorealistische Kämpfer: Integrationspaket 1.9.54

WICHTIG: In diesem Paket sind noch KEINE neuen fotorealistischen Kämpfer-Modelle enthalten. Die bisherigen prozeduralen Roboter bleiben als sichere Rückfallebene aktiv, bis gültige GLB-Dateien eingesetzt wurden. Ich behaupte daher nicht, dass die Figuren mit diesem ZIP bereits fotorealistisch ersetzt sind.

Dateien, die für den tatsächlichen Austausch benötigt werden:
  assets/fighters/player.glb
  assets/fighters/enemy.glb

Die Modelle sollten menschliche, texturierte Meshes mit Skinning/Skelett enthalten. Für echte Kampfbewegungen müssen passende Animationen im GLB enthalten sein. Empfohlene Animationsnamen (Groß-/Kleinschreibung egal):
  Idle/Stand, Walk/Run, Punch/Jab/Hook/Uppercut, Kick, Block/Guard, Dodge/Evade, Hit/Hurt/Stagger, KO/Death/Fall.

Die Arena lädt die beiden Dateien unter /assets/fighters/ automatisch. Wenn sie fehlen oder ungültig sind, bleibt das bisherige Modell sichtbar, damit die Spielseite nicht leer wird.

Asset-Quellen zur Auswahl und Lizenzprüfung:
- https://models.codelove.in/ (GLB-Modelle; Lizenz ist je Asset zu prüfen)
- https://app.cinevva.com/tools/animations (Animationsbibliothek; Export-/Tarifbedingungen vor Verwendung prüfen)
- https://www.mixamo.com/ (Humanoid-Animationen; Nutzungsbedingungen beachten)

Einbau auf Render: Lege den Ordner assets/fighters im gleichen öffentlichen Webpfad an, aus dem battle-arena.html ausgeliefert wird. Lade player.glb und enemy.glb dort hoch. Danach im echten Browser prüfen: Blickrichtung, Fußkontakt, Modellmaßstab, Animationen und mobile Performance.

Adminbereich, server.js, PayPal und LIVE wurden nicht geändert.
