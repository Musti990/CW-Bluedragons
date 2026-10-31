// Benachrichtigungen: Personen im Kanal „Benachrichtigungen“ markieren statt Direktnachrichten.
// Jede Nachricht wird nach 1 Stunde automatisch gelöscht.
import { get, mutate, getConfig } from "./store.mjs";
import { sendMessage, deleteMessage } from "./discord.mjs";

export const NOTIFY_TTL_MS = 60 * 60 * 1000;

/** users: eine ID oder Liste von IDs; payload: { embeds } */
export async function notify(users, payload) {
  const ids = [].concat(users).filter(Boolean);
  if (!ids.length) return null;
  const cfg = await getConfig();
  const ch = cfg.channels.notify;
  if (!ch) return null;
  const msg = await sendMessage(ch, { ...payload, content: ids.map((u) => `<@${u}>`).join(" "), allowed_mentions: { users: ids } });
  if (msg) await mutate("autodelete", (l) => { l.push({ ch, id: msg.id, at: Date.now() + NOTIFY_TTL_MS }); }, { initial: [] });
  return msg;
}

/** Vom Timer: abgelaufene Benachrichtigungen löschen */
export async function runAutoDelete(now = Date.now()) {
  const list = (await get("autodelete")) || [];
  const due = list.filter((x) => x.at <= now).slice(0, 20);
  if (!due.length) return;
  for (const d of due) await deleteMessage(d.ch, d.id);
  const ids = new Set(due.map((d) => d.id));
  await mutate("autodelete", (l) => { for (let i = l.length - 1; i >= 0; i--) if (ids.has(l[i].id)) l.splice(i, 1); }, { initial: [] });
}
