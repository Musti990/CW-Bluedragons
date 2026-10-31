// Hintergrund-Aufgaben: Manager-Rolle ↔ Spieler-Rolle abgleichen, 7-Tage-Inaktivität.
import { get, set, mutate, getConfig, getClubs } from "./store.mjs";
import { listMembers, sendMessage } from "./discord.mjs";
import { welcomePost } from "./views.mjs";
import { enqueue } from "./roles.mjs";
import { activeTournament } from "./flow.mjs";
import * as T from "./tournament.mjs";

// Ultimate Team: keine Manager/Spieler-Rollenumschaltung und keine 7-Tage-Regel – Profile bleiben bestehen.
export async function syncManagerRoles() {}
export async function dailyInactivity() {}

const WELCOME_WINDOW = 15 * 60000; // wer in den letzten 15 Min. beigetreten ist und noch nicht begrüßt wurde

/**
 * Neue Mitglieder begrüßen. Maßgeblich ist der Beitrittszeitpunkt (joined_at) – so geht niemand verloren,
 * wenn ein Durchlauf mal ausfällt, und es gibt keine Massen-Begrüßung, wenn die Liste einmal unvollständig ist.
 */
export async function welcomeNewMembers(members) {
  const cfg = await getConfig();
  if (!members || !cfg.channels.welcome) return;
  const now = Date.now();
  const fresh = members.filter((m) => !m.user.bot && now - Date.parse(m.joined_at) < WELCOME_WINDOW);
  if (!fresh.length) return;
  const { result: todo } = await mutate("welcomed", (w) => {
    for (const [id, at] of Object.entries(w)) if (now - at > 86400000) delete w[id]; // nach einem Tag vergessen
    const list = fresh.filter((m) => !w[m.user.id]).slice(0, 10);
    for (const m of list) w[m.user.id] = now; // vorher eintragen → nie doppelt
    return list.map((m) => m.user.id);
  }, { initial: {} });
  for (const id of todo) await sendMessage(cfg.channels.welcome, welcomePost(id, cfg.channels));
}

/**
 * Sicherheitsnetz für Turnier-Rollen: vergleicht jede Minute, welche Gruppen- bzw. K.-o.-Rolle jeder Teilnehmer
 * haben sollte, mit dem, was er wirklich hat – und korrigiert Abweichungen (z. B. wenn Discord eine Vergabe abgelehnt hat).
 */
export async function reconcileCupRoles(members) {
  const r = await cupRoleDiff(members);
  if (r?.ops?.length) await enqueue(r.ops);
}

/** Soll/Ist-Vergleich der Turnier-Rollen. Rückgabe: { t, ops, missing: [{ u, club, add, rem }] } oder null */
export async function cupRoleDiff(members, { includePending = false } = {}) {
  if (!members) return null;
  const t = await activeTournament();
  if (!t || !T.ACTIVE.includes(t.status)) return null;
  const cfg = await getConfig();
  const groupRoles = cfg.roles.groups || {}, roundRoles = cfg.roles.rounds || {};
  const managed = new Set([...Object.values(groupRoles), ...Object.values(roundRoles), cfg.roles.koPhase].filter(Boolean));
  const pending = new Set(((await get("rolequeue")) || []).map((o) => o.u)); // nicht dazwischenfunken
  const want = new Map();
  for (const u of Object.values(t.members || {}).flat()) want.set(u, new Set());
  const wish = (club, role) => { if (role) for (const u of t.members?.[club] || []) want.get(u)?.add(role); };
  if (t.status === "checkin" || t.status === "gruppen") {
    for (const g of t.groups) for (const c of g.teams) if (!t.out.includes(c)) wish(c, groupRoles[g.name]);
  } else {
    for (const m of T.currentMatches(t)) for (const c of [m.home, m.away]) { wish(c, roundRoles[T.koRoleOf(t, c)]); wish(c, cfg.roles.koPhase); }
  }
  const byId = new Map(members.map((m) => [m.user.id, m]));
  const clubOf = new Map(Object.entries(t.members || {}).flatMap(([c, us]) => us.map((u) => [u, c])));
  const ops = [], missing = [];
  for (const [u, roles] of want) {
    const m = byId.get(u);
    if (!m) { missing.push({ u, club: clubOf.get(u), gone: true, add: [], rem: [] }); continue; }
    const add = [...roles].filter((r) => !m.roles.includes(r));
    const rem = m.roles.filter((r) => managed.has(r) && !roles.has(r));
    if (!add.length && !rem.length) continue;
    missing.push({ u, club: clubOf.get(u), add, rem, pending: pending.has(u) });
    if (includePending || !pending.has(u)) ops.push({ u, add, rem, why: "Turnier-Rollen abgeglichen" });
  }
  return { t, ops, missing, queue: pending.size };
}
