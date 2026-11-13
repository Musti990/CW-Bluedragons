// 🛡️ Mod-Log: liest alle 2 Minuten das Discord-Audit-Log und postet Mod-Aktionen in den Kanal „Mod-Log“.
// (Netlify-Bots bekommen keine Live-Ereignisse – deshalb das Audit-Log. Inhalte gelöschter Nachrichten gibt es dort nicht.)
const { getStore } = require('@netlify/blobs');
const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' });
const store = () => getStore({ name: 'modlog', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const bi = (s) => [...s].map((ch) => { const c = ch.codePointAt(0); if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d468 + c - 65); if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d482 + c - 97); return ch; }).join('');
const CHANNEL_NAME = `🛡️・${bi('Mod-Log')}`;

// Audit-Log-Typen → Darstellung
const T = {
  20: { e: '👢', t: 'Kick', c: 0xe67e22 },
  22: { e: '🔨', t: 'Ban', c: 0xda373c },
  23: { e: '🕊️', t: 'Ban aufgehoben', c: 0x23a55a },
  24: { e: '✏️', t: 'Mitglied geändert', c: 0x5865f2 },
  25: { e: '🎭', t: 'Rollen geändert', c: 0x9b59b6 },
  26: { e: '🔀', t: 'Im Sprachkanal verschoben', c: 0x5865f2 },
  27: { e: '🔇', t: 'Aus Sprachkanal geworfen', c: 0xe67e22 },
  10: { e: '➕', t: 'Kanal erstellt', c: 0x23a55a },
  11: { e: '🔧', t: 'Kanal geändert', c: 0x5865f2 },
  12: { e: '🗑️', t: 'Kanal gelöscht', c: 0xda373c },
  30: { e: '➕', t: 'Rolle erstellt', c: 0x23a55a },
  31: { e: '🔧', t: 'Rolle geändert', c: 0x5865f2 },
  32: { e: '🗑️', t: 'Rolle gelöscht', c: 0xda373c },
  72: { e: '🗑️', t: 'Nachricht gelöscht', c: 0xda373c },
  73: { e: '🧹', t: 'Mehrere Nachrichten gelöscht', c: 0xda373c },
  74: { e: '📌', t: 'Nachricht angepinnt', c: 0x5865f2 },
  75: { e: '📍', t: 'Pin entfernt', c: 0x5865f2 },
};

let chCache = { id: null, at: 0 };
async function findChannel(guildId) {
  if (process.env.MODLOG_CHANNEL_ID) return process.env.MODLOG_CHANNEL_ID;
  if (chCache.at && Date.now() - chCache.at < 10 * 60000) return chCache.id;
  const r = await fetch(`${API}/guilds/${guildId}/channels`, { headers: auth() });
  const id = r.ok ? (await r.json()).find((c) => c.type === 0 && norm(c.name).includes('modlog'))?.id || null : null;
  chCache = { id, at: Date.now() };
  return id;
}

/** Jeden Button-Klick / jede Auswahl ins Mod-Log (wer, was, wo) */
async function logClick(i) {
  try {
    if (i.type !== 3 || !i.guild_id) return;
    const ch = await findChannel(i.guild_id);
    if (!ch || i.channel_id === ch) return;
    const id = i.data?.custom_id || '';
    let label = null;
    for (const row of i.message?.components || []) for (const c of row.components || [row]) {
      if (c.custom_id === id) label = c.label || c.placeholder || null;
      for (const cc of c.components || []) if (cc.custom_id === id) label = cc.label || cc.placeholder || null; // Components V2
    }
    const KNOWN = { 'rsvp:yes': 'Zusage ✅', 'rsvp:no': 'Absage ❌', 'rsvp:maybe': 'Vielleicht ❔', 'rsvp:missing': 'Wer fehlt noch?' };
    label = label || KNOWN[id.split(':').slice(0, 2).join(':')] || null;
    const vals = i.data?.values?.length ? ` → ${i.data.values.slice(0, 5).join(', ')}` : '';
    const uid = i.member?.user?.id || i.user?.id;
    const t = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(new Date());
    const text = `\`${t}\` 🖱️ <@${uid}> klickt **${(label || id.split(':').slice(0, 2).join(':')).slice(0, 80)}**${vals} in <#${i.channel_id}>`;
    await fetch(`${API}/channels/${ch}/messages`, { method: 'POST', headers: auth(), body: JSON.stringify({ content: text.slice(0, 1990), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(1500) });
  } catch { /* das Log darf nie etwas blockieren */ }
}

/** /modlog-einrichten: Kanal anlegen – nur für Admins/Mods sichtbar, niemand schreibt außer dem Bot */
async function setupModlog(guildId) {
  if (await findChannel(guildId)) return { existed: true };
  const roles = await (await fetch(`${API}/guilds/${guildId}/roles`, { headers: auth() })).json().catch(() => []);
  const staff = (roles || []).filter((r) => !r.managed && /(admin|owner|mod|vm)/.test(norm(r.name)));
  const VIEW = 1n << 10n, SEND = 1n << 11n, HISTORY = 1n << 16n;
  const ow = [{ id: guildId, type: 0, allow: '0', deny: VIEW.toString() }, ...staff.map((r) => ({ id: r.id, type: 0, allow: (VIEW | HISTORY).toString(), deny: SEND.toString() }))];
  const res = await fetch(`${API}/guilds/${guildId}/channels`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: CHANNEL_NAME, type: 0, topic: 'Mod-Aktionen aus dem Audit-Log (alle 2 Minuten)', permission_overwrites: ow }) });
  if (!res.ok) return { error: `Kanal konnte nicht angelegt werden (${res.status}) – der Bot braucht „Kanäle verwalten“.` };
  return { created: true, staff: staff.map((r) => r.name) };
}

function describe(e, users) {
  const who = (id) => (id ? `<@${id}>` : '–');
  const lines = [];
  const tgt = e.target_id;
  if ([20, 22, 23, 24, 25, 26, 27].includes(e.action_type)) lines.push(`👤 **Mitglied:** ${who(tgt)}${users[tgt] ? ` (${users[tgt]})` : ''}`);
  if ([10, 11, 12].includes(e.action_type)) lines.push(`📁 **Kanal:** ${e.action_type === 12 ? (e.changes?.find((c) => c.key === 'name')?.old_value || tgt) : `<#${tgt}>`}`);
  if ([30, 31, 32].includes(e.action_type)) lines.push(`🏷️ **Rolle:** ${e.action_type === 32 ? (e.changes?.find((c) => c.key === 'name')?.old_value || tgt) : `<@&${tgt}>`}`);
  if (e.action_type === 72 || e.action_type === 73) {
    if (e.action_type === 72) lines.push(`👤 **Von:** ${who(tgt)}`);
    if (e.options?.channel_id) lines.push(`📁 **Kanal:** <#${e.options.channel_id}>`);
    if (e.options?.count) lines.push(`🔢 **Anzahl:** ${e.options.count}`);
  }
  for (const c of e.changes || []) {
    if (c.key === '$add') lines.push(`➕ **Rolle bekommen:** ${c.new_value.map((r) => `<@&${r.id}>`).join(', ')}`);
    if (c.key === '$remove') lines.push(`➖ **Rolle entfernt:** ${c.new_value.map((r) => `<@&${r.id}>`).join(', ')}`);
    if (c.key === 'nick') lines.push(`🏷️ **Name:** ${c.old_value || '–'} → **${c.new_value || '(zurückgesetzt)'}**`);
    if (c.key === 'communication_disabled_until') lines.push(c.new_value ? `⏳ **Timeout bis** <t:${Math.floor(Date.parse(c.new_value) / 1000)}:f>` : '✅ **Timeout aufgehoben**');
    if (c.key === 'name' && [11, 31].includes(e.action_type)) lines.push(`🔤 **Name:** ${c.old_value} → **${c.new_value}**`);
  }
  lines.push(`🛡️ **Durch:** ${who(e.user_id)}`);
  if (e.reason) lines.push(`📝 **Grund:** ${e.reason}`);
  return lines.join('\n');
}

/** Vom 2-Minuten-Timer: neue Audit-Log-Einträge posten */
async function processModlog(guildId) {
  const ch = await findChannel(guildId);
  if (!ch) return null;
  const s = store();
  const state = (await s.get('state', { type: 'json' })) || {};
  const r = await fetch(`${API}/guilds/${guildId}/audit-logs?limit=50`, { headers: auth() });
  if (!r.ok) return `Audit-Log nicht lesbar (${r.status}) – Bot braucht „Audit-Log anzeigen“`;
  const data = await r.json();
  const me = state.me || (await (await fetch(`${API}/users/@me`, { headers: auth() })).json()).id;
  const entries = (data.audit_log_entries || []).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const last = entries.length ? entries[entries.length - 1].id : state.last;
  if (!state.last) { await s.setJSON('state', { last, me }); return 'Start – merkt sich den Stand'; }
  const users = Object.fromEntries((data.users || []).map((u) => [u.id, u.global_name || u.username]));
  const fresh = entries.filter((e) => BigInt(e.id) > BigInt(state.last) && T[e.action_type] && e.user_id !== me); // eigene Bot-Aktionen stehen im Bot-Log
  const embeds = fresh.map((e) => ({
    color: T[e.action_type].c,
    title: (() => {
      const to = e.action_type === 24 && (e.changes || []).find((c) => c.key === 'communication_disabled_until');
      if (to) return to.new_value ? '⏳ Timeout' : '✅ Timeout aufgehoben';
      if (e.action_type === 24 && (e.changes || []).some((c) => c.key === 'nick')) return '🏷️ Name geändert';
      return `${T[e.action_type].e} ${T[e.action_type].t}`;
    })(),
    description: describe(e, users).slice(0, 4000),
    timestamp: new Date(Number((BigInt(e.id) >> 22n) + 1420070400000n)).toISOString(),
  }));
  for (let i = 0; i < embeds.length; i += 10) {
    await fetch(`${API}/channels/${ch}/messages`, { method: 'POST', headers: auth(), body: JSON.stringify({ embeds: embeds.slice(i, i + 10), allowed_mentions: { parse: [] } }) });
  }
  await s.setJSON('state', { last, me });
  return fresh.length ? `${fresh.length} Einträge gepostet` : null;
}

module.exports = { processModlog, setupModlog, logClick, CHANNEL_NAME };
