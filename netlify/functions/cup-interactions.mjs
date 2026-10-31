import nacl from "tweetnacl";
import { get, set, mutate, getConfig, getClubs, tKey } from "../cup/store.mjs";
import { editOriginal, discord, sendMessage } from "../cup/discord.mjs";
import { enqueue, processQueue } from "../cup/roles.mjs";
import * as T from "../cup/tournament.mjs";
import * as V from "../cup/views.mjs";
import * as F from "../cup/flow.mjs";
import { durText, GROUP_NAMES, ROUND_ROLES, CHANNEL_TYPES, DAYS, COLOR, PLATFORMS, flagOf, cleanEaId } from "../cup/data.mjs";
import * as B from "../cup/bans.mjs";
import { baseNameOf, nickFor, setNick } from "../cup/names.mjs";
import * as AS from "../cup/autosetup.mjs";
import * as AU from "../cup/audit.mjs";
import { parseVienna, parseTime, toMinutes, nextOccurrence, dateKey, shortDate, todayKey, daysBetween, minutesToHHMM } from "../cup/time.mjs";

// ---------- Hilfen ----------
const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
const eph = (content, extra = {}) => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] }, ...extra } });
const uidOf = (i) => i.member?.user?.id ?? i.user?.id;
const isEphemeralMsg = (i) => ((i.message?.flags ?? 0) & 64) === 64;
/** Antwort auf einen Button: im eigenen Fenster aktualisieren, sonst neues privates Fenster */
const reply = (i, payload) => (isEphemeralMsg(i) ? { type: 7, data: { allowed_mentions: { parse: [] }, ...payload } } : { type: 4, data: { flags: 64, allowed_mentions: { parse: [] }, ...payload } });
const opts = (list = []) => Object.fromEntries(list.map((x) => [x.name, x.value]));
function modalValues(i) { const o = {}; for (const r of i.data.components ?? []) { const c = r.components?.[0] ?? r.component; if (c?.custom_id) o[c.custom_id] = c.value ?? ""; } return o; }

const hasRole = (i, id) => !!id && (i.member?.roles ?? []).includes(id);
function isAdmin(i, cfg) {
  if (hasRole(i, cfg.roles.turnierleitung) || hasRole(i, process.env.ADMIN_ROLE_ID)) return true;
  return (BigInt(i.member?.permissions ?? "0") & 8n) === 8n;
}
const isStaff = (i, cfg) => isAdmin(i, cfg) || hasRole(i, cfg.roles.moderator);
const banText = (b) => `ist bis <t:${Math.floor(b.until / 1000)}:F> gesperrt (${["Eingecheckt, aber nicht erschienen","Während laufendem Turnierbetrieb rausgegangen","Gruppen- oder K.-o.-Phase ohne Abmeldung verlassen","Beleidigungen, Respektlosigkeit oder unsportliches Verhalten","Sonstiger schwerer Regelverstoß"][b.reason]})`;

/** Längere Aktionen: Discord sofort antworten, im Hintergrund weiterarbeiten */
function background(i, context, work, { update = false } = {}) {
  const run = async () => { try { return await work(); } catch (e) { console.error(e); return `❌ ${e.message}`; } };
  if (typeof context?.waitUntil === "function") {
    context.waitUntil(run().then(async (content) => { if (content) await editOriginal(i, typeof content === "string" ? { content, embeds: [], components: [] } : content); await processQueue(4000); }));
    return update ? { type: 6 } : { type: 5, data: { flags: 64 } };
  }
  return run().then((content) => (update ? { type: 7, data: typeof content === "string" ? { content, embeds: [], components: [] } : content } : eph(typeof content === "string" ? content : "", typeof content === "string" ? {} : content)));
}
const later = (context, fn) => { const p = Promise.resolve().then(fn).catch((e) => console.error(e)); if (context?.waitUntil) context.waitUntil(p.then(() => processQueue(4000))); return p; };

/** Spieler anhand der EA-ID finden (Groß/Kleinschreibung egal) */
async function findPlayer(raw) {
  const q = String(raw || "").trim().toLowerCase();
  const clubs = await getClubs();
  const name = Object.keys(clubs).find((k) => k.toLowerCase() === q);
  if (!name) throw new Error("Diese EA-ID ist nicht registriert. Bitte genau wie in der Spielerübersicht schreiben.");
  return name;
}

async function resolveTournament(i) {
  const own = await get(tKey(i.channel_id));
  if (own && !["fertig", "abgesagt", "geloescht"].includes(own.status)) return own;
  const active = await F.activeTournament();
  if (active) return active;
  throw new Error("Gerade läuft kein Cup.");
}

// ---------- Einstieg ----------
export default async (req, context) => {
  const body = await req.text();
  const sig = req.headers.get("x-signature-ed25519"), time = req.headers.get("x-signature-timestamp");
  let ok = false;
  try { ok = !!sig && !!time && nacl.sign.detached.verify(Buffer.from(time + body), Buffer.from(sig, "hex"), Buffer.from((process.env.CUP_PUBLIC_KEY || process.env.DISCORD_PUBLIC_KEY), "hex")); } catch {}
  if (!ok) return new Response("Ungültige Signatur", { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return json({ type: 1 });
  // Zweiter Auslöser für die automatische Bestätigung (zusätzlich zum Minuten-Timer)
  if (context?.waitUntil) context.waitUntil(F.runAutoConfirm().catch((e) => console.error("Auto-Bestätigung:", e)));
  // Protokoll für die Admins: Aktionen von Turnierleitung & Staff in den Admin-Kanal
  try {
    const text = auditEntry(i, await getConfig());
    if (text) { const p = AU.audit(uidOf(i), text, i.channel_id).catch((e) => console.error("Protokoll:", e)); if (context?.waitUntil) context.waitUntil(p); }
  } catch (e) { console.error("Protokoll:", e); }
  try {
    if (i.type === 2) return json(await command(i, context));
    if (i.type === 3) return json(await component(i, context));
    if (i.type === 5) return json(await modal(i, context));
    return json(eph("Unbekannte Aktion."));
  } catch (e) {
    console.error(e);
    return json(isEphemeralMsg(i) && i.type === 3 ? { type: 7, data: { content: `❌ ${e.message}` } } : eph(`❌ ${e.message}`));
  }
};
export const config = { path: "/api/cup/interactions" };

/** Nach dem Verknüpfen eines Kanals das passende Panel dort sofort (neu) posten */
async function refreshLinkedPanel(key) {
  if (key === "hof") return F.refreshHofHeader();
  if (key === "trophy") return (await import("../cup/trophies.mjs")).refreshTrophyPanel();
  const map = { rules: F.refreshRulesPanel, reg: F.refreshRegPanel, team: F.refreshTeamPanel, over: F.refreshOverview, ban: B.refreshBanPanel };
  if (map[key]) return map[key]();
  const t = await F.activeTournament();
  if (!t) return;
  if (key === "kor" && t.koSize) return F.refreshKOResultPanel(t, true);
  if (/^r[A-H]$/.test(key) && ["checkin", "gruppen"].includes(t.status) && t.groups.some((g) => g.name === key[1])) return F.refreshResultPanel(t, key[1]);
  if (key === "ko" && t.koSize) return F.refreshBracket(t);
}

// ---------- Protokoll ----------
function auditEntry(i, cfg) {
  if (i.type === 2) {
    const name = i.data.name;
    if (name === "ut-ergebnis") return null; // normale Spieler-Aktion
    const ok = isAdmin(i, cfg);
    return ok ? `\`${AU.describeCommand(i.data)}\`` : null;
  }
  if (i.type !== 3 && i.type !== 5) return null;
  const id = i.data.custom_id || "";
  let ok = false;
  if (id.startsWith("ban_")) ok = isStaff(i, cfg);
  else if (id.startsWith("reset_ok:")) ok = isAdmin(i, cfg);
  return ok ? AU.describeComponent(i) : null;
}

// ---------- Slash-Befehle ----------
async function command(i, context) {
  const cfg = await getConfig();
  const name = i.data.name;
  if (name === "ut-ergebnis") return resultOpen(i);
  if (!isAdmin(i, cfg)) return eph("Das darf nur die Turnierleitung.");
  if (name === "ut-einrichten") return setup(i, context, cfg);
  if (name === "ut-zeitplan") return schedule(i, context);
  if (name === "ut-turnier") return manualCup(i, context);
  if (name === "ut-admin") return admin(i, context, cfg);
  return eph("Unbekannter Befehl.");
}

async function setup(i, context, cfg) {
  const sub = i.data.options[0], o = opts(sub.options);
  o.kanal = o.kanal || i.channel_id; // ohne Auswahl: aktueller Kanal
  if (sub.name === "kanal") {
    const ch = o.kanal || i.channel_id; // ohne Auswahl: der Kanal, in dem der Befehl ausgeführt wird
    await mutate("config", (c) => { c.channels = c.channels || {}; c.channels[o.typ] = ch; }, { initial: { channels: {}, roles: { groups: {}, rounds: {} } } });
    later(context, () => refreshLinkedPanel(o.typ));
    return eph(`✅ **${CHANNEL_TYPES[o.typ]}** → <#${ch}>`);
  }
  if (sub.name === "schrift") {
    return background(i, context, async () => {
      const n = await AS.setupRename();
      if (!n) return "✅ Alle Kanäle stehen schon in der fetten Schrift.";
      await AS.processSetupJobs(14000);
      const pr = await AS.setupProgress();
      return `🔤 **${n} Kanäle werden umbenannt** (z. B. 𝐊𝐎-𝐄𝐫𝐠𝐞𝐛𝐧𝐢𝐬𝐬𝐞).\n${pr?.left ? `⏳ Noch ${pr.left} offen – läuft im Hintergrund weiter (etwa ${Math.ceil(pr.left / 8)} Min.).` : "✅ Fertig."}\n-# Verknüpfungen bleiben erhalten. Kategorien und Ticket-Kanäle werden nicht angefasst. Umlaute werden zu ae/oe/ue.`;
    });
  }
  if (sub.name === "rechte") {
    return background(i, context, async () => {
      const n = await AS.setupPerms();
      if (!n) return "Es sind noch keine Kanäle verknüpft.";
      await AS.processSetupJobs(14000);
      const pr = await AS.setupProgress();
      return `🔒 **Rechte für ${n} Kanäle werden gesetzt.**\n• Regelwerk, Registrieren, Tageskanäle usw.: für **alle** lesbar\n• Mein-Profil: nur Rolle **UT Spieler** · Gruppen- und KO-Kanäle: nur die jeweiligen Spieler (Turnierleitung sieht alles)\n${pr?.left ? `⏳ Noch ${pr.left} offen – läuft im Hintergrund weiter (ca. 1 Minute).` : "✅ Fertig."}\n-# Deine eigenen Kanäle (z. B. Community) stellst du am besten über die Kategorie ein.`;
    });
  }
  if (sub.name === "alles") {
    return background(i, context, async () => {
      const r = await AS.setupAll({ create: o.fehlende_erstellen ?? true, perms: o.rechte_setzen ?? true, kickoff: o.anpfiff ?? "20:00" });
      await AS.processSetupJobs(14000);
      const pr = await AS.setupProgress();
      const name = (k) => (k.startsWith("day") ? DAYS[Number(k.slice(3)) - 1] : CHANNEL_TYPES[k] || k);
      const found = Object.keys(r.found);
      return [
        "✅ **Einrichtung gestartet**",
        `👥 Rollen verknüpft bzw. angelegt.`,
        `🔎 **${found.length} Kanäle erkannt:** ${found.map(name).join(", ") || "–"}`,
        r.missing.length ? `🆕 **${r.missing.length} Kanäle werden angelegt:** ${r.missing.map((m) => name(m.key)).join(", ")}` : "🆕 Keine fehlenden Kanäle.",
        r.perms ? "🔒 Rechte werden gesetzt (wer welchen Kanal sieht)." : "🔒 Rechte nicht verändert.",
        `🗓️ Wochenplan: neue Tageskanäle mit Anpfiff ${o.anpfiff ?? "20:00"} – schon eingestellte Tage bleiben unverändert.`,
        "",
        pr?.left ? `⏳ **${pr.done}/${pr.total} erledigt** – der Rest läuft automatisch weiter (ca. 1–3 Minuten). Danach mit \`/ut-einrichten status\` prüfen.` : "🎉 **Alles erledigt!** Prüfen mit `/ut-einrichten status`.",
        "",
        "-# Wichtig: Die Rolle des Bots muss in der Rollenliste ganz oben stehen.",
      ].join("\n");
    });
  }
  if (sub.name === "zurücksetzen" && o.umfang === "stats") {
    return eph("⚠️ **Statistik zurücksetzen?**\nGelöscht werden: Medaillenspiegel, Top-Spieler, Rekorde, letzte Sieger, alle persönlichen Statistiken sowie Titel- und Cup-Zähler der Spieler. Die Trophäenhalle startet wieder bei null.\nSpielerprofile, Sperren, Einrichtung und die Hall of Fame bleiben erhalten. Das kann nicht rückgängig gemacht werden.",
      { components: [{ type: 1, components: [{ type: 2, style: 2, label: "Abbrechen", custom_id: "reset_no" }, { type: 2, style: 4, label: "Ja, Statistik zurücksetzen", custom_id: "reset_ok:stats" }] }] });
  }
  if (sub.name === "zurücksetzen") {
    const all = o.umfang === "all";
    return eph(all
      ? "⚠️ **Wirklich ALLES zurücksetzen?**\nGelöscht werden: Kanal- und Rollen-Verknüpfungen, Wochenplan, Panels **und** alle Spielerprofile, Sperren, Regel-Bestätigungen, Turniere und Statistiken. Spitznamen werden zurückgesetzt.\nDeine Discord-Kanäle und -Rollen bleiben bestehen. Das kann nicht rückgängig gemacht werden."
      : "⚠️ **Einrichtung zurücksetzen?**\nGelöscht werden: Kanal- und Rollen-Verknüpfungen, Wochenplan und die Panel-Posts. Spielerprofile, Sperren und Turniere bleiben erhalten.\nDeine Discord-Kanäle und -Rollen bleiben bestehen.",
      { components: [{ type: 1, components: [{ type: 2, style: 2, label: "Abbrechen", custom_id: "reset_no" }, { type: 2, style: 4, label: all ? "Ja, alles zurücksetzen" : "Ja, Einrichtung zurücksetzen", custom_id: `reset_ok:${all ? "all" : "setup"}` }] }] });
  }
  if (sub.name === "gruppe") {
    const key = (o.art === "ergebnisse" ? "r" : "g") + o.gruppe;
    const ch = o.kanal || i.channel_id;
    await mutate("config", (c) => { c.channels = c.channels || {}; c.channels[key] = ch; }, { initial: { channels: {}, roles: { groups: {}, rounds: {} } } });
    later(context, () => refreshLinkedPanel(key));
    return eph(`✅ **${CHANNEL_TYPES[key]}** → <#${ch}>`);
  }
  if (sub.name === "rollen") {
    return background(i, context, async () => {
      const roles = await AS.setupRoles();
      const missing = [roles.turnierleitung, roles.moderator, roles.support, roles.manager, roles.spieler, ...Object.values(roles.groups), ...Object.values(roles.rounds), roles.koPhase].filter((x) => !x).length;
      return missing ? `⚠️ ${missing} Rollen konnten nicht angelegt werden – hat der Bot „Rollen verwalten“?` : "✅ Alle Rollen sind verknüpft (vorhandene übernommen, fehlende angelegt). Zieh die Rolle des Bots in der Rollenliste über alle diese Rollen.";
    });
  }
  if (sub.name === "panels") {
    return background(i, context, async () => { await F.refreshRulesPanel(); await F.refreshRegPanel(); await F.refreshTeamPanel(); await F.refreshOverview(); await B.refreshBanPanel(); await (await import("../cup/trophies.mjs")).refreshTrophyPanel(); await F.refreshHofHeader(); return "✅ Panels in Regelwerk, Registrieren, Mein-Profil, Spielerübersicht, Sperrliste, Trophäenhalle und Hall of Fame gepostet bzw. aktualisiert."; });
  }
  if (sub.name === "status") return background(i, context, async () => {
    // Prüfen, ob die verknüpften Kanäle noch existieren (gelöschte Kanäle erscheinen in Discord als „#unbekannt“)
    const linked = Object.keys(CHANNEL_TYPES).filter((k) => cfg.channels?.[k]);
    const exists = Object.fromEntries(await Promise.all(linked.map(async (k) => [k, !!(await discord(`/channels/${cfg.channels[k]}`))])));
    const broken = linked.filter((k) => !exists[k]);
    const lines = Object.entries(CHANNEL_TYPES).map(([k, n]) => !cfg.channels?.[k] ? `▫️ **${n}**` : exists[k] ? `✅ **${n}** → <#${cfg.channels[k]}>` : `❌ **${n}** → Kanal existiert nicht mehr – neu verknüpfen!`);
    const r = cfg.roles || {};
    const roleOk = r.manager && r.turnierleitung && GROUP_NAMES.every((g) => r.groups?.[g]) && ROUND_ROLES.every((x) => r.rounds?.[x]);
    const pr = await AS.setupProgress();
    const memOk = !!(await discord(`/guilds/${(process.env.CUP_GUILD_ID || process.env.GUILD_ID)}/members?limit=1`));
    const memLine = memOk ? "**Mitgliederliste:** ✅ lesbar (Rollen-Check läuft)" : "**Mitgliederliste:** ❌ nicht lesbar – im Discord Developer Portal unter *Bot* den **Server Members Intent** einschalten. Ohne den funktioniert der Rollen-Check nicht.";
    return `${memLine}\n${broken.length ? `\n⚠️ **${broken.length} ${broken.length === 1 ? "verknüpfter Kanal existiert" : "verknüpfte Kanäle existieren"} nicht mehr** – im richtigen Kanal \`/ut-einrichten kanal\` bzw. \`/ut-einrichten gruppe\` ausführen.\n` : ""}\n${pr?.left ? `⏳ **Einrichtung läuft noch:** ${pr.done}/${pr.total} erledigt\n\n` : ""}**Kanäle**\n${lines.join("\n")}\n\n**Rollen:** ${roleOk ? "✅ alle verknüpft" : "⚠️ noch nicht vollständig – \`/ut-einrichten rollen\`"}\n-# Gruppenkanäle brauchst du nur so viele, wie es Gruppen gibt (8 bei 32 Spielern).`.slice(0, 1990);
  });
  return eph("Unbekannter Befehl.");
}

async function schedule(i, context) {
  const sub = i.data.options[0], o = opts(sub.options);
  o.kanal = o.kanal || (await getConfig()).channels?.signup || i.channel_id; // ohne Auswahl: UT-Anmeldung, sonst aktueller Kanal
  if (sub.name === "setzen") {
    const kickoff = parseTime(o.anpfiff), post = parseTime(o.posten ?? "12:00");
    if (!kickoff) return eph("Anpfiff bitte so angeben: `20:00`");
    if (!post) return eph("Posting-Zeit bitte so angeben: `12:00`");
    if (toMinutes(post) > toMinutes(kickoff) - 62) return eph(`Die Liste muss vor dem Anmeldeschluss (${minutesToHHMM(toMinutes(kickoff) - 60)}) gepostet werden.`);
    const entry = { channelId: o.kanal, kickoff, post, name: (o.name ?? "Ultimate Team Cup").trim(), advance: false };
    await mutate("zeitplan", (p) => { const old = p[o.tag]; p[o.tag] = { ...entry, lastPosted: old?.channelId === o.kanal ? old.lastPosted ?? null : null }; }, { initial: {} });
    return eph(`✅ **${DAYS[o.tag - 1]}:** Liste um ${post} in <#${o.kanal}> · Anmeldeschluss & Auslosung ${minutesToHHMM(toMinutes(kickoff) - 60)} · Check-in-Ende ${minutesToHHMM(toMinutes(kickoff) - 5)} · Anpfiff ${kickoff}`);
  }
  if (sub.name === "anzeigen") {
    const p = (await get("zeitplan")) || {};
    return eph("🗓️ **Wochenplan** (Wiener Zeit)\n\n" + DAYS.map((d, k) => { const e = p[k + 1]; return e ? `**${d}** → <#${e.channelId}> · Anpfiff ${e.kickoff} · ${e.advance ? `Liste für nächste Woche nach dem Cup ab ${e.post}` : `Liste am selben Tag um ${e.post}`}` : `**${d}** → –`; }).join("\n"));
  }
  if (sub.name === "woche") {
    const m = String(o.start || "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return eph("Startdatum bitte so angeben: `29.10.2026`");
    const kickoff = parseTime(o.anpfiff ?? "20:00"), post = parseTime(o.posten ?? "23:00");
    if (!kickoff || !post) return eph("Uhrzeiten bitte so angeben: `20:00`");
    if (toMinutes(post) <= toMinutes(kickoff)) return eph("Die neue Liste muss **nach** dem Anpfiff gepostet werden (z. B. 23:00), sonst kollidiert sie mit dem laufenden Cup.");
    return background(i, context, async () => {
      const lines = await F.setupWeek({ startY: Number(m[3]), startMo: Number(m[2]), startD: Number(m[1]), kickoff, post, name: (o.name ?? "Ultimate Team Cup").trim() });
      return `🗓️ **Woche eingerichtet** – Anpfiff jeden Tag um ${kickoff}\n\n${lines.join("\n")}\n\n🔁 **Ab jetzt automatisch:** Nach jedem Cup wird um **${post}** die Liste für denselben Tag **nächste Woche** gepostet (ist der Cup um ${post} noch nicht vorbei, kommt sie direkt danach).`;
    });
  }
  if (sub.name === "entfernen") {
    await mutate("zeitplan", (p) => { delete p[o.tag]; }, { initial: {} });
    return eph(`✅ ${DAYS[o.tag - 1]} entfernt.`);
  }
  if (sub.name === "jetzt-posten") {
    return background(i, context, async () => {
      const e = ((await get("zeitplan")) || {})[o.tag];
      if (!e) throw new Error(`Für ${DAYS[o.tag - 1]} ist nichts eingestellt.`);
      const n = nextOccurrence(o.tag, e.kickoff, 62 * 60000);
      if (!n) throw new Error("Kein passender Termin gefunden.");
      await F.launchTournament({ channelId: e.channelId, name: `${e.name} · ${DAYS[o.tag - 1]}, ${shortDate(n.mo, n.d)}`, day: DAYS[o.tag - 1], date: shortDate(n.mo, n.d), times: F.timesFromKickoff(n.ms) }, { replace: true });
      await mutate("zeitplan", (p) => { if (p[o.tag]) p[o.tag].lastPosted = dateKey(n.y, n.mo, n.d); }, { initial: {} });
      return `✅ Liste für ${DAYS[o.tag - 1]}, ${shortDate(n.mo, n.d)} in <#${e.channelId}> gepostet.`;
    });
  }
  return eph("Unbekannter Befehl.");
}

async function manualCup(i, context) {
  const o = opts(i.data.options);
  const kickoff = parseVienna(o.anpfiff);
  if (!kickoff) return eph("Anpfiff bitte so angeben: `31.10.2026 20:00`");
  if (kickoff - 60 * 60000 < Date.now() + 2 * 60000) return eph("Der Anmeldeschluss (60 Min. vor Anpfiff) muss in der Zukunft liegen.");
  return background(i, context, async () => {
    let t = await F.launchTournament({ channelId: i.channel_id, name: o.name.trim(), times: F.timesFromKickoff(kickoff) });
    return `✅ **${t.name}** ist erstellt.`;
  });
}

async function admin(i, context, cfg) {
  const sub = i.data.options[0], o = opts(sub.options);
  if (sub.name === "anmeldeschluss") return background(i, context, async () => { const t = await get(tKey(i.channel_id)); if (!t || t.status !== "anmeldung") throw new Error("In diesem Kanal ist keine Anmeldung offen."); await F.doDraw(i.channel_id); return "✅ Anmeldung geschlossen und ausgelost."; });
  if (sub.name === "checkin-ende") return background(i, context, async () => { const t = await resolveTournament(i); if (t.status !== "checkin") throw new Error("Es läuft gerade kein Check-in."); await F.doCheckinEnd(t.channelId); await F.doKickoff(t.channelId); if (t.test) await F.playVirtualMatches(t.channelId); return "✅ Check-in beendet – Spieltag 1 ist sofort freigegeben."; });
  if (sub.name === "spiele") {
    const t = await resolveTournament(i);
    const open = T.currentMatches(t).filter((m) => m.status !== "fertig");
    if (!open.length) return eph("Keine offenen Spiele.");
    return eph(open.map((m) => `${V.matchLine(m)}${Object.keys(m.reports).length ? `\n  ↳ ${Object.entries(m.reports).map(([c, r]) => `${V.esc(c)}: ${r.h}:${r.a}${r.pen ? ` (${r.pen.join(":")} i.E.)` : ""}`).join(" | ")}` : ""}`).join("\n").slice(0, 1900));
  }
  if (sub.name === "ergebnis") {
    return background(i, context, async () => {
      const pen = o.elfmeter ? T.parseScore(o.elfmeter) : null;
      if (o.elfmeter && !pen) throw new Error("Elfmeter bitte so angeben: `4:3`");
      const t0 = await resolveTournament(i);
      const { value: t, result } = await mutate(tKey(t0.channelId), (t) => { const m = T.adminSet(t, o.spiel, o.heim, o.gast, pen); return { id: m.id, events: T.advance(t) }; });
      const m = t.matches.find((x) => x.id === result.id);
      await F.afterResult(t, m, result.events, true);
      return `✅ Spiel #${m.id} festgelegt: ${V.matchLine(m, false)}`;
    });
  }
  if (sub.name === "freilos-hinzufügen" || sub.name === "freilos-entfernen") {
    const add = sub.name === "freilos-hinzufügen";
    const { value: t, result: count } = await mutate(tKey(i.channel_id), (t) => (add ? T.addFreilos(t) : T.removeFreilos(t)), { missing: "In diesem Kanal gibt es gerade keine Anmeldung – bitte im Tageskanal benutzen." });
    later(context, () => F.refreshSignup(t));
    return eph(`🎟️ ${add ? "Freilos hinzugefügt" : "Freilos entfernt"} – jetzt ${count} ${count === 1 ? "Freilos" : "Freilose"} in der Liste.`);
  }
  if (sub.name === "abbrechen") return background(i, context, async () => { const t = await resolveTournament(i); await F.cancelTournament(t.channelId); return "✅ Turnier abgebrochen, Rollen werden entfernt."; });
  if (sub.name === "abmelden") {
    return background(i, context, async () => {
      const name = await findPlayer(o.spieler);
      const ch = o.tag ? ((await get("zeitplan")) || {})[o.tag]?.channelId : i.channel_id;
      if (!ch) throw new Error(`Für ${DAYS[o.tag - 1]} ist kein Tageskanal eingestellt.`);
      const t0 = await get(tKey(ch));
      if (!t0) throw new Error(o.tag ? `Für ${DAYS[o.tag - 1]} gibt es gerade keine Anmeldeliste.` : "In diesem Kanal gibt es keine Anmeldeliste – gib den Tag an, z. B. `tag: Montag`.");
      const { value: t } = await mutate(tKey(ch), (t) => {
        if (t.status === "anmeldung") return T.unregister(t, name);
        if (t.status === "checkin" && t.wait?.includes(name)) { t.wait = t.wait.filter((c) => c !== name); t.waitChecked = (t.waitChecked || []).filter((c) => c !== name); return; }
        throw new Error(t.status === "checkin" ? "Nach der Auslosung kann nur noch die Warteliste bearbeitet werden. Spielt der Spieler schon mit, lass ihn nicht einchecken – er wird dann automatisch ersetzt." : "Die Anmeldung ist schon vorbei.");
      });
      await F.refreshSignup(t);
      const users = F.membersOf(await getClubs(), name);
      if (users.length) await (await import("../cup/notify.mjs")).notify(users, { embeds: [{ color: COLOR, title: `${flagOf(name)} Von der Anmeldung entfernt`, description: `Du (**${name}**) wurdest von der Turnierleitung aus der Liste für **${t.name}** entfernt.${o.grund ? `\n**Grund:** ${o.grund}` : ""}` }] });
      return `✅ ${flagOf(name)} **${V.esc(name)}** wurde aus der Liste entfernt${users.length ? " und benachrichtigt" : ""}.`;
    });
  }
  if (sub.name === "testcup-start") {
    return background(i, context, async () => {
      const size = Number(o.teams || 8);
      const r = await F.startTestCup(i.channel_id, uidOf(i), size);
      return `🧪 **Test-Cup erstellt** (${size} Spieler).\n${r.mine ? `• Du spielst mit: ${flagOf(r.mine.club)} **${V.esc(r.mine.club)}** – du bekommst echte Gruppen- und KO-Rollen.` : "• ⚠️ Du bist nicht registriert – registrier dich zuerst, damit du selbst mitspielen und die Rollen testen kannst."}\n• ${r.virtual.length} Testspieler (automatisch eingecheckt, spielen gegeneinander von selbst)\n\n**So geht's weiter:**\n1. \`/ut-admin anmeldeschluss\` → Auslosung\n2. Im Gruppenkanal einchecken, dann \`/ut-admin checkin-ende\`\n3. Deine Spiele über die Knöpfe melden (der Test-Gegner bestätigt nach 2 Min. automatisch) oder \`/ut-admin ergebnis\`\n4. \`/ut-admin testcup-weiter\` spielt die Test-Spiele sofort, sonst passiert es jede Minute von selbst\n5. \`/ut-admin rollen-check\` zum Prüfen der Rollen\n-# Keine Statistik, keine Trophäen. Abbrechen: \`/ut-admin abbrechen\`.`;
    });
  }
  if (sub.name === "testcup-weiter") {
    return background(i, context, async () => {
      const t = await F.activeTournament();
      if (!t?.test) throw new Error("Gerade läuft kein Test-Cup (oder er ist noch nicht ausgelost).");
      const n = await F.playVirtualMatches(t.channelId);
      return n ? `🧪 ${n} Test-Spiele gespielt.` : "🧪 Gerade gibt es keine offenen Spiele zwischen Testspielern – jetzt bist du dran (oder der Check-in läuft noch).";
    });
  }
  if (sub.name === "rollen-check") {
    return background(i, context, async () => {
      const { listMembers } = await import("../cup/discord.mjs");
      const M = await import("../cup/maintenance.mjs");
      const members = await listMembers();
      if (!members) return "❌ Ich kann die Mitgliederliste nicht lesen. Im Discord Developer Portal unter *Bot* den **Server Members Intent** einschalten – ohne den kann ich fehlende Rollen weder erkennen noch nachholen.";
      const r = await M.cupRoleDiff(members, { includePending: true });
      if (!r) return "Gerade läuft kein Cup mit Gruppen- oder K.-o.-Phase.";
      const q = (await get("rolequeue")) || [];
      const head = `🔎 **Rollen-Check · ${r.t.name}**\n📥 Warteschlange: **${q.length}** offene Rollen-Änderungen${q.length ? ` (nächster Versuch <t:${Math.ceil(Math.min(...q.map((o) => o.nextAt || Date.now())) / 1000)}:R>)` : ""}`;
      if (!r.missing.length) return `${head}\n✅ Alle Teilnehmer haben genau die richtigen Turnier-Rollen.`;
      const lines = r.missing.slice(0, 25).map((x) => x.gone
        ? `• <@${x.u}> (${V.esc(x.club || "?")}) – **nicht mehr auf dem Server**`
        : `• <@${x.u}> (${V.esc(x.club || "?")})${x.add.length ? ` fehlt: ${x.add.map((id) => `<@&${id}>`).join(" ")}` : ""}${x.rem.length ? ` zu viel: ${x.rem.map((id) => `<@&${id}>`).join(" ")}` : ""}${x.pending ? " ⏳" : ""}`);
      await enqueue(r.ops.map((o) => ({ ...o, why: "Rollen-Check" })));
      await processQueue(8000);
      return `${head}\n⚠️ **${r.missing.length} Abweichungen** – ich korrigiere sie jetzt:\n${lines.join("\n")}${r.missing.length > 25 ? `\n… und ${r.missing.length - 25} weitere` : ""}\n-# ⏳ = war schon in der Warteschlange. Führ den Check in 1–2 Minuten nochmal aus. Bleibt jemand übrig, steht die Bot-Rolle wahrscheinlich unter dieser Rolle (Servereinstellungen → Rollen → Bot-Rolle nach oben ziehen).`.slice(0, 1990);
    });
  }
  if (sub.name === "profil-löschen") {
    return background(i, context, async () => {
      const name = await findPlayer(o.spieler);
      const r = await F.releaseClub(name, { reason: "Von der Turnierleitung gelöscht" });
      return r ? `✅ Profil ${flagOf(name)} **${V.esc(name)}** gelöscht.` : "Dieses Profil gibt es nicht.";
    });
  }
  return eph("Unbekannter Befehl.");
}

// ---------- Ergebnis melden ----------
async function resultOpen(i) {
  const t = await resolveTournament(i);
  const mine = F.clubOfUser(await getClubs(), uidOf(i));
  if (!mine) return eph("Du bist nicht registriert.");
  const open = T.openMatchesOf(t, mine.club);
  if (!open.length) return eph("Du hast gerade kein offenes Spiel.");
  if (open.length === 1) return V.resultModal(open[0], T.koRoundName(t));
  return { type: 4, data: { flags: 64, ...V.matchPicker(open) } };
}

// ---------- Buttons & Menüs ----------
async function component(i, context) {
  const cfg = await getConfig();
  const id = i.data.custom_id, uid = uidOf(i);

  // --- Trophäenhalle ---
  if (id === "stats_me") return eph(await (await import("../cup/trophies.mjs")).myStats(uid));

  // --- Zurücksetzen ---
  if (id === "reset_no") return reply(i, { content: "Abgebrochen – nichts wurde verändert.", components: [] });
  if (id.startsWith("reset_ok:")) {
    if (!isAdmin(i, cfg)) return reply(i, { content: "Das darf nur die Turnierleitung.", components: [] });
    const scope = id.split(":")[1];
    return background(i, context, async () => {
      const r = await AS.resetBot(scope);
      if (scope === "stats") return "✅ **Statistik zurückgesetzt.** Die Trophäenhalle startet wieder bei null.";
      return `✅ **${scope === "all" ? "Alles" : "Einrichtung"} zurückgesetzt.** ${r.deleted} Panel-Posts gelöscht${scope === "all" ? `, ${r.nicks} Spitznamen zurückgesetzt` : ""}.\nNeu einrichten mit \`/ut-einrichten alles\`.`;
    }, { update: true });
  }

  // --- Regelwerk ---
  if (id === "rules_ok") {
    if (await F.rulesAccepted(uid)) return eph("✅ Du hast das Regelwerk bereits akzeptiert.");
    await F.acceptRules(uid);
    later(context, F.refreshRulesPanel);
    return eph("✅ Danke! Du hast das Regelwerk akzeptiert und kannst dich jetzt zum Cup anmelden.");
  }

  // --- Registrierung: Plattform wählen → EA-ID eintragen ---
  if (id === "reg_start" || id.startsWith("reg_pf:")) {
    const clubs = await getClubs();
    const mine = F.clubOfUser(clubs, uid);
    if (mine) return reply(i, { content: `Du bist bereits als ${flagOf(mine.club)} **${V.esc(mine.club)}** registriert. Ändern kannst du das in Mein Profil.`, embeds: [], components: [] });
    const b = await B.findBan([uid]);
    if (b) return reply(i, { content: `❌ Du ${banText(b).replace(/^ist/, "bist")} und kannst dich gerade nicht registrieren.`, components: [] });
    if (!(await F.rulesAccepted(uid))) return reply(i, { content: `📜 Bitte akzeptiere zuerst das Regelwerk${cfg.channels.rules ? ` in <#${cfg.channels.rules}>` : ""}.`, components: [] });
    if (id === "reg_start") return reply(i, V.regPlatforms());
    const pf = id.split(":")[1];
    if (!PLATFORMS[pf]) return reply(i, V.regPlatforms());
    return V.eaModal(`reg_ea:${pf}`, `Registrieren · ${PLATFORMS[pf].short}`);
  }

  // --- Mein Profil ---
  if (id.startsWith("team_")) {
    const clubs = await getClubs();
    const mine = F.clubOfUser(clubs, uid);
    if (!mine) return reply(i, { content: `Du bist noch nicht registriert${cfg.channels.reg ? ` – das geht in <#${cfg.channels.reg}>` : ""}.`, embeds: [], components: [] });
    const st = await (await import("../cup/trophies.mjs")).personStats(uid);
    const detail = (c, note) => ({ ...V.teamDetail(c.club, c.data, st), content: note || "" });
    const busy = async () => { for (const t of await F.allTournaments()) if (!["fertig", "abgesagt", "geloescht"].includes(t.status) && (t.reg.includes(mine.club) || t.playing.includes(mine.club) || (t.wait || []).includes(mine.club))) return true; return false; };
    if (id === "team_open") return reply(i, detail(mine));
    if (id === "team_ea") {
      if (await busy()) return reply(i, detail(mine, "⚠️ Während du für einen Cup angemeldet bist, kannst du deine EA-ID nicht ändern. Melde dich zuerst ab oder warte bis nach dem Cup."));
      return V.eaModal("team_ea_m", "EA-ID ändern", mine.club);
    }
    if (id === "team_pf") return reply(i, V.platformPicker());
    if (id.startsWith("team_pf_set:")) {
      const pf = id.split(":")[1];
      if (!PLATFORMS[pf]) return reply(i, V.platformPicker());
      const { value } = await mutate("clubs", (cl) => { if (cl[mine.club]) cl[mine.club].platform = pf; }, { initial: {} });
      later(context, async () => { await F.refreshOverview(); await F.refreshRegPanel(); });
      return reply(i, detail({ ...mine, data: value[mine.club] || mine.data }, `✅ Plattform geändert: ${PLATFORMS[pf].icon} **${PLATFORMS[pf].short}**`));
    }
    if (id === "team_del") return reply(i, V.confirmView(`Profil wirklich löschen? **${V.esc(mine.club)}** wird entfernt, deine Titel und Cups im Profil gehen verloren. Du kannst dich danach neu registrieren.`, "team_del_ok", "Endgültig löschen"));
    if (id === "team_del_ok") {
      if (await busy()) return reply(i, { content: "Während du für einen Cup angemeldet bist, geht das nicht. Melde dich zuerst ab oder warte bis nach dem Cup.", embeds: [], components: [] });
      later(context, () => F.releaseClub(mine.club, { reason: "Profil gelöscht" }));
      return reply(i, { content: `🗑️ Profil **${V.esc(mine.club)}** gelöscht.`, embeds: [], components: [] });
    }
    return reply(i, detail(mine));
  }

  // --- Anmeldeliste ---
  if (id === "cup_join" || id === "cup_leave" || id === "cup_waitci") {
    const mine = F.clubOfUser(await getClubs(), uid);
    if (!mine) return eph(`📝 Du musst dich zuerst mit deiner EA-ID registrieren${cfg.channels.reg ? ` in <#${cfg.channels.reg}>` : ""}.`);
    if (id !== "cup_leave") {
      const b = await B.findBan(F.membersOf(await getClubs(), mine.club));
      if (b) return eph(`❌ ${flagOf(mine.club)} **${V.esc(mine.club)}** kann sich nicht anmelden: <@${b.user}> ${banText(b)}.`);
    }
    if (id === "cup_join" && !(await F.rulesAccepted(uid))) return eph(`📜 Bitte akzeptiere zuerst das Regelwerk${cfg.channels.rules ? ` in <#${cfg.channels.rules}>` : ""} – danach kannst du dich anmelden.`);
    const { value: t, result } = await mutate(tKey(i.channel_id), (t) => {
      if (id === "cup_join") { const pos = T.register(t, mine.club); const f = T.fmtOf(t.reg.length); return f && pos > f ? `${flagOf(mine.club)} **${V.esc(mine.club)}** ist angemeldet – **Warteliste Platz ${pos - f}**.` : `${flagOf(mine.club)} **${V.esc(mine.club)}** ist angemeldet – Platz ${pos}.`; }
      if (id === "cup_leave") { T.unregister(t, mine.club); return "Du wurdest abgemeldet."; }
      const r = T.checkIn(t, mine.club); return r === "warteliste" ? "✅ Auf der Warteliste eingecheckt – du rückst nach, falls jemand nicht eincheckt." : "✅ Eingecheckt.";
    }, { missing: "In diesem Kanal gibt es gerade keine Anmeldung." });
    later(context, () => F.refreshSignup(t));
    return eph(result);
  }

  // --- Check-in in der Gruppe ---
  if (id === "grp_ci") {
    const mine = F.clubOfUser(await getClubs(), uid);
    if (!mine) return eph("Du bist nicht registriert.");
    const t0 = await resolveTournament(i);
    const { value: t } = await mutate(tKey(t0.channelId), (t) => T.checkIn(t, mine.club));
    later(context, () => F.refreshGroupCheckin(t, T.groupOf(t, mine.club)));
    return eph(`✅ ${flagOf(mine.club)} **${V.esc(mine.club)}** ist eingecheckt. Viel Erfolg!`);
  }

  // --- Sperrliste ---
  if (id.startsWith("ban_")) {
    if (!isStaff(i, cfg)) return reply(i, { content: "❌ Sperren können nur die **Turnierleitung** und **Mods**.", components: [] });
    if (id === "ban_start") return reply(i, V.banStep1());
    if (id === "ban_user") {
      const u = i.data.values?.[0];
      if (!u || i.data.resolved?.users?.[u]?.bot) return reply(i, { ...V.banStep1(), content: "Bitte eine echte Person auswählen." });
      return reply(i, V.banStep2(u));
    }
    if (id.startsWith("ban_r:")) return reply(i, V.banStep3(id.split(":")[1], Number(i.data.values[0])));
    if (id.startsWith("ban_d:")) {
      const [, u, r] = id.split(":");
      const clubs = await getClubs(), mine = F.clubOfUser(clubs, u);
      const partners = mine ? F.membersOf(clubs, mine.club).filter((x) => x !== u) : [];
      return reply(i, V.banStep4(u, Number(r), Number(i.data.values[0]), partners));
    }
    if (id.startsWith("ban_note:")) return V.banNoteModal(id.slice("ban_note:".length));
    if (id.startsWith("ban_ok:")) return doBan(i, context, id.slice("ban_ok:".length), "");
    if (id === "ban_lift") { const bans = await B.getActiveBans(); return reply(i, bans.length ? V.banLiftPicker(bans) : { content: "Aktuell ist niemand gesperrt.", components: [] }); }
    if (id === "ban_lift_pick") { const u = i.data.values[0]; later(context, () => B.lift(u, uid)); return reply(i, { content: `✅ Sperre von <@${u}> wird aufgehoben.`, components: [] }); }
  }

  // --- Größenvideo ---


  // --- Ergebnis ---
  if (id === "res_open") return resultOpen(i);
  if (id.startsWith("res_ok:")) {
    const mine = F.clubOfUser(await getClubs(), uid);
    if (!mine) return eph("Du bist nicht registriert.");
    const matchId = Number(id.split(":")[1]);
    return background(i, context, async () => {
      const t0 = await resolveTournament(i);
      const { value: t, result } = await mutate(tKey(t0.channelId), (t) => { T.confirmPending(t, matchId, mine.club); return T.advance(t); });
      const m = t.matches.find((x) => x.id === matchId);
      await F.afterResult(t, m, result);
      return `✅ Ergebnis bestätigt: ${V.matchLine(m, false)}`;
    });
  }
  if (id === "res_pick") {
    const t = await resolveTournament(i);
    const m = t.matches.find((x) => x.id === Number(i.data.values?.[0]));
    if (!m || m.status === "fertig") return reply(i, { content: "Dieses Spiel ist nicht mehr offen.", components: [] });
    return V.resultModal(m, T.koRoundName(t));
  }
  return eph("Unbekannter Button.");
}

// ---------- Formulare ----------
async function modal(i, context) {
  const cfg = await getConfig();
  const id = i.data.custom_id, uid = uidOf(i), v = modalValues(i);

  if (id.startsWith("reg_ea:")) {
    const pf = id.split(":")[1];
    if (!PLATFORMS[pf]) return reply(i, { content: "Unbekannte Plattform – bitte neu starten.", components: [] });
    const ea = cleanEaId(v.ea);
    if (!ea) return reply(i, { content: "❌ Diese EA-ID passt nicht: 3–32 Zeichen, nur Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich oder Leerzeichen.", components: [] });
    const { result } = await mutate("clubs", (cl) => {
      if (F.clubOfUser(cl, uid)) return "schon";
      if (Object.keys(cl).some((k) => k.toLowerCase() === ea.toLowerCase())) return "vergeben";
      cl[ea] = { manager: uid, cos: [], platform: pf, since: Date.now(), lastPlayed: todayKey(), cups: 0, titles: 0, managerBase: baseNameOf(i.member), managerOrigNick: i.member?.nick ?? null };
      return "ok";
    }, { initial: {} });
    if (result === "vergeben") return reply(i, { content: `❌ Die EA-ID **${V.esc(ea)}** ist schon registriert. Wenn das deine ist, melde dich bei der Turnierleitung.`, components: [] });
    if (result === "schon") return reply(i, { content: "Du bist bereits registriert.", components: [] });
    later(context, async () => {
      await enqueue([{ u: uid, add: [cfg.roles.manager], why: "Registriert" }]);
      await setNick(uid, nickFor(baseNameOf(i.member), "manager", ea));
      await F.refreshRegPanel(); await F.refreshOverview();
    });
    return reply(i, { content: `✅ **Registriert!** Willkommen beim Ultimate Team Cup, <@${uid}>.\nEA-ID: \`${ea}\` · Plattform: ${PLATFORMS[pf].icon} ${PLATFORMS[pf].short}\nDein Name auf dem Server: **${nickFor(baseNameOf(i.member), "manager", ea)}**\n\nJetzt kannst du dich in den Tageskanälen zum Cup anmelden.`, embeds: [], components: [] });
  }

  if (id.startsWith("ban_m:")) {
    if (!isStaff(i, cfg)) return reply(i, { content: "❌ Sperren können nur die **Turnierleitung** und **Mods**.", components: [] });
    return doBan(i, context, id.slice("ban_m:".length), v.note?.trim() || "");
  }

  if (id === "team_ea_m") {
    const ea = cleanEaId(v.ea);
    if (!ea) return reply(i, { content: "❌ Diese EA-ID passt nicht: 3–32 Zeichen, nur Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich oder Leerzeichen." });
    const clubs = await getClubs(), mine = F.clubOfUser(clubs, uid);
    if (!mine) return reply(i, { content: "Du bist nicht registriert.", embeds: [], components: [] });
    if (ea === mine.club) return reply(i, { ...V.teamDetail(mine.club, mine.data, await (await import("../cup/trophies.mjs")).personStats(uid)), content: "Das ist schon deine EA-ID." });
    for (const t of await F.allTournaments()) if (!["fertig", "abgesagt", "geloescht"].includes(t.status) && [...t.reg, ...t.playing, ...(t.wait || [])].includes(mine.club)) return reply(i, { content: "⚠️ Während du für einen Cup angemeldet bist, geht das nicht.", embeds: [], components: [] });
    const { value, result } = await mutate("clubs", (cl) => {
      if (Object.keys(cl).some((k) => k !== mine.club && k.toLowerCase() === ea.toLowerCase())) return "vergeben";
      const x = cl[mine.club]; if (!x) return "weg";
      delete cl[mine.club]; cl[ea] = x; return "ok";
    }, { initial: {} });
    if (result === "vergeben") return reply(i, { content: `❌ Die EA-ID **${V.esc(ea)}** ist schon registriert.` });
    if (result !== "ok") return reply(i, { content: "Dein Profil wurde nicht gefunden.", embeds: [], components: [] });
    later(context, async () => {
      await setNick(uid, nickFor(value[ea].managerBase || baseNameOf(i.member), "manager", ea));
      await (await import("../cup/trophies.mjs")).renameClub?.(mine.club, ea);
      await F.refreshOverview();
    });
    return reply(i, { ...V.teamDetail(ea, value[ea], await (await import("../cup/trophies.mjs")).personStats(uid)), content: `✅ EA-ID geändert: \`${V.esc(mine.club)}\` → \`${V.esc(ea)}\`` });
  }

  if (id.startsWith("res:")) {
    const matchId = Number(id.split(":")[1]);
    const h = /^\d{1,2}$/.test(v.h?.trim()) ? Number(v.h) : null, a = /^\d{1,2}$/.test(v.a?.trim()) ? Number(v.a) : null;
    if (h === null || a === null) return eph("Bitte bei beiden Spielern die Tore als Zahl eintragen.");
    const pen = v.pen?.trim() ? T.parseScore(v.pen) : null;
    if (v.pen?.trim() && !pen) return eph("Elfmeter bitte so angeben: `4:3`");
    const mine = F.clubOfUser(await getClubs(), uid);
    if (!mine) return eph("Du bist nicht registriert.");
    return background(i, context, async () => {
      const t0 = await resolveTournament(i);
      const { value: t, result } = await mutate(tKey(t0.channelId), (t) => {
        const r = T.report(t, matchId, mine.club, h, a, pen);
        return { state: r.state, events: r.state === "bestaetigt" ? T.advance(t) : [] };
      });
      const m = t.matches.find((x) => x.id === matchId);
      if (result.state === "wartet") { await F.askOpponent(t, m, mine.club, h, a, pen); return "📨 Ergebnis eingetragen. Der Gegner hat 2 Minuten zum Bestätigen – danach gilt es automatisch.\n📸 Denk an den **Screenshot vom Endstand** hier im Kanal."; }
      if (result.state === "konflikt") { await F.notifyConflict(t, m); return "⚠️ Euer Ergebnis weicht vom Gegner ab. Die Turnierleitung wurde markiert und entscheidet."; }
      await F.afterResult(t, m, result.events);
      return `✅ Ergebnis bestätigt: ${V.matchLine(m, false)}`;
    });
  }
  return eph("Unbekanntes Formular.");
}

async function doBan(i, context, rest, note) {
  const [u, r, d, both] = rest.split(":");
  const users = [u];
  if (both === "2") {
    const clubs = await getClubs(), mine = F.clubOfUser(clubs, u);
    if (mine) users.push(...F.membersOf(clubs, mine.club).filter((x) => x !== u));
  }
  later(context, () => B.ban(users, Number(r), Number(d), uidOf(i), note));
  return reply(i, { content: `✅ ${users.map((x) => `<@${x}>`).join(", ").replace(/, ([^,]*)$/, " und $1")} ${users.length > 1 ? "sind" : "ist"} für **${durText(Number(d))}** gesperrt. Die Sperrliste wird aktualisiert, und die Betroffenen werden im Benachrichtigungs-Kanal markiert.`, components: [] });
}
