GameTik Battle Arena – Cyber-Ninja Fix 2.8.1

Inhalt:
- battle-arena.html: aktualisierte Arena auf Basis der GameTik-Version 2.8.0 mit Sprung-/Laufsteuerung
- assets/fighters/cyberninja.glb: Cyber-Ninja mit eingebettetem Skelett und 12 Animationsclips

Ursache des alten Modells:
Die Arena verwendet eine eingebaute Ersatzfigur, solange die GLB-Datei nicht erfolgreich geladen werden kann. Das Modell muss genau im Pfad assets/fighters/cyberninja.glb liegen. Die aktualisierte Arena zeigt nun im oberen Statusfeld an, ob der Cyber-Ninja geladen wurde oder ob die Ersatzfigur verwendet wird.

Einbau auf Render/GitHub:
1. Öffne den Ordner, aus dem die Arena-HTML öffentlich ausgeliefert wird (typisch: public).
2. Ersetze dort battle-arena.html mit dieser Version.
3. Lege die Modell-Datei unter public/assets/fighters/cyberninja.glb ab (also neben dem Ordner, aus dem battle-arena.html ausgeliefert wird).
4. Commit und Deploy ausführen.
5. Auf dem Handy die Arena neu laden. Wenn noch die alte Version erscheint, Browser-Cache leeren und Render-Deploy-Status prüfen.

Erwartete Struktur, falls battle-arena.html in public liegt:
public/battle-arena.html
public/assets/fighters/cyberninja.glb

Die Arena benötigt weiterhin Babylon.js über die bestehenden externen CDN-Adressen und eine Internetverbindung. Der Adminbereich und andere Projektdateien sind nicht enthalten und werden nicht geändert.
