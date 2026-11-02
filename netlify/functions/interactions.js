const nacl = require('tweetnacl');
const { getStore } = require('@netlify/blobs');
const { remindEvent, listMissing } = require('./lib/reminder-core');
const {
  berlinToUtcTimestamp,
  getTopRoleName,
  buildEmbed,
  buildComponents,
} = require('./lib/event-core');
const { sessionStore, getSession, saveSession, newSession } = require('./lib/session-core');
const { INFO_PARTS, openTesterTicket, archiveAndCloseTicket, getInfo, buildInfoModal, saveInfoPart, infoEmbed, postInfoToChannel } = require('./lib/ticket-core');
const {
  lineupStore, lineupKey, emptyLineup, getLineup, saveLineup, requestLineupPublish, requestLineupRepublish, parseKickoff,
  switchFormation, autoFill, lineupEmbed, lineupComponents, requestLineupRefresh, FORMATION_NAMES,
} = require('./lib/lineup-core');
const { getGroups, setGroups, POS_GROUP,
  KADER_TEAMS,
  api: discordApi,
  getGuildRoles,
  findKaderRole,
  isKaderAdmin,
  getNumbers,
  setNumbers,
  getKaderPlayers,
  buildKaderEmbed,
  kaderComponents,
  requestKaderRefresh,
} = require('./lib/kader-core');

// ---------- Signatur-Prüfung (Pflicht laut Discord) ----------
function verifySignature(event) {
  const signature = event.headers['x-signature-ed25519'];
  const timestamp = event.headers['x-signature-timestamp'];
  const rawBody = event.body || '';
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp || !publicKey) return false;

  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody),
      Buffer.from(signature, 'hex'),
      Buffer.from(publicKey, 'hex')
    );
  } catch {
    return false;
  }
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

// Wandelt Jahr/Monat/Tag/Stunde/Minute, gedacht als deutsche Ortszeit (Europe/Berlin,
// inkl. automatischer Sommer-/Winterzeit-Erkennung), in einen korrekten UTC-Unix-Timestamp um.
// -> jetzt in ./lib/event-core.js, hier nur noch importiert (siehe oben)

// Rollen, die in Bot-Anzeigen nie als "Top-Rolle" berücksichtigt werden sollen
// -> jetzt in ./lib/event-core.js, hier nur noch importiert (siehe oben)

// Wer eine dieser Rollen hat, wird in der "Wer fehlt"-Liste komplett übersprungen (kann aber weiterhin abstimmen)
// -> jetzt in ./lib/event-core.js

// ---------- /aufstellung (3-5-2, als Text) ----------
const POSITION_CODES = ['TW', 'LIV', 'ZIV', 'RIV', 'LM', 'RM', 'ZDM', 'ZOM', 'LS', 'RS'];

function parseAufstellungInput(input) {
  const codes = POSITION_CODES.slice().sort((a, b) => b.length - a.length);
  const codePattern = codes.join('|');
  const regex = new RegExp(`(${codePattern})\\s*:\\s*([^:]*?)(?=\\s+(?:${codePattern})\\s*:|$)`, 'g');

  const occurrences = {};
  let match;
  while ((match = regex.exec(input)) !== null) {
    const code = match[1];
    const name = match[2].trim();
    if (!name) continue;
    if (!occurrences[code]) occurrences[code] = [];
    occurrences[code].push(name);
  }

  const result = {};
  for (const [code, names] of Object.entries(occurrences)) {
    if (code === 'ZDM') {
      if (names[0]) result.ZDM = names[0];
      if (names[1]) result.ZDM2 = names[1];
    } else {
      result[code] = names[0];
    }
  }
  return result;
}

function fmtLine(players, codes) {
  const labelFor = (c) => (c === 'ZDM2' ? 'ZDM' : c);
  return codes.map((c) => `**${labelFor(c)}:** ${players[c] || '—'}`).join('   ');
}

async function handleAufstellungCommand(interaction) {
  const opts = {};
  for (const o of interaction.data.options || []) opts[o.name] = o.value;

  const players = parseAufstellungInput(opts.spieler || '');
  const creator =
    interaction.member?.nick || interaction.member?.user?.username || interaction.user?.username || 'Unbekannt';

  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: opts.titel || 'Aufstellung (3-5-2)',
          color: 0x1f6bff,
          fields: [
            { name: '🔺 Sturm', value: fmtLine(players, ['LS', 'RS']) },
            { name: '↔️ Flügel', value: fmtLine(players, ['LM', 'RM']) },
            {
              name: '🔸 Mittelfeld',
              value: `**ZDM:** ${players.ZDM || '—'}   **ZOM:** ${players.ZOM || '—'}   **ZDM:** ${players.ZDM2 || '—'}`,
            },
            { name: '🔹 Abwehr', value: fmtLine(players, ['LIV', 'ZIV', 'RIV']) },
            { name: '🥅 Tor', value: fmtLine(players, ['TW']) },
          ],
          footer: { text: `Erstellt von ${creator}` },
        },
      ],
    },
  });
}

// ---------- /aufstellungvorschlag (automatisch anhand HP-Tags im Nickname) ----------
async function handleAufstellungVorschlagCommand(interaction) {
  const guildId = interaction.guild_id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const membersRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
    headers: authHeader,
  });
  if (!membersRes.ok) {
    return json(200, { type: 4, data: { content: 'Konnte Mitgliederliste nicht laden.', flags: 64 } });
  }
  const members = await membersRes.json();

  let pool = members
    .filter((m) => !m.user?.bot)
    .map((m) => {
      const nick = m.nick || m.user?.username || 'Unbekannt';
      const baseName = nick.split('|')[0].trim();
      const hpMatch = nick.match(/HP:\s*([A-ZÄÖÜ,0-9]+)/);
      const hp = hpMatch ? hpMatch[1].split(',').filter(Boolean) : [];
      return { id: m.user.id, name: baseName, hp };
    })
    .filter((p) => p.hp.length > 0);

  const slots = ['TW', 'LIV', 'ZIV', 'RIV', 'ZDM', 'ZDM', 'ZOM', 'LM', 'RM', 'LS', 'RS'];
  const assigned = {};
  let zdmCount = 0;

  for (const code of slots) {
    const idx = pool.findIndex((p) => p.hp.includes(code));
    let name = '—';
    if (idx !== -1) {
      name = pool[idx].name;
      pool.splice(idx, 1);
    }
    if (code === 'ZDM') {
      zdmCount += 1;
      assigned[zdmCount === 1 ? 'ZDM' : 'ZDM2'] = name;
    } else {
      assigned[code] = name;
    }
  }

  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: 'Aufstellungsvorschlag (3-5-2)',
          color: 0x1f6bff,
          fields: [
            { name: '🔺 Sturm', value: fmtLine(assigned, ['LS', 'RS']) },
            { name: '↔️ Flügel', value: fmtLine(assigned, ['LM', 'RM']) },
            {
              name: '🔸 Mittelfeld',
              value: `**ZDM:** ${assigned.ZDM || '—'}   **ZOM:** ${assigned.ZOM || '—'}   **ZDM:** ${assigned.ZDM2 || '—'}`,
            },
            { name: '🔹 Abwehr', value: fmtLine(assigned, ['LIV', 'ZIV', 'RIV']) },
            { name: '🥅 Tor', value: fmtLine(assigned, ['TW']) },
          ],
          footer: { text: 'Automatisch vorgeschlagen anhand der HP-Positionen (/position hp)' },
        },
      ],
    },
  });
}

// ---------- Höchste Rolle, "Wer fehlt", buildEmbed/buildComponents ----------
// -> jetzt alle in ./lib/event-core.js, hier oben importiert

// ---------- Slash-Command /event ----------
async function handleCreateEvent(interaction, store, { postToChannel = false } = {}) {
  const opts = {};
  for (const o of interaction.data.options || []) opts[o.name] = o.value;

  const [day, month, year] = opts.datum.split('.').map(Number);
  const [hour, minute] = opts.uhrzeit.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);

  if (isNaN(date.getTime())) {
    return json(200, {
      type: 4,
      data: { content: 'Datum oder Uhrzeit ungültig. Format: TT.MM.JJJJ und HH:MM', flags: 64 },
    });
  }

  const creator =
    interaction.member?.nick || interaction.member?.user?.username || interaction.user?.username || 'Unbekannt';

  const imageUrl = opts.bild ? interaction.data.resolved?.attachments?.[opts.bild]?.url || null : null;

  const eventId = interaction.id;
  const ev = {
    title: opts.titel,
    flag: opts.info || '',
    beschreibung: opts.beschreibung || '',
    limit: opts.limit,
    timestamp: berlinToUtcTimestamp(year, month, day, hour, minute),
    creator,
    creatorId: interaction.member?.user?.id || interaction.user?.id || null,
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    imageUrl,
    team: opts.mannschaft || null,
    anonym: !!opts.anonym,
    accepted: [],
    maybe: [],
    declined: [],
    reminderSent: false, // Erinnerung 2h vor Termin wurde noch nicht verschickt
    messageId: null,     // wird gleich nach dem Posten nachgetragen (für @-Erinnerung im Kanal)
  };

  await store.setJSON(eventId, ev);

  if (postToChannel) {
    const res = await fetch(`https://discord.com/api/v10/channels/${ev.channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [await buildEmbed(ev)], components: buildComponents(eventId) }),
    });
    if (!res.ok) { await store.delete(eventId); return ephemeral('⚠️ Konnte hier nicht posten – der Bot braucht „Nachrichten senden“ und „Links einbetten“.'); }
    ev.messageId = (await res.json()).id;
    await store.setJSON(eventId, ev);
    return ephemeral(`✅ ${ev.anonym ? 'Anonyme Umfrage' : 'Event'} **${ev.title}** ist gepostet.`);
  }

  // Nachricht-ID nachtragen: die /event-Antwort selbst liefert sie nicht, daher @original abfragen
  (async () => {
    try {
      const res = await fetch(
        `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`
      );
      if (res.ok) {
        const msg = await res.json();
        const fresh = await store.get(eventId, { type: 'json' });
        if (fresh) {
          fresh.messageId = msg.id;
          await store.setJSON(eventId, fresh);
        }
      }
    } catch (_) {
      // nicht schlimm – die @-Erinnerung im Kanal fällt dann nur weg, die DMs gehen trotzdem
    }
  })();

  return json(200, {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: { embeds: [await buildEmbed(ev)], components: buildComponents(eventId) },
  });
}

// ---------- Button-Klick ----------
async function handleButton(interaction, store) {
  const [prefix, action, eventId] = interaction.data.custom_id.split(':');
  if (prefix !== 'rsvp') return json(400, { error: 'unknown component' });

  const ev = await store.get(eventId, { type: 'json' });
  if (!ev) {
    return json(200, {
      type: 4,
      data: { content: 'Dieses Event ist nicht mehr verfügbar.', flags: 64 },
    });
  }

  // Admin-Button: Liste der Nicht-Abstimmer (nur für den Admin sichtbar)
  if (action === 'missing') {
    if (!(await isKaderAdmin(interaction))) {
      return json(200, { type: 4, data: { content: '⛔ Nur Admins können das sehen.', flags: 64 } });
    }
    const r = await listMissing(interaction.guild_id, ev);
    if (r.error) return json(200, { type: 4, data: { content: '⚠️ ' + r.error, flags: 64 } });
    const teamLabel = ev.team ? ` (${ev.team})` : '';
    const content = r.names.length === 0
      ? `✅ Alle haben abgestimmt${teamLabel}.`
      : `❔ Noch nicht abgestimmt${teamLabel} (${r.names.length}):\n` + r.names.map((n) => `• ${n}`).join('\n');
    return json(200, { type: 4, data: { content: content.slice(0, 1900), flags: 64 } });
  }

  // Admin-Button: Erinnerung sofort an alle ohne Stimme senden
  if (action === 'remind') {
    if (!(await isKaderAdmin(interaction))) {
      return json(200, { type: 4, data: { content: '⛔ Nur Admins können die Erinnerung senden.', flags: 64 } });
    }
    const r = await remindEvent(interaction.guild_id, ev, { markAsSent: false });
    if (r.error) return json(200, { type: 4, data: { content: '⚠️ ' + r.error, flags: 64 } });
    const extra = r.noDm ? ` (${r.noDm} ohne offene DMs – im Kanal erwähnt)` : '';
    return json(200, {
      type: 4,
      data: { content: r.total === 0 ? '✅ Alle haben schon abgestimmt – keine Erinnerung nötig.' : `⏰ Erinnerung an ${r.total} Spieler gesendet${extra}.`, flags: 64 },
    });
  }

  const member = interaction.member;
  const rawNick = member?.nick || member?.user?.username || interaction.user?.username || 'Unbekannt';
  const hpMatch = rawNick.match(/HP:\s*([A-ZÄÖÜ,0-9]+)/);
  const position = hpMatch ? hpMatch[1].split(',')[0] : null;
  const roleName = await getTopRoleName(interaction.guild_id, member?.roles);
  const combinedRole = [roleName, position].filter(Boolean).join(', ');
  const user = {
    id: member?.user?.id || interaction.user?.id,
    name: rawNick.split('|')[0].trim(),
    displayName: rawNick.trim(), // voller Nickname für die Anzeige im Embed
    role: combinedRole || null,
    votedAt: Date.now(),
  };

  const inAccepted = ev.accepted.some((u) => u.id === user.id);
  const inDeclined = ev.declined.some((u) => u.id === user.id);

  ev.accepted = ev.accepted.filter((u) => u.id !== user.id);
  ev.declined = ev.declined.filter((u) => u.id !== user.id);
  if (Array.isArray(ev.maybe)) ev.maybe = ev.maybe.filter((u) => u.id !== user.id); // Altbestand aufräumen

  const wasAlreadySelected =
    (action === 'accept' && inAccepted) ||
    (action === 'decline' && inDeclined);

  if (!wasAlreadySelected && (action === 'accept' || action === 'decline')) {
    const list = action === 'accept' ? ev.accepted : ev.declined;
    list.push(user);
  }

  await store.setJSON(eventId, ev);

  return json(200, {
    type: 7, // UPDATE_MESSAGE
    data: { embeds: [await buildEmbed(ev)], components: buildComponents(eventId) },
  });
}


// ---------- Positions-Auswahl als Rolle (/position) ----------
// Klick vergibt die Rolle mit genau diesem Namen (z. B. "ZDM"), nochmal klicken entfernt sie.
// Der Nickname bleibt unverändert.
// Gruppen = Embed-Zeilen und Button-Reihen. style: 1 blau, 2 grau, 3 grün, 4 rot
const POSITION_GROUPS = [
  { title: 'Torwart', emoji: '🧤', style: 3, positions: ['TW'] },
  { title: 'Abwehr', emoji: '🛡️', style: 1, positions: ['LIV', 'ZIV', 'RIV'] },
  { title: 'Mittelfeld', emoji: '🎯', style: 2, positions: ['LM', 'ZDM', 'ZOM', 'RM'] },
  { title: 'Sturm', emoji: '⚽', style: 4, positions: ['ST'] },
];
const POSITIONS = POSITION_GROUPS.flatMap((g) => g.positions);

function buildPositionButtons() {
  return POSITION_GROUPS.map((g) => ({
    type: 1,
    components: g.positions.map((p) => ({
      type: 2,
      style: g.style,
      label: p,
      custom_id: `posrole:${p}`,
      ...(g.positions.length === 1 ? { emoji: { name: g.emoji } } : {}),
    })),
  }));
}

async function handlePositionCommand() {
  const list = POSITION_GROUPS.map((g) => `${g.emoji} **${g.title}** — ${g.positions.join(' · ')}`).join('\n');
  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: '🐉 BLUE DRAGONS · POSITIONEN',
          description: `Wähle, wo du spielst – du bekommst die passende Rolle.\nMehrere möglich, nochmal klicken entfernt sie.\n\n${list}`,
          color: 0x1f6bff,
          thumbnail: { url: `${brandBase()}/blue-dragons-logo.png` },
          footer: { text: 'United by Blue Fire 🐉' },
        },
      ],
      components: buildPositionButtons(),
    },
  });
}

async function handlePositionRoleButton(interaction) {
  const position = interaction.data.custom_id.split(':')[1];
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };
  const eph = (content) => json(200, { type: 4, data: { content, flags: 64 } });

  const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader });
  if (!rolesRes.ok) return eph('Konnte Rollen nicht laden.');
  const role = (await rolesRes.json()).find((r) => r.name === position);
  if (!role) return eph(`Es gibt noch keine Rolle **${position}** auf dem Server. Bitte zuerst anlegen (genau so geschrieben).`);

  const hasRole = (interaction.member?.roles || []).includes(role.id);
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${role.id}`, {
    method: hasRole ? 'DELETE' : 'PUT',
    headers: authHeader,
  });
  if (!res.ok) {
    return eph(`Konnte Rolle nicht ${hasRole ? 'entfernen' : 'vergeben'}. Die Bot-Rolle muss über **${position}** stehen und „Rollen verwalten“ dürfen.`);
  }
  return eph(hasRole ? `❌ Position **${position}** entfernt.` : `✅ Position **${position}** als Rolle bekommen.`);
}

async function handlePositionNickButton(interaction) {
  const [, prefix, position] = interaction.data.custom_id.split(':'); // posnick:HP:ZDM
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' };

  const currentNick = interaction.member?.nick || interaction.member?.user?.username || 'Unbekannt';
  const tags = parseNick(currentNick); // behält "BD Spieler" usw. bei

  const list = tags[prefix];
  const idx = list.indexOf(position);
  if (idx === -1) {
    list.push(position);
  } else {
    list.splice(idx, 1);
  }

  const newNick = buildNick(tags);
  const res = await setNick(guildId, userId, newNick);

  if (!res.ok) {
    return json(200, {
      type: 4,
      data: {
        content: `Konnte Nickname nicht ändern. Prüfe, ob der Bot "Nicknamen verwalten" darf und über dir in der Rollen-Reihenfolge steht. Server-Owner können per Bot generell nicht umbenannt werden (Discord-Beschränkung).`,
        flags: 64,
      },
    });
  }

  return json(200, {
    type: 4,
    data: { content: `✅ Nickname aktualisiert: **${newNick}**`, flags: 64 },
  });
}

// ---------- Rollen-Auswahl (/rolle) ----------
// name = exakter Rollenname auf dem Server, tag = Zusatz im Nickname (null = kein Zusatz)
// Reihenfolge = Priorität: hat jemand mehrere Rollen, steht nur die oberste im Nickname.
// label = Text auf Button und im Embed, style: 1 blau, 2 grau, 3 grün, 4 rot, row = Button-Reihe
const GENERAL_ROLES = [
  { name: 'Aushilfe', label: 'Aushilfe', tag: 'Aushilfe', emoji: '🤝', style: 3, row: 0 },
  { name: 'Tester', label: 'Tester', tag: 'Tester', emoji: '🧪', style: 1, row: 0 },
  { name: 'Late Night Spieler', label: 'Late Night', tag: null, emoji: '🌙', style: 2, row: 0 },
  { name: 'ProClubs Member', label: 'ProClubs Member', tag: null, emoji: '🎮', style: 1, row: 1 },
  { name: 'FUT Member', label: 'FUT Member', tag: null, emoji: '🃏', style: 1, row: 1 },
];
const ROLE_TAGS = GENERAL_ROLES.map((r) => r.tag).filter(Boolean);

// Nickname zerlegen: "Musti | BD Spieler | HP:ZDM | NP: IV" -> { base, tag, HP, NP }
function parseNick(nick) {
  const segs = String(nick || '').split('|').map((x) => x.trim()).filter(Boolean);
  const out = { base: segs[0] || 'Spieler', tag: null, HP: [], NP: [] };
  segs.slice(1).forEach((seg) => {
    const m = seg.match(/^(HP|NP):\s*([A-ZÄÖÜ,0-9]+)$/);
    if (m) out[m[1]] = m[2].split(',').filter(Boolean);
    else if (ROLE_TAGS.includes(seg)) out.tag = seg;
  });
  return out;
}

// Nickname wieder zusammensetzen (Discord erlaubt max. 32 Zeichen -> zuerst NP, dann HP weglassen)
function buildNick({ base, tag, HP, NP }) {
  const head = [base];
  if (tag) head.push(tag);
  const variants = [
    [...head, HP.length ? `HP:${HP.join(',')}` : null, NP.length ? `NP: ${NP.join(',')}` : null],
    [...head, HP.length ? `HP:${HP.join(',')}` : null],
    head,
  ];
  for (const v of variants) {
    const nick = v.filter(Boolean).join(' | ');
    if (nick.length <= 32) return nick;
  }
  return head.join(' | ').slice(0, 32);
}

async function setNick(guildId, userId, nick) {
  return fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nick }),
  });
}

function buildRoleComponents() {
  const rows = [];
  GENERAL_ROLES.forEach((r) => {
    rows[r.row] = rows[r.row] || { type: 1, components: [] };
    rows[r.row].components.push({ type: 2, style: r.style, label: r.label, emoji: { name: r.emoji }, custom_id: `genrole:${r.name}` });
  });
  return rows.filter(Boolean);
}

function brandBase() {
  return process.env.URL || 'https://DEIN-SITE-NAME.netlify.app';
}

async function handleRoleCommand() {
  const list = GENERAL_ROLES.map((r) => `${r.emoji} **${r.label}**`).join('\n');
  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: '🐉 BLUE DRAGONS · ROLLEN',
          description: `Hol dir deine Rolle per Klick – sie steht dann auch in deinem Namen.\nNochmal klicken entfernt sie.\n\n${list}`,
          color: 0x1f6bff,
          thumbnail: { url: `${brandBase()}/blue-dragons-logo.png` },
          footer: { text: 'United by Blue Fire 🐉' },
        },
      ],
      components: buildRoleComponents(),
    },
  });
}

async function handleRoleButton(interaction) {
  const roleName = interaction.data.custom_id.split(':')[1];
  const gate = await require('./lib/server-rules').mayChooseRoles(interaction.member);
  if (!gate.ok) {
    return json(200, { type: 4, data: { content: `📜 Bitte akzeptiere zuerst die **Server-Regeln**${gate.channelId ? ` in <#${gate.channelId}>` : ''} – danach kannst du dir hier deine Rollen holen.`, flags: 64 } });
  }
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader });
  if (!rolesRes.ok) {
    return json(200, { type: 4, data: { content: 'Konnte Rollen nicht laden.', flags: 64 } });
  }
  const roles = await rolesRes.json();
  // Exakter Name, sonst tolerant (Emojis/Schrift/Leerzeichen egal) – nie die Bot-Rolle
  const normR = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const role = roles.find((r) => r.name === roleName) || roles.find((r) => !r.managed && normR(r.name) === normR(roleName));

  if (!role) {
    return json(200, {
      type: 4,
      data: {
        content: `Es gibt noch keine Rolle namens "${roleName}" auf diesem Server. Bitte zuerst eine Rolle mit exakt diesem Namen anlegen.`,
        flags: 64,
      },
    });
  }

  const hasRole = (interaction.member?.roles || []).includes(role.id);

  // Tester gibt es nicht direkt: es öffnet sich ein Bewerbungs-Ticket (privater Kanal mit Infoblatt).
  // Beim „Annehmen“ im Ticket bekommt man Tester + Dragons Spieler und den Namen „Name | Tester“.
  if (roleName === 'Tester' && !hasRole) {
    const t = await openTesterTicket(interaction, roles);
    if (t.error) return json(200, { type: 4, data: { content: `⚠️ ${t.error}`, flags: 64 } });
    return json(200, {
      type: 4,
      data: {
        content: t.existing
          ? `🎫 Du hast schon ein offenes Ticket: <#${t.channelId}>`
          : `🎫 Dein Tester-Ticket ist offen: <#${t.channelId}>\nFüll dort das Infoblatt aus – ein Admin meldet sich.`,
        flags: 64,
      },
    });
  }

  const method = hasRole ? 'DELETE' : 'PUT';

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${role.id}`,
    { method, headers: authHeader }
  );

  if (!res.ok) {
    return json(200, {
      type: 4,
      data: {
        content: `Konnte Rolle nicht ${hasRole ? 'entfernen' : 'vergeben'}. Prüfe, ob die Bot-Rolle über "${roleName}" in der Rollen-Reihenfolge steht und der Bot "Rollen verwalten" darf.`,
        flags: 64,
      },
    });
  }

  // Nickname anpassen: höchste Rolle mit Zusatz gewinnt
  const roleIdsAfter = new Set(interaction.member?.roles || []);
  if (hasRole) roleIdsAfter.delete(role.id);
  else roleIdsAfter.add(role.id);
  const heldNames = new Set(roles.filter((r) => roleIdsAfter.has(r.id)).map((r) => r.name));
  const winner = GENERAL_ROLES.find((r) => r.tag && heldNames.has(r.name));
  const parsed = parseNick(interaction.member?.nick || interaction.member?.user?.global_name || interaction.member?.user?.username);
  parsed.tag = winner ? winner.tag : null;
  const newNick = buildNick(parsed);
  let nickInfo = '';
  const nickRes = await setNick(guildId, userId, newNick);
  if (nickRes.ok) nickInfo = `\nDein Name: **${newNick}**`;
  else nickInfo = '\n(Nickname konnte nicht geändert werden – Server-Owner kann der Bot nicht umbenennen.)';

  return json(200, {
    type: 4,
    data: {
      content: (hasRole ? `❌ Rolle **${roleName}** entfernt.` : `✅ Rolle **${roleName}** zugewiesen.`) + nickInfo,
      flags: 64,
    },
  });
}

// ---------- /session und /sessionend ----------
// Antworten sind nur für den Auslöser sichtbar (flags: 64), damit im Kanal nur die Bilder stehen.
// Der Club wird per Autovervollständigung gesucht: Wert = "<clubId>|<Clubname>".

async function handleSessionAutocomplete(interaction) {
  const focused = (interaction.data.options || []).find((o) => o.focused);
  const typed = String(focused?.value || '').trim();
  const { searchClubs } = require('./lib/club-search');
  const clubs = await searchClubs(typed);
  const choices = clubs.slice(0, 25).map((c) => ({
    name: `${c.name} · ${c.games} Spiele · ID ${c.clubId}`.slice(0, 100),
    value: `${c.clubId}|${c.name}`.slice(0, 100),
  }));
  // Reine Zahl eingetippt -> direkt als Club-ID anbieten
  if (/^\d{3,}$/.test(typed) && !choices.some((c) => c.value.startsWith(typed + '|'))) {
    choices.unshift({ name: `Club-ID ${typed}`, value: `${typed}|Club ${typed}` });
  }
  return json(200, { type: 8, data: { choices: choices.slice(0, 25) } });
}

function parseClubOption(interaction) {
  const raw = String((interaction.data.options || []).find((o) => o.name === 'club')?.value || '').trim();
  const m = raw.match(/^(\d{3,})(?:\|(.+))?$/);
  if (!m) return null;
  return { clubId: m[1], label: (m[2] || `Club ${m[1]}`).trim() };
}

async function listRunningSessions(store) {
  const { blobs } = await store.list({ prefix: 'session-' });
  const out = [];
  for (const b of blobs) {
    const s = await store.get(b.key, { type: 'json' });
    if (s) out.push(s);
  }
  return out;
}

async function handleSessionStart(interaction) {
  const club = parseClubOption(interaction);
  if (!club) {
    return json(200, {
      type: 4,
      data: { content: '⚠️ Bitte den Club aus der **Vorschlagsliste** auswählen (Namen tippen, kurz warten, dann anklicken).', flags: 64 },
    });
  }
  const store = sessionStore();
  if (await getSession(store, club.clubId)) {
    return json(200, { type: 4, data: { content: `ℹ️ Für **${club.label}** läuft schon eine Session. Beenden mit **/sessionend**.`, flags: 64 } });
  }
  const userName = interaction.member?.user?.global_name || interaction.member?.user?.username || '';
  await saveSession(store, newSession(club, userName));
  return json(200, {
    type: 4,
    data: {
      content: `✅ Session gestartet für **${club.label}** (ID ${club.clubId}). Ich prüfe alle 2 Minuten auf neue Spiele und poste die Statistiken in #📊-𝑴𝒂𝒕𝒄𝒉-𝑺𝒕𝒂𝒕𝒊𝒔𝒕𝒊𝒌.\nBeenden mit **/sessionend** – dann kommt die Session-Bilanz.`,
      flags: 64,
    },
  });
}

async function handleSessionEnd() {
  const store = sessionStore();
  const ending = [];
  for (const session of await listRunningSessions(store)) {
    if (session.endRequestedAt) continue;
    session.endRequestedAt = Date.now();
    await saveSession(store, session);
    ending.push(`${session.label} (${session.matches.length} ${session.matches.length === 1 ? 'Spiel' : 'Spiele'} bisher)`);
  }
  const content = ending.length
    ? `🏁 Session wird beendet: ${ending.join(', ')}.\nDie Bilanz kommt in ca. 2–4 Minuten in #📊-𝑴𝒂𝒕𝒄𝒉-𝑺𝒕𝒂𝒕𝒊𝒔𝒕𝒊𝒌 (letzte Spiele werden noch mitgenommen).`
    : 'Es läuft gerade keine Session.';
  return json(200, { type: 4, data: { content, flags: 64 } });
}

// ---------- /kader + Buttons ----------
// Antworten an einzelne Admins sind nur für sie sichtbar (flags: 64).
const ephemeral = (content, extra = {}) => json(200, { type: 4, data: { content, flags: 64, ...extra } });
const updateEphemeral = (content) => json(200, { type: 7, data: { content, components: [] } });
const NO_ADMIN = '⛔ Nur Admins können den Kader bearbeiten.';

async function handleKaderCommand(interaction) {
  if (!(await isKaderAdmin(interaction))) return ephemeral(NO_ADMIN);
  const team = String((interaction.data.options || []).find((o) => o.name === 'team')?.value || '1');

  // Discord gibt nur 3 Sekunden Zeit. Deshalb sofort "Bot denkt nach…" zurückgeben (type 5)
  // und Rollen, Mitglieder und Bild komplett im kader-worker erledigen. Der ersetzt die Nachricht dann.
  try {
    await requestKaderRefresh({
      action: 'post',
      team,
      guildId: interaction.guild_id,
      appId: interaction.application_id,
      token: interaction.token,
    });
  } catch (err) {
    console.error('kader:', err);
    return ephemeral('⚠️ Kader konnte nicht gestartet werden. Bitte gleich nochmal versuchen.');
  }
  return json(200, { type: 5 });
}

function playerOptions(players) {
  return players.slice(0, 25).map((p) => ({
    label: `${p.number != null ? '#' + p.number + ' ' : ''}${p.name}`.slice(0, 100),
    description: p.pos ? `Position: ${p.pos}` : undefined,
    value: p.id,
  }));
}

async function handleKaderButton(interaction) {
  const [, action, team] = interaction.data.custom_id.split(':');
  if (!KADER_TEAMS[team]) return ephemeral('Unbekanntes Team.');
  if (!(await isKaderAdmin(interaction))) return ephemeral(NO_ADMIN);
  const guildId = interaction.guild_id;
  const label = KADER_TEAMS[team].label;

  // --- Buttons an der Kader-Nachricht ---
  if (action === 'refresh') {
    await requestKaderRefresh({ action: 'refresh', team, guildId });
    return ephemeral('🔄 Kader wird aktualisiert…');
  }
  if (action === 'add') {
    return ephemeral(`**➕ Spieler zum Kader von ${label} hinzufügen**\nSchritt 1 von 3: Spieler auswählen`, {
      components: [{ type: 1, components: [{ type: 5, custom_id: `kader:addsel:${team}`, placeholder: 'Spieler auswählen…', min_values: 1, max_values: 1 }] }],
    });
  }
  if (action === 'pos') {
    const { players } = await getKaderPlayers(guildId, team);
    if (players.length === 0) return ephemeral(`Im Kader von **${label}** ist noch niemand.`);
    return ephemeral(`**🧭 Position ändern** – wen willst du in eine andere Spalte setzen? (${label})`, {
      components: [{ type: 1, components: [{ type: 3, custom_id: `kader:possel:${team}`, placeholder: 'Spieler auswählen…', min_values: 1, max_values: 1, options: playerOptions(players) }] }],
    });
  }
  if (action === 'rem' || action === 'num') {
    const { players } = await getKaderPlayers(guildId, team);
    if (players.length === 0) return ephemeral(`Im Kader von **${label}** ist noch niemand.`);
    const remove = action === 'rem';
    return ephemeral(
      remove ? `Wen willst du aus dem Kader von **${label}** entfernen?` : `Wem willst du eine Rückennummer geben? (${label})`,
      {
        components: [{
          type: 1,
          components: [{
            type: 3,
            custom_id: `kader:${remove ? 'remsel' : 'numsel'}:${team}`,
            placeholder: 'Spieler auswählen…',
            min_values: 1,
            max_values: remove ? Math.min(10, players.length) : 1,
            options: playerOptions(players),
          }],
        }],
      }
    );
  }

  // --- Auswahl aus den Menüs ---
  const selected = interaction.data.values || [];
  // Hinzufügen Schritt 2 / Position ändern: Spalte wählen
  if (action === 'addsel' || action === 'possel') {
    const userId = selected[0];
    const next = action === 'addsel' ? 'addgrp' : 'posgrp';
    return json(200, { type: 7, data: {
      content: action === 'addsel' ? `**➕ <@${userId}> hinzufügen**\nSchritt 2 von 3: In welche Spalte?` : `**🧭 <@${userId}>** – in welche Spalte?`,
      allowed_mentions: { parse: [] },
      components: [{ type: 1, components: [{ type: 3, custom_id: `kader:${next}:${team}:${userId}`, placeholder: 'Spalte auswählen…', options: KADER_GROUP_OPTIONS }] }],
    } });
  }
  if (action === 'posgrp') {
    const userId = interaction.data.custom_id.split(':')[3];
    const groups = await getGroups(team);
    groups[userId] = selected[0];
    await setGroups(team, groups);
    await requestKaderRefresh({ action: 'refresh', team, guildId });
    return updateEphemeral(`✅ <@${userId}> steht jetzt bei **${KADER_GROUP_NAMES[selected[0]]}** – der Kader wird gleich aktualisiert.`);
  }
  // Hinzufügen Schritt 3: Rückennummer (Formular)
  if (action === 'addgrp') {
    const userId = interaction.data.custom_id.split(':')[3];
    return json(200, { type: 9, data: {
      custom_id: `kader:addmodal:${team}:${userId}:${selected[0]}`,
      title: `Rückennummer · ${KADER_GROUP_NAMES[selected[0]]}`.slice(0, 45),
      components: [{ type: 1, components: [{ type: 4, custom_id: 'nummer', style: 1, label: 'Rückennummer (1–99, leer = ohne Nummer)', min_length: 0, max_length: 2, required: false }] }],
    } });
  }

  if (action === 'remsel') {
    const role = findKaderRole(await getGuildRoles(guildId), team);
    if (!role) return updateEphemeral(`⚠️ Die Rolle **${KADER_TEAMS[team].roleName}** gibt es nicht.`);
    const add = false;
    const ok = [];
    const failed = [];
    for (const userId of selected) {
      const res = await discordApi(`/guilds/${guildId}/members/${userId}/roles/${role.id}`, {
        method: add ? 'PUT' : 'DELETE',
        headers: { 'X-Audit-Log-Reason': encodeURIComponent(`Kader ${label} über Bot`) },
      });
      (res.ok ? ok : failed).push(`<@${userId}>`);
    }
    if (!add && ok.length) {
      const numbers = await getNumbers(team);
      selected.forEach((id) => delete numbers[id]); // Nummer wird wieder frei
      await setNumbers(team, numbers);
      const groups = await getGroups(team);
      selected.forEach((id) => delete groups[id]);
      await setGroups(team, groups);
    }
    if (ok.length) await requestKaderRefresh({ action: 'refresh', team, guildId });
    let msg = ok.length ? `✅ ${add ? 'Hinzugefügt' : 'Entfernt'}: ${ok.join(', ')} – der Kader wird gleich aktualisiert.` : '';
    if (failed.length) msg += `\n⚠️ Nicht geklappt bei ${failed.join(', ')} – die Bot-Rolle muss in den Server-Einstellungen **über** „${role.name}“ stehen.`;
    return updateEphemeral(msg.trim());
  }

  if (action === 'numsel') {
    const userId = selected[0];
    const current = (await getNumbers(team))[userId];
    return json(200, {
      type: 9, // Formular öffnen
      data: {
        custom_id: `kader:nummodal:${team}:${userId}`,
        title: 'Rückennummer vergeben',
        components: [{
          type: 1,
          components: [{
            type: 4, custom_id: 'nummer', style: 1, label: 'Nummer (1–99, leer = Nummer entfernen)',
            min_length: 0, max_length: 2, required: false, value: current != null ? String(current) : undefined,
          }],
        }],
      },
    });
  }

  return ephemeral('Unbekannte Aktion.');
}

const KADER_GROUP_NAMES = { TW: 'Torwart', ABW: 'Abwehr', MF: 'Mittelfeld', OFF: 'Offensive' };
const KADER_GROUP_OPTIONS = [
  { label: 'Torwart', value: 'TW', emoji: { name: '🧤' } },
  { label: 'Abwehr', value: 'ABW', emoji: { name: '🛡️' } },
  { label: 'Mittelfeld', value: 'MF', emoji: { name: '🎯' } },
  { label: 'Offensive', value: 'OFF', emoji: { name: '⚽' } },
];

async function handleKaderAddModal(interaction) {
  const [, , team, userId, grp] = interaction.data.custom_id.split(':');
  if (!(await isKaderAdmin(interaction))) return ephemeral(NO_ADMIN);
  const guildId = interaction.guild_id;
  const raw = interaction.data.components?.[0]?.components?.[0]?.value?.trim() || '';
  const numbers = await getNumbers(team);
  let nr = null;
  if (raw !== '') {
    nr = Number(raw);
    if (!Number.isInteger(nr) || nr < 1 || nr > 99) return ephemeral('❌ Die Nummer muss zwischen 1 und 99 liegen.');
    const taken = Object.entries(numbers).find(([uid, n]) => n === nr && uid !== userId);
    if (taken) return ephemeral(`❌ Die **${nr}** trägt schon <@${taken[0]}>. Bitte eine andere Nummer wählen.`);
  }
  const role = findKaderRole(await getGuildRoles(guildId), team);
  if (!role) return ephemeral(`⚠️ Die Rolle **${KADER_TEAMS[team].roleName}** gibt es nicht.`);
  const res = await discordApi(`/guilds/${guildId}/members/${userId}/roles/${role.id}`, { method: 'PUT', headers: { 'X-Audit-Log-Reason': encodeURIComponent(`Kader ${KADER_TEAMS[team].label} über Bot`) } });
  if (!res.ok) return ephemeral(`⚠️ Konnte <@${userId}> nicht hinzufügen – die Bot-Rolle muss über „${role.name}“ stehen.`);
  if (nr != null) numbers[userId] = nr; else delete numbers[userId];
  await setNumbers(team, numbers);
  const groups = await getGroups(team);
  groups[userId] = grp;
  await setGroups(team, groups);
  await requestKaderRefresh({ action: 'refresh', team, guildId });
  return ephemeral(`✅ <@${userId}> ist im Kader: **${KADER_GROUP_NAMES[grp]}**${nr != null ? ` · Nummer **${nr}**` : ''} – der Kader wird gleich aktualisiert.`);
}

async function handleKaderModal(interaction) {
  const [, , team, userId] = interaction.data.custom_id.split(':');
  if (!(await isKaderAdmin(interaction))) return ephemeral(NO_ADMIN);
  const raw = interaction.data.components?.[0]?.components?.[0]?.value?.trim() || '';
  const numbers = await getNumbers(team);

  if (raw === '') {
    delete numbers[userId];
    await setNumbers(team, numbers);
    await requestKaderRefresh({ action: 'refresh', team, guildId: interaction.guild_id });
    return ephemeral(`✅ Nummer von <@${userId}> entfernt.`);
  }

  const nr = Number(raw);
  if (!Number.isInteger(nr) || nr < 1 || nr > 99) return ephemeral('⚠️ Bitte eine Zahl von 1 bis 99 eingeben.');
  const taken = Object.entries(numbers).find(([id, n]) => n === nr && id !== userId);
  if (taken) return ephemeral(`⚠️ Die **#${nr}** hat schon <@${taken[0]}>. Bitte zuerst dort ändern.`);

  numbers[userId] = nr;
  await setNumbers(team, numbers);
  await requestKaderRefresh({ action: 'refresh', team, guildId: interaction.guild_id });
  return ephemeral(`✅ <@${userId}> trägt jetzt die **#${nr}** – der Kader wird gleich aktualisiert.`);
}

// ---------- /aufstellung (Klick-Bedienung, Bild, nur Admins) ----------
const luEph = (content, extra = {}) => json(200, { type: 4, data: { content, flags: 64, ...extra } });
const luUpd = (content, extra = {}) => json(200, { type: 7, data: { content, components: [], ...extra } });

async function handleAufstellungCommand(interaction) {
  if (!(await isKaderAdmin(interaction))) return luEph('⛔ Nur Admins können die Aufstellung bearbeiten.');
  const opts = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  const team = String(opts.team || '1');
  const store = lineupStore();
  const key = lineupKey(interaction);
  const lineup = emptyLineup(team, opts.titel, interaction.member.user.id);
  lineup.guildId = interaction.guild_id;
  await saveLineup(store, key, lineup);
  // Sofort (ephemer) die Bedienelemente zeigen, Bild ergänzt lineup-worker gleich danach
  await requestLineupRefresh({ action: 'post', key, appId: interaction.application_id, token: interaction.token });
  return json(200, { type: 4, data: { flags: 64, embeds: [lineupEmbed(lineup)], components: lineupComponents(lineup) } });
}

async function loadLineupForEdit(interaction) {
  const store = lineupStore();
  const key = lineupKey(interaction);
  const lineup = await getLineup(store, key);
  return { store, key, lineup };
}

async function handleLineupComponent(interaction) {
  if (!(await isKaderAdmin(interaction))) return luEph('⛔ Nur Admins können die Aufstellung bearbeiten.');
  const parts = interaction.data.custom_id.split(':'); // lineup:<action>:<team>[:slot]
  const action = parts[1];
  const { store, key, lineup } = await loadLineupForEdit(interaction);
  if (!lineup) return luEph('Diese Aufstellung ist abgelaufen. Starte sie neu mit /aufstellung.');

  const applyAndRefresh = async (newLineup, content) => {
    newLineup.guildId = interaction.guild_id;
    await saveLineup(store, key, newLineup);
    await requestLineupRefresh({ action: 'refresh', key });
    return content;
  };

  if (action === 'form') {
    const next = switchFormation(lineup, interaction.data.values[0]);
    return luUpd(await applyAndRefresh(next, `Formation auf **${next.formation}** gesetzt.`));
  }

  if (action === 'auto') {
    const filled = await autoFill(interaction.guild_id, lineup);
    return luUpd(await applyAndRefresh(filled, '✨ Automatisch gefüllt (nach HP-Positionen). Einzelne Plätze kannst du unten anpassen.'));
  }

  if (action === 'clear') {
    return luUpd(await applyAndRefresh({ ...lineup, players: {}, ids: {} }, '🧹 Alle Positionen geleert.'));
  }

  // 📤 Posten: Kanal wählen → Uhrzeit/Datum/Info eintragen → Bild wird in den Kanal gepostet
  if (action === 'send') {
    const filled = Object.values(lineup.players || {}).filter(Boolean).length;
    return luEph(`**📤 Aufstellung posten**${filled ? '' : '\n⚠️ Es ist noch niemand eingesetzt.'}\nIn welchen Kanal soll sie?`, {
      components: [{ type: 1, components: [{ type: 8, custom_id: `lineup:sendch:${lineup.team}`, placeholder: 'Kanal auswählen…', channel_types: [0, 5], min_values: 1, max_values: 1 }] }],
    });
  }
  if (action === 'sendch') {
    const channelId = interaction.data.values?.[0];
    return json(200, { type: 9, data: {
      custom_id: `lineup:sendmodal:${lineup.team}:${channelId}`,
      title: 'Aufstellung posten',
      components: [
        { type: 1, components: [{ type: 4, custom_id: 'zeit', style: 1, label: 'Anstoß-Uhrzeit (optional, z. B. 20:30)', required: false, max_length: 5, placeholder: '20:30' }] },
        { type: 1, components: [{ type: 4, custom_id: 'datum', style: 1, label: 'Datum (optional, leer = heute)', required: false, max_length: 10, placeholder: '02.11.' }] },
        { type: 1, components: [{ type: 4, custom_id: 'info', style: 2, label: 'Info (optional)', required: false, max_length: 300, placeholder: 'z. B. Treffpunkt 20:15 in der Lobby' }] },
      ],
    } });
  }

  // Position gewählt -> kleines Menü: Mitglied anklicken oder Aushilfe eintippen / leeren
  if (action === 'slot') {
    const slotKey = interaction.data.values[0];
    return luEph(`Wen willst du auf **${slotKey}** stellen?`, {
      components: [
        { type: 1, components: [{ type: 5, custom_id: `lineup:pick:${lineup.team}:${slotKey}`, placeholder: 'Spieler wählen…', min_values: 1, max_values: 1 }] },
        { type: 1, components: [
          { type: 2, style: 2, label: 'Aushilfe eintippen', emoji: { name: '✏️' }, custom_id: `lineup:guest:${lineup.team}:${slotKey}` },
          { type: 2, style: 4, label: 'Leeren', emoji: { name: '✖️' }, custom_id: `lineup:unset:${lineup.team}:${slotKey}` },
        ] },
      ],
    });
  }

  const slotKey = parts[3];
  if (action === 'unset') {
    const next = { ...lineup, players: { ...lineup.players }, ids: { ...(lineup.ids || {}) } };
    delete next.players[slotKey]; delete next.ids[slotKey];
    return luUpd(await applyAndRefresh(next, `**${slotKey}** geleert.`));
  }

  if (action === 'pick') {
    const userId = interaction.data.values[0];
    const resolved = interaction.data.resolved || {};
    const member = resolved.members?.[userId];
    const user = resolved.users?.[userId];
    const rawNick = member?.nick || user?.global_name || user?.username || 'Spieler';
    const name = String(rawNick).split('|')[0].trim() || rawNick;
    const next = { ...lineup, players: { ...lineup.players, [slotKey]: name }, ids: { ...(lineup.ids || {}), [slotKey]: userId } };
    return luUpd(await applyAndRefresh(next, `**${slotKey}:** ${name}`));
  }

  if (action === 'guest') {
    return json(200, {
      type: 9,
      data: {
        custom_id: `lineup:guestmodal:${lineup.team}:${slotKey}`,
        title: 'Aushilfe eintragen',
        components: [{ type: 1, components: [{ type: 4, custom_id: 'name', style: 1, label: `Name für ${slotKey}`, min_length: 1, max_length: 20, required: true }] }],
      },
    });
  }

  return luEph('Unbekannte Aktion.');
}

// ---------- Veröffentlichte Aufstellung: Spieler ersetzen ----------
async function handleLineupPub(interaction) {
  const parts = interaction.data.custom_id.split(':'); // lineup:<pubrep|pubslot|pubnew|pubmodal|pubyes|pubno>:<pubId>[:slot]
  const [, act, pubId, slotKey] = parts;
  const store = lineupStore();
  const pub = await store.get(`pub-${pubId}`, { type: 'json' });
  if (!pub) return luEph('Diese Aufstellung ist zu alt – bitte neu posten.');

  // ✅ Bin dabei / ❌ Kann nicht – für die eingesetzten Spieler selbst
  if (act === 'pubyes' || act === 'pubno') {
    const uid = interaction.member?.user?.id;
    const slot = Object.entries(pub.ids || {}).find(([, u]) => u === uid)?.[0];
    if (!slot) return luEph('Du stehst nicht in dieser Aufstellung.');
    const R = require('./lib/lineup-render');
    if (act === 'pubyes') {
      pub.confirm = { ...(pub.confirm || {}), [uid]: 'yes' };
      await store.setJSON(`pub-${pubId}`, pub);
      await R.updatePublishedText(pub).catch(() => {});
      return luEph('✅ Danke, du bist bestätigt! Viel Erfolg 🐉');
    }
    const name = String(pub.players[slot] || '').split('|')[0].trim();
    const label = (require('./lib/matchreport-svg').FORMATIONS[pub.formation] || []).find((x) => x.key === slot)?.label || slot;
    delete pub.players[slot]; delete pub.ids[slot]; if (pub.confirm) delete pub.confirm[uid];
    pub.changes = [...(pub.changes || []), `${label}: ~~${name}~~ → **frei** (kann nicht)`];
    await store.setJSON(`pub-${pubId}`, pub);
    await requestLineupRepublish(pubId);
    return luEph(`❌ Okay, du bist aus der Aufstellung raus (**${label}** ist jetzt frei). Die Admins können die Position neu besetzen.`);
  }

  if (!(await isKaderAdmin(interaction))) return luEph('⛔ Nur Admins können Spieler ersetzen.');
  const slots = (require('./lib/matchreport-svg').FORMATIONS[pub.formation] || []);
  const label = (k) => slots.find((x) => x.key === k)?.label || k;

  if (act === 'pubrep') {
    return luEph(`**🔄 Spieler ersetzen** · ${pub.title}\nWelche Position?`, {
      components: [{ type: 1, components: [{ type: 3, custom_id: `lineup:pubslot:${pubId}`, placeholder: 'Position wählen…', options: slots.map((x) => ({ label: `${x.label} · ${pub.players[x.key] || '— frei —'}`.slice(0, 100), value: x.key })) }] }],
    });
  }
  if (act === 'pubslot') {
    const key = interaction.data.values?.[0];
    const { players } = await getKaderPlayers(interaction.guild_id, pub.team).catch(() => ({ players: [] }));
    const used = new Set(Object.values(pub.players).map((n) => String(n).split('|')[0].trim()));
    const free = players.map((p) => p.name).filter((n) => !used.has(String(n).split('|')[0].trim())).slice(0, 23);
    return json(200, { type: 7, data: {
      content: `**🔄 ${label(key)}:** ${pub.players[key] || '— frei —'} → wer kommt rein?`,
      components: [{ type: 1, components: [{ type: 3, custom_id: `lineup:pubnew:${pubId}:${key}`, placeholder: 'Ersatzspieler wählen…', options: [
        ...free.map((n) => ({ label: String(n).slice(0, 100), value: `p:${String(n).slice(0, 90)}` })),
        { label: 'Aushilfe / anderen Namen eintippen', value: 'type', emoji: { name: '✍️' } },
        { label: 'Position leer lassen', value: 'empty', emoji: { name: '⬜' } },
      ] }] }],
    } });
  }
  let newName = null;
  if (act === 'pubnew') {
    const v = interaction.data.values?.[0];
    if (v === 'type') {
      return json(200, { type: 9, data: { custom_id: `lineup:pubmodal:${pubId}:${slotKey}`, title: `Ersatz für ${label(slotKey)}`.slice(0, 45), components: [{ type: 1, components: [{ type: 4, custom_id: 'name', style: 1, label: 'Name', required: true, max_length: 32 }] }] } });
    }
    newName = v === 'empty' ? '' : v.slice(2);
  } else if (act === 'pubmodal') {
    newName = (interaction.data.components?.[0]?.components?.[0]?.value || '').trim();
    if (!newName) return luEph('Bitte einen Namen eintragen.');
  } else return luEph('Unbekannte Aktion.');

  const old = pub.players[slotKey] || '— frei —';
  if (newName) pub.players[slotKey] = newName; else delete pub.players[slotKey];
  // Discord-ID des neuen Spielers (für Bestätigen); Aushilfe/leer = keine
  pub.ids = pub.ids || {};
  delete pub.ids[slotKey];
  if (newName && act === 'pubnew') {
    const { players } = await getKaderPlayers(interaction.guild_id, pub.team).catch(() => ({ players: [] }));
    const p = players.find((x) => String(x.name).split('|')[0].trim() === String(newName).split('|')[0].trim());
    if (p) pub.ids[slotKey] = p.id;
  }
  pub.changes = pub.changes || [];
  pub.changes.push(`${label(slotKey)}: ~~${String(old).split('|')[0].trim()}~~ → **${newName ? String(newName).split('|')[0].trim() : 'frei'}**`);
  await store.setJSON(`pub-${pubId}`, pub);
  await requestLineupRepublish(pubId);
  const msg = `✅ **${label(slotKey)}:** ${String(old).split('|')[0].trim()} → **${newName || 'frei'}** – die Aufstellung wird gleich aktualisiert.`;
  return act === 'pubmodal' ? luEph(msg) : json(200, { type: 7, data: { content: msg, components: [] } });
}

async function handleLineupSendModal(interaction) {
  if (!(await isKaderAdmin(interaction))) return luEph('⛔ Nur Admins können die Aufstellung posten.');
  const [, , , channelId] = interaction.data.custom_id.split(':');
  const val = (id) => { for (const r of interaction.data.components || []) for (const c of r.components || []) if (c.custom_id === id) return String(c.value || '').trim(); return ''; };
  const zeit = val('zeit'), datum = val('datum'), info = val('info');
  let kickoff = null;
  if (zeit) {
    kickoff = parseKickoff(zeit, datum);
    if (!kickoff) return luEph('❌ Die Uhrzeit bitte so eintragen: **20:30** (Datum optional: **02.11.**)');
  }
  const key = lineupKey(interaction);
  if (!(await getLineup(lineupStore(), key))) return luEph('Diese Aufstellung ist abgelaufen. Starte sie neu.');
  await requestLineupPublish({ key, channelId, kickoff, note: info || null });
  return luEph(`📤 Wird gepostet in <#${channelId}>${kickoff ? ` · Anstoß <t:${kickoff}:F>` : ''} – das Bild erscheint in ein paar Sekunden.`);
}

async function handleLineupModal(interaction) {
  if (!(await isKaderAdmin(interaction))) return luEph('⛔ Nur Admins können die Aufstellung bearbeiten.');
  const [, , team, slotKey] = interaction.data.custom_id.split(':');
  const name = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
  const { store, key, lineup } = await loadLineupForEdit(interaction);
  if (!lineup) return luEph('Diese Aufstellung ist abgelaufen. Starte sie neu mit /aufstellung.');
  const next = { ...lineup, players: { ...lineup.players, [slotKey]: name }, ids: { ...(lineup.ids || {}) } };
  delete next.ids[slotKey]; // Aushilfe: kein Discord-Konto
  next.guildId = interaction.guild_id;
  await saveLineup(store, key, next);
  await requestLineupRefresh({ action: 'refresh', key });
  return luEph(`**${slotKey}:** ${name} (Aushilfe)`);
}


// ---------- Tester-Ticket: Annehmen / Ablehnen / Schließen (nur Admins) ----------
async function handleTicketButton(interaction) {
  const [, action, applicantId] = interaction.data.custom_id.split(':');
  const eph = (content) => json(200, { type: 4, data: { content, flags: 64 } });

  // Infoblatt-Formular öffnen (nur der Bewerber selbst)
  if (action === 'form1' || action === 'form2') {
    if (interaction.member?.user?.id !== applicantId) return eph('⛔ Das Infoblatt kann nur der Bewerber ausfüllen.');
    const existing = await getInfo(interaction.guild_id, applicantId);
    return json(200, buildInfoModal(action === 'form1' ? 1 : 2, applicantId, existing));
  }

  if (!(await isKaderAdmin(interaction))) return eph('⛔ Nur Admins können das Ticket bearbeiten.');

  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id || interaction.channel?.id;
  const adminName = interaction.member?.nick || interaction.member?.user?.global_name || interaction.member?.user?.username;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  if (action === 'close') {
    const r = await archiveAndCloseTicket(guildId, applicantId, channelId, adminName);
    if (r.error) return eph(`⚠️ ${r.error}`);
    return json(200, { type: 6 }); // Kanal ist weg, Archiv-Eintrag ist gepostet
  }

  const embed = { ...(interaction.message?.embeds?.[0] || {}) };
  const closeRow = [
    { type: 1, components: [{ type: 2, style: 2, label: 'Ticket schließen', emoji: { name: '🔒' }, custom_id: `ticket:close:${applicantId}` }] },
  ];

  if (action === 'reject') {
    embed.color = 0xda373c;
    embed.fields = [{ name: 'Status', value: `❌ Abgelehnt von **${adminName}**` }];
    return json(200, { type: 7, data: { content: `<@${applicantId}>`, embeds: [embed], components: closeRow } });
  }

  // accept: Tester-Rolle geben + Nickname-Zusatz
  const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader });
  const roles = rolesRes.ok ? await rolesRes.json() : [];
  const role = roles.find((r) => r.name === 'Tester');
  if (!role) return eph('⚠️ Es gibt keine Rolle **Tester** auf dem Server.');
  const put = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${applicantId}/roles/${role.id}`, { method: 'PUT', headers: authHeader });
  if (!put.ok) return eph('⚠️ Rolle konnte nicht vergeben werden. Die Bot-Rolle muss über **Tester** stehen.');
  // Zusätzlich die Rolle „Dragons Spieler“ (Schrift/Emojis egal, nie die Bot-Rolle; oder fest per ACCEPT_ROLE_ID)
  const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const bdRole = roles.find((r) => r.id === process.env.ACCEPT_ROLE_ID)
    || roles.find((r) => !r.managed && norm(r.name) === 'dragonsspieler')
    || roles.find((r) => !r.managed && norm(r.name).includes('dragonsspieler'))
    || roles.find((r) => !r.managed && norm(r.name).includes('bluedragons'));
  let bdInfo = '';
  if (bdRole) {
    const r2 = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${applicantId}/roles/${bdRole.id}`, { method: 'PUT', headers: authHeader });
    bdInfo = r2.ok ? ` + Rolle **${bdRole.name}**` : ` (⚠️ **${bdRole.name}** konnte nicht vergeben werden – Bot-Rolle muss darüber stehen)`;
  }

  const memberRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${applicantId}`, { headers: authHeader });
  if (memberRes.ok) {
    const m = await memberRes.json();
    const heldNames = new Set(roles.filter((r) => (m.roles || []).includes(r.id) || r.id === role.id).map((r) => r.name));
    const winner = GENERAL_ROLES.find((r) => r.tag && heldNames.has(r.name));
    const parsed = parseNick(m.nick || m.user?.global_name || m.user?.username);
    parsed.tag = winner ? winner.tag : null;
    await setNick(guildId, applicantId, buildNick(parsed));
  }

  embed.color = 0x248046;
  embed.fields = [{ name: 'Status', value: `✅ Angenommen von **${adminName}** – <@${applicantId}> ist jetzt Tester! 🧪${bdInfo}` }];
  return json(200, { type: 7, data: { content: `<@${applicantId}>`, embeds: [embed], components: closeRow } });
}

// Infoblatt-Formular abgeschickt
async function handleTicketModal(interaction) {
  const [, partStr, applicantId] = interaction.data.custom_id.split(':');
  const part = Number(partStr);
  const guildId = interaction.guild_id;
  const before = await getInfo(guildId, applicantId);
  const wasComplete = Boolean(before.complete);
  const info = await saveInfoPart(guildId, applicantId, interaction.data.components);

  if (part < INFO_PARTS.length) {
    return json(200, {
      type: 4,
      data: {
        content: `✅ Teil ${part} gespeichert. Jetzt noch Teil ${part + 1}:`,
        flags: 64,
        components: [
          { type: 1, components: [{ type: 2, style: 1, label: `Weiter zu Teil ${part + 1}`, emoji: { name: '📋' }, custom_id: `ticket:form${part + 1}:${applicantId}` }] },
        ],
      },
    });
  }

  // Letzter Teil: Infoblatt öffentlich im Ticket posten
  info.complete = true;
  await saveInfoPart(guildId, applicantId, [{ components: [{ custom_id: 'complete', value: 'true' }] }]);
  await postInfoToChannel(applicantId, info, wasComplete, interaction.channel_id || interaction.channel?.id);
  return json(200, { type: 4, data: { embeds: [infoEmbed(applicantId, info, wasComplete)], allowed_mentions: { parse: [] } } });
}

// Was gehört zum Zusagen-Bot? Alles andere (Befehle /ut-…, Cup-Buttons) gehört zum Ultimate Team Cup.
const BD_PREFIXES = ['sched:', 'poll:', 'srules:', 'bdp:', 'genrole:', 'kader:', 'lineup:', 'posnick:', 'posrole:', 'ticket:', 'ticketform:', 'rsvp:'];
function isCupInteraction(i) {
  if (i.type === 2 || i.type === 4) return String(i.data?.name || '').startsWith('ut-');
  if (i.type === 3 || i.type === 5) {
    const id = String(i.data?.custom_id || '');
    return !BD_PREFIXES.some((p) => id.startsWith(p));
  }
  return false;
}

// ---------- Gepostete Spielpläne: hinzufügen, Ergebnis, bearbeiten, löschen ----------
async function handleSchedule(interaction) {
  if (!(await isKaderAdmin(interaction))) return ephemeral('⛔ Nur Admins können den Spielplan ändern.');
  const S = require('./lib/schedule');
  const [, act, sid, extra] = interaction.data.custom_id.split(':');
  const st = S.store();
  const s = await st.get(`sched-${sid}`, { type: 'json' });
  if (!s) return ephemeral('Diesen Spielplan gibt es nicht mehr.');
  const val = (cid) => { for (const r of interaction.data.components || []) for (const c of r.components || []) if (c.custom_id === cid) return String(c.value || '').trim(); return ''; };
  const all = [...s.fs.map((g, i) => ({ g, key: `f${i}` })), ...s.games.map((g, i) => ({ g, key: `g${i}` }))];
  const byKey = (k) => (k[0] === 'f' ? s.fs : s.games)[Number(k.slice(1))];
  const save = async (change) => { s.lastChange = change; await st.setJSON(`sched-${sid}`, s); await S.requestRender(sid); };
  const f = (cid, label, req, value, ph, style = 1, max = 60) => ({ type: 1, components: [{ type: 4, custom_id: cid, label, style, required: req, value: value || undefined, placeholder: ph, max_length: max }] });

  if (act === 'add') return json(200, { type: 9, data: { custom_id: `sched:addm:${sid}`, title: 'Freundschaftsspiel hinzufügen', components: [f('spiele', 'Spiele (eins pro Zeile)', true, '', 'z. B. 22:20 Gegner FC', 2, 600)] } });
  if (act === 'addm') {
    const add = S.parseGames(val('spiele'));
    if (!add.length) return ephemeral('❌ Bitte mindestens ein Spiel eintragen.');
    s.fs = [...s.fs, ...add].sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
    await save(`+${add.length} Freundschaftsspiel${add.length > 1 ? 'e' : ''} (${add.map((g) => g.time || g.opp).join(', ')})`);
    return ephemeral(`✅ ${add.length} Freundschaftsspiel${add.length > 1 ? 'e' : ''} hinzugefügt – der Spielplan wird gleich aktualisiert.`);
  }
  if (act === 'res') {
    if (!all.length) return ephemeral('Keine Spiele im Spielplan.');
    return ephemeral('**📝 Ergebnis eintragen** – welches Spiel?', { components: [{ type: 1, components: [{ type: 3, custom_id: `sched:respick:${sid}`, placeholder: 'Spiel wählen…', options: all.slice(0, 25).map(({ g, key }) => ({ label: `${g.time || ''} vs ${g.opp}`.trim().slice(0, 100), description: g.res ? `Aktuell ${g.res[0]}:${g.res[1]}` : key[0] === 'f' ? 'Freundschaftsspiel' : s.wettbewerb, value: key })) }] }] });
  }
  if (act === 'respick') {
    const key = interaction.data.values?.[0]; const g = byKey(key);
    if (!g) return ephemeral('Dieses Spiel gibt es nicht mehr.');
    return json(200, { type: 9, data: { custom_id: `sched:resm:${sid}:${key}`, title: `Ergebnis vs ${g.opp}`.slice(0, 45), components: [f('erg', 'Ergebnis aus unserer Sicht (z. B. 3-1)', false, g.res ? `${g.res[0]}-${g.res[1]}` : '', '3-1 · leer = Ergebnis löschen', 1, 7)] } });
  }
  if (act === 'resm') {
    const g = byKey(extra); if (!g) return ephemeral('Dieses Spiel gibt es nicht mehr.');
    const raw = val('erg');
    if (!raw) { delete g.res; await save(`Ergebnis vs ${g.opp} gelöscht`); return ephemeral(`🗑️ Ergebnis vs **${g.opp}** gelöscht.`); }
    const r = S.parseScore(raw); if (!r) return ephemeral('❌ Ergebnis bitte so eintragen: **3-1** (zuerst unsere Tore).');
    g.res = r;
    const out = r[0] > r[1] ? '✅ Sieg' : r[0] < r[1] ? '❌ Niederlage' : '➖ Unentschieden';
    await save(`${g.opp} ${r[0]}:${r[1]} (${out.split(' ')[1]})`);
    return ephemeral(`${out}: **CW ${r[0]}:${r[1]} ${g.opp}** – der Spielplan wird gleich aktualisiert.`);
  }
  if (act === 'edit') {
    return json(200, { type: 9, data: { custom_id: `sched:editm:${sid}`, title: 'Spielplan bearbeiten', components: [
      f('datum', 'Datum (TT.MM.JJJJ)', true, s.datum, '01.11.2026', 1, 10),
      f('treffen', 'Treffen (HH:MM)', true, s.treffen, '19:30', 1, 5),
      f('fs', 'Freundschaftsspiele (eins pro Zeile)', false, s.fs.map(S.gameLine).join('\n'), '19:45 Gegner FC', 2, 900),
      f('wettbewerb', 'Liga / Cup – Name (optional)', false, s.wettbewerb, 'PL4 Quali Spiele', 1, 60),
      f('spiele', 'Liga/Cup-Spiele (pro Zeile, H/A am Ende)', false, s.games.map(S.gameLine).join('\n'), '20:15 FCG ESPORTS A', 2, 900),
    ] } });
  }
  if (act === 'editm') {
    const datum = val('datum'), treffen = val('treffen');
    if (!/^\d{1,2}\.\d{1,2}\.(\d{2}|\d{4})$/.test(datum) || !/^\d{1,2}[:.]\d{2}$/.test(treffen)) return ephemeral('❌ Datum als **TT.MM.JJJJ** und Treffen als **HH:MM** eintragen.');
    // Ergebnisse behalten, wenn Uhrzeit + Gegner gleich bleiben
    const keep = (list, old) => list.map((g) => { const o = old.find((x) => x.time === g.time && x.opp.toLowerCase() === g.opp.toLowerCase()); return o?.res ? { ...g, res: o.res } : g; });
    s.fs = keep(S.parseGames(val('fs')), s.fs); s.games = keep(S.parseGames(val('spiele')), s.games);
    s.datum = datum; s.treffen = treffen.replace('.', ':'); s.wettbewerb = val('wettbewerb') || 'Liga / Cup'; s.kick = parseKickoff(s.treffen, s.datum);
    await save('Spielplan bearbeitet');
    return ephemeral('✅ Gespeichert – der Spielplan wird gleich aktualisiert.');
  }
  if (act === 'del') return ephemeral('🗑️ Spielplan wirklich löschen?', { components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Ja, löschen', custom_id: `sched:delok:${sid}` }] }] });
  if (act === 'delok') {
    await fetch(`https://discord.com/api/v10/channels/${s.channelId}/messages/${s.messageId}`, { method: 'DELETE', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } });
    await st.delete(`sched-${sid}`);
    return json(200, { type: 7, data: { content: '🗑️ Spielplan gelöscht.', components: [] } });
  }
  return ephemeral('Unbekannte Aktion.');
}

// ---------- Bedien-Panels (/panel): Session und Aufstellung per Klick ----------
function sessionPanel() {
  return {
    embeds: [{
      color: 0x1f6bff,
      title: '🎮 SESSION · PRO CLUBS STATISTIKEN',
      description: 'Starte eine Session – der Bot prüft dann alle 2 Minuten auf neue Spiele und postet Spielbericht und Spielerstatistik in **#📊-𝑴𝒂𝒕𝒄𝒉-𝑺𝒕𝒂𝒕𝒊𝒔𝒕𝒊𝒌**.\nMit **Session beenden** kommt die Bilanz (Spieler nach Ø-Rating).',
      thumbnail: { url: `${process.env.URL}/blue-dragons-logo.png` },
      footer: { text: 'Nur Admins · Antworten sieht nur, wer klickt' },
    }],
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: 'Session starten', emoji: { name: '▶️' }, custom_id: 'bdp:sess_start' },
      { type: 2, style: 4, label: 'Session beenden', emoji: { name: '⏹️' }, custom_id: 'bdp:sess_end' },
      { type: 2, style: 2, label: 'Laufende Sessions', emoji: { name: '📊' }, custom_id: 'bdp:sess_list' },
    ] }, { type: 1, components: [
      { type: 2, style: 1, label: 'Umfrage: Wer hat nicht gefallen?', emoji: { name: '🕵️' }, custom_id: 'bdp:pu_start' },
    ] }],
  };
}

function eventPanel() {
  return {
    embeds: [{
      color: 0x1f6bff,
      title: '📅 EVENT & UMFRAGE',
      description: '**📅 Event erstellen** – Session mit Zusage/Absage und Namensliste.\n**🕵️ Anonyme Umfrage** – gleiche Buttons, aber es werden nur Zahlen angezeigt, keine Namen.\n\nTitel, Datum, Uhrzeit & Co. eintragen, Mannschaft und Kanal wählen – fertig.',
      thumbnail: { url: `${process.env.URL}/blue-dragons-logo.png` },
      footer: { text: 'Nur Admins · Kanal wählst du beim Erstellen' },
    }],
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: 'Event erstellen', emoji: { name: '📅' }, custom_id: 'bdp:ev_new:0' },
      { type: 2, style: 1, label: 'Anonyme Umfrage', emoji: { name: '🕵️' }, custom_id: 'bdp:ev_new:1' },
      { type: 2, style: 2, label: 'Wer hat nicht gefallen?', emoji: { name: '👎' }, custom_id: 'bdp:pu_start' },
    ] }],
  };
}

function transferPanel() {
  return {
    embeds: [{
      color: 0x1f6bff,
      title: '🔁 TRANSFERS',
      description: '**✅ Neuzugang** → postet in **✅-Transfers**\n**❌ Abgang** → postet in **❌-Abgänge**\n…und jeweils auch in **📢-ProClubs-News**.\n\nSpieler auswählen, Position & Verein eintragen – fertig ist die Grafik mit Logo und Namen.',
      thumbnail: { url: `${process.env.URL}/blue-dragons-logo.png` },
      footer: { text: 'Nur Admins' },
    }],
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: 'Neuzugang', emoji: { name: '✅' }, custom_id: 'bdp:tr:in' },
      { type: 2, style: 4, label: 'Abgang', emoji: { name: '❌' }, custom_id: 'bdp:tr:out' },
    ] }],
  };
}

function lineupPanel() {
  return {
    embeds: [{
      color: 0x1f6bff,
      title: '📋 AUFSTELLUNG',
      description: 'Klick auf dein Team, gib optional einen Titel ein (z. B. „Aufstellung Cup“) – danach öffnet sich der Aufstellungs-Builder: Formation wählen, Spieler einsetzen, fertig ist das Bild.\n\n**🗓️ Spielplan / Freundschaftsspiele** – Datum, Treffen, Freundschaftsspiele und Liga-/Cup-Spiele eintragen und in einen Kanal posten.',
      thumbnail: { url: `${process.env.URL}/blue-dragons-logo.png` },
      footer: { text: 'Nur Admins · Der Builder ist nur für dich sichtbar' },
    }],
    components: [
      { type: 1, components: Object.entries(KADER_TEAMS).map(([team, t]) => ({ type: 2, style: 1, label: `Aufstellung · ${t.label}`.slice(0, 80), emoji: { name: '📋' }, custom_id: `bdp:lu:${team}` })) },
      { type: 1, components: [{ type: 2, style: 3, label: 'Spielplan / Freundschaftsspiele', emoji: { name: '🗓️' }, custom_id: 'bdp:sp_start' }] },
    ],
  };
}

async function handlePanelCommand(interaction) {
  if (!(await isKaderAdmin(interaction))) return ephemeral('⛔ Nur Admins können Panels posten.');
  const typ = (interaction.data.options || []).find((o) => o.name === 'typ')?.value;
  const panel = typ === 'aufstellung' ? lineupPanel() : typ === 'event' ? eventPanel() : typ === 'transfers' ? transferPanel() : sessionPanel();
  return json(200, { type: 4, data: panel });
}

const modalValue = (interaction, id) => {
  for (const r of interaction.data.components || []) for (const c of r.components || []) if (c.custom_id === id) return String(c.value || '').trim();
  return '';
};

async function handlePanelAction(interaction) {
  if (!(await isKaderAdmin(interaction))) return ephemeral('⛔ Das Panel dürfen nur Admins benutzen.');
  const id = interaction.data.custom_id;
  const asSession = (value) => ({ ...interaction, type: 2, data: { name: 'session', options: [{ name: 'club', value }] } });

  if (id === 'bdp:sess_start') {
    return json(200, { type: 9, data: { custom_id: 'bdp:sess_modal', title: 'Session starten', components: [{ type: 1, components: [{ type: 4, custom_id: 'club', style: 1, label: 'Clubname (oder Club-ID)', required: true, min_length: 2, max_length: 40, placeholder: 'z. B. CW BlueDragons' }] }] } });
  }
  if (id === 'bdp:sess_modal') {
    const q = modalValue(interaction, 'club');
    if (/^\d{3,}$/.test(q)) return handleSessionStart(asSession(`${q}|Club ${q}`));
    const { searchClubs } = require('./lib/club-search');
    const clubs = await searchClubs(q);
    if (!clubs.length) return ephemeral(`🔍 Kein Club zu „${q}“ gefunden. Prüf die Schreibweise oder gib die Club-ID ein.`);
    if (clubs.length === 1) return handleSessionStart(asSession(`${clubs[0].clubId}|${clubs[0].name}`));
    return ephemeral(`🔍 ${clubs.length} Clubs gefunden – welcher ist es?`, {
      components: [{ type: 1, components: [{ type: 3, custom_id: 'bdp:sess_pick', placeholder: 'Club auswählen…', options: clubs.slice(0, 25).map((c) => ({ label: c.name.slice(0, 100), description: `${c.games} Spiele · ID ${c.clubId}`, value: `${c.clubId}|${c.name}`.slice(0, 100) })) }] }],
    });
  }
  if (id === 'bdp:sess_pick') return handleSessionStart(asSession(interaction.data.values?.[0] || ''));
  if (id === 'bdp:sess_end') return handleSessionEnd(interaction);
  if (id === 'bdp:sess_list') {
    const list = await listRunningSessions(sessionStore());
    if (!list.length) return ephemeral('Gerade läuft keine Session.');
    return ephemeral(`📊 **Laufende Sessions**\n${list.map((x) => `• **${x.label}** (ID ${x.clubId}) · ${x.matches.length} ${x.matches.length === 1 ? 'Spiel' : 'Spiele'}${x.endRequestedAt ? ' · wird beendet' : ''}`).join('\n')}`);
  }
  // ---------- Transfers ----------
  if (id === 'bdp:tr:in' || id === 'bdp:tr:out') {
    const kind = id.endsWith(':in') ? 'in' : 'out';
    return ephemeral(`**${kind === 'in' ? '✅ Neuzugang' : '❌ Abgang'}** – welcher Spieler? (ist er nicht auf dem Server, wähl „Ohne Discord-Mitglied“)`, {
      components: [
        { type: 1, components: [{ type: 5, custom_id: `bdp:tr_user:${kind}`, placeholder: 'Spieler auswählen…', min_values: 1, max_values: 1 }] },
        { type: 1, components: [{ type: 2, style: 2, label: 'Ohne Discord-Mitglied', emoji: { name: '✍️' }, custom_id: `bdp:tr_user:${kind}:none` }] },
      ],
    });
  }
  if (id.startsWith('bdp:tr_user:')) {
    const [, , kind, none] = id.split(':');
    const uid = none ? '' : interaction.data.values?.[0] || '';
    const r = interaction.data.resolved || {};
    const nameGuess = uid ? String(r.members?.[uid]?.nick || r.users?.[uid]?.global_name || r.users?.[uid]?.username || '').split('|')[0].trim() : '';
    const f = (cid, label, req, value, ph, style = 1, max = 40) => ({ type: 1, components: [{ type: 4, custom_id: cid, label, style, required: req, max_length: max, value: value || undefined, placeholder: ph }] });
    return json(200, { type: 9, data: { custom_id: `bdp:tr_modal:${kind}:${uid || '-'}`, title: `${kind === 'in' ? 'Neuzugang' : 'Abgang'}${nameGuess ? ' · ' + nameGuess : ''}`.slice(0, 45), components: [
      f('name', 'Name auf der Grafik', true, nameGuess, 'z. B. Leon', 1, 24),
      f('position', 'Position (optional)', false, '', 'z. B. ZDM', 1, 12),
      f('nummer', 'Rückennummer (optional)', false, '', 'z. B. 6', 1, 2),
      f('verein', kind === 'in' ? 'Kommt von (optional)' : 'Wechselt zu (optional)', false, '', 'z. B. Calcio Strada', 1, 40),
      f('info', 'Info (optional)', false, '', kind === 'in' ? 'z. B. Willkommen zurück!' : 'z. B. Danke für 2 starke Saisons', 2, 300),
    ] } });
  }
  if (id.startsWith('bdp:tr_modal:')) {
    const [, , kind, uid] = id.split(':');
    const name = modalValue(interaction, 'name');
    if (!name) return ephemeral('❌ Bitte einen Namen eintragen.');
    const nummer = modalValue(interaction, 'nummer');
    if (nummer && !/^\d{1,2}$/.test(nummer)) return ephemeral('❌ Die Rückennummer muss eine Zahl von 1 bis 99 sein.');
    await require('./lib/transfers').requestTransfer({ kind, guildId: interaction.guild_id, userId: uid !== '-' ? uid : null, name, position: modalValue(interaction, 'position').toUpperCase(), number: nummer || null, club: modalValue(interaction, 'verein'), info: modalValue(interaction, 'info') });
    return ephemeral(`✅ ${kind === 'in' ? 'Neuzugang' : 'Abgang'} **${name}** wird gepostet – in ${kind === 'in' ? '✅-Transfers' : '❌-Abgänge'} und 📢-ProClubs-News. Die Grafik erscheint in ein paar Sekunden.`);
  }

  // ---------- Spieler-Umfrage nach der Session ----------
  if (id === 'bdp:pu_start') {
    return ephemeral('**🕵️ Spieler-Umfrage** – welche Aufstellung soll ich als Liste nehmen? (Namen kannst du danach noch ändern)', {
      components: [{ type: 1, components: [{ type: 3, custom_id: 'bdp:pu_team', placeholder: 'Aufstellung wählen…', options: [
        { label: `Letzte Aufstellung · ${KADER_TEAMS['1'].label}`, value: '1', emoji: { name: '🐉' } },
        { label: `Letzte Aufstellung · ${KADER_TEAMS['2'].label}`, value: '2', emoji: { name: '🌙' } },
        { label: 'Namen selbst eintragen', value: '-', emoji: { name: '✍️' } },
      ] }] }],
    });
  }
  if (id === 'bdp:pu_team') {
    const team = interaction.data.values?.[0];
    const last = team && team !== '-' ? await require('./lib/polls').lastLineupNames(team) : null;
    const names = (last?.names || []).join('\n');
    return json(200, { type: 9, data: { custom_id: 'bdp:pu_modal', title: 'Spieler-Umfrage (anonym)', components: [
      { type: 1, components: [{ type: 4, custom_id: 'frage', style: 1, label: 'Frage', required: true, max_length: 120, value: 'Wer hat euch heute nicht gefallen?' }] },
      { type: 1, components: [{ type: 4, custom_id: 'spieler', style: 2, label: 'Spieler (einer pro Zeile, 2–20)', required: true, max_length: 1000, value: names || undefined, placeholder: 'Musti, Leon, Noah … (je eine Zeile)' }] },
      { type: 1, components: [{ type: 4, custom_id: 'dauer', style: 1, label: 'Dauer (z. B. 30m, 2h, 1d – leer = 12h)', required: false, max_length: 6, placeholder: '12h' }] },
    ] } });
  }
  if (id === 'bdp:pu_modal') {
    const P = require('./lib/polls');
    const options = [...new Set(modalValue(interaction, 'spieler').split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 20);
    if (options.length < 2) return ephemeral('❌ Bitte mindestens 2 Spieler eintragen (einer pro Zeile).');
    try {
      await P.createPoll({ id: interaction.id, channelId: interaction.channel_id, question: modalValue(interaction, 'frage') || 'Wer hat euch heute nicht gefallen?', options, durationMs: P.parseDuration(modalValue(interaction, 'dauer')), creatorId: interaction.member?.user?.id });
    } catch (e) { return ephemeral('⚠️ ' + e.message); }
    return ephemeral(`✅ Anonyme Umfrage mit **${options.length} Spielern** ist gepostet.`);
  }

  // ---------- Event/Umfrage per Panel ----------
  const evStore = () => getStore({ name: 'rsvp-events', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  if (id.startsWith('bdp:ev_new:')) {
    const anon = id.endsWith(':1');
    const f = (cid, label, req, ph, style = 1, max = 100) => ({ type: 1, components: [{ type: 4, custom_id: cid, label, style, required: req, placeholder: ph, max_length: max }] });
    return json(200, { type: 9, data: { custom_id: `bdp:ev_modal:${anon ? 1 : 0}`, title: anon ? 'Anonyme Umfrage' : 'Event erstellen', components: [
      f('titel', anon ? 'Frage / Titel' : 'Titel', true, anon ? 'z. B. Training am Freitag?' : 'z. B. Cup Abend'),
      f('datum', 'Datum (TT.MM.JJJJ)', true, '05.11.2026', 1, 10),
      f('uhrzeit', 'Uhrzeit (HH:MM)', true, '20:00', 1, 5),
      f('limit', anon ? 'Limit Ja-Stimmen (leer = 99)' : 'Limit Zusagen (leer = 11)', false, anon ? '99' : '11', 1, 3),
      f('info', 'Info / Beschreibung (optional)', false, 'z. B. Champions Cup | Lobby: Musti', 2, 900),
    ] } });
  }
  if (id.startsWith('bdp:ev_modal:')) {
    const anon = id.endsWith(':1');
    const titel = modalValue(interaction, 'titel'), datum = modalValue(interaction, 'datum'), uhrzeit = modalValue(interaction, 'uhrzeit');
    const limRaw = modalValue(interaction, 'limit'), info = modalValue(interaction, 'info');
    const dm = datum.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/), tm = uhrzeit.match(/^(\d{1,2})[:.](\d{2})$/);
    if (!dm || !tm) return ephemeral('❌ Datum bitte als **TT.MM.JJJJ** und Uhrzeit als **HH:MM** eintragen.');
    const limit = limRaw === '' ? (anon ? 99 : 11) : Number(limRaw);
    if (!Number.isInteger(limit) || limit < 1) return ephemeral('❌ Das Limit muss eine Zahl ab 1 sein.');
    const draft = { titel, datum: `${dm[1]}.${dm[2]}.${dm[3].length === 2 ? '20' + dm[3] : dm[3]}`, uhrzeit: `${tm[1]}:${tm[2]}`, limit, info, anonym: anon, channelId: interaction.channel_id };
    await evStore().setJSON(`draft-${interaction.member.user.id}`, draft);
    return ephemeral(`**${anon ? '🕵️ Anonyme Umfrage' : '📅 Event'}: ${titel}**\nFür welche Mannschaft? (bestimmt, wer bei „Wer fehlt noch?“ zählt)`, {
      components: [{ type: 1, components: [{ type: 3, custom_id: 'bdp:ev_team', placeholder: 'Mannschaft wählen…', options: [
        { label: 'Alle', value: '-', emoji: { name: '👥' } },
        { label: KADER_TEAMS['1'].label, value: '1 Mannschaft', emoji: { name: '🐉' } },
        { label: KADER_TEAMS['2'].label, value: '2 Mannschaft', emoji: { name: '🌙' } },
        { label: 'Tester', value: 'Tester', emoji: { name: '🧪' } },
      ] }] }],
    });
  }
  if (id === 'bdp:ev_team') {
    // Schritt: Mannschaft merken → Kanal wählen
    const st = evStore();
    const draft = await st.get(`draft-${interaction.member.user.id}`, { type: 'json' });
    if (!draft) return json(200, { type: 7, data: { content: 'Der Entwurf ist abgelaufen – bitte neu starten.', components: [] } });
    draft.team = interaction.data.values?.[0];
    await st.setJSON(`draft-${interaction.member.user.id}`, draft);
    return json(200, { type: 7, data: {
      content: `**${draft.anonym ? '🕵️ Anonyme Umfrage' : '📅 Event'}: ${draft.titel}**\nIn welchen Kanal soll ${draft.anonym ? 'die Umfrage' : 'das Event'}?`,
      components: [{ type: 1, components: [{ type: 8, custom_id: 'bdp:ev_ch', placeholder: 'Kanal auswählen…', channel_types: [0, 5], min_values: 1, max_values: 1, default_values: [{ id: draft.channelId, type: 'channel' }] }] }],
    } });
  }
  if (id === 'bdp:ev_ch') {
    const st = evStore();
    const draft = await st.get(`draft-${interaction.member.user.id}`, { type: 'json' });
    if (!draft) return json(200, { type: 7, data: { content: 'Der Entwurf ist abgelaufen – bitte neu starten.', components: [] } });
    draft.channelId = interaction.data.values?.[0] || draft.channelId;
    const team = draft.team;
    const options = [
      { name: 'titel', value: draft.titel }, { name: 'datum', value: draft.datum }, { name: 'uhrzeit', value: draft.uhrzeit },
      { name: 'limit', value: draft.limit }, { name: 'anonym', value: draft.anonym },
      ...(draft.info ? [{ name: 'info', value: draft.info }] : []),
      ...(team && team !== '-' ? [{ name: 'mannschaft', value: team }] : []),
    ];
    // Event wie bei /event anlegen, aber direkt in den Panel-Kanal posten
    const fake = { ...interaction, channel_id: draft.channelId, data: { name: 'event', options } };
    const res = await handleCreateEvent(fake, st, { postToChannel: true });
    await st.delete(`draft-${interaction.member.user.id}`);
    const body = JSON.parse(res.body);
    return json(200, { type: 7, data: { content: (body.data?.content || '✅ Gepostet!') + (body.data?.content?.startsWith('✅') ? ` → <#${draft.channelId}>` : ''), components: [] } });
  }

  // ---------- Spielplan / Freundschaftsspiele ----------
  if (id === 'bdp:sp_start') {
    return ephemeral('**🗓️ Spielplan** – für welches Team?', { components: [{ type: 1, components: Object.entries(KADER_TEAMS).map(([team, t]) => ({ type: 2, style: 1, label: t.label, custom_id: `bdp:sp_team:${team}` })) }] });
  }
  if (id.startsWith('bdp:sp_team:')) {
    const team = id.split(':')[2];
    const f = (cid, label, req, ph, style = 1, max = 60, value) => ({ type: 1, components: [{ type: 4, custom_id: cid, label, style, required: req, placeholder: ph, max_length: max, value }] });
    const d = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    return json(200, { type: 9, data: { custom_id: `bdp:sp_modal:${team}`, title: `Spielplan · ${KADER_TEAMS[team]?.label || ''}`.slice(0, 45), components: [
      f('datum', 'Datum (TT.MM.JJJJ)', true, '01.11.2026', 1, 10, d),
      f('treffen', 'Treffen (HH:MM)', true, '19:30', 1, 5),
      f('fs', 'Freundschaftsspiele (eins pro Zeile)', false, 'z. B. 19:45 Gegner FC', 2, 600),
      f('wettbewerb', 'Liga / Cup – Name (optional)', false, 'z. B. PL4 Quali Spiele', 1, 60),
      f('spiele', 'Liga/Cup-Spiele (pro Zeile, H/A am Ende)', false, 'z. B. 20:15 FCG ESPORTS A', 2, 900),
    ] } });
  }
  if (id.startsWith('bdp:sp_modal:')) {
    const team = id.split(':')[2];
    const datum = modalValue(interaction, 'datum'), treffen = modalValue(interaction, 'treffen');
    if (!/^\d{1,2}\.\d{1,2}\.(\d{2}|\d{4})$/.test(datum)) return ephemeral('❌ Datum bitte als **TT.MM.JJJJ** eintragen.');
    if (!/^\d{1,2}[:.]\d{2}$/.test(treffen)) return ephemeral('❌ Treffen bitte als **HH:MM** eintragen.');
    const { parseGames: parse } = require('./lib/schedule');
    const fs = parse(modalValue(interaction, 'fs')), games = parse(modalValue(interaction, 'spiele'));
    if (!fs.length && !games.length) return ephemeral('❌ Bitte mindestens ein Spiel eintragen (Freundschaftsspiel oder Liga/Cup).');
    const draft = { team, datum, treffen: treffen.replace('.', ':'), fs, wettbewerb: modalValue(interaction, 'wettbewerb') || 'Liga / Cup', games };
    await lineupStore().setJSON(`spdraft-${interaction.member.user.id}`, draft);
    return ephemeral(`**🗓️ Spielplan ${datum}** · ${fs.length + games.length} ${fs.length + games.length === 1 ? 'Spiel' : 'Spiele'}\nIn welchen Kanal posten?`, {
      components: [{ type: 1, components: [{ type: 8, custom_id: 'bdp:sp_ch', placeholder: 'Kanal auswählen…', channel_types: [0, 5], min_values: 1, max_values: 1, default_values: [{ id: interaction.channel_id, type: 'channel' }] }] }],
    });
  }
  if (id === 'bdp:sp_ch') {
    const st = lineupStore();
    const d = await st.get(`spdraft-${interaction.member.user.id}`, { type: 'json' });
    if (!d) return json(200, { type: 7, data: { content: 'Der Entwurf ist abgelaufen – bitte neu starten.', components: [] } });
    const S = require('./lib/schedule');
    const sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await S.store().setJSON(`sched-${sid}`, { id: sid, guildId: interaction.guild_id, channelId: interaction.data.values?.[0], team: d.team, teamLabel: KADER_TEAMS[d.team]?.label || 'CW BlueDragons', datum: d.datum, treffen: d.treffen, kick: parseKickoff(d.treffen, d.datum), fs: d.fs, wettbewerb: d.wettbewerb, games: d.games, messageId: null, lastChange: null });
    await st.delete(`spdraft-${interaction.member.user.id}`);
    await S.requestRender(sid);
    return json(200, { type: 7, data: { content: `✅ Spielplan für **${d.datum}** wird in <#${interaction.data.values?.[0]}> gepostet – das Bild erscheint in ein paar Sekunden.`, components: [] } });
  }

  if (id.startsWith('bdp:lu:')) {
    const team = id.split(':')[2];
    return json(200, { type: 9, data: { custom_id: `bdp:lu_modal:${team}`, title: `Aufstellung · ${KADER_TEAMS[team]?.label || ''}`.slice(0, 45), components: [{ type: 1, components: [{ type: 4, custom_id: 'titel', style: 1, label: 'Titel (optional)', required: false, max_length: 60, placeholder: 'z. B. Aufstellung Cup' }] }] } });
  }
  if (id.startsWith('bdp:lu_modal:')) {
    const team = id.split(':')[2];
    const titel = modalValue(interaction, 'titel');
    const options = [{ name: 'team', value: team }];
    if (titel) options.push({ name: 'titel', value: titel });
    return handleAufstellungCommand({ ...interaction, type: 2, data: { name: 'aufstellung', options } });
  }
  return ephemeral('Unbekannte Aktion.');
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  if (!verifySignature(event)) return json(401, { error: 'invalid request signature' });

  const interaction = JSON.parse(event.body);

  if (interaction.type === 1) return json(200, { type: 1 }); // PING -> PONG

  // Ultimate Team Cup: gleiche Discord-App, eigener Teil → Anfrage an /api/cup/interactions weiterreichen
  if (isCupInteraction(interaction)) {
    try {
      const res = await fetch(`${process.env.URL}/api/cup/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': event.headers['x-signature-ed25519'],
          'x-signature-timestamp': event.headers['x-signature-timestamp'],
        },
        body: event.body,
      });
      return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: await res.text() };
    } catch (e) {
      console.error('Cup weiterleiten:', e);
      return json(200, { type: 4, data: { content: '⚠️ Der Cup ist gerade nicht erreichbar – bitte gleich nochmal versuchen.', flags: 64 } });
    }
  }

  const store = getStore({
    name: 'rsvp-events',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });

  if (interaction.type === 2 && interaction.data?.name === 'event') {
    return handleCreateEvent(interaction, store);
  }

  if (interaction.type === 2 && interaction.data?.name === 'position') {
    return handlePositionCommand(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'rolle') {
    return handleRoleCommand();
  }

  if (interaction.type === 2 && interaction.data?.name === 'regeln') {
    if (!(await isKaderAdmin(interaction))) return ephemeral('⛔ Nur Admins können die Regeln posten.');
    const R = require('./lib/server-rules');
    if ((interaction.data.options || []).find((o) => o.name === 'aktion')?.value === 'status') {
      const st = await R.getState(), job = await R.backfillStatus();
      return ephemeral(`📊 **Server-Regeln**\n• Akzeptiert (neue Mitglieder): **${Object.keys(st.accepted || {}).length}**\n• Rolle: ${st.roleId ? `<@&${st.roleId}>` : '–'}\n• Bestehende Mitglieder: ${job ? `**${job.done}/${job.total}** haben „Verifiziert“ bekommen${job.todo?.length ? ' – läuft noch (alle 2 Min. weiter)' : ' ✅ fertig'}` : '–'}`);
    }
    const st = await R.markPosted(interaction.channel_id, interaction.guild_id);
    const info = st.first
      ? (st.role ? `✅ Rolle <@&${st.role.id}> ist bereit. **${st.queued}** bestehende Mitglieder bekommen sie jetzt automatisch (ca. ${Math.max(1, Math.ceil(st.queued / 50) * 2)} Min.). Stand prüfen: \`/regeln aktion: Status\`\n⚠️ Kanalrechte erst umstellen, wenn der Status „fertig“ zeigt.` : '⚠️ Die Rolle „Verifiziert“ konnte nicht angelegt werden – der Bot braucht „Rollen verwalten“.')
      : '';
    // Panel öffentlich in den Kanal posten, Hinweis nur für den Admin
    const post = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, { method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(R.rulesPanel()) });
    if (!post.ok) return ephemeral('⚠️ Konnte die Regeln hier nicht posten – der Bot braucht in diesem Kanal „Nachrichten senden“ und „Links einbetten“.');
    return ephemeral(`📜 Regeln gepostet.${info ? '\n' + info : ''}`);
  }

  if (interaction.type === 3 && String(interaction.data?.custom_id || '').startsWith('poll:')) {
    const P = require('./lib/polls');
    const [, act, pid, idx] = interaction.data.custom_id.split(':');
    if (act === 'end') {
      if (!(await isKaderAdmin(interaction))) return ephemeral('⛔ Nur Admins können die Umfrage beenden.');
      const p = await P.closePoll(pid);
      return ephemeral(p ? '🏁 Umfrage beendet – das Ergebnis steht jetzt in der Nachricht.' : 'Diese Umfrage ist schon beendet.');
    }
    const r = await P.vote(pid, interaction.member?.user?.id, Number(idx));
    if (r.error) return ephemeral(r.error);
    // Stimmenzahl in der Umfrage aktualisieren (ohne zu verraten, wer was gewählt hat)
    await fetch(`https://discord.com/api/v10/channels/${r.p.channelId}/messages/${r.p.messageId}`, { method: 'PATCH', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [P.liveEmbed(r.p)] }) }).catch(() => {});
    return ephemeral(r.removed ? '↩️ Deine Stimme wurde zurückgenommen.' : `🕵️ Deine Stimme: **${r.p.options[Number(idx)]}** – bleibt anonym. Nochmal klicken = zurücknehmen, anderer Name = ändern.`);
  }

  if (interaction.type === 3 && interaction.data?.custom_id === 'srules:ok') {
    const { already, roleOk } = await require('./lib/server-rules').accept(interaction.member?.user?.id, interaction.guild_id);
    if (!roleOk) return ephemeral('✅ Regeln akzeptiert – ⚠️ die Rolle „Verifiziert“ konnte aber nicht vergeben werden. Bitte melde dich bei einem Admin.');
    return ephemeral(already ? '✅ Du hast die Regeln bereits akzeptiert.' : '✅ **Danke!** Du hast die Server-Regeln akzeptiert – die **Rollenauswahl** ist jetzt für dich freigeschaltet.');
  }

  if (interaction.type === 2 && interaction.data?.name === 'test') {
    if (!(await isKaderAdmin(interaction))) return ephemeral('⛔ Nur Admins können testen.');
    const typ = (interaction.data.options || []).find((o) => o.name === 'typ')?.value || 'willkommen';
    const txt = await require('./lib/greetings').testGreeting(interaction.guild_id, interaction.member, typ);
    return ephemeral(`🧪 **Test: ${typ}**\n${txt}`);
  }

  if (interaction.type === 2 && interaction.data?.name === 'transfers') {
    if (!(await isKaderAdmin(interaction))) return ephemeral('⛔ Nur Admins können das Transfer-Panel posten.');
    return json(200, { type: 4, data: transferPanel() });
  }

  if (interaction.type === 2 && interaction.data?.name === 'panel') {
    return handlePanelCommand(interaction);
  }

  if ((interaction.type === 3 || interaction.type === 5) && String(interaction.data?.custom_id || '').startsWith('sched:')) {
    return handleSchedule(interaction);
  }

  if ((interaction.type === 3 || interaction.type === 5) && String(interaction.data?.custom_id || '').startsWith('bdp:')) {
    return handlePanelAction(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'kader') {
    return handleKaderCommand(interaction);
  }

  // Autovervollständigung (Clubsuche bei /session)
  if (interaction.type === 4 && interaction.data?.name === 'session') {
    return handleSessionAutocomplete(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'session') {
    return handleSessionStart(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'sessionend') {
    return handleSessionEnd(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'aufstellung') {
    return handleAufstellungCommand(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'aufstellungvorschlag') {
    return handleAufstellungVorschlagCommand(interaction);
  }

  if (interaction.type === 5 && interaction.data.custom_id.startsWith('ticketform:')) {
    return handleTicketModal(interaction);
  }

  if (interaction.type === 5 && interaction.data.custom_id.startsWith('kader:addmodal:')) {
    return handleKaderAddModal(interaction);
  }

  if (interaction.type === 5 && interaction.data.custom_id.startsWith('kader:nummodal:')) {
    return handleKaderModal(interaction);
  }

  if (interaction.type === 5 && interaction.data.custom_id.startsWith('lineup:pubmodal:')) {
    return handleLineupPub(interaction);
  }

  if (interaction.type === 5 && interaction.data.custom_id.startsWith('lineup:sendmodal:')) {
    return handleLineupSendModal(interaction);
  }

  if (interaction.type === 5 && interaction.data.custom_id.startsWith('lineup:guestmodal:')) {
    return handleLineupModal(interaction);
  }

  if (interaction.type === 3) {
    if (interaction.data.custom_id.startsWith('lineup:pub')) {
      return handleLineupPub(interaction);
    }
    if (interaction.data.custom_id.startsWith('lineup:')) {
      return handleLineupComponent(interaction);
    }
    if (interaction.data.custom_id.startsWith('kader:')) {
      return handleKaderButton(interaction);
    }
    if (interaction.data.custom_id.startsWith('posrole:')) {
      return handlePositionRoleButton(interaction);
    }
    if (interaction.data.custom_id.startsWith('posnick:')) {
      return handlePositionNickButton(interaction);
    }
    if (interaction.data.custom_id.startsWith('ticket:')) {
      return handleTicketButton(interaction);
    }
    if (interaction.data.custom_id.startsWith('genrole:')) {
      return handleRoleButton(interaction);
    }
    return handleButton(interaction, store);
  }

  return json(400, { error: 'unhandled interaction type' });
};
