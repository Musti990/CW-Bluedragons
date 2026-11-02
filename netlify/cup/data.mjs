// Feste Daten: Ligen, Vereine, Formate, Farben.

export const COLOR = 0x2f7bff; // alle Embed-Ränder blau

// ---------- Spieler (Ultimate Team, 1 gegen 1) ----------
// Jeder registrierte Spieler ist ein „Team“ im Turnier. Schlüssel = EA-ID.
export const PLATFORMS = {
  ps: { name: "PlayStation", short: "PS5", icon: "🎮" },
  xbox: { name: "Xbox", short: "Xbox", icon: "🟩" },
  pc: { name: "PC", short: "PC", icon: "💻" },
};
// Alte Namen bleiben als leere Hüllen, damit nichts bricht
export const LEAGUES = [];
export const CLUBS = [];
let PLATFORM_CACHE = {};
/** Wird von getClubs() gefüllt, damit flagOf() synchron die Plattform kennt */
export function setPlatformCache(clubs) { PLATFORM_CACHE = Object.fromEntries(Object.entries(clubs || {}).map(([k, v]) => [k, v.platform])); }
export const club = (name) => (PLATFORM_CACHE[name] !== undefined ? { name, league: PLATFORMS[PLATFORM_CACHE[name]]?.name || "", flag: PLATFORMS[PLATFORM_CACHE[name]]?.icon || "🎮" } : undefined);
export const clubIndex = () => undefined;
export const isFreilos = (name) => String(name).startsWith("Freilos");
export const flagOf = (name) => (isFreilos(name) ? "🎟️" : PLATFORMS[PLATFORM_CACHE[name]]?.icon ?? "🎮");
export const platformOf = (name) => PLATFORMS[PLATFORM_CACHE[name]] || null;
/** EA-ID prüfen: 3–32 Zeichen, Buchstaben/Ziffern/Punkt/Unterstrich/Bindestrich/Leerzeichen */
export function cleanEaId(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (s.length < 3 || s.length > 32) return null;
  if (!/^[\p{L}\p{N}._\- ]+$/u.test(s)) return null;
  if (/^freilos/i.test(s) || /^test-/i.test(s)) return null;
  return s;
}
export function shortClub(name) { return String(name); }

/** Formate (league = Ligasystem mit einer Tabelle und festen Spieltagen): Gruppengrößen, wie viele pro Gruppe sicher weiter (top) und wie viele „Beste des nächsten Platzes“ (ex). */
export const FORMATS = {
  8: { g: [4, 4], top: 2, ex: 0 },
  10: { g: [5, 5], top: 2, ex: 0 },
  12: { g: [4, 4, 4], top: 2, ex: 2 },
  14: { g: [5, 5, 4], top: 2, ex: 2 },
  16: { g: [4, 4, 4, 4], top: 2, ex: 0 },
  18: { g: [5, 5, 4, 4], top: 2, ex: 0 },
  20: { g: [5, 5, 5, 5], top: 2, ex: 0 },
  22: { g: [5, 5, 4, 4, 4], top: 1, ex: 3 },
  24: { g: [4, 4, 4, 4, 4, 4], top: 2, ex: 4 },
  26: { g: [5, 5, 4, 4, 4, 4], top: 2, ex: 4 },
  28: { g: [4, 4, 4, 4, 4, 4, 4], top: 2, ex: 2 },
  30: { g: [5, 5, 5, 5, 5, 5], top: 2, ex: 4 },
  32: { g: [4, 4, 4, 4, 4, 4, 4, 4], top: 2, ex: 0 },
};
/** Ligasystem: eine Tabelle, 4 Spieltage gegen zufällige Gegner; ab 12 Spielern Top 8 → Viertelfinale, sonst Top 4 → Halbfinale */
export const LEAGUE_MAX_ROUNDS = 4; // Liga: höchstens 4 Spieltage
export const leagueDef = (n) => ({ g: [n], top: n >= 12 ? 8 : 4, ex: 0, league: true, rounds: Math.min(LEAGUE_MAX_ROUNDS, n - 1) });
/** Standard ohne Auswahl: 12er und 20er als Liga, alles andere mit Gruppen */
export const defaultMode = (n) => (n === 12 || n === 20 ? "liga" : "gruppen");
/** Modus pro Cup: "auto" (Standard), "gruppen" oder "liga" */
export const isLeague = (f, mode) => mode === "liga" || (mode !== "gruppen" && defaultMode(f) === "liga");
export const fmtDef = (f, mode) => (isLeague(f, mode) ? leagueDef(f) : FORMATS[f]);
export const MODE_NAME = { auto: "Automatisch (12er/20er Liga, sonst Gruppen)", gruppen: "Gruppenphase", liga: "Ligasystem" };

export const FORMAT_KEYS = Object.keys(FORMATS).map(Number);
export const KO_SIZE = { 8: 4, 10: 4, 12: 8, 14: 8, 16: 8, 18: 8, 20: 8, 22: 8, 24: 16, 26: 16, 28: 16, 30: 16, 32: 16 };
export const koSizeFor = (f, mode) => (isLeague(f, mode) ? leagueDef(f).top : KO_SIZE[f]);
export const KO_NAME = { 2: "Finale", 4: "Halbfinale", 8: "Viertelfinale", 16: "Achtelfinale" };

export const GROUP_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const ROUND_ROLES = ["Achtelfinale", "Viertelfinale", "Halbfinale", "Finale", "Spiel um Platz 3"];
export const BASE_ROLES = ["Turnierleitung", "UT Spieler"];

/** Kanal-Typen für /ut-einrichten kanal */
export const BASE_CHANNEL_TYPES = {
  rules: "Regelwerk",
  notify: "Benachrichtigungen",
  reg: "Spieler-registrieren",
  signup: "Anmeldung (Cup-Listen)",
  chat: "Turnier-Chat",
  panel: "Admin-Panel",
  team: "Mein-Profil",
  over: "Spielerübersicht",
  live: "Live-Spielplan",
  hof: "Hall-of-Fame",
  trophy: "Trophäenhalle",
  ko: "KO-Phase",
  kor: "KO-Phase · Ergebnisse",
  ban: "Sperrliste",
  log: "Turnierleitung (Log)",
  admin: "Admin (Protokoll)",
};
export const CHANNEL_TYPES = {
  ...BASE_CHANNEL_TYPES,
  ...Object.fromEntries(GROUP_NAMES.map((g) => ["g" + g, "Gruppe " + g])),
  ...Object.fromEntries(GROUP_NAMES.map((g) => ["r" + g, "Gruppe " + g + " · Ergebnisse"])),
};

export const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export const INACTIVE_DAYS = 7;

export const BAN_REASONS = [
  "Eingecheckt, aber nicht erschienen",
  "Während laufendem Turnierbetrieb rausgegangen",
  "Gruppen- oder K.-o.-Phase ohne Abmeldung verlassen",
  "Beleidigungen, Respektlosigkeit oder unsportliches Verhalten",
  "Sonstiger schwerer Regelverstoß",
];
export const BAN_DAYS = [1, 3, 7, 14, 30, 90, 180, 365];
/** Sperrdauer lesbar: 1 Tag, 7 Tage, 1 Monat, 3 Monate, 12 Monate */
export const durText = (d) => (d >= 30 && d % 30 === 0 ? `${d / 30} ${d === 30 ? "Monat" : "Monate"}` : d === 365 ? "12 Monate" : d === 180 ? "6 Monate" : d === 90 ? "3 Monate" : `${d} ${d === 1 ? "Tag" : "Tage"}`);
/** Bei geänderten Banner-Bildern erhöhen – Discord lädt die Bilder dann neu statt aus dem Zwischenspeicher */
export const BANNER_V = "cw2";
export const BAN_DEFAULT_DAYS = 7;

export const VIDEO_LIMIT = 3; // Größenvideo-Anforderungen pro Mannschaft und Turnier
export const VIDEO_WINDOW_MIN = 40; // nur bis zur 40. Spielminute (Spieluhr in FC 27)

export const RULES_VERSION = 1; // erhöhen, wenn sich das Regelwerk ändert → alle müssen neu akzeptieren
export const RULES = {
  title: "🏆 EA COMMUNITY WORLD – TURNIERREGELN 🏆",
  // Roter Kasten unter dem Regelwerk
  highlight: {
    title: "✅ PFLICHT: TWITCH & TIKTOK FOLLOW",
    text: "Für **beide** Accounts – Follows werden kontrolliert!\n💬 **Bonus:** Aktiv im Chat = Vorteile für zukünftige Turniere\n\n**Follow – Join – Support – Compete – Report – Win** 💪",
  },
  sections: [
    ["💠 Social Media & Twitch", "💪 Wir für euch – ihr für uns!\n⚡ Community Power\n📢 Follows werden kontrolliert\n🤝 Support ist kein Mord – sondern Zusammenhalt der Community"],
    ["👤 ⚜️ Robii92 | Server Admin ⚜️", "🟣 Twitch (Pflicht): **Robii92**\n📸 Instagram (Pflicht): **community.world.turniere**\n🎵 TikTok: **robi92_ttv**"],
    ["👤 Server Admin | BSG", "🟣 Twitch (Pflicht): **BlackSeaGamer**\n🎵 TikTok (Pflicht): **BlackSeaGamer**\n📸 Instagram: **BlackSeaGamer**\n▶️ YouTube: **BlackSeaGamer**"],
    ["💬 Discord", "• Regeln sorgfältig lesen\n• Organisation & Ergebnisse nur im Discord\n• Turnierlinks & Updates unter **CUP Infos**"],
    ["🧾 Teilnahmebedingungen", "🎮 Nur Casual-Spieler\n🎮 Eigenes PSN & Team erforderlich\n🏆 Ultimate Modus (PS5/Xbox – NEW GEN)\n\n❌ **Nicht erlaubt:** Esportler · Esport-Academy-Spieler · Esport-Player-Foundation · angehende Esportler · Leihspieler · PC-Spieler\n\n🎥 **Streamingpflicht ab Halbfinale:** Mindestens 1 Spieler streamt oder teilt via PSN Party\n⚠️ Verstöße = Teilnahme und Preisgeld können nachträglich gestrichen werden"],
    ["⏳ Einladezeit & Matchstart", "• Jede Runde startet nur auf Anweisung im Stream\n• **5 Minuten** Einladezeit nach Matchbekanntgabe\n• **Bei Disconnect:** Restliche Spielzeit wird nachgespielt, Ergebnisse werden addiert. Uneinigkeit → Mod-Team/Veranstalter kontaktieren\n• Technische Probleme/inaktive Gegner → Mod kontaktieren\n• Frist nicht eingehalten → **Default Win 3:0**"],
    ["🎮 Gameplay-Regeln", "• Rainbow-Flick-Bug-Tore ❌\n• Rainbow-Flick-Bug-Kopfball ❌\n• Bei **Rage Quit** kommen **3 Tore** hinzu ⚠️\n\n⚠️ **Verstöße = sofortige Disqualifikation**"],
    ["📊 Ergebnisse", "• Nach jedem Spiel im **Ergebnis-Kanal** deiner Gruppe auf **Ergebnis eintragen** klicken\n• Der Gegner hat **2 Minuten** zum Bestätigen – sonst gilt das Ergebnis automatisch ✅\n• Unterschiedliche Ergebnisse → die Turnierleitung wird markiert und entscheidet\n• Screenshot vom Endstand im Ergebnis-Kanal posten (empfohlen)\n• Tabelle, Spielplan und Bracket aktualisieren sich automatisch"],
    ["🏅 Preise & Belohnungen", "• Preise werden individuell pro Turnier festgelegt\n• Infos unter **CUP Infos**"],
    ["🔞 Teilnahmealter & Zustimmung", "• Mindestalter: **16 Jahre**\n• Teilnahme = Zustimmung zu rechtlichen Voraussetzungen für Preisgeld\n• Veranstalter kann Altersnachweis anfordern"],
    ["⚖️ Rechtliches & Haftung", "• Das Community World Team steht in keinem direkten oder indirekten Zusammenhang mit Twitch, Instagram oder TikTok.\n• Preisgeld wird ausschließlich vom Community World Team ausgezahlt.\n• Regeln können jederzeit angepasst werden, um einen fairen Ablauf zu gewährleisten.\n• Jeder Spieler ist selbst dafür verantwortlich, die rechtlichen Voraussetzungen für Teilnahme und Preisgeld zu erfüllen.\n• Keine Haftung für technische Probleme, Internetverbindungen, Spielfehler oder externe Störungen.\n• Das Team kann bei Regelverstößen disqualifizieren, Ergebnisse ändern oder Matches wiederholen.\n• Entscheidungen des Mod-Teams oder Veranstalters sind verbindlich."],
    ["✅ Zusammenfassung", "1️⃣ Twitch-Kanäle & TikTok folgen\n2️⃣ Im Stream oder Discord anmelden\n3️⃣ Fair spielen & Ergebnis posten\n4️⃣ Sieg sichern 🥇🏆🎯\n\n**Fairness & Respekt = oberste Priorität** 💛\n💛 LG Community World Team 🫶"],
  ],
};

export const FREIGABE_MIN = 5; // maximale Freigabezeit: so viele Minuten nach der Freigabe muss angepfiffen sein
