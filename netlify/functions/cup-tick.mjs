// UT Cup – läuft jede Minute: Wochenplan, Turnier-Zeitpunkte, Rollen, Sperren, Aufräumen.
import { runSchedule, runTimers, allTournaments, runAutoConfirm } from "../cup/flow.mjs";
import { reconcileCupRoles } from "../cup/maintenance.mjs";
import { listMembers } from "../cup/discord.mjs";
import { processQueue } from "../cup/roles.mjs";
import { expireBans } from "../cup/bans.mjs";
import { runAutoDelete } from "../cup/notify.mjs";
import { processSetupJobs } from "../cup/autosetup.mjs";
import { runCleanup } from "../cup/cleanup.mjs";

export default async () => {
  // Ohne eingerichteten Cup-Bot nichts tun (z. B. solange nur der Zusagen-Bot läuft)
  if (!process.env.CUP_DISCORD_TOKEN || !process.env.CUP_GUILD_ID) return;
  const start = Date.now();
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.error(`${name}:`, e?.message || e); } };
  await step("Einrichtung", () => processSetupJobs(9000));
  await step("Wochenplan", () => runSchedule());
  await step("Turniere", async () => {
    for (const t of await allTournaments()) if (["anmeldung", "checkin", "gruppen"].includes(t.status)) await step(`Turnier ${t.channelId}`, () => runTimers(t));
  });
  await step("Ergebnisse automatisch bestätigen", () => runAutoConfirm());
  await step("Test-Cup", async () => { const F = await import("../cup/flow.mjs"); const t = await F.activeTournament(); if (t?.test) await F.playVirtualMatches(t.channelId); });
  let members = null;
  await step("Mitglieder laden", async () => { members = await listMembers(); });
  await step("Turnier-Rollen prüfen", () => reconcileCupRoles(members));
  await step("Sperren", () => expireBans());
  await step("Benachrichtigungen löschen", () => runAutoDelete());
  await step("Aufräumen nach dem Cup", () => runCleanup(8000));
  await step("Rollen-Warteschlange", () => processQueue(Math.max(3000, 26000 - (Date.now() - start))));
};

export const config = { schedule: "* * * * *" };
