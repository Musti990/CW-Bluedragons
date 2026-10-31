// Alles rund um Wiener Zeit (inkl. Sommer-/Winterzeit).
const TZ = "Europe/Vienna";
export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

const two = (n) => String(n).padStart(2, "0");
export const weekdayOf = (y, mo, d) => ((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7) + 1; // Mo=1 … So=7
export const dateKey = (y, mo, d) => `${y}-${two(mo)}-${two(d)}`;
export const shortDate = (mo, d) => `${two(d)}.${two(mo)}.`;
export const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export function viennaParts(ms = Date.now()) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const y = +p.year, mo = +p.month, d = +p.day;
  return { y, mo, d, h: +p.hour, mi: +p.minute, weekday: weekdayOf(y, mo, d), dateKey: dateKey(y, mo, d), hhmm: `${p.hour}:${p.minute}` };
}

/** Datum + "HH:MM" in Wiener Zeit → Zeitstempel */
export function viennaAt(y, mo, d, hhmm) {
  const [h, mi] = hhmm.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const p = viennaParts(asUtc);
  const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - asUtc;
  return asUtc - offset;
}

/** "31.10.2026 20:00" → Zeitstempel */
export function parseVienna(str) {
  const m = String(str).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const [d, mo, y] = m.slice(1, 4).map(Number);
  return viennaAt(y, mo, d, `${two(m[4])}:${m[5]}`);
}

/** "20:00" / "8.30" → "08:30" oder null */
export function parseTime(str) {
  const m = String(str ?? "").trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${two(m[1])}:${m[2]}`;
}

/** Nächster Termin an diesem Wochentag, der noch mind. minLead in der Zukunft liegt. */
export function nextOccurrence(weekday, hhmm, minLead = 5 * 60000) {
  const now = viennaParts();
  for (let k = 0; k <= 7; k++) {
    const dt = new Date(Date.UTC(now.y, now.mo - 1, now.d + k));
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    if (weekdayOf(y, mo, d) !== weekday) continue;
    const ms = viennaAt(y, mo, d, hhmm);
    if (ms > Date.now() + minLead) return { y, mo, d, ms };
  }
  return null;
}

/** Heutiges Datum in Wien als "JJJJ-MM-TT" */
export const todayKey = (ms = Date.now()) => viennaParts(ms).dateKey;

/** Ganze Tage zwischen zwei "JJJJ-MM-TT"-Daten */
export function daysBetween(a, b) {
  const p = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

export const minutesToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
