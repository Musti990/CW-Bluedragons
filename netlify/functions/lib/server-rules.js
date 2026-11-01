// Server-Regeln mit „✅ Regeln akzeptieren“-Button (/regeln)
// Bestehende Mitglieder (beigetreten, bevor das Regel-Panel zum ersten Mal gepostet wurde) müssen NICHT akzeptieren.
const { getStore } = require('@netlify/blobs');

const SERVER_RULES = {
  title: '📜 WICHTIGE SERVER REGELN ❗️',
  sections: [
    ['1️⃣ 🙏 Umgang & Respekt', '• 🤝 Respektvoller und sachlicher Umgang ist Pflicht\n• ❌ Keine Beleidigungen, Diskriminierung, Hassrede, Mobbing oder Trolling\n• ⛔ Keine rassistischen, sexistischen, homophoben oder extremistischen Inhalte\n• ⛔ Politische oder religiöse Diskussionen sind zu unterlassen'],
    ['2️⃣ 📜 Inhalte & Discord-Regeln', '• 📵 Inhalte müssen den Discord Terms of Service und geltendem Recht entsprechen\n• 🚫 Verboten sind insbesondere:\n  – 🔞 Pornografische oder jugendgefährdende Inhalte\n  – 🔪 Gewaltverherrlichung\n  – 💾 Illegale Downloads, Cheats, Hacks oder Exploits\n  – 🚓 Aufrufe zu Straftaten'],
    ['3️⃣ 🙌 Fair Play', '• 🚫 Cheating, Hacking, Exploits oder Bug-Abuse sind verboten\n• 🔗 Das Bewerben oder Erklären solcher Methoden ist ebenfalls untersagt'],
    ['4️⃣ 📢 Spam & Werbung', '• 🔇 Kein Spam, Flooding, Kettennachrichten oder unnötiges Pingen\n• 📣 Werbung nur mit ausdrücklicher Genehmigung der Serverleitung\n• ❌ Private Werbe-DMs an Mitglieder sind verboten'],
    ['5️⃣ 🎙️ Voice & Profile', '• 🎧 Kein absichtliches Stören, Trolling oder Soundboard-Spam\n• 🖼️ Namen, Profilbilder & Status müssen regelkonform sein\n• 🤖 Kein Imitieren von Teammitgliedern oder Bots'],
    ['6️⃣ 🛡️ Moderation', '• 👮 Anweisungen von Moderatoren & Admins sind zu befolgen\n• 📩 Strafen werden nicht öffentlich diskutiert (DM an Mod)\n• ⚖️ Entscheidungen erfolgen nach Ermessen des Teams'],
    ['7️⃣ ⚖️ Haftung & Verbleib', '• 👤 Jeder Nutzer ist für seine Inhalte selbst verantwortlich\n• 🚨 Keine Haftung für geteilte Inhalte oder externe Links\n• 🚪 Kein Anspruch auf Verbleib auf dem Server\n• 🔄 Regeln können jederzeit geändert werden'],
    ['8️⃣ 🤝 Unser Wunsch an euch', '• 🤝 Zusammenhalt\n• 💬 Offener Austausch\n• 🆘 Hilfsbereitschaft\n• 🎉 Spaß und gute Vibes'],
  ],
  outro: '🤹 **Herzlich Willkommen** 🤹‍♀️\n🔱 **Viel Spaß auf dem Server** 🔱',
};

const store = () => getStore({ name: 'server-rules', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
async function getState() { return (await store().get('state', { type: 'json' })) || { since: null, channelId: null, accepted: {} }; }

// ---------- Rolle „Verifiziert“ (Schlüssel für die Rollenauswahl & weitere Kanäle) ----------
const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}` });
const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const VERIFY_NAME = 'Verifiziert';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rolle finden (ID aus VERIFY_ROLE_ID oder Name „Verifiziert“ – Emojis/Schrift egal); fehlt sie, wird sie angelegt */
async function verifyRole(guildId, { create = false } = {}) {
  const res = await fetch(`${API}/guilds/${guildId}/roles`, { headers: auth() });
  if (!res.ok) return null;
  const roles = await res.json();
  const found = roles.find((r) => r.id === process.env.VERIFY_ROLE_ID) || roles.find((r) => !r.managed && norm(r.name) === norm(VERIFY_NAME));
  if (found || !create) return found || null;
  const mk = await fetch(`${API}/guilds/${guildId}/roles`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: VERIFY_NAME, color: 0x1f6bff, permissions: '0', mentionable: false }) });
  return mk.ok ? mk.json() : null;
}

async function giveRole(guildId, userId, roleId) {
  const res = await fetch(`${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'PUT', headers: { ...auth(), 'X-Audit-Log-Reason': encodeURIComponent('Server-Regeln') } });
  return res;
}

/** Beim ersten /regeln: alle bestehenden Mitglieder einmalig vormerken, damit sie „Verifiziert“ bekommen */
async function queueBackfill(guildId, since, roleId) {
  const ids = [];
  let after = '0';
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${API}/guilds/${guildId}/members?limit=1000&after=${after}`, { headers: auth() });
    if (!res.ok) break;
    const list = await res.json();
    for (const m of list) {
      if (m.user?.bot) continue;
      if (m.joined_at && Date.parse(m.joined_at) >= since) continue;
      if ((m.roles || []).includes(roleId)) continue;
      ids.push(m.user.id);
    }
    if (list.length < 1000) break;
    after = list[list.length - 1].user.id;
  }
  await store().setJSON('backfill', { roleId, guildId, todo: ids, done: 0, total: ids.length, startedAt: Date.now() });
  return ids.length;
}

/** Läuft alle 2 Minuten (session-check): arbeitet die Liste in kleinen Schritten ab */
async function processBackfill(budgetMs = 18000) {
  const job = await store().get('backfill', { type: 'json' });
  if (!job || !job.todo?.length) return null;
  const start = Date.now();
  let n = 0;
  while (job.todo.length && Date.now() - start < budgetMs) {
    const uid = job.todo[0];
    const res = await giveRole(job.guildId, uid, job.roleId);
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') || 2) * 1000;
      if (Date.now() - start + wait > budgetMs) break;
      await sleep(wait); continue;
    }
    job.todo.shift(); job.done++; n++;
    if (res.headers.get('x-ratelimit-remaining') === '0') await sleep(Number(res.headers.get('x-ratelimit-reset-after') || 1) * 1000);
  }
  await store().setJSON('backfill', job);
  return { done: job.done, total: job.total, now: n };
}

async function backfillStatus() { return store().get('backfill', { type: 'json' }); }
async function saveState(s) { await store().setJSON('state', s); }

function rulesPanel() {
  return {
    embeds: [{
      color: 0x1f6bff,
      title: SERVER_RULES.title,
      thumbnail: { url: `${process.env.URL}/blue-dragons-logo.png` },
      fields: [...SERVER_RULES.sections.map(([name, value]) => ({ name, value })), { name: '\u200b', value: SERVER_RULES.outro }],
      footer: { text: 'Mit dem Button bestätigst du, dass du die Regeln gelesen hast und einhältst.' },
    }],
    components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Regeln akzeptieren', emoji: { name: '✅' }, custom_id: 'srules:ok' }] }],
  };
}

/** Darf diese Person Rollen wählen? Bestehende Mitglieder: ja. Neue: erst nach dem Akzeptieren. */
async function mayChooseRoles(member) {
  const st = await getState();
  if (!st.since) return { ok: true }; // Regel-Panel noch nie gepostet → keine Pflicht
  const uid = member?.user?.id;
  if (st.accepted[uid]) return { ok: true };
  if (st.roleId && (member?.roles || []).includes(st.roleId)) return { ok: true };
  const joined = member?.joined_at ? Date.parse(member.joined_at) : 0;
  if (joined && joined < st.since) return { ok: true }; // schon vorher auf dem Server
  return { ok: false, channelId: st.channelId };
}

async function markPosted(channelId, guildId) {
  const st = await getState();
  const first = !st.since;
  if (first) st.since = Date.now();
  st.channelId = channelId;
  const role = await verifyRole(guildId, { create: true });
  if (role) st.roleId = role.id;
  await saveState(st);
  let queued = null;
  if (first && role) queued = await queueBackfill(guildId, st.since, role.id);
  return { ...st, first, role, queued };
}

async function accept(uid, guildId) {
  const st = await getState();
  const already = !!st.accepted[uid];
  st.accepted[uid] = Date.now();
  await saveState(st);
  let roleOk = true;
  if (st.roleId) roleOk = (await giveRole(guildId, uid, st.roleId)).ok;
  return { already, roleOk, count: Object.keys(st.accepted).length };
}

module.exports = { SERVER_RULES, rulesPanel, mayChooseRoles, markPosted, accept, processBackfill, backfillStatus, getState };
