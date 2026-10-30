// Tester-Bewerbung als Ticket: privater Kanal mit Fragen, Admin nimmt an oder lehnt ab.
const { getStore } = require('@netlify/blobs');

// ---------- Infoblatt (hier selbst bearbeiten) ----------
// Wird als Formular (2 Teile, Discord erlaubt max. 5 Felder pro Formular) ausgefüllt.
// style 1 = einzeilig, 2 = mehrzeilig
const INFO_PARTS = [
  [
    { id: 'name', label: 'Name', style: 1 },
    { id: 'plattform', label: 'Plattform', style: 1 },
    { id: 'aktiv', label: 'Aktivität (Tage)', style: 1 },
    { id: 'psn', label: 'PSN (ID)', style: 1 },
    { id: 'hp', label: 'HP (Hauptposition)', style: 1 },
  ],
  [
    { id: 'np', label: 'NP (Nebenposition)', style: 1 },
    { id: 'erfahrung', label: 'Erfahrung', style: 2 },
    { id: 'clubs', label: 'Letzte ex-Clubs', style: 2 },
    { id: 'testtage', label: 'Mögliche Testtage', style: 1 },
  ],
];
const INFO_FIELDS = INFO_PARTS.flat();
const TESTER_QUESTIONS = INFO_FIELDS.map((f) => `${f.label}:`);
const INFO_CHANNEL_ID = '1565800045670830112'; // ausgefüllte Infoblätter landen zusätzlich hier
const ARCHIVE_CHANNEL = 'ticket-archiv'; // hier landen geschlossene Tickets
const TICKET_CATEGORY = 'Tickets'; // Kategorie für die Ticket-Kanäle (wird genutzt, wenn es sie gibt)
const ADMIN_ROLE_NAMES = ['owner', 'admin', 'head vm', 'kapitän', 'kapitan', 'captain', 'vorstand', 'moderator'];

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const EMBED = 1n << 14n;
const ATTACH = 1n << 15n;
const HISTORY = 1n << 16n;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;
const USER_ALLOW = (VIEW | SEND | ATTACH | EMBED | HISTORY).toString();
const APPLICANT_ALLOW = (VIEW | HISTORY).toString(); // Bewerber kann nicht schreiben, nur das Formular nutzen
const APPLICANT_DENY = SEND.toString();

const API = 'https://discord.com/api/v10';
function api(path, opts = {}) {
  return fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

function ticketStore() {
  return getStore({ name: 'tickets', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

function slug(name) {
  return String(name || 'spieler').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'spieler';
}

function ticketMessage(userId) {
  const sheet = '```\n' + INFO_FIELDS.map((f) => `${f.label}:`).join('\n') + '\n```';
  return {
    content: `<@${userId}>`,
    allowed_mentions: { users: [userId] },
    embeds: [
      {
        title: '🧪 TESTER-BEWERBUNG',
        description: `Willkommen! Klick unten auf **📋 Infoblatt ausfüllen** und füll beide Teile aus.\nEin Admin schaut es sich an und meldet sich.\n\n**Abgefragt wird:**\n${sheet}`,
        color: 0x1f6bff,
        thumbnail: { url: `${process.env.URL || ''}/blue-dragons-logo.png` },
        footer: { text: 'United by Blue Fire 🐉 · Annehmen/Ablehnen nur für Admins' },
      },
    ],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 1, label: 'Infoblatt ausfüllen', emoji: { name: '📋' }, custom_id: `ticket:form1:${userId}` }],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Annehmen', emoji: { name: '✅' }, custom_id: `ticket:accept:${userId}` },
          { type: 2, style: 4, label: 'Ablehnen', emoji: { name: '❌' }, custom_id: `ticket:reject:${userId}` },
          { type: 2, style: 2, label: 'Ticket schließen', emoji: { name: '🔒' }, custom_id: `ticket:close:${userId}` },
        ],
      },
    ],
  };
}

// ---------- Infoblatt-Formular ----------
function infoStore() {
  return getStore({ name: 'tester-infoblatt', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}
const infoKey = (guildId, userId) => `info-${guildId}-${userId}`;

async function getInfo(guildId, userId) {
  return (await infoStore().get(infoKey(guildId, userId), { type: 'json' })) || {};
}

function buildInfoModal(part, userId, existing = {}) {
  const fields = INFO_PARTS[part - 1];
  return {
    type: 9,
    data: {
      custom_id: `ticketform:${part}:${userId}`,
      title: `Infoblatt (${part}/${INFO_PARTS.length})`,
      components: fields.map((f) => ({
        type: 1,
        components: [
          {
            type: 4,
            custom_id: f.id,
            label: f.label,
            style: f.style,
            required: true,
            max_length: f.style === 2 ? 400 : 100,
            ...(existing[f.id] ? { value: existing[f.id] } : {}),
          },
        ],
      })),
    },
  };
}

// Formular-Antworten speichern, gibt den Gesamtstand zurück
async function saveInfoPart(guildId, userId, modalComponents) {
  const info = await getInfo(guildId, userId);
  (modalComponents || []).forEach((row) => (row.components || []).forEach((c) => (info[c.custom_id] = String(c.value || '').trim())));
  await infoStore().setJSON(infoKey(guildId, userId), info);
  return info;
}

function infoText(info) {
  return INFO_FIELDS.map((f) => `${f.label}: ${info[f.id] || '–'}`).join('\n');
}

// Infoblatt zusätzlich in den Infoblatt-Kanal schicken
async function postInfoToChannel(userId, info, updated, ticketChannelId) {
  const embed = infoEmbed(userId, info, updated);
  if (ticketChannelId) embed.description += ` · Ticket: <#${ticketChannelId}>`;
  const res = await api(`/channels/${INFO_CHANNEL_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) console.error('infoblatt-kanal:', res.status, await res.text());
  return res.ok;
}

function infoEmbed(userId, info, updated) {
  return {
    title: `📋 INFOBLATT${updated ? ' (aktualisiert)' : ''}`,
    description: `von <@${userId}>`,
    color: 0xf2c14e,
    fields: INFO_FIELDS.map((f) => ({ name: f.label, value: (info[f.id] || '–').slice(0, 1000), inline: f.style === 1 })),
    footer: { text: 'United by Blue Fire 🐉' },
  };
}

// Erstellt den Ticket-Kanal (oder gibt den bestehenden zurück). Rückgabe: { channelId, existing } oder { error }
async function openTesterTicket(interaction, roles) {
  const guildId = interaction.guild_id;
  const user = interaction.member?.user || {};
  const store = ticketStore();
  const key = `tester-${guildId}-${user.id}`;

  const known = await store.get(key, { type: 'json' });
  if (known?.channelId) {
    const check = await api(`/channels/${known.channelId}`);
    if (check.ok) return { channelId: known.channelId, existing: true };
    await store.delete(key);
  }

  const channelsRes = await api(`/guilds/${guildId}/channels`);
  const channels = channelsRes.ok ? await channelsRes.json() : [];
  const category = channels.find((c) => c.type === 4 && c.name.toLowerCase() === TICKET_CATEGORY.toLowerCase());

  const overwrites = [
    { id: guildId, type: 0, deny: VIEW.toString() }, // @everyone sieht nichts
    { id: user.id, type: 1, allow: APPLICANT_ALLOW, deny: APPLICANT_DENY },
    { id: interaction.application_id, type: 1, allow: USER_ALLOW }, // der Bot selbst
  ];
  roles
    .filter((r) => {
      const perms = BigInt(r.permissions || '0');
      return ADMIN_ROLE_NAMES.includes(String(r.name).toLowerCase()) || (perms & (MANAGE_GUILD | ADMINISTRATOR));
    })
    .filter((r) => r.id !== guildId && !r.managed)
    .forEach((r) => overwrites.push({ id: r.id, type: 0, allow: USER_ALLOW }));

  const createRes = await api(`/guilds/${guildId}/channels`, {
    method: 'POST',
    body: JSON.stringify({
      name: `tester-${slug(user.global_name || user.username)}`,
      type: 0,
      topic: `Tester-Bewerbung von ${user.global_name || user.username}`,
      ...(category ? { parent_id: category.id } : {}),
      permission_overwrites: overwrites,
    }),
  });
  if (!createRes.ok) {
    console.error('ticket create:', createRes.status, await createRes.text());
    return { error: 'Ticket konnte nicht erstellt werden. Der Bot braucht das Recht **„Kanäle verwalten“**.' };
  }
  const channel = await createRes.json();
  await api(`/channels/${channel.id}/messages`, { method: 'POST', body: JSON.stringify(ticketMessage(user.id)) });
  await store.setJSON(key, { channelId: channel.id, userId: user.id, createdAt: Date.now() });
  return { channelId: channel.id, existing: false };
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Alle Nachrichten des Kanals laden (älteste zuerst)
async function fetchAllMessages(channelId) {
  const all = [];
  let before = '';
  for (let i = 0; i < 5; i++) {
    const res = await api(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
    if (!res.ok) break;
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
    before = batch[batch.length - 1].id;
  }
  return all.reverse();
}

// Ticket ins Archiv posten (Zusammenfassung + komplettes Protokoll als .txt) und Kanal löschen
async function archiveAndCloseTicket(guildId, applicantId, channelId, closedBy) {
  const channelsRes = await api(`/guilds/${guildId}/channels`);
  const channels = channelsRes.ok ? await channelsRes.json() : [];
  const archive = channels.find((c) => c.type === 0 && c.name.toLowerCase() === ARCHIVE_CHANNEL);
  if (!archive) return { error: `Es gibt keinen Kanal **#${ARCHIVE_CHANNEL}**. Bitte anlegen, dann nochmal schließen.` };

  const ticketChannel = channels.find((c) => c.id === channelId);
  const messages = await fetchAllMessages(channelId);

  // Status aus dem Bewerbungs-Embed lesen
  const botMsg = messages.find((m) => m.embeds?.[0]?.title?.includes('TESTER-BEWERBUNG'));
  const statusField = botMsg?.embeds?.[0]?.fields?.find((f) => f.name === 'Status');
  const status = statusField ? statusField.value.split(' – ')[0] : '⏳ Offen (nicht entschieden)';
  const color = status.startsWith('✅') ? 0x248046 : status.startsWith('❌') ? 0xda373c : 0x4e5058;

  // Antworten des Bewerbers
  const info = await getInfo(guildId, applicantId);
  const answers = INFO_FIELDS.some((f) => info[f.id]) ? infoText(info) : '';

  // Protokoll als Text
  const lines = messages.map((m) => {
    const who = m.author?.global_name || m.author?.username || 'Unbekannt';
    let text = m.content || '';
    if (m.embeds?.length) text += (text ? ' ' : '') + m.embeds.map((e) => `[Embed: ${e.title || ''}${e.fields?.length ? ' · ' + e.fields.map((f) => f.value).join(' · ') : ''}]`).join(' ');
    if (m.attachments?.length) text += ' ' + m.attachments.map((a) => `[Datei: ${a.url}]`).join(' ');
    return `[${fmtTime(m.timestamp)}] ${who}: ${text}`;
  });
  const transcript = [
    `Ticket: #${ticketChannel?.name || channelId}`,
    `Bewerber-ID: ${applicantId}`,
    `Status: ${status}`,
    `Geschlossen von: ${closedBy} am ${fmtTime(new Date().toISOString())}`,
    '-'.repeat(50),
    ...lines,
  ].join('\n');

  const embed = {
    title: `🗂️ Archiv · #${ticketChannel?.name || 'ticket'}`,
    color,
    fields: [
      { name: 'Bewerber', value: `<@${applicantId}>`, inline: true },
      { name: 'Status', value: status, inline: true },
      { name: 'Geschlossen von', value: closedBy, inline: true },
      { name: '📋 Infoblatt / Antworten', value: (answers || '_Infoblatt nicht ausgefüllt_').slice(0, 1000) },
    ],
    footer: { text: `${messages.length} Nachrichten · komplettes Protokoll im Anhang` },
    timestamp: new Date().toISOString(),
  };

  const form = new FormData();
  form.append('payload_json', JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: 'protokoll.txt' }] }));
  form.append('files[0]', new Blob([transcript], { type: 'text/plain' }), 'protokoll.txt');
  const post = await fetch(`${API}/channels/${archive.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
    body: form,
  });
  if (!post.ok) {
    console.error('archiv:', post.status, await post.text());
    return { error: `Konnte nicht in **#${ARCHIVE_CHANNEL}** posten. Der Bot braucht dort „Kanal ansehen“, „Nachrichten senden“ und „Dateien anhängen“.` };
  }

  await ticketStore().delete(`tester-${guildId}-${applicantId}`);
  await infoStore().delete(infoKey(guildId, applicantId));
  await api(`/channels/${channelId}`, { method: 'DELETE' });
  return { ok: true };
}

module.exports = { TESTER_QUESTIONS, INFO_PARTS, openTesterTicket, archiveAndCloseTicket, getInfo, buildInfoModal, saveInfoPart, infoEmbed, postInfoToChannel, api };
