GAMETIK BATTLE ARENA – MULTI-ENGINE STARTER 1.0

Inhalt:
- BabylonJS/battle-arena.html: Browser-Projektdatei aus dem bisherigen Arbeitsstand 1.9.54. Dies ist der direkteste Pfad für die bestehende GameTik-Webseite.
- Godot/: minimales Godot-4-Projekt mit Arena, Spielersteuerung, einfacher KI und Lebenspunkten.
- Unreal/Source/: UE5-C++-Fighter-Basis mit Treffererkennung, Lebenspunkten, Blocken und KO-Event.

WICHTIG:
Diese drei Engines sind getrennte Builds. Dieses Paket enthält Code-Grundlagen, aber keine Photoreal-Modelle, Motion-Capture-Dateien, vollständigen UI-/Menüfluss oder fertige Multiplayer-Serverlogik. Für BabylonJS existiert ein GLB-Ladepfad in der gelieferten HTML-Datei; echte Modelle müssen lizenziert beschafft und unter den vorgesehenen Assets ergänzt werden.

Sicherheit/Scope: Dieses Paket enthält keine Änderungen an admin.html, server.js, PayPal oder LIVE. Die gelieferten Dateien sind ein separater Multi-Engine-Arbeitsstand. Bitte nicht blind über das komplette Produktions-Repository kopieren; zuerst in einem separaten Branch testen.

Steuerung im BabylonJS-Build steht im Spiel-HUD. Godot: WASD bewegen, J leichter Angriff, K schwerer Angriff, L blocken, Leertaste ausweichen. Unreal: Inputs im Editor an die UFUNCTIONs binden.
