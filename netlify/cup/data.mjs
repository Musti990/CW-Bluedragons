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

/** Formate: Gruppengrößen, wie viele pro Gruppe sicher weiter (top) und wie viele „Beste des nächsten Platzes“ (ex). */
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
export const FORMAT_KEYS = Object.keys(FORMATS).map(Number);
export const KO_SIZE = { 8: 4, 10: 4, 12: 8, 14: 8, 16: 8, 18: 8, 20: 8, 22: 8, 24: 16, 26: 16, 28: 16, 30: 16, 32: 16 };
export const KO_NAME = { 2: "Finale", 4: "Halbfinale", 8: "Viertelfinale", 16: "Achtelfinale" };

export const GROUP_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const ROUND_ROLES = ["Achtelfinale", "Viertelfinale", "Halbfinale", "Finale", "Spiel um Platz 3"];
export const BASE_ROLES = ["Turnierleitung", "UT Spieler"];

/** Kanal-Typen für /ut-einrichten kanal */
export const BASE_CHANNEL_TYPES = {
  rules: "Regelwerk",
  notify: "Benachrichtigungen",
  reg: "Spieler-registrieren",
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
export const BAN_DAYS = [1, 3, 7, 14, 30];
export const BAN_DEFAULT_DAYS = 7;

export const VIDEO_LIMIT = 3; // Größenvideo-Anforderungen pro Mannschaft und Turnier
export const VIDEO_WINDOW_MIN = 40; // nur bis zur 40. Spielminute (Spieluhr in FC 27)

export const RULES_VERSION = 1; // erhöhen, wenn sich das Regelwerk ändert → alle müssen neu akzeptieren
export const RULES = {
  title: "🏆 CW BLUEDRAGONS · ULTIMATE TEAM CUP – REGELWERK",
  highlight: {
    title: "📸 SCREENSHOT-PFLICHT 📸",
    text: "**Nach jedem Spiel postet der Sieger einen Screenshot vom Endstand im Ergebniskanal.**\nOhne Screenshot kann die Turnierleitung bei Streit nicht entscheiden – im Zweifel wird das Spiel neu angesetzt oder gegen dich gewertet.",
  },
  sections: [
    ["🎮 Spielmodus", "• **1 gegen 1** in EA FC Ultimate Team (Freundschaftsspiel online)\n• Spielzeit **6 Minuten** pro Halbzeit, Schwierigkeit **Weltklasse**\n• Crossplay ist erlaubt – ladet euch über die **EA-ID** aus der Anmeldeliste ein"],
    ["⏰ Pünktlichkeit", "• Check-in bis **5 Minuten vor Anpfiff** – sonst rückt die Warteliste nach\n• Wer **10 Minuten** nach Freigabe nicht erscheint, verliert das Spiel **0:3**"],
    ["🔌 Verbindungsabbruch", "• Abbruch in der **1. Halbzeit**: Neustart, Spielstand wird übernommen\n• Abbruch in der **2. Halbzeit**: Das Ergebnis zum Zeitpunkt des Abbruchs zählt\n• Absichtliches Verlassen = **0:3** und Sperre"],
    ["⚖️ Unentschieden", "• **Gruppenphase:** Unentschieden zählt (1 Punkt)\n• **K.-o.-Phase:** Verlängerung und Elfmeterschießen laufen im Spiel – das Elfmeterergebnis mit angeben"],
    ["🤝 Respekt & Fair Play", "• Respektvoller Umgang mit allen Spielern\n• Keine Beleidigungen, kein Trashtalk über die Grenze\n• Kein Ausnutzen von Bugs oder Glitches"],
    ["⚖️ Fairness geht vor", "Mit der Anmeldung akzeptiert jeder Spieler dieses Regelwerk. Verstöße werden je nach Schwere mit Verwarnung, Sperre oder Ausschluss geahndet.\n\n**CW Bluedragons – Respekt. Fairness. Wettbewerb.** 🐉"],
  ],
};

export const FREIGABE_MIN = 5; // maximale Freigabezeit: so viele Minuten nach der Freigabe muss angepfiffen sein
