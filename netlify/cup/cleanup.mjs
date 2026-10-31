// Aufräumen nach dem Cup: alle Nachrichten des Cups in den Turnier-Kanälen löschen.
import { get, mutate, getConfig } from "./store.mjs";
import { discord, deleteMessage } from "./discord.mjs";
import { GROUP_NAMES } from "./data.mjs";

export const CLEANUP_DELAY_MIN = 30; // so viele Minuten nach Turnierende wird aufgeräumt

/** Aufräumen für ein Turnier einplanen */
export async function scheduleCleanup(t, delayMin = CLEANUP_DELAY_MIN) {
  const cfg = await getConfig();
  const c = cfg.channels || {};
  const channels = [
    t.channelId, c.live, c.log, c.ko, c.kor,
    ...GROUP_NAMES.flatMap((g) => [c["g" + g], c["r" + g]]),
  ].filter(Boolean);
  const since = (t.createdAt || Date.now()) - 60 * 1000;
  await mutate("cleanup", (l) => {
    if (l.some((j) => j.tid === t.channelId + ":" + t.createdAt)) return;
    l.push({ tid: t.channelId + ":" + t.createdAt, at: Date.now() + delayMin * 60000, since, channels: [...new Set(channels)] });
  }, { initial: [] });
}

/** Nachrichten eines Kanals seit `since` holen (neueste zuerst) */
async function messagesSince(ch, since, max = 500) {
  const out = [];
  let before = null;
  while (out.length < max) {
    const batch = await discord(`/channels/${ch}/messages?limit=100${before ? `&before=${before}` : ""}`);
    if (!batch?.length) break;
    for (const m of batch) if (Date.parse(m.timestamp) >= since) out.push(m.id);
    if (batch.length < 100 || Date.parse(batch[batch.length - 1].timestamp) < since) break;
    before = batch[batch.length - 1].id;
  }
  return out;
}

async function wipe(ch, since) {
  const ids = await messagesSince(ch, since);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if (chunk.length === 1) await deleteMessage(ch, chunk[0]);
    else await discord(`/channels/${ch}/messages/bulk-delete`, "POST", { messages: chunk });
  }
  return ids.length;
}

/**
 * Vor jeder Freigabe: alle Nachrichten im Kanal löschen, außer `keep` (z. B. der Spielplan).
 * Nur Nachrichten der letzten 13 Tage – ältere kann Discord nicht in einem Rutsch löschen.
 */
export async function purgeExcept(ch, keep = []) {
  if (!ch) return 0;
  const keepSet = new Set(keep.filter(Boolean));
  const ids = (await messagesSince(ch, Date.now() - 13 * 86400000, 300)).filter((id) => !keepSet.has(id));
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if (chunk.length === 1) await deleteMessage(ch, chunk[0]);
    else if (!(await discord(`/channels/${ch}/messages/bulk-delete`, "POST", { messages: chunk }))) for (const id of chunk) await deleteMessage(ch, id);
  }
  return ids.length;
}

/** Vom Timer: fällige Aufräum-Aufträge abarbeiten */
export async function runCleanup(budgetMs = 8000, now = Date.now()) {
  const deadline = Date.now() + budgetMs;
  const list = (await get("cleanup")) || [];
  for (const job of list.filter((j) => j.at <= now)) {
    while (job.channels.length && Date.now() < deadline - 1500) {
      const ch = job.channels[0];
      await wipe(ch, job.since);
      job.channels.shift();
      await mutate("cleanup", (l) => { const j = l.find((x) => x.tid === job.tid); if (j) j.channels = [...job.channels]; }, { initial: [] });
    }
    if (!job.channels.length) await mutate("cleanup", (l) => { const i = l.findIndex((x) => x.tid === job.tid); if (i >= 0) l.splice(i, 1); }, { initial: [] });
    if (Date.now() >= deadline - 1500) break;
  }
}
