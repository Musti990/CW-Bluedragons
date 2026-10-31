// Protokoll: Jede Aktion der Turnierleitung / des Staffs wird im Admin-Kanal festgehalten,
// damit die Server-Admins nachvollziehen können, wer was gemacht hat.
import { getConfig } from "./store.mjs";
import { sendMessage } from "./discord.mjs";
import { BAN_REASONS } from "./data.mjs";

const OPT_TYPES = { 6: (v) => `<@${v}>`, 7: (v) => `<#${v}>`, 8: (v) => `<@&${v}>`, 9: (v) => `<@${v}>` };

/** Slash-Befehl mit allen Optionen als lesbare Zeile, z. B. `/cl-admin ergebnis spiel: 4 heim: 2 gast: 1` */
export function describeCommand(data) {
  const parts = [`/${data.name}`];
  const walk = (opts = []) => {
    for (const o of opts) {
      if (o.type === 1 || o.type === 2) { parts.push(o.name); walk(o.options); continue; }
      const fmt = OPT_TYPES[o.type];
      parts.push(`${o.name}: ${fmt ? fmt(o.value) : String(o.value)}`);
    }
  };
  walk(data.options);
  return parts.join(" ");
}

/** Text für Staff-Buttons und -Formulare (null = nicht protokollieren) */
export function describeComponent(i) {
  const id = i.data.custom_id, v = i.data.values || [];
  if (id.startsWith("ban_ok:") || id.startsWith("ban_m:")) {
    const [u, r, d, both] = id.split(":").slice(1);
    const note = id.startsWith("ban_m:") ? modalText(i, "note") : "";
    return `🚫 sperrt <@${u}>${both === "2" ? " (und Partner)" : ""} für **${d} ${d === "1" ? "Tag" : "Tage"}** · Grund: ${BAN_REASONS[Number(r)] ?? r}${note ? ` · Notiz: ${note.slice(0, 200)}` : ""}`;
  }
  if (id === "ban_lift_pick") return `🔓 hebt die Sperre von <@${v[0]}> auf`;
  if (id.startsWith("reset_ok:")) return `♻️ setzt zurück: **${{ stats: "Statistik", setup: "Einrichtung", all: "ALLES" }[id.split(":")[1]] || id}**`;
  if (id === "tk_claim") return `🙋 übernimmt das Ticket <#${i.channel_id}>`;
  if (id === "tk_add_pick") return `➕ fügt <@${v[0]}> zum Ticket <#${i.channel_id}> hinzu`;
  if (id.startsWith("ap_yes:")) return `✅ nimmt Bewerbung #${id.split(":")[1]} an`;
  if (id.startsWith("ap_no_m:")) { const r = modalText(i, "reason"); return `❌ lehnt Bewerbung #${id.split(":")[1]} ab${r ? ` · Begründung: ${r.slice(0, 200)}` : ""}`; }
  if (id.startsWith("ap_talk:")) return `💬 startet ein Gespräch zu Bewerbung #${id.split(":")[1]}`;
  return null;
}

function modalText(i, key) {
  for (const r of i.data.components ?? []) { const c = r.components?.[0] ?? r.component; if (c?.custom_id === key) return String(c.value ?? "").trim(); }
  return "";
}

/** Eintrag in den Admin-Kanal (ohne Pings) */
export async function audit(uid, text, channelId) {
  const cfg = await getConfig();
  const ch = cfg.channels.admin;
  if (!ch || !text) return;
  await sendMessage(ch, {
    content: `🛠️ <@${uid}> · ${text}${channelId ? ` · in <#${channelId}>` : ""} · <t:${Math.floor(Date.now() / 1000)}:f>`,
    allowed_mentions: { parse: [] },
  });
}
