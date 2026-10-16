GameTik Battle Arena – Version 1.9.75 (Stabilitätsfix)

Korrekturen:
- Mobile/kleine Displays laden keine externen GLB-Dateien mehr automatisch. Die Arena startet sofort mit den lokalen prozeduralen Kämpfern, statt auf externe Modell-Downloads zu warten.
- Auf Desktop werden externe Modelle mit einem 7-Sekunden-Timeout geladen. Bei Fehler/Timeout bleibt der lokale Kämpfer erhalten.
- GLB-Import wird nur akzeptiert, wenn tatsächlich sichtbare Geometrie vorhanden ist.
- Render-Auflösung und Arena-Höhe wurden für Mobilgeräte angepasst.
- Bei Größenänderungen der mobilen Browser-Viewport-Höhe wird die Engine neu skaliert.
- Vorhandene Kampf-, Pause-, Statistik-, Stil-, Challenge-, Karriere-, XP- und Spezialangriffsfunktionen bleiben im HTML erhalten.

Tests:
- JavaScript-Syntax mit Node.js geprüft.
- Alle Referenzen auf HTML-IDs auf Vorhandensein geprüft.
- ZIP-Archivintegrität geprüft.
- Kein echter Android-/Chrome-Laufzeittest möglich; daher keine Behauptung, dass sämtliche Live-Funktionen bereits im Browser bestätigt wurden.
- Nicht bei GitHub oder Render veröffentlicht.

Hinweis: Auf Mobilgeräten wird die lokale prozedurale 3D-Figur verwendet, damit externe Modell-Downloads nicht die Arena blockieren. Das sind keine vollwertigen Skelett-Motion-Capture-Kämpfer.
