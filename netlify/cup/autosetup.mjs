// /ut-einrichten alles: Rollen, Kanäle erkennen/anlegen, Rechte, Wochenplan, Panels – in einem Rutsch.
import { coList } from "./co.mjs";
import { get, set, del, keys, mutate, getConfig } from "./store.mjs";
import { discord, getRoles, createRole, deleteMessage } from "./discord.mjs";
import { GROUP_NAMES, ROUND_ROLES, DAYS, CHANNEL_TYPES } from "./data.mjs";
import { parseTime, toMinutes } from "./time.mjs";

const G = () => process.env.CUP_GUILD_ID;
const P = { VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n, FILES: 1n << 15n, HISTORY: 1n << 16n };
const bits = (...xs) => xs.reduce((a, b) => a | b, 0n).toString();

/**
 * Text in die fette Server-Schrift umwandeln (𝐁𝐞𝐢𝐬𝐩𝐢𝐞𝐥). Funktioniert auch mit Namen, die schon in einer
 * anderen Zier-Schrift stehen (z. B. 𝓢𝓬𝓱𝓻𝓮𝓲𝓫𝓼𝓬𝓱𝓻𝓲𝓯𝓽). Umlaute gibt es in dieser Schrift nicht → ae, oe, ue, ss.
 */
export function toBold(s) {
  const UML = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };
  return [...String(s)].map((ch) => {
    const plain = UML[ch] ?? (ch.codePointAt(0) > 0x1d000 ? ch.normalize("NFKC") : ch);
    return [...plain].map((x) => {
      const c = x.charCodeAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + c - 97);
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ce + c - 48);
      return x;
    }).join("");
  }).join("");
}
const fancy = toBold;

/** Kanal-Plan: Schlüssel, Name beim Anlegen, Kategorie, Rechte-Profil.
 *  Alle Cup-Kanäle beginnen mit „UT-“, damit sie nie mit anderen Kanälen des Servers verwechselt werden. */
const PLAN = [
  { key: "rules", name: "📜・" + fancy("UT-Regelwerk"), cat: "info", prof: "public" },
  { key: "notify", name: "🔔・" + fancy("UT-Benachrichtigungen"), cat: "info", prof: "public" },
  { key: "reg", name: "📝・" + fancy("UT-Registrieren"), cat: "info", prof: "public" },
  { key: "team", name: "🛡️・" + fancy("UT-Mein-Profil"), cat: "info", prof: "managers" },
  { key: "over", name: "📋・" + fancy("UT-Spieleruebersicht"), cat: "info", prof: "public" },
  ...DAYS.map((d, i) => ({ key: "day" + (i + 1), name: "🗓️・" + fancy("UT-" + d), cat: "cup", prof: "public", day: i + 1 })),
  { key: "live", name: "📺・" + fancy("UT-Live-Spielplan"), cat: "cup", prof: "public" },
  { key: "hof", name: "🏆・" + fancy("UT-Hall-of-Fame"), cat: "cup", prof: "public" },
  { key: "trophy", name: "🏅・" + fancy("UT-Trophaeenhalle"), cat: "cup", prof: "public" },
  { key: "ban", name: "🚫・" + fancy("UT-Sperrliste"), cat: "cup", prof: "public" },
  { key: "log", name: "📢・" + fancy("UT-Turnierleitung"), cat: "cup", prof: "staff" },
  ...GROUP_NAMES.flatMap((g) => [
    { key: "g" + g, name: "⚽・" + fancy("UT-Gruppe-" + g), cat: "groups", prof: "group:" + g },
    { key: "r" + g, name: "📋・" + fancy("UT-" + g + "-Ergebnisse"), cat: "groups", prof: "groupres:" + g },
  ]),
  { key: "ko", name: "⚔️・" + fancy("UT-KO-Phase"), cat: "ko", prof: "ko" },
  { key: "kor", name: "📋・" + fancy("UT-KO-Ergebnisse"), cat: "ko", prof: "kores" },
  { key: "admin", name: "⚙️・" + fancy("UT-Admin"), cat: "ko", prof: "admins" },
];
const CATS = { info: "🐉 UT CUP · INFO", cup: "🏆 ULTIMATE TEAM CUP", groups: "⚽ UT GRUPPEN", ko: "⚔️ UT K.-O.-PHASE" };

/** Kanalname → Schlüssel (funktioniert auch mit Schreibschrift, Emojis und Trennzeichen) */
export function detectKey(rawName) {
  let n = rawName.normalize("NFKC").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
  if (!n.startsWith("ut")) return null; // nur Cup-Kanäle („UT-…“), andere Server-Kanäle nie anfassen
  n = n.slice(2);
  let m;
  if ((m = n.match(/^gruppe([a-h])ergebnisse$/)) || (m = n.match(/^([a-h])ergebnisse$/))) return "r" + m[1].toUpperCase();
  if ((m = n.match(/^gruppe([a-h])$/))) return "g" + m[1].toUpperCase();
  if (n.includes("koergebnisse")) return "kor";
  if (n.includes("kophase")) return "ko";
  const day = DAYS.findIndex((d) => n === d.toLowerCase());
  if (day >= 0) return "day" + (day + 1);
  const map = [["benachrichtigung", "notify"], ["regelwerk", "rules"], ["registrieren", "reg"], ["meinprofil", "team"], ["spieleruebersicht", "over"], ["livespielplan", "live"], ["halloffame", "hof"], ["trophaeen", "trophy"], ["sperrliste", "ban"], ["turnierleitung", "log"]];
  for (const [kw, key] of map) if (n.includes(kw)) return key;
  if (n === "regeln") return "rules";
  if (n === "admin") return "admin";
  return null;
}

/** Rechte je Profil (Bot ist Admin und sieht ohnehin alles) */
function overwrites(prof, roles) {
  const everyone = G();
  const ro = { id: everyone, type: 0, allow: bits(P.VIEW, P.HISTORY), deny: bits(P.SEND) };
  const hide = { id: everyone, type: 0, allow: "0", deny: bits(P.VIEW) };
  const see = (id, ...extra) => (id ? { id, type: 0, allow: bits(P.VIEW, P.HISTORY, ...extra), deny: "0" } : null);
  const seeRO = (id) => (id ? { id, type: 0, allow: bits(P.VIEW, P.HISTORY), deny: bits(P.SEND) } : null);
  const lead = see(roles.turnierleitung, P.SEND, P.FILES);
  // Eingang: Willkommen, Regelwerk, Rollenauswahl – sieht jeder, auch ohne Rolle
  if (prof === "entry" || prof === "public") return [ro];
  // Alles andere: erst mit Rolle Spieler oder Manager (Staff sieht immer mit)
  if (prof === "members") return [ro, lead].filter(Boolean);
  if (prof === "managers") return [hide, seeRO(roles.manager), lead].filter(Boolean);
  if (prof === "staff") return [hide, lead, see(roles.moderator, P.SEND)].filter(Boolean);
  if (prof === "admins") return [hide]; // nur Server-Admins (sehen ohnehin alles) und der Bot
  if (prof.startsWith("group:")) return [hide, see(roles.groups?.[prof.slice(6)], P.SEND), lead].filter(Boolean);
  if (prof.startsWith("groupres:")) return [hide, see(roles.groups?.[prof.slice(9)], P.SEND, P.FILES), lead].filter(Boolean);
  if (prof === "ko") return [hide, see(roles.koPhase, P.SEND), ...ROUND_ROLES.map((r) => see(roles.rounds?.[r], P.SEND)), lead].filter(Boolean);
  if (prof === "kores") return [hide, see(roles.koPhase, P.SEND, P.FILES), ...ROUND_ROLES.map((r) => see(roles.rounds?.[r], P.SEND, P.FILES)), lead].filter(Boolean);
  return [];
}

/** Rollen verknüpfen bzw. anlegen */
export async function setupRoles() {
  const existing = (await getRoles()) || [];
  const find = async (n, color) => { const r = existing.find((x) => x.name.toLowerCase() === n.toLowerCase()); if (r) return r.id; const c = await createRole(n, color); return c?.id ?? null; };
  const roles = { turnierleitung: await find("UT Turnierleitung", 0xc9a227), moderator: await find("UT Moderator", 0xe67e22), manager: await find("UT Spieler", 0x2f7bff), spieler: null, support: null, groups: {}, rounds: {} };
  for (const g of GROUP_NAMES) roles.groups[g] = await find(`UT Gruppe ${g}`, 0x3ba55c);
  const rc = { Achtelfinale: 0x3c9ad6, Viertelfinale: 0x5865f2, Halbfinale: 0x9b59b6, Finale: 0xc9a227, "Spiel um Platz 3": 0xb5763a };
  for (const r of ROUND_ROLES) roles.rounds[r] = await find(`UT ${r}`, rc[r]);
  // Gemeinsame Rolle für alle Spieler in der K.-o.-Phase
  roles.koPhase = await find("UT KO Phase", 0x3c9ad6);
  await mutate("config", (c) => { c.roles = roles; }, { initial: { channels: {}, roles: {} } });
  return roles;
}

/** Hauptfunktion: plant alles und stellt die Aufträge in die Warteschlange */
export async function setupAll({ create = true, perms = true, kickoff = "20:00" } = {}) {
  const roles = await setupRoles();
  const all = (await discord(`/guilds/${G()}/channels`)) || [];
  const text = all.filter((c) => c.type === 0 || c.type === 5);
  const found = {};
  for (const c of text) { const k = detectKey(c.name); if (k && !found[k]) found[k] = c.id; }

  // Gefundene Kanäle sofort verknüpfen
  await mutate("config", (cfg) => {
    cfg.channels = cfg.channels || {};
    for (const [k, id] of Object.entries(found)) if (!k.startsWith("day")) cfg.channels[k] = id;
  }, { initial: { channels: {}, roles: {} } });

  const jobs = [];
  const missing = PLAN.filter((p) => !found[p.key]);
  if (create && missing.length) {
    const cats = all.filter((c) => c.type === 4);
    for (const catKey of [...new Set(missing.map((m) => m.cat))]) {
      const existing = cats.find((c) => c.name.normalize("NFKC").toLowerCase() === CATS[catKey].normalize("NFKC").toLowerCase());
      jobs.push(existing ? { k: "catknown", cat: catKey, id: existing.id } : { k: "cat", cat: catKey, name: CATS[catKey] });
    }
    for (const m of missing) jobs.push({ k: "chan", key: m.key, name: m.name, cat: m.cat, prof: m.prof, day: m.day });
  }
  if (perms) for (const p of PLAN) if (found[p.key]) jobs.push({ k: "perm", ch: found[p.key], prof: p.prof });
  // Wochenplan für gefundene Tageskanäle
  const ko = parseTime(kickoff) || "20:00";
  for (const p of PLAN.filter((x) => x.day && found[x.key])) jobs.push({ k: "zeit", day: p.day, ch: found[p.key], kickoff: ko });
  jobs.push({ k: "panels" });
  await mutate("setupjobs", (q) => { q.list = jobs; q.kickoff = ko; q.cats = {}; q.done = 0; q.total = jobs.length; }, { initial: {} });
  return { roles, found, missing: create ? missing : [], perms, total: jobs.length };
}

/** Alle Kanalnamen des Servers in die fette Schrift umstellen (Kategorien und Ticket-Kanäle bleiben) */
export async function setupRename() {
  const all = (await discord(`/guilds/${G()}/channels`)) || [];
  const jobs = all
    .filter((c) => [0, 2, 5, 13, 15].includes(c.type) && detectKey(c.name))
    .map((c) => ({ k: "rename", ch: c.id, name: toBold(c.name), old: c.name }))
    .filter((j) => j.name !== j.old);
  await mutate("setupjobs", (q) => { q.list = [...(q.list || []), ...jobs]; q.cats ||= {}; q.done = q.done || 0; q.total = (q.total || 0) + jobs.length; }, { initial: {} });
  return jobs.length;
}

/** Nur die Rechte aller verknüpften Kanäle neu setzen (ohne Kanäle anzulegen oder den Wochenplan zu ändern) */
export async function setupPerms() {
  const cfg = await getConfig();
  const plan = await get("zeitplan") || {};
  const jobs = [];
  for (const p of PLAN) {
    const ch = p.day ? plan[p.day]?.channelId : cfg.channels?.[p.key];
    if (ch) jobs.push({ k: "perm", ch, prof: p.prof });
  }
  await mutate("setupjobs", (q) => { q.list = [...(q.list || []), ...jobs]; q.cats ||= {}; q.done = q.done || 0; q.total = (q.total || 0) + jobs.length; }, { initial: {} });
  return jobs.length;
}

/** Aufträge abarbeiten (vom Befehl und danach jede Minute vom Timer) */
export async function processSetupJobs(budgetMs = 8000) {
  const deadline = Date.now() + budgetMs;
  const { refreshRulesPanel, refreshRegPanel, refreshTeamPanel, refreshOverview } = await import("./flow.mjs");
  const { refreshBanPanel } = await import("./bans.mjs");
  while (Date.now() < deadline - 1500) {
    const q = await get("setupjobs");
    const job = q?.list?.[0];
    if (!job) return;
    const cfg = await getConfig();
    let ok = true;
    if (job.k === "catknown") await mutate("setupjobs", (x) => { x.cats[job.cat] = job.id; });
    if (job.k === "cat") {
      const c = await discord(`/guilds/${G()}/channels`, "POST", { name: job.name, type: 4 });
      ok = !!c; if (c) await mutate("setupjobs", (x) => { x.cats[job.cat] = c.id; });
    }
    if (job.k === "chan") {
      const c = await discord(`/guilds/${G()}/channels`, "POST", { name: job.name, type: 0, parent_id: q.cats?.[job.cat] || undefined, permission_overwrites: overwrites(job.prof, cfg.roles || {}) });
      ok = !!c;
      if (c && !job.day) await mutate("config", (x) => { x.channels[job.key] = c.id; });
      if (c && job.day) await setDay(job.day, c.id, q.kickoff || "20:00");
    }
    if (job.k === "perm") {
      for (const o of overwrites(job.prof, cfg.roles || {})) {
        const r = await discord(`/channels/${job.ch}/permissions/${o.id}`, "PUT", { type: o.type, allow: o.allow, deny: o.deny });
        if (!r) ok = false;
      }
    }
    if (job.k === "zeit") await setDay(job.day, job.ch, job.kickoff);
    if (job.k === "rename") ok = !!(await discord(`/channels/${job.ch}`, "PATCH", { name: job.name }, { reason: "Schrift vereinheitlicht" }));
    if (job.k === "panels") {
      await refreshRulesPanel(); await refreshRegPanel(); await refreshTeamPanel(); await refreshOverview(); await refreshBanPanel();
      await (await import("./trophies.mjs")).refreshTrophyPanel();
      await (await import("./flow.mjs")).refreshHofHeader();
    }
    await mutate("setupjobs", (x) => {
      const j = x.list[0];
      if (!j) return;
      j.tries = (j.tries || 0) + 1;
      if (ok || j.tries >= 3) { x.list.shift(); x.done = (x.done || 0) + 1; }
      else x.list.push(x.list.shift());
    });
  }
}

async function setDay(day, ch, kickoff) {
  const k = parseTime(kickoff) || "20:00";
  const post = toMinutes(k) - 60 > toMinutes("12:00") ? "12:00" : "08:00";
  await mutate("zeitplan", (p) => { const old = p[day]; if (old?.channelId === ch) return; /* schon eingestellt → Anpfiff, Uhrzeit und Name bleiben */ p[day] = { channelId: ch, kickoff: k, post, name: "Ultimate Team Cup", lastPosted: old?.channelId === ch ? old.lastPosted ?? null : null }; }, { initial: {} });
}

export async function setupProgress() {
  const q = await get("setupjobs");
  return q ? { done: q.done || 0, total: q.total || 0, left: q.list?.length || 0 } : null;
}

export { PLAN, CHANNEL_TYPES };

/**
 * Zurücksetzen.
 * scope "setup": Kanal-Verknüpfungen, Rollen-Verknüpfungen, Wochenplan, Panels (Posts werden gelöscht)
 * scope "all":   zusätzlich Vereine, Sperren, Regel-Bestätigungen, Turniere, Statistiken
 * Discord-Kanäle und -Rollen selbst bleiben bestehen.
 */
export async function resetBot(scope = "setup") {
  if (scope === "stats") {
    await del("stats");
    await mutate("clubs", (cl) => { for (const c of Object.values(cl)) { c.cups = 0; c.titles = 0; } }, { initial: {} });
    const TR = await import("./trophies.mjs");
    await TR.refreshTrophyPanel();
    const F = await import("./flow.mjs");
    await F.refreshOverview();
    return { deleted: 0, scope, nicks: 0 };
  }
  const cfg = await getConfig();
  const panels = (await get("panels")) || {};
  const ch = cfg.channels || {};
  const msgs = [[ch.reg, panels.reg], [ch.team, panels.team], [ch.rules, panels.rules], [ch.ban, panels.ban], [ch.trophy, panels.trophy], [ch.hof, panels.hofHead], ...(panels.over || []).map((id) => [ch.over, id])];
  let deleted = 0;
  for (const [c, id] of msgs) if (c && id && (await deleteMessage(c, id))) deleted++;
  for (const k of ["config", "panels", "zeitplan", "setupjobs"]) await del(k);
  const res = { deleted, scope, nicks: 0 };
  if (scope === "all") {
    const clubs = (await get("clubs")) || {};
    const { setNick } = await import("./names.mjs");
    const started = Date.now();
    for (const c of Object.values(clubs)) {
      if (Date.now() - started > 12000) break; // Zeitlimit – restliche Spitznamen bleiben
      if (c.manager && (await setNick(c.manager, c.managerOrigNick ?? null))) res.nicks++;
      for (const x of coList(c)) if (await setNick(x.id, x.orig ?? null)) res.nicks++;
    }
    for (const k of ["clubs", "stats", "bans", "rules", "mreq", "managers", "knownMembers", "rolequeue", "autodelete", "daily", "active"]) await del(k);
    for (const k of await keys("t:")) await del(k);
  }
  return res;
}
