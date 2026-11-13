// Warteschlange für Rollen-Änderungen. Discord begrenzt, wie schnell Rollen vergeben werden dürfen –
// deshalb werden Änderungen gesammelt und in mehreren Durchläufen abgearbeitet.
import { get, mutate } from "./store.mjs";
import { addRole, removeRole } from "./discord.mjs";

const KEY = "rolequeue";

/** ops: [{ u: Nutzer-ID, add: [Rollen-IDs], rem: [Rollen-IDs], why: "Grund" }] */
export async function enqueue(ops) {
  const clean = ops
    .map((o) => ({ u: o.u, add: (o.add || []).filter(Boolean), rem: (o.rem || []).filter(Boolean), why: o.why || "UT Cup" }))
    .filter((o) => o.u && (o.add.length || o.rem.length));
  if (!clean.length) return;
  await mutate(KEY, (q) => {
    for (const o of clean) q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tries: 0, ...o });
  }, { initial: [] });
}

const MAX_TRIES = 6;                       // ca. 20 Minuten lang immer wieder versuchen
const backoff = (tries) => Math.min(15000 * 2 ** tries, 5 * 60000); // 15 s, 30 s, 1 min, 2 min, 4 min, 5 min

/**
 * Arbeitet die Warteschlange ab, bis die Zeit um ist.
 * - Fehlgeschlagene Änderungen (z. B. Discord-Rate-Limit) werden später erneut versucht, nicht sofort verworfen.
 * - Pro Person bleibt die Reihenfolge erhalten: eine spätere Änderung wartet, bis die frühere durch ist.
 */
const LOG = [];
async function flushLog() {
  if (!LOG.length) return;
  const lines = LOG.splice(0);
  const { audit } = await import("./audit.mjs");
  for (let i = 0; i < lines.length; i += 25) await audit(`🎭 **Rollen** (${lines.length})\n${lines.slice(i, i + 25).join("\n")}`);
}

export async function processQueue(budgetMs = 8000) {
  const deadline = Date.now() + budgetMs;
  let done = 0;
  while (Date.now() < deadline - 800) {
    const q = (await get(KEY)) || [];
    const now = Date.now(), blocked = new Set();
    let op = null;
    for (const x of q) {
      if (blocked.has(x.u)) continue;
      if ((x.nextAt || 0) <= now) { op = x; break; }
      blocked.add(x.u); // ältere Änderung dieser Person wartet noch → spätere nicht vorziehen
    }
    if (!op) break;
    let ok = true;
    for (const r of op.add) { const a = await addRole(op.u, r, op.why); if (!a) ok = false; LOG.push(`${a ? "➕" : "❌➕"} <@${op.u}> <@&${r}> · ${op.why || ""}`); }
    for (const r of op.rem) { const a = await removeRole(op.u, r, op.why); if (!a) ok = false; LOG.push(`${a ? "➖" : "❌➖"} <@${op.u}> <@&${r}> · ${op.why || ""}`); }
    await mutate(KEY, (list) => {
      const i = list.findIndex((x) => x.id === op.id);
      if (i < 0) return;
      if (ok || list[i].tries + 1 >= MAX_TRIES) {
        if (!ok) console.error(`Rolle konnte nicht geändert werden (${list[i].why}) für ${list[i].u}`);
        list.splice(i, 1);
      } else { list[i].tries++; list[i].nextAt = Date.now() + backoff(list[i].tries); }
    }, { initial: [] });
    done++;
  }
  await flushLog();
  return done;
}
