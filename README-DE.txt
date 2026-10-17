GameTik Cyber-Ninja Arena 2.8.3 – Arbeitsstand

Dateien
- battle-arena.html: bestehende Babylon.js-Kampf-Arena, Versionsanzeige im Seitentitel auf 2.8.3 aktualisiert.

WICHTIGER TECHNISCHER HINWEIS
Die HTML-Datei erwartet das eigentliche geriggte Ninja-Modell unter:
/assets/fighters/cyberninja.glb
Die Datei allein enthält dieses Modell nicht. Ohne eine passende Cyber-Ninja-GLB-Datei zeigt der Code weiterhin die eingebaute Ersatzfigur. Die hochgeladene science+fi.glb-Datei wurde geprüft: sie enthält eine Szene mit 46 Nodes, 45 Meshes, keinen Skins und nur einer Kamera-Animation; sie ist daher kein geriggter Ninja-Kämpfer und wurde nicht fälschlich als Figur eingesetzt.

Die FBX-, DWG-, MAX- und BLEND1-Dateien sind Quell-/DCC-Formate und werden von dieser HTML-Seite nicht direkt als Laufzeit-Assets geladen. Für eine echte Integration müssen kompatible GLB/glTF-Modelle exportiert und getestet werden.

Prüfung
- Inline-JavaScript-Blöcke wurden mit Node.js Syntaxprüfung geprüft.
- Es wurde kein Live-Test in einem Browser, auf Android oder auf Render durchgeführt.

Installation
1. battle-arena.html im GameTik-Projekt als battle-arena.html verwenden.
2. Für die echten Ninja-Modelle muss zusätzlich assets/fighters/cyberninja.glb vorhanden sein.
3. Nach dem Deployment in Browser-Konsole und auf einem Android-Gerät prüfen.
