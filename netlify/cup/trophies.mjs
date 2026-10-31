// Trophäenhalle: Medaillen, Statistiken und Rekorde über alle Cups.
import { isCo } from "./co.mjs";
import { get, mutate, getConfig, getClubs } from "./store.mjs";
import { upsertMessage } from "./discord.mjs";
import { isFreilos, flagOf } from "./data.mjs";
import { winner } from "./tournament.mjs";
import { shortDate } from "./time.mjs";

const blank = () => ({ g: 0, s: 0, b: 0, cups: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
const init = () => ({ cups: 0, goals: 0, clubs: {}, managers: {}, records: {}, last: [] });

/** Nach jedem Cup: alles eintragen */
export async function recordCup(t) {
  const [gold, silver, bronze] = t.podium || [];
  const people = (c) => (t.members?.[c] || []).filter(Boolean);
  const date = shortDate(t.times?.kickoff || Date.now());
  await mutate("stats", (S) => {
    Object.assign(S, { ...init(), ...S });
    S.cups++;
    const club = (c) => (S.clubs[c] ||= blank());
    const man = (u) => (S.managers[u] ||= { ...blank(), titlesBy: {} });
    const both = (c, fn) => { fn(club(c)); for (const u of people(c)) fn(man(u)); };
    for (const c of t.checked.filter((c) => !isFreilos(c))) both(c, (x) => { x.cups++; });
    if (gold) both(gold, (x) => { x.g++; if (x.titlesBy) x.titlesBy[gold] = (x.titlesBy[gold] || 0) + 1; });
    if (silver) both(silver, (x) => { x.s++; });
    if (bronze) both(bronze, (x) => { x.b++; });
    // Spiele (ohne Freilose und kampflose Wertungen)
    const goalsCup = {};
    for (const m of t.matches.filter((m) => m.status === "fertig" && !m.ff && !isFreilos(m.home) && !isFreilos(m.away))) {
      const w = winner(m);
      for (const [c, f, a] of [[m.home, m.h, m.a], [m.away, m.a, m.h]]) {
        both(c, (x) => { x.gf += f; x.ga += a; if (w === c) x.w++; else if (w) x.l++; else x.d++; });
        goalsCup[c] = (goalsCup[c] || 0) + f;
      }
      S.goals += m.h + m.a;
      const diff = Math.abs(m.h - m.a), best = S.records.biggestWin;
      if (diff > 0 && (!best || diff > Math.abs(best.h - best.a))) S.records.biggestWin = { home: m.home, away: m.away, h: m.h, a: m.a, date };
    }
    for (const [c, n] of Object.entries(goalsCup)) if (!S.records.mostGoals || n > S.records.mostGoals.n) S.records.mostGoals = { club: c, n, date };
    if (gold) {
      const cur = S.records.curStreak;
      S.records.curStreak = cur?.club === gold ? { club: gold, n: cur.n + 1, from: cur.from, to: date } : { club: gold, n: 1, from: date, to: date };
      if (!S.records.streak || S.records.curStreak.n > S.records.streak.n) S.records.streak = { ...S.records.curStreak };
      const f = t.matches.find((m) => m.final && m.round === t.koRound);
      S.last.unshift({ date, club: gold, final: f ? { opp: f.home === gold ? f.away : f.home, h: f.home === gold ? f.h : f.a, a: f.home === gold ? f.a : f.h, pen: f.pen ? (f.home === gold ? f.pen : [f.pen[1], f.pen[0]]) : null } : null });
      S.last = S.last.slice(0, 5);
    }
  }, { initial: init() });
}

const rank = (a, b) => b.g - a.g || b.s - a.s || b.b - a.b || b.cups - a.cups;

export function trophyPanel(S, clubs = {}, site = "") {
  S = { ...init(), ...(S || {}) };
  const V2 = 1 << 15;
  const esc = (s) => String(s).replace(/([*_`~|>])/g, "\\$1");
  const txt = (content) => ({ type: 10, content });
  const line = () => ({ type: 14, divider: true, spacing: 1 });
  const clubRows = Object.entries(S.clubs).filter(([, x]) => x.g || x.s || x.b).sort((a, b) => rank(a[1], b[1])).slice(0, 10)
    .map(([c, x], k) => `\`${String(k + 1).padStart(2, "0")}\` ${flagOf(c)} **${esc(c)}** · 🥇 **${x.g}** · 🥈 ${x.s} · 🥉 ${x.b} · ${x.cups} ${x.cups === 1 ? "Cup" : "Cups"}`);
  const mgrRows = Object.entries(S.managers).filter(([, x]) => x.g || x.s || x.b).sort((a, b) => rank(a[1], b[1])).slice(0, 5)
    .map(([u, x], k) => `${["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][k]} <@${u}> · **${x.g} Titel** · ${x.s}× Finale · ${x.b}× Platz 3`);
  const R = S.records, rec = [];
  if (R.mostGoals) rec.push(`⚽ **Meiste Tore in einem Cup:** ${flagOf(R.mostGoals.club)} ${esc(R.mostGoals.club)} · ${R.mostGoals.n} Tore (${R.mostGoals.date})`);
  if (R.biggestWin) rec.push(`💥 **Höchster Sieg:** ${flagOf(R.biggestWin.home)} ${esc(R.biggestWin.home)} ${R.biggestWin.h}:${R.biggestWin.a} ${esc(R.biggestWin.away)} ${flagOf(R.biggestWin.away)} (${R.biggestWin.date})`);
  if (R.streak && R.streak.n > 1) rec.push(`🔥 **Titel in Folge:** ${flagOf(R.streak.club)} ${esc(R.streak.club)} · ${R.streak.n}× (${R.streak.from} – ${R.streak.to})`);
  const most = Object.entries(S.clubs).sort((a, b) => b[1].cups - a[1].cups)[0];
  if (most) rec.push(`🎯 **Meiste Cups gespielt:** ${flagOf(most[0])} ${esc(most[0])} · ${most[1].cups}`);
  const last = S.last.map((x) => `\`${x.date.split(", ").pop()}\` 🏆 ${flagOf(x.club)} **${esc(x.club)}**${x.final ? ` · Finale ${x.final.h}:${x.final.a}${x.final.pen ? ` (${x.final.pen[0]}:${x.final.pen[1]} i.E.)` : ""} gegen ${esc(x.final.opp)}` : ""}`);
  const withMedal = Object.values(S.clubs).filter((x) => x.g || x.s || x.b).length;
  const empty = "_Noch keine Einträge – nach dem ersten Cup geht’s los._";
  return {
    flags: V2,
    components: [{
      type: 17, accent_color: 0x2f7bff, components: [
        { type: 12, items: [{ media: { url: `${site}/cup-banner-halloffame.jpg` } }] },
        txt(`## 🏅 Trophäenhalle · Ultimate Team Cup\n**${S.cups} ${S.cups === 1 ? "Cup" : "Cups"}** gespielt · **${withMedal} Spieler** mit Medaille · **${S.goals.toLocaleString("de-AT")} Tore**`),
        line(), txt("### 🏆 Medaillenspiegel · Spieler\n" + (clubRows.join("\n") || empty)),
        line(), txt("### 📊 Rekorde\n" + (rec.join("\n") || empty)),
        line(), txt("### 🕰️ Letzte Sieger\n" + (last.join("\n") || empty)),
        line(),
        { type: 1, components: [{ type: 2, style: 1, label: "Meine Statistik", custom_id: "stats_me", emoji: { name: "📊" } }] },
        txt("-# 🥇 Sieger · 🥈 Finalist · 🥉 Platz 3 · sortiert nach Titeln, dann Finals, dann Platz 3 · aktualisiert sich nach jedem Cup"),
      ],
    }],
    allowed_mentions: { parse: [] },
  };
}

/** „Meine Statistik“ (nur für den Klickenden sichtbar) */
export async function myStats(uid) {
  const S = { ...init(), ...((await get("stats")) || {}) };
  const x = S.managers[uid];
  const clubs = await getClubs();
  const mine = Object.entries(clubs).find(([, c]) => c.manager === uid || isCo(c, uid));
  const now = mine ? `🎮 EA-ID: ${flagOf(mine[0])} **${mine[0]}**\n` : "";
  if (!x) return `📊 **Deine Statistik**\n\n${now}Du hast noch keinen Cup gespielt – sobald du dabei bist, landen deine Zahlen hier.`;
  const games = x.w + x.d + x.l, td = x.gf - x.ga;
  const by = "";
  const vit = "🏆".repeat(Math.min(x.g, 15)) + (x.s ? " " + "🥈".repeat(Math.min(x.s, 15)) : "") + (x.b ? " " + "🥉".repeat(Math.min(x.b, 15)) : "");
  return `📊 **Deine Statistik**\n\n${now}🏆 **${x.g} Titel**${by ? ` (${by})` : ""} · 🥈 ${x.s} Finals · 🥉 ${x.b}× Platz 3\n🎮 **${x.cups} ${x.cups === 1 ? "Cup" : "Cups"}** · ${games} Spiele · ${x.w} S · ${x.d} U · ${x.l} N\n⚽ ${x.gf}:${x.ga} Tore · TD ${td > 0 ? "+" + td : td}${games ? ` · Ø ${(x.gf / games).toFixed(1).replace(".", ",")} Tore pro Spiel` : ""}\n\n🏅 **Deine Vitrine:** ${vit || "noch leer"}`;
}

export async function refreshTrophyPanel() {
  const cfg = await getConfig(); const ch = cfg.channels?.trophy; if (!ch) return;
  const site = process.env.URL || process.env.SITE_URL || "";
  const panels = (await get("panels")) || {};
  const id = await upsertMessage(ch, panels.trophy, trophyPanel(await get("stats"), await getClubs(), site));
  if (id && id !== panels.trophy) { await mutate("panels", (p) => { p.trophy = id; }, { initial: { over: [] } }); }
}

/** EA-ID geändert: Statistik unter dem neuen Namen weiterführen */
export async function renameClub(oldName, newName) {
  await mutate("stats", (S) => {
    Object.assign(S, { ...init(), ...S });
    if (S.clubs[oldName]) { S.clubs[newName] = S.clubs[oldName]; delete S.clubs[oldName]; }
    for (const k of ["mostGoals", "streak", "curStreak"]) if (S.records[k]?.club === oldName) S.records[k].club = newName;
    for (const x of S.last) if (x.club === oldName) x.club = newName;
  }, { initial: init() });
  await refreshTrophyPanel();
}

/** Statistik einer Person (für „Mein Profil“) */
export async function personStats(uid) {
  const S = { ...init(), ...((await get("stats")) || {}) };
  return S.managers[uid] || null;
}
