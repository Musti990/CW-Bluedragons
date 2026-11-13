// 🧾 Bot-Log: alles, was der Bot selbst macht (löschen, Rollen, Kanäle, Admin-Aktionen), landet im Kanal „Bot-Log“.
import { getConfig } from "./store.mjs";
import { discord } from "./discord.mjs";

const hhmm = () => new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" }).format(new Date());

/** Eine Zeile ins Bot-Log schreiben (ohne Pings). Fehler werden ignoriert – das Log darf nie etwas blockieren. */
export async function audit(text) {
  try {
    const cfg = await getConfig();
    const ch = cfg.channels?.audit || process.env.AUDIT_CHANNEL_ID;
    if (!ch) return;
    await discord(`/channels/${ch}/messages`, "POST", { content: `\`${hhmm()}\` ${text}`.slice(0, 1990), allowed_mentions: { parse: [] } });
  } catch { /* egal */ }
}
