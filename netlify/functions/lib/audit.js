// 🧾 Bot-Log für den Zusagen-Bot: schreibt in denselben Kanal wie der Cup („UT-Bot-Log“ bzw. ein Kanal mit „Bot-Log“ im Namen).
// Fest einstellbar mit der Netlify-Variable AUDIT_CHANNEL_ID.
const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' });
const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
let cache = { id: null, at: 0 };

async function channelId(guildId) {
  if (process.env.AUDIT_CHANNEL_ID) return process.env.AUDIT_CHANNEL_ID;
  if (cache.id && Date.now() - cache.at < 10 * 60000) return cache.id;
  const gid = guildId || process.env.GUILD_ID;
  if (!gid) return null;
  const r = await fetch(`${API}/guilds/${gid}/channels`, { headers: auth() });
  const ch = r.ok ? (await r.json()).find((c) => c.type === 0 && norm(c.name).includes('botlog')) : null;
  cache = { id: ch?.id || null, at: Date.now() };
  return cache.id;
}

/** Eine Zeile ins Bot-Log (ohne Pings). Fehler werden ignoriert. */
async function audit(text, guildId) {
  console.log('[Bot-Log]', String(text).replace(/\n/g, ' | ')); // auch in den Netlify-Logs sichtbar
  try {
    const ch = await channelId(guildId);
    if (!ch) return;
    const t = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(new Date());
    await fetch(`${API}/channels/${ch}/messages`, { method: 'POST', headers: auth(), body: JSON.stringify({ content: `\`${t}\` ${text}`.slice(0, 1990), allowed_mentions: { parse: [] } }) });
  } catch { /* egal */ }
}

module.exports = { audit };
