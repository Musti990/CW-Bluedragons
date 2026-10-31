// Sperrliste: Personen sperren, automatisch ablaufen lassen.
import { durText } from "./data.mjs";
import { isCo } from "./co.mjs";
import { get, mutate, getConfig, getClubs } from "./store.mjs";
import { sendMessage, upsertMessage } from "./discord.mjs";
import { notify } from "./notify.mjs";
import { BAN_REASONS, COLOR, flagOf } from "./data.mjs";
import * as V from "./views.mjs";

const unix = (ms) => Math.floor(ms / 1000);
export const activeBans = (bans, now = Date.now()) => (bans || []).filter((b) => b.until > now);
export async function getActiveBans() { return activeBans(await get("bans")); }
export const banOf = (bans, uid) => activeBans(bans).find((b) => b.user === uid) || null;

/** Ist eine der Personen gesperrt? Gibt die Sperre zurück. */
export async function findBan(userIds) {
  const bans = await getActiveBans();
  return bans.find((b) => userIds.includes(b.user)) || null;
}

export async function refreshBanPanel() {
  const cfg = await getConfig(); if (!cfg.channels.ban) return;
  const panels = (await get("panels")) || {};
  const id = await upsertMessage(cfg.channels.ban, panels.ban, V.banPanel(await getActiveBans(), await getClubs()));
  if (id && id !== panels.ban) { await mutate("panels", (p) => { p.ban = id; }, { initial: { over: [] } }); }
}

/** Personen sperren */
export async function ban(users, reason, days, byId, note = "") {
  const cfg = await getConfig(), clubs = await getClubs();
  const now = Date.now(), until = now + days * 86400000;
  const clubOf = (u) => Object.entries(clubs).find(([, c]) => c.manager === u || isCo(c, u))?.[0] || null;
  await mutate("bans", (list) => {
    for (const u of users) {
      const old = list.find((b) => b.user === u && b.until > now);
      if (old) Object.assign(old, { reason, days, start: now, until, by: byId, note, club: clubOf(u) });
      else list.push({ id: `${now}-${u}`, user: u, club: clubOf(u), reason, days, start: now, until, by: byId, note });
    }
  }, { initial: [] });
  for (const u of users) {
    await notify(u, { embeds: [{ color: COLOR, title: "🚫 Du wurdest gesperrt", description: `Du bist für **${durText(days)}** gesperrt – bis <t:${unix(until)}:F>.\n**Grund:** ${BAN_REASONS[reason]}\n\nIn dieser Zeit kannst du an keinem Cup teilnehmen. Fragen bitte an die Turnierleitung.` }] });
  }
  if (cfg.channels.log) await sendMessage(cfg.channels.log, { content: `🚫 ${users.map((u) => `<@${u}>`).join(" ")} gesperrt für **${durText(days)}** von <@${byId}> – ${BAN_REASONS[reason]}${note ? `\n> Notiz: ${note}` : ""}` });
  await refreshBanPanel();
}

export async function lift(user, byId) {
  const cfg = await getConfig();
  const { result } = await mutate("bans", (list) => { const b = list.find((x) => x.user === user && x.until > Date.now()); if (!b) return false; b.until = Date.now() - 1; b.liftedBy = byId; return true; }, { initial: [] });
  if (!result) return false;
  if (cfg.channels.log) await sendMessage(cfg.channels.log, { content: `✅ Sperre von <@${user}> aufgehoben von <@${byId}>.` });
  await notify(user, { embeds: [{ color: COLOR, title: "✅ Sperre aufgehoben", description: "Deine Sperre wurde von der Turnierleitung aufgehoben. Ihr könnt euch wieder zu Cups anmelden." }] });
  await refreshBanPanel();
  return true;
}

/** Vom Timer: abgelaufene Sperren entfernen */
export async function expireBans(now = Date.now()) {
  const list = (await get("bans")) || [];
  const expired = list.filter((b) => b.until <= now && !b.done);
  if (!expired.length) return;
  const cfg = await getConfig();
  await mutate("bans", (l) => {
    for (const b of l) if (b.until <= now) b.done = true;
    // Alte Einträge nach 60 Tagen löschen
    for (let i = l.length - 1; i >= 0; i--) if (l[i].until < now - 60 * 86400000) l.splice(i, 1);
  }, { initial: [] });
  for (const b of expired) {
    if (b.liftedBy) continue;
    if (cfg.channels.log) await sendMessage(cfg.channels.log, { content: `⏱️ Sperre von <@${b.user}> ist abgelaufen und wurde automatisch entfernt.` });
    await notify(b.user, { embeds: [{ color: COLOR, title: "⏱️ Sperre abgelaufen", description: "Deine Sperre ist abgelaufen. Ihr könnt euch wieder zu Cups anmelden." }] });
  }
  await refreshBanPanel();
}
