// Anonyme Spieler-Umfrage nach der Session („Wer hat euch heute nicht gefallen?“)
// Jeder hat 1 Stimme (änderbar). Während die Umfrage läuft, sieht man nur die Zahl der Stimmen – das Ergebnis kommt am Ende.
const { getStore } = require('@netlify/blobs');

const store = () => getStore({ name: 'polls', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' });
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const num = (i) => NUM[i] || `**${i + 1}.**`;

function parseDuration(raw) {
  const m = String(raw || '').trim().toLowerCase().match(/^(\d+)\s*(m|min|h|std|d|t)?$/);
  if (!m) return 12 * 3600e3;
  const n = Number(m[1]), u = m[2] || 'h';
  const ms = u.startsWith('m') ? n * 60e3 : u === 'd' || u === 't' ? n * 86400e3 : n * 3600e3;
  return Math.min(Math.max(ms, 5 * 60e3), 7 * 86400e3);
}

function liveEmbed(p) {
  const voters = Object.keys(p.votes).length;
  return {
    color: 0x1f6bff,
    title: `🕵️ ${p.question}`,
    description: `${p.options.map((o, i) => `${num(i)} ${o}`).join('\n')}\n\n🗳️ **${voters} ${voters === 1 ? 'Stimme' : 'Stimmen'}** · ⏰ endet <t:${Math.floor(p.endsAt / 1000)}:R>`,
    thumbnail: { url: `${process.env.URL}/blue-dragons-logo.png` },
    footer: { text: 'Anonym · 1 Stimme pro Person (nochmal klicken = ändern) · Ergebnis kommt am Ende' },
  };
}

function resultEmbed(p) {
  const counts = p.options.map((o, i) => ({ o, i, n: Object.values(p.votes).filter((v) => v === i).length }));
  const total = counts.reduce((a, c) => a + c.n, 0);
  const sorted = counts.filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
  const bar = (n) => { const f = total ? Math.round((n / total) * 10) : 0; return '▰'.repeat(f) + '▱'.repeat(10 - f); };
  const lines = sorted.map((c, k) => `${k === 0 ? '👎' : '▫️'} **${c.o}** – ${c.n} ${c.n === 1 ? 'Stimme' : 'Stimmen'}\n${bar(c.n)} ${Math.round((c.n / total) * 100)} %`);
  return {
    color: 0x4e5058,
    title: `🏁 ERGEBNIS · ${p.question}`,
    description: total ? `${lines.join('\n')}\n\n🗳️ ${total} ${total === 1 ? 'Stimme' : 'Stimmen'} · anonym · beendet` : 'Keine Stimmen abgegeben.',
    thumbnail: { url: `${process.env.URL}/blue-dragons-logo.png` },
    footer: { text: `Spieler ohne Stimme werden nicht angezeigt · ${p.options.length} Spieler zur Auswahl` },
  };
}

function buttons(p) {
  const rows = [];
  p.options.forEach((o, i) => {
    if (i % 5 === 0) rows.push({ type: 1, components: [] });
    rows[rows.length - 1].components.push({ type: 2, style: 2, label: String(o).slice(0, 80), custom_id: `poll:vote:${p.id}:${i}` });
  });
  if (rows.length < 5) rows.push({ type: 1, components: [{ type: 2, style: 4, label: 'Beenden (Admin)', emoji: { name: '🏁' }, custom_id: `poll:end:${p.id}` }] });
  return rows.slice(0, 5);
}

async function createPoll({ id, channelId, question, options, durationMs, creatorId }) {
  const p = { id, channelId, question, options, votes: {}, creatorId, createdAt: Date.now(), endsAt: Date.now() + durationMs, closed: false, messageId: null };
  const res = await fetch(`${API}/channels/${channelId}/messages`, { method: 'POST', headers: auth(), body: JSON.stringify({ embeds: [liveEmbed(p)], components: buttons(p) }) });
  if (!res.ok) throw new Error(`Konnte die Umfrage nicht posten (${res.status}) – der Bot braucht „Nachrichten senden“.`);
  p.messageId = (await res.json()).id;
  await store().setJSON(`poll-${id}`, p);
  return p;
}

async function vote(id, userId, idx) {
  const p = await store().get(`poll-${id}`, { type: 'json' });
  if (!p || p.closed) return { error: 'Diese Umfrage ist beendet.' };
  if (!p.options[idx]) return { error: 'Unbekannte Auswahl.' };
  const same = p.votes[userId] === idx;
  if (same) delete p.votes[userId]; else p.votes[userId] = idx;
  await store().setJSON(`poll-${id}`, p);
  return { p, removed: same };
}

async function closePoll(id) {
  const p = await store().get(`poll-${id}`, { type: 'json' });
  if (!p || p.closed) return null;
  p.closed = true;
  await store().setJSON(`poll-${id}`, p);
  await fetch(`${API}/channels/${p.channelId}/messages/${p.messageId}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ embeds: [resultEmbed(p)], components: [] }) });
  return p;
}

/** session-check: abgelaufene Umfragen schließen, alte löschen */
async function processPolls() {
  const { blobs } = await store().list({ prefix: 'poll-' });
  let closed = 0;
  for (const b of blobs) {
    const p = await store().get(b.key, { type: 'json' });
    if (!p) continue;
    if (!p.closed && Date.now() >= p.endsAt) { await closePoll(p.id); closed++; }
    else if (p.closed && Date.now() - p.endsAt > 14 * 86400e3) await store().delete(b.key);
  }
  return closed;
}

async function lastLineupNames(team) {
  const ls = getStore({ name: 'lineups', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  return (await ls.get(`last-team-${team}`, { type: 'json' })) || null;
}

module.exports = { createPoll, vote, closePoll, processPolls, liveEmbed, resultEmbed, buttons, parseDuration, lastLineupNames };
