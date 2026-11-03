// /serverkontaktpersonen – übersichtliche Kontakt-Nachricht, die Admins abschnittsweise bearbeiten können
// Namen mit @ davor (z. B. @Robii92) werden beim Speichern automatisch mit dem Discord-Mitglied verlinkt.
const { getStore } = require('@netlify/blobs');
const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' });
const store = () => getStore({ name: 'contacts', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
const LINE = '━━━━━━━━━━━━━━━━━━━━';

const DEFAULT = [
  { key: 'intro', color: 0x1e90ff, title: '🌍 COMMUNITY WORLD 🌍', body: '## 🏅 OFFIZIELLE SERVER-KONTAKTPERSONEN 🏅\nWillkommen im Management-Bereich von **Community World**!\n\nHier findet ihr alle verantwortlichen Ansprechpartner für **Serverleitung, Administration, Pro Clubs und Community-Anliegen**.\n\nBitte wendet euch bei Fragen oder Problemen direkt an die jeweils zuständige Person.' },
  { key: 'ceo', color: 0xf2c14e, title: '👑 CEO & DISCORD FOUNDERS 👑', body: '**@Robii92** & **@BlackSeaGamer**\n*Unsere Head Owner und oberste Entscheidungsinstanz.*\n\n**Verantwortlich für:**\n• Gesamtleitung und Weiterentwicklung von Community World\n• Grundlegende Entscheidungen und Serverstruktur\n• Beschwerdemanagement und übergeordnete Konfliktlösungen' },
  { key: 'admin', color: 0x9b59b6, title: '🛠️ SERVER ADMINISTRATION 🛠️', body: '**@Robii92**\n• Pro Clubs Owner – CW BlueDragons\n\n**@BlackSeaGamer**\n• Pro Clubs Owner – BlackSea Lions\n• Ultimate Team Events & Cups Manager\n\n**@Yshlaifton** & **@Musti**\n• Discord-Aufbau und Weiterentwicklung\n• Technische Serverstruktur und Optimierung\n\n**@Kenny**\n• Allgemeine Discord-Verwaltung und Administration' },
  { key: 'bd', color: 0x2f7bff, title: '⚽ PRO CLUBS – CW BLUEDRAGONS ⚽', body: '**Vorstand:** @Robii92\n**Co-Vorstand:** @Schrott75\n\n**Teammanagement:**\n• Head VM: @Albin\n• Co-VM: @Timo\n• Spielerrat: @Yusuf\n\n**Zuständig für:**\n• Kaderplanung, Transfers und Vertragswesen\n• Sportliche Leitung und Spieltagsorganisation\n• Teamkommunikation und interne Abläufe\n\n**Spielerrat – Aufgaben:**\n• Schnittstelle zwischen Spielern und Management\n• Ansprechpartner und Unterstützung für die Spieler\n• Beratung bei Anliegen und Problemen\n• Aufnahme, Weiterleitung und Vermittlung von Spielerfeedback\n• Vertretung der Interessen der Mannschaft gegenüber dem Management\n\n**📋 Tester-Bewerbungen:**\nTester-Bewerbungen erfolgen ausschließlich über das **Ticketsystem**.\n➡️ Im Tester-Panel auf den roten Button **„Tester werden“** klicken und anschließend das Ticket nutzen.' },
  { key: 'bsl', color: 0x1abc9c, title: '⚽ PRO CLUBS – BLACKSEA LIONS ⚽', body: '**Vorstand:** @BlackSeaGamer\n**Head VM:** @BlackSeaGamer\n\n**Zuständig für:**\n• Kaderplanung und Spielerverwaltung\n• Sportliche Leitung und Teamorganisation\n• Transfers, Verträge und Spieltagsabläufe' },
  { key: 'mod', color: 0xe67e22, title: '🛡️ MODERATOREN-TEAM 🛡️', body: '**Aktuelle Moderatoren:**\n• @Robii92\n• @BlackSeaGamer\n• @Kenny\n\n**Zuständigkeitsbereiche:**\n• Regelüberwachung und Einhaltung der Serverordnung\n• Turnieraufsicht\n• Support und Community-Anliegen\n• Konfliktmanagement' },
  { key: 'contact', color: 0x5865f2, title: '📩 KONTAKTSTRUKTUR 📩', body: '🎮 **Spielbezogene Fragen:**\n➡️ An den jeweiligen Pro-Clubs-Verantwortlichen oder Event-Manager.\n\n🛠️ **Technische und organisatorische Themen:**\n➡️ An die zuständigen Server Admins.\n\n⚠️ **Beschwerden und Konflikte:**\n➡️ An das Moderatoren-Team oder direkt an die Head Owner.\n\n💬 **Allgemeine Anliegen:**\n➡️ An das Moderatoren-Team.' },
  { key: 'outro', color: 0x1e90ff, title: '🌍 COMMUNITY WORLD', body: 'Wir stehen für **Fairplay, Zusammenhalt, Professionalität** und eine starke Gaming-Community.\n\n***We connect the players.*** 🚀' },
];

async function getState() { return (await store().get('state', { type: 'json' })) || { sections: DEFAULT, channelId: null, messageId: null, links: {} }; }
async function saveState(s) { await store().setJSON('state', s); }

/** „@Name“ → <@id>, wenn es ein passendes Mitglied gibt (Nickname ohne „| …“, globaler Name oder Benutzername) */
async function linkNames(guildId, text, links = {}) {
  const tokens = [...new Set([...String(text).matchAll(/@([\p{L}\p{N}_.]{2,32})/gu)].map((m) => m[1]))];
  if (!tokens.length) return { text, links };
  let members = [];
  try { const r = await fetch(`${API}/guilds/${guildId}/members?limit=1000`, { headers: auth() }); members = r.ok ? await r.json() : []; } catch { /* ohne Verlinkung */ }
  const out = { ...links };
  for (const t of tokens) {
    const k = norm(t);
    const m = members.find((x) => [String(x.nick || '').split('|')[0], x.user?.global_name, x.user?.username].some((n) => norm(n) === k));
    if (m) out[k] = { id: m.user.id, n: t };
  }
  const replaced = String(text).replace(/@([\p{L}\p{N}_.]{2,32})/gu, (all, t) => (out[norm(t)] ? `<@${out[norm(t)].id}>` : all));
  return { text: replaced, links: out };
}

/** Für das Bearbeiten-Formular: <@id> wieder als @Name anzeigen */
function unlink(text, links = {}) {
  const byId = Object.fromEntries(Object.values(links).map((v) => [v.id, v.n]));
  return String(text).replace(/<@!?(\d+)>/g, (all, id) => (byId[id] ? `@${byId[id]}` : all));
}

function message(state) {
  const embeds = state.sections.map((s, i) => ({
    color: s.color,
    title: s.title,
    description: s.body.slice(0, 4000),
    ...(i === 0 ? { thumbnail: { url: `${process.env.URL}/cw-community-logo.png` } } : {}),
    ...(i === state.sections.length - 1 ? { footer: { text: `${LINE}\nCommunity World · Stand` }, timestamp: new Date().toISOString() } : {}),
  }));
  return {
    embeds,
    allowed_mentions: { parse: [] },
    components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Bearbeiten (Admin)', emoji: { name: '✏️' }, custom_id: 'contact:edit' }] }],
  };
}

async function post(guildId, channelId) {
  const st = await getState();
  // Namen beim ersten Posten verlinken
  for (const s of st.sections) { const r = await linkNames(guildId, s.body, st.links); s.body = r.text; st.links = r.links; }
  const res = await fetch(`${API}/channels/${channelId}/messages`, { method: 'POST', headers: auth(), body: JSON.stringify(message(st)) });
  if (!res.ok) throw new Error(`Konnte nicht posten (${res.status}) – der Bot braucht „Nachrichten senden“ und „Links einbetten“.`);
  st.channelId = channelId; st.messageId = (await res.json()).id;
  await saveState(st);
  return st;
}

async function update(guildId, key, title, body) {
  const st = await getState();
  const sec = st.sections.find((s) => s.key === key);
  if (!sec) throw new Error('Diesen Abschnitt gibt es nicht.');
  const r = await linkNames(guildId, body, st.links);
  sec.title = title || sec.title; sec.body = r.text; st.links = r.links;
  await saveState(st);
  if (st.messageId) await fetch(`${API}/channels/${st.channelId}/messages/${st.messageId}`, { method: 'PATCH', headers: auth(), body: JSON.stringify(message(st)) });
  return st;
}

module.exports = { getState, post, update, unlink, linkNames, message, DEFAULT };
