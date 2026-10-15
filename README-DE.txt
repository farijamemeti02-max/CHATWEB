GAMETIK – KORRIGIERTER BUILD (PostgreSQL + Cloudflare R2)

WICHTIG: admin.html wurde absichtlich nicht verändert und ist nicht in diesem ZIP.

WAS GEÄNDERT WURDE
- PostgreSQL-Treiber pg hinzugefügt.
- GameTik-State wird beim Start aus Neon PostgreSQL geladen und bei Änderungen gespeichert.
- /api/health zeigt an, ob PostgreSQL verbunden ist.
- Render startet erst nach erfolgreicher Datenbankinitialisierung, wenn DATABASE_URL gesetzt ist.
- Cloudflare R2 bleibt für Profilbilder/Medien zuständig.

VOR DEM DEPLOY
1. Sichere dein GitHub-Projekt oder erstelle einen Branch.
2. Ersetze server.js, app.js, live.js, index.html und package.json durch diese Version. admin.html NICHT ersetzen.
3. In Render Environment muss DATABASE_URL auf die Neon-Verbindungszeichenfolge zeigen (mit SSL; den Wert niemals in Chat oder Screenshot zeigen).
4. R2 Variablen beibehalten: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL; optional R2_REGION=auto und R2_ENDPOINT.
5. Deploy auslösen. npm install wird pg installieren.
6. Prüfe https://DEINE-RENDER-URL/api/health. Erwartet: ok=true und database=postgresql-connected.
7. Profilbild testen: anmelden, Bild hochladen, Seite neu laden.

WICHTIG ZUR DATENÜBERNAHME
Wenn in Neon bereits eine gametik_state-Zeile existiert, wird diese beim Start verwendet. Lokale JSON-Dateien werden nur übernommen, wenn die Tabelle noch leer ist. Render-Containerdateien sind möglicherweise bereits vergänglich. Profilbilder, die in R2 liegen, müssen nicht erneut hochgeladen werden; die gespeicherte avatar_url muss jedoch in den Daten der Datenbank vorhanden sein.

SICHERHEIT
Niemals DATABASE_URL, DB-Passwort, R2_SECRET_ACCESS_KEY oder SMTP_PASS in GitHub oder Chat posten. Dieses ZIP enthält keine Zugangsdaten.

TESTS
Syntaxprüfung mit npm run check ausführen. Ein vollständiger End-to-End-Test gegen dein echtes Render-/Neon-/R2-Konto ist von hier aus nicht möglich; nach dem Deploy müssen Health-Check und Profilbild getestet werden.


WICHTIG – ANMELDUNG / NEON POSTGRESQL
1. Nach dem Deploy zuerst „Konto erstellen“ benutzen und auf die Erfolgsmeldung warten.
2. Danach erst „Anmelden“ verwenden. Ein bisheriges Konto ist nur dann verfügbar, wenn es in den alten gespeicherten Daten vorhanden war und diese in Neon übernommen wurden. Bei einer neu angelegten leeren Datenbank kann ein altes Konto nicht automatisch gefunden werden.
3. Die Authentifizierungsrouten warten nun auf die eingereihte PostgreSQL-Speicherung, bevor sie Erfolg zurückmelden.
4. Render benötigt DATABASE_URL als Environment Variable. Niemals diesen Wert öffentlich teilen.
5. admin.html wurde nicht verändert und ist nicht Teil dieser ZIP-Datei, falls sie separat im Repository liegt.
