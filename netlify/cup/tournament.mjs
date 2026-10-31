// Reine Turnierlogik – keine Discord-Aufrufe. Mannschaften werden über den Vereinsnamen identifiziert.
import { FORMATS, FORMAT_KEYS, KO_SIZE, KO_NAME, GROUP_NAMES, isFreilos } from "./data.mjs";

export const fmtOf = (n) => FORMAT_KEYS.filter((k) => k <= n).pop() ?? null;
export const nextFmt = (n) => FORMAT_KEYS.find((k) => k > n) ?? null;
export const ACTIVE = ["checkin", "gruppen", "ko"];

export function createTournament({ channelId, name, day, date, times }) {
  return {
    channelId, name, day, date, times, // times: { close, checkinEnd, kickoff } als Zeitstempel
    status: "anmeldung", // anmeldung → checkin → gruppen → ko → fertig | abgesagt | geloescht
    reg: [], fmt: null, playing: [], wait: [], waitChecked: [],
    groups: [], matches: [], checked: [], out: [],
    round: 0, maxRounds: 0, koSize: 0, koRound: 0, champion: null, podium: null,
    members: {}, // Verein → [Discord-IDs] (Manager + Co-VM) zum Zeitpunkt der Auslosung
    msgs: { panel: null, live: null, groups: {}, bracket: null },
    nextId: 1, kickoffDone: false, createdAt: Date.now(),
    videos: [], // Größenvideo-Anforderungen

  };
}

// ---------- Anmeldung ----------
export function register(t, clubName) {
  if (t.status !== "anmeldung") throw new Error("Die Anmeldung ist geschlossen.");
  if (t.reg.includes(clubName)) throw new Error("Du bist bereits angemeldet.");
  t.reg.push(clubName);
  return t.reg.length;
}
export function unregister(t, clubName) {
  if (t.status !== "anmeldung") throw new Error("Abmelden geht nur, solange die Anmeldung offen ist.");
  if (!t.reg.includes(clubName)) throw new Error("Du bist nicht angemeldet.");
  t.reg = t.reg.filter((c) => c !== clubName);
}

// ---------- Freilose ----------
export function addFreilos(t) {
  if (t.status !== "anmeldung") throw new Error("Freilose gehen nur, solange die Anmeldung offen ist.");
  let k = 1; while (t.reg.includes(`Freilos ${k}`)) k++;
  t.reg.push(`Freilos ${k}`);
  return t.reg.filter(isFreilos).length;
}
export function removeFreilos(t) {
  if (t.status !== "anmeldung") throw new Error("Freilose gehen nur, solange die Anmeldung offen ist.");
  const last = [...t.reg].reverse().find(isFreilos);
  if (!last) throw new Error("Es gibt kein Freilos zum Entfernen.");
  t.reg = t.reg.filter((c) => c !== last);
  return t.reg.filter(isFreilos).length;
}

// ---------- Auslosung ----------
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function roundRobin(ids) {
  const a = [...ids];
  if (a.length % 2) a.push(null);
  const n = a.length, out = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let k = 0; k < n / 2; k++) {
      const x = a[k], y = a[n - 1 - k];
      if (x && y) pairs.push(r % 2 ? [y, x] : [x, y]);
    }
    out.push(pairs);
    a.splice(1, 0, a.pop());
  }
  return out;
}

/** Schließt die Anmeldung, wählt das Format und lost die Gruppen aus. */
export function closeAndDraw(t) {
  if (t.status !== "anmeldung") throw new Error("Die Anmeldung ist schon geschlossen.");
  const f = fmtOf(t.reg.length);
  if (!f) { t.status = "abgesagt"; return { cancelled: true }; }
  t.fmt = f;
  // Echte Mannschaften zuerst, Freilose füllen nur auf
  const real = t.reg.filter((c) => !isFreilos(c)), free = t.reg.filter(isFreilos);
  const ordered = [...real.slice(0, f), ...free, ...real.slice(f)];
  t.playing = ordered.slice(0, f);
  t.wait = ordered.slice(f).filter((c) => !isFreilos(c));
  const sizes = FORMATS[f].g;
  t.groups = sizes.map((size, i) => ({ name: GROUP_NAMES[i], size, teams: [] }));
  let gi = 0;
  // Freilose zuerst verteilen → jedes in eine andere Gruppe
  const pool = [...shuffle(t.playing.filter(isFreilos)), ...shuffle(t.playing.filter((c) => !isFreilos(c)))];
  for (const c of pool) {
    while (t.groups[gi % t.groups.length].teams.length >= t.groups[gi % t.groups.length].size) gi++;
    t.groups[gi % t.groups.length].teams.push(c);
    gi++;
  }
  t.matches = [];
  t.maxRounds = 0;
  for (const g of t.groups) {
    const rounds = roundRobin(g.teams);
    t.maxRounds = Math.max(t.maxRounds, rounds.length);
    rounds.forEach((pairs, ri) => pairs.forEach(([home, away]) => t.matches.push(newMatch(t, { phase: "gruppe", group: g.name, round: ri + 1, home, away }))));
  }
  t.status = "checkin";
  t.checked = t.playing.filter((c) => isFreilos(c) || t.virtual?.includes(c)); // Freilose und Test-Teams sind automatisch „da“
  t.waitChecked = [];
  t.out = t.playing.filter(isFreilos);     // … verlieren aber jedes Spiel 0:3 und kommen nie weiter
  return { cancelled: false };
}

function newMatch(t, data) {
  return { id: t.nextId++, reports: {}, h: null, a: null, pen: null, status: "offen", ff: false, ...data };
}

export const groupOf = (t, clubName) => t.groups.find((g) => g.teams.includes(clubName))?.name ?? null;

// ---------- Check-in ----------
export function checkIn(t, clubName) {
  if (t.status !== "checkin") throw new Error("Der Check-in ist gerade nicht offen.");
  if (t.playing.includes(clubName)) {
    if (t.checked.includes(clubName)) throw new Error("Du bist bereits eingecheckt.");
    t.checked.push(clubName);
    return "gruppe";
  }
  if (t.wait.includes(clubName)) {
    if (t.waitChecked.includes(clubName)) throw new Error("Du bist auf der Warteliste bereits eingecheckt.");
    t.waitChecked.push(clubName);
    return "warteliste";
  }
  throw new Error("Du bist heute nicht dabei.");
}

function replaceTeam(t, oldC, newC) {
  t.groups.forEach((g) => (g.teams = g.teams.map((x) => (x === oldC ? newC : x))));
  t.matches.forEach((m) => { if (m.home === oldC) m.home = newC; if (m.away === oldC) m.away = newC; });
  t.playing = t.playing.map((x) => (x === oldC ? newC : x));
}

/** Check-in-Ende: Nachrücker einsetzen, sonst Spiele mit 0:3 werten. */
export function finishCheckin(t) {
  if (t.status !== "checkin") throw new Error("Es läuft gerade kein Check-in.");
  const replaced = [], forfeited = [];
  const queue = t.wait.filter((c) => t.waitChecked.includes(c));
  for (const c of t.playing.filter((c) => !t.checked.includes(c) && !isFreilos(c))) {
    const g = groupOf(t, c);
    const rep = queue.shift();
    if (rep) {
      replaceTeam(t, c, rep);
      t.checked.push(rep);
      t.wait = t.wait.filter((x) => x !== rep);
      replaced.push({ old: c, new: rep, group: g });
    } else {
      t.out.push(c);
      forfeited.push({ club: c, group: g });
    }
  }
  for (const m of t.matches) {
    const ho = t.out.includes(m.home), ao = t.out.includes(m.away);
    if (ho || ao) { m.h = ho && !ao ? 0 : ao && !ho ? 3 : 0; m.a = ao && !ho ? 0 : ho && !ao ? 3 : 0; m.status = "fertig"; m.ff = true; }
  }
  t.status = "gruppen";
  t.round = 1;
  return { replaced, forfeited };
}

// ---------- Tabellen ----------
export function standings(t, groupName) {
  const g = t.groups.find((x) => x.name === groupName);
  const rows = g.teams.map((id) => ({ id, sp: 0, s: 0, u: 0, n: 0, t: 0, gt: 0, p: 0 }));
  const f = (id) => rows.find((r) => r.id === id);
  for (const m of t.matches) {
    if (m.phase !== "gruppe" || m.group !== groupName || m.status !== "fertig") continue;
    const A = f(m.home), B = f(m.away);
    if (!A || !B) continue;
    A.sp++; B.sp++; A.t += m.h; A.gt += m.a; B.t += m.a; B.gt += m.h;
    if (m.h > m.a) { A.s++; B.n++; A.p += 3; } else if (m.h < m.a) { B.s++; A.n++; B.p += 3; } else { A.u++; B.u++; A.p++; B.p++; }
  }
  return rows.sort((x, y) => y.p - x.p || (y.t - y.gt) - (x.t - x.gt) || y.t - x.t || x.id.localeCompare(y.id));
}

// ---------- Spiele ----------
export const currentMatches = (t) =>
  t.status === "gruppen" ? t.matches.filter((m) => m.phase === "gruppe" && m.round === t.round)
  : t.status === "ko" ? t.matches.filter((m) => m.phase === "ko" && m.round === t.koRound)
  : [];

export const isEditable = (t, m) =>
  (m.phase === "gruppe" && t.status === "gruppen" && m.round === t.round) || (m.phase === "ko" && t.status === "ko" && m.round === t.koRound);

export const openMatchesOf = (t, clubName) => currentMatches(t).filter((m) => m.status !== "fertig" && (m.home === clubName || m.away === clubName));

export const winner = (m) => (m.h !== m.a ? (m.h > m.a ? m.home : m.away) : m.pen ? (m.pen[0] > m.pen[1] ? m.home : m.away) : null);
export const loser = (m) => (winner(m) === m.home ? m.away : m.home);

export function parseScore(s) {
  const m = String(s ?? "").match(/^\s*(\d{1,2})\s*[:\-]\s*(\d{1,2})\s*$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function normalize(m, h, a, pen) {
  if (![h, a].every((x) => Number.isInteger(x) && x >= 0 && x <= 99)) throw new Error("Ungültiges Ergebnis.");
  if (m.phase === "gruppe" || h !== a) return null;
  if (!pen) throw new Error("K.-o.-Spiele brauchen einen Sieger: bei Unentschieden bitte das Elfmeterergebnis angeben (z. B. 4:3).");
  if (pen[0] === pen[1]) throw new Error("Das Elfmeterschießen kann nicht unentschieden enden.");
  return pen;
}

/** Meldung einer Mannschaft. Rückgabe: "wartet" | "konflikt" | "bestaetigt" */
export function report(t, matchId, clubName, h, a, pen) {
  const m = t.matches.find((x) => x.id === matchId);
  if (!m || !isEditable(t, m) || m.status === "fertig") throw new Error("Dieses Spiel ist bereits abgeschlossen.");
  if (clubName !== m.home && clubName !== m.away) throw new Error("Du spielst nicht in diesem Spiel.");
  pen = normalize(m, h, a, pen);
  m.reports[clubName] = { h, a, pen };
  const other = m.reports[clubName === m.home ? m.away : m.home];
  if (!other) { m.status = "offen"; m.pendingBy = clubName; m.pendingSince = Date.now(); return { state: "wartet", m }; }
  if (JSON.stringify(other) === JSON.stringify(m.reports[clubName])) {
    Object.assign(m, { h, a, pen, status: "fertig" });
    return { state: "bestaetigt", m };
  }
  m.status = "konflikt";
  return { state: "konflikt", m };
}

/** Ergebnis durch die Turnierleitung */
export function adminSet(t, matchId, h, a, pen) {
  const m = t.matches.find((x) => x.id === matchId);
  if (!m) throw new Error(`Spiel #${matchId} gibt es nicht.`);
  if (!isEditable(t, m)) throw new Error("Dieses Spiel kann nicht mehr geändert werden (die Runde ist schon vorbei).");
  pen = normalize(m, h, a, pen);
  Object.assign(m, { h, a, pen, status: "fertig" });
  return m;
}

// ---------- Fortschritt ----------
/** Prüft, ob die aktuelle Runde fertig ist, und geht weiter. Gibt Ereignisse zurück. */
export function advance(t) {
  const events = [];
  for (let guard = 0; guard < 20; guard++) {
    const cur = currentMatches(t);
    if (!["gruppen", "ko"].includes(t.status) || cur.some((m) => m.status !== "fertig")) break;
    if (t.status === "gruppen") {
      if (t.round < t.maxRounds) { t.round++; events.push({ type: "spieltag", round: t.round }); continue; }
      startKO(t);
      events.push({ type: "ko-start" });
      continue;
    }
    const r = advanceKO(t);
    events.push(r);
    if (r.type === "finish") break;
  }
  return events;
}

export function qualification(t) {
  const d = FORMATS[t.fmt];
  const mixed = new Set(d.g).size > 1;
  const tabs = t.groups.map((g) => standings(t, g.name).filter((r) => !t.out.includes(r.id)));
  const ppg = (r) => (r.sp ? r.p / r.sp : 0), dpg = (r) => (r.sp ? (r.t - r.gt) / r.sp : 0);
  const cmp = (a, b) => (mixed ? ppg(b) - ppg(a) || dpg(b) - dpg(a) || b.t - a.t : b.p - a.p || (b.t - b.gt) - (a.t - a.gt) || b.t - a.t);
  const q = [];
  for (let p = 0; p < d.top; p++) q.push(...tabs.map((x) => x[p]).filter(Boolean).sort(cmp));
  if (d.ex) q.push(...tabs.map((x) => x[d.top]).filter(Boolean).sort(cmp).slice(0, d.ex));
  let size = 1;
  while (size * 2 <= q.length) size *= 2;
  return q.slice(0, size).map((r) => r.id);
}

function seedOrder(n) { let o = [1]; while (o.length < n) { const m = o.length * 2; o = o.flatMap((x) => [x, m + 1 - x]); } return o; }

function startKO(t) {
  const q = qualification(t);
  t.koSize = q.length;
  t.koRound = 1;
  t.qualified = q;
  t.status = "ko";
  const o = seedOrder(q.length);
  for (let i = 0; i < q.length / 2; i++) {
    t.matches.push(newMatch(t, { phase: "ko", round: 1, slot: i, home: q[o[2 * i] - 1], away: q[o[2 * i + 1] - 1], final: q.length === 2 }));
  }
}

function advanceKO(t) {
  const cur = currentMatches(t).sort((a, b) => a.slot - b.slot);
  if (cur.some((m) => m.final)) {
    const f = cur.find((m) => m.final), p = cur.find((m) => m.p3);
    t.champion = winner(f);
    t.podium = [winner(f), loser(f), p ? winner(p) : null].filter(Boolean);
    t.status = "fertig";
    return { type: "finish" };
  }
  const w = cur.map(winner), l = cur.map(loser);
  t.koRound++;
  if (w.length === 2) {
    t.matches.push(newMatch(t, { phase: "ko", round: t.koRound, slot: 0, home: w[0], away: w[1], final: true }));
    t.matches.push(newMatch(t, { phase: "ko", round: t.koRound, slot: 1, home: l[0], away: l[1], p3: true }));
  } else {
    for (let i = 0; i < w.length; i += 2) t.matches.push(newMatch(t, { phase: "ko", round: t.koRound, slot: i / 2, home: w[i], away: w[i + 1] }));
  }
  return { type: "ko-runde", winners: w, losers: l };
}

/** Name der K.-o.-Runde */
export function koRoundName(t, round = t.koRound) {
  const n = t.koSize / Math.pow(2, round - 1);
  return n === 2 ? "Finale" : KO_NAME[n];
}

/** Welche Runden-Rolle hat ein Verein gerade? */
export function koRoleOf(t, clubName) {
  if (t.status !== "ko") return null;
  const m = currentMatches(t).find((x) => x.home === clubName || x.away === clubName);
  if (!m) return null;
  if (m.p3) return "Spiel um Platz 3";
  if (m.final) return "Finale";
  return koRoundName(t);
}

export const koSizeOf = (fmt) => KO_SIZE[fmt];

// ---------- Größenvideos ----------
export function requestVideo(t, clubName, limit, windowMin = 40, minute = null) {
  if (minute != null && (minute < 1 || minute > windowMin)) throw new Error(`Größenvideos können nur in den ersten ${windowMin} Spielminuten angefordert werden.`);
  const m = openMatchesOf(t, clubName)[0];
  if (!m) throw new Error("Du hast gerade kein laufendes Spiel.");
  t.videos = t.videos || [];
  const used = t.videos.filter((v) => v.by === clubName).length;
  if (used >= limit) throw new Error(`Ihr habt eure ${limit} Größenvideo-Anforderungen für dieses Turnier schon aufgebraucht.`);
  if (t.videos.some((v) => v.by === clubName && v.matchId === m.id)) throw new Error("Ihr habt in diesem Spiel schon ein Größenvideo angefordert.");
  const to = m.home === clubName ? m.away : m.home;
  const v = { id: t.videos.length + 1, matchId: m.id, by: clubName, to, status: "offen", link: null, at: Date.now(), minute };
  t.videos.push(v);
  return { v, m, left: limit - used - 1 };
}
export function submitVideo(t, videoId, clubName, link) {
  const v = (t.videos || []).find((x) => x.id === videoId);
  if (!v) throw new Error("Diese Anforderung gibt es nicht mehr.");
  if (v.to !== clubName) throw new Error("Das Video muss die angefragte Mannschaft einreichen.");
  if (v.status === "eingereicht" || v.status === "verspaetet") throw new Error("Das Video wurde schon eingereicht.");
  v.status = v.status === "verpasst" ? "verspaetet" : "eingereicht";
  v.link = link;
  return v;
}
/** Nach Spielende: offene Anforderungen zu diesem Spiel als verpasst markieren */
export function closeVideos(t, matchId) {
  const missed = [];
  for (const v of t.videos || []) if (v.matchId === matchId && v.status === "offen") { v.status = "verpasst"; missed.push(v); }
  return missed;
}

// ---------- Bestätigen & 2-Minuten-Regel ----------
export const CONFIRM_MS = 2 * 60 * 1000;

/** Gegner bestätigt das gemeldete Ergebnis per Button */
export function confirmPending(t, matchId, clubName) {
  const m = t.matches.find((x) => x.id === matchId);
  if (!m || !isEditable(t, m) || m.status === "fertig") throw new Error("Dieses Spiel ist bereits abgeschlossen.");
  if (m.status === "konflikt") throw new Error("Für dieses Spiel gibt es einen Konflikt – die Turnierleitung entscheidet.");
  if (!m.pendingBy) throw new Error("Für dieses Spiel wurde noch kein Ergebnis gemeldet.");
  if (clubName === m.pendingBy) throw new Error("Bestätigen muss der Gegner.");
  if (clubName !== m.home && clubName !== m.away) throw new Error("Du spielst nicht in diesem Spiel.");
  const r = m.reports[m.pendingBy];
  Object.assign(m, { h: r.h, a: r.a, pen: r.pen, status: "fertig" });
  return m;
}

/** Nach 2 Minuten ohne Reaktion gilt das gemeldete Ergebnis */
export function autoConfirm(t, now = Date.now()) {
  const done = [];
  for (const m of currentMatches(t)) {
    if (m.status === "offen" && m.pendingBy && m.pendingSince && now - m.pendingSince >= CONFIRM_MS && Object.keys(m.reports).length === 1) {
      const r = m.reports[m.pendingBy];
      Object.assign(m, { h: r.h, a: r.a, pen: r.pen, status: "fertig", auto: true });
      done.push(m.id);
    }
  }
  return done;
}
