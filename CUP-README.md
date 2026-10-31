# 🏆 CW Bluedragons · Ultimate Team Cup

Turnier-Bot für **EA FC Ultimate Team (1 gegen 1)**: Registrieren mit EA-ID, tägliche Anmeldelisten, Auslosung in Gruppen, Check-in, Ergebnisse mit Bestätigung, K.-o.-Phase mit Turnierbaum, Hall of Fame mit Siegerbild und Trophäenhalle.

Der Cup läuft **im selben Repo und auf derselben Netlify-Seite** wie der Zusagen-Bot, aber als **eigener Discord-Bot**. Der Zusagen-Bot bleibt unverändert. Solange die `CUP_…`-Variablen fehlen, macht der Cup-Teil gar nichts.

---

## 1. Neuen Discord-Bot anlegen

1. https://discord.com/developers/applications → **New Application**, z. B. „CW Bluedragons Cup“, Logo als App-Icon.
2. **General Information:** *Application ID* und *Public Key* kopieren.
3. **Bot:** *Reset Token* → Token kopieren (geheim halten!).
4. **Bot → Privileged Gateway Intents:** **Server Members Intent** einschalten.
5. **OAuth2 → URL Generator:** Scopes `bot` + `applications.commands`, Bot Permission **Administrator** (oder einzeln: Kanäle verwalten, Rollen verwalten, Nicknamen verwalten, Nachrichten senden/verwalten, Links einbetten, Dateien anhängen, Nachrichtenverlauf lesen, Alle Rollen erwähnen) → Link öffnen → Server auswählen.

## 2. Netlify: Umgebungsvariablen

Auf der bestehenden Seite unter **Project configuration → Environment variables** hinzufügen:

| Variable | Inhalt |
|---|---|
| `CUP_DISCORD_TOKEN` | Token vom **neuen** Cup-Bot |
| `CUP_PUBLIC_KEY` | Public Key vom Cup-Bot |
| `CUP_APP_ID` | Application ID vom Cup-Bot |
| `CUP_GUILD_ID` | Server-ID (Entwicklermodus → Rechtsklick auf Server → ID kopieren) |
| `CUP_SETUP_KEY` | frei gewähltes Passwort, z. B. `ut-setup-4711` |

Danach **neu deployen**.

## 3. Discord mit Netlify verbinden

1. Developer Portal (Cup-Bot) → **General Information → Interactions Endpoint URL:**
   `https://DEINE-SEITE.netlify.app/api/cup/interactions` → Speichern.
2. Im Browser öffnen: `https://DEINE-SEITE.netlify.app/api/cup/setup?key=DEIN_CUP_SETUP_KEY` → Befehle werden registriert.

## 4. Im Discord einrichten

```
/ut-einrichten alles anpfiff: 20:00
```
Legt die Rollen (**UT Turnierleitung**, **UT Spieler**, **UT Gruppe A–H**, **UT Achtelfinale** …) und alle Kanäle an. Alle Cup-Kanäle beginnen mit **UT-** (z. B. 𝐔𝐓-𝐌𝐨𝐧𝐭𝐚𝐠), deshalb werden bestehende Kanäle des Servers nie angefasst. Danach:
- Die Rolle des Cup-Bots in der Rollenliste **ganz nach oben** ziehen.
- Dir selbst die Rolle **UT Turnierleitung** geben (Server-Admins dürfen sowieso alles).
- `/ut-einrichten status` zeigt, was noch fehlt.

## 5. Allein testen (Test-Cup)

1. Selbst registrieren: im Kanal **UT-Regelwerk** akzeptieren, dann **UT-Registrieren** → Plattform → EA-ID.
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
