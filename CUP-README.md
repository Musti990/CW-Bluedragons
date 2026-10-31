# 🏆 CW Bluedragons · Ultimate Team Cup

Turnier-Bot für **EA FC Ultimate Team (1 gegen 1)**: Registrieren mit EA-ID, tägliche Anmeldelisten, Auslosung in Gruppen, Check-in, Ergebnisse mit Bestätigung, K.-o.-Phase mit Turnierbaum, Hall of Fame mit Siegerbild und Trophäenhalle.

Der Cup läuft **im selben Repo, auf derselben Netlify-Seite und mit demselben Discord-Bot** („CW Bluedragons“) wie der Zusagen-Bot. Befehle mit `/ut-…` und Cup-Buttons leitet der Bot automatisch an den Cup-Teil weiter, alles andere## 1. Netlify: eine neue Variable

Token, Public Key, Application ID und Server-ID nimmt der Cup automatisch vom bestehenden Bot (`DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `APPLICATION_ID`, `GUILD_ID`). Neu ist nur:

| Variable | Inhalt |
|---|---|
| `CUP_SETUP_KEY` | frei gewähltes Passwort, z. B. `bluedragons2026` (nur Buchstaben, Zahlen, Bindestrich) |

Scope: **All scopes** bzw. mindestens **Functions**. Danach **neu deployen** (und veröffentlichen).

## 2. Bot-Rechte

Der Bot „CW Bluedragons“ braucht für den Cup zusätzlich **Kanäle verwalten**, **Rollen verwalten**, **Nicknamen verwalten** und **Nachrichten verwalten** (am einfachsten: Rolle des Bots auf **Administrator**). Im Developer Portal unter *Bot* muss **Server Members Intent** an sein.

## 3. Befehle registrieren

Im Browser öffnen: `https://DEINE-SEITE.netlify.app/api/cup/setup?key=DEIN_CUP_SETUP_KEY`
→ registriert `/ut-einrichten`, `/ut-zeitplan`, `/ut-turnier`, `/ut-admin`. Die Befehle des Zusagen-Bots bleiben erhalten (und umgekehrt behält der Register-Link des Zusagen-Bots die Cup-Befehle).

> Optional: Wer den Cup lieber mit einem **eigenen** Discord-Bot betreibt, trägt `CUP_DISCORD_TOKEN`, `CUP_PUBLIC_KEY`, `CUP_APP_ID`, `CUP_GUILD_ID` ein und setzt beim eigenen Bot die Interactions-URL `https://DEINE-SEITE.netlify.app/api/cup/interactions`.

 → Befehle werden registriert.

## 4. Im Discord einrichten

```
/ut-einrichten alles anpfiff: 20:00
```
Legt die Rollen (**UT Turnierleitung**, **UT Spieler**, **UT Gruppe A–H**, **UT Achtelfinale** …) und die Cup-Kanäle an (Registrieren, Mein-Profil, Spielerübersicht, Live-Spielplan, Hall of Fame, Trophäenhalle, Gruppen, K.-o.). **Kein** Regelwerk-, Sperrlisten- oder Tageskanal – die Anmeldelisten kommen in eure eigenen Kanäle (siehe unten). Alle Cup-Kanäle beginnen mit **UT-** (z. B. 𝐔𝐓-𝐌𝐨𝐧𝐭𝐚𝐠), deshalb werden bestehende Kanäle des Servers nie angefasst. Danach:
- Die Rolle des Cup-Bots in der Rollenliste **ganz nach oben** ziehen.
- Dir selbst die Rolle **UT Turnierleitung** geben (Server-Admins dürfen sowieso alles).
- `/ut-einrichten status` zeigt, was noch fehlt.
- **Anmeldelisten:** Für jeden Cup-Tag einmal im gewünschten Kanal `/ut-zeitplan setzen tag: Montag anpfiff: 20:00` ausführen (ohne `kanal` = der Kanal, in dem du schreibst). Oder ein einzelnes Turnier mit `/ut-turnier`.

## 5. Allein testen (Test-Cup)

> Tipp: Solange du testest, die neuen Kategorien (🐉 UT CUP · INFO, 🏆 ULTIMATE TEAM CUP …) in Discord für @everyone ausblenden – dann sieht noch niemand den Cup.


1. Selbst registrieren: **UT-Registrieren** → Plattform → EA-ID.
2. In einem beliebigen Testkanal: `/ut-admin testcup-start teams: 8` → du + 7 Testspieler.
3. `/ut-admin anmeldeschluss` → Auslosung, im Gruppenkanal **Einchecken**.
4. `/ut-admin checkin-ende` → Spieltag 1 wird freigegeben.
5. Deine Spiele im Ergebniskanal eintragen (der Testgegner bestätigt nach 2 Minuten automatisch). Spiele zwischen Testspielern spielt der Bot selbst (`/ut-admin testcup-weiter` beschleunigt).
6. Am Ende kommt das Siegerbild – beim Test-Cup im Testkanal, ohne Statistik.
Abbrechen jederzeit mit `/ut-admin abbrechen`.

## Ablauf eines Cup-Tages

- **12:00** Anmeldeliste im Tageskanal (Banner, Format, alle Spieler mit Plattform und EA-ID)
- **19:00** Anmeldeschluss & Auslosung → Rollen **UT Gruppe X**, Check-in im Gruppenkanal
- **19:55** Check-in-Ende → Warteliste rückt nach, sonst 0:3
- **20:00** Anpfiff → Freigabe Spieltag 1 mit Paarungen (EA-IDs zum Einladen)
- Ergebnis eintragen → Gegner bestätigt (2 Min.) → bei Streit wird die Turnierleitung markiert (`/ut-admin ergebnis`)
- K.-o.-Phase mit Runden-Rollen und Turnierbaum → Finale + Spiel um Platz 3 → Siegerbild in der **Hall of Fame**

## Wichtige Befehle (Turnierleitung)

| Befehl | Wofür |
|---|---|
| `/ut-zeitplan setzen tag kanal anpfiff` | Tag im Wochenplan einstellen |
| `/ut-zeitplan woche start: 02.11.2026` | Jeden Tag Cup, Listen eine Woche im Voraus |
| `/ut-turnier name anpfiff` | Einmaliges Turnier im aktuellen Kanal |
| `/ut-admin spiele` / `ergebnis` | Offene Spiele anzeigen / Ergebnis festlegen |
| `/ut-admin abmelden spieler: EA-ID` | Spieler aus der Liste entfernen |
| `/ut-admin freilos-hinzufügen` | Freilos setzen (z. B. 7 + 1 = 8er-Format) |
| `/ut-admin profil-löschen spieler: EA-ID` | Falsches Profil löschen |
| `/ut-admin rollen-check` | Gruppen-/KO-Rollen prüfen und reparieren |

## Dateien

- `netlify/functions/cup-interactions.mjs` – Discord-Endpunkt (`/api/cup/interactions`)
- `netlify/functions/cup-setup.mjs` – Befehle registrieren (`/api/cup/setup`)
- `netlify/functions/cup-tick.mjs` – läuft jede Minute (Zeitplan, Check-in, Aufräumen)
- `netlify/cup/` – Turnierlogik, Ansichten, Siegerbild
- `public/cup-banner-*.jpg` – Banner (einfach austauschen, gleicher Dateiname)
- Regelwerk ändern: `netlify/cup/data.mjs` → `RULES`, danach `RULES_VERSION` um 1 erhöhen und `/ut-einrichten panels`
