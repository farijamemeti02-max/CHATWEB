GameTik Battle Arena – Version 1.9.74

Änderung in diesem Paket:
- Drei eigene Spezialangriffs-Sequenzen mit unterscheidbarer Bewegung und Energieeffekten:
  1. NEON BURST – aufladender Energiekern und expandierender Ring
  2. CYBER DASH – kurzer Vorstoß mit cyanfarbener Energie
  3. OVERDRIVE – grüner Energieaufbau mit rotierendem Ring
- Die Spezialsequenzen laufen beim Spezialangriff abwechselnd und werden beim Neustart bereinigt.
- Bestehende Spiellogik, XP/Karriere, Outfits, Menüs und restliche Funktionen bleiben im selben HTML erhalten.
- Vorhandenes GLB-Skelett/Clip-System bleibt unverändert; die drei neuen Spezialsequenzen sind eigens erstellte Babylon.js-Transform-/VFX-Animationen und keine neuen externen Motion-Capture-Skelettclips.

Wichtig:
- Die drei Spezialsequenzen sind visuelle Spiel-Animationen. Sie animieren die Fighter-Root-Transform und Energieeffekte; sie sind KEINE neu aufgenommenen Skelettanimationen für einzelne Arme/Beine.
- Externes Cesium-Man-Modell benötigt Internet. Falls es nicht lädt, greift weiterhin der prozedurale Kämpfer.
- Kein Live-Browser-Test und keine Veröffentlichung auf GitHub oder Render durchgeführt.
