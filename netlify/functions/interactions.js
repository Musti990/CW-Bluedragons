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
const {
  lineupStore, lineupKey, emptyLineup, getLineup, saveLineup,
  switchFormation, autoFill, lineupEmbed, lineupComponents, requestLineupRefresh, FORMATION_NAMES,
} = require('./lib/lineup-core');
const {
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
async function handleCreateEvent(interaction, store) {
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
    accepted: [],
    maybe: [],
    declined: [],
    reminderSent: false, // Erinnerung 2h vor Termin wurde noch nicht verschickt
    messageId: null,     // wird gleich nach dem Posten nachgetragen (für @-Erinnerung im Kanal)
  };

  await store.setJSON(eventId, ev);

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
  { name: 'Bluedragons Spieler', label: 'BD Spieler', tag: 'BD Spieler', emoji: '🐉', style: 1, row: 0 },
  { name: 'Aushilfe', label: 'Aushilfe', tag: 'Aushilfe', emoji: '🤝', style: 3, row: 0 },
  { name: 'Tester', label: 'Tester', tag: 'Tester', emoji: '🧪', style: 2, row: 1 },
  { name: 'Late Night Spieler', label: 'Late Night', tag: null, emoji: '🌙', style: 2, row: 1 },
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
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader });
  if (!rolesRes.ok) {
    return json(200, { type: 4, data: { content: 'Konnte Rollen nicht laden.', flags: 64 } });
  }
  const roles = await rolesRes.json();
  const role = roles.find((r) => r.name === roleName);

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
      content: `✅ Session gestartet für **${club.label}** (ID ${club.clubId}). Ich prüfe alle 2 Minuten auf neue Spiele und poste die Statistiken in #match-history.\nBeenden mit **/sessionend** – dann kommt die Session-Bilanz.`,
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
    ? `🏁 Session wird beendet: ${ending.join(', ')}.\nDie Bilanz kommt in ca. 2–4 Minuten in #match-history (letzte Spiele werden noch mitgenommen).`
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
    return ephemeral(`Wen willst du zum Kader von **${label}** hinzufügen? (bis zu 10 auf einmal)`, {
      components: [{ type: 1, components: [{ type: 5, custom_id: `kader:addsel:${team}`, placeholder: 'Spieler auswählen…', min_values: 1, max_values: 10 }] }],
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
  if (action === 'addsel' || action === 'remsel') {
    const role = findKaderRole(await getGuildRoles(guildId), team);
    if (!role) return updateEphemeral(`⚠️ Die Rolle **${KADER_TEAMS[team].roleName}** gibt es nicht.`);
    const add = action === 'addsel';
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
    return luUpd(await applyAndRefresh({ ...lineup, players: {} }, '🧹 Alle Positionen geleert.'));
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
    const next = { ...lineup, players: { ...lineup.players } };
    delete next.players[slotKey];
    return luUpd(await applyAndRefresh(next, `**${slotKey}** geleert.`));
  }

  if (action === 'pick') {
    const userId = interaction.data.values[0];
    const resolved = interaction.data.resolved || {};
    const member = resolved.members?.[userId];
    const user = resolved.users?.[userId];
    const rawNick = member?.nick || user?.global_name || user?.username || 'Spieler';
    const name = String(rawNick).split('|')[0].trim() || rawNick;
    const next = { ...lineup, players: { ...lineup.players, [slotKey]: name } };
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

async function handleLineupModal(interaction) {
  if (!(await isKaderAdmin(interaction))) return luEph('⛔ Nur Admins können die Aufstellung bearbeiten.');
  const [, , team, slotKey] = interaction.data.custom_id.split(':');
  const name = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
  const { store, key, lineup } = await loadLineupForEdit(interaction);
  if (!lineup) return luEph('Diese Aufstellung ist abgelaufen. Starte sie neu mit /aufstellung.');
  const next = { ...lineup, players: { ...lineup.players, [slotKey]: name } };
  next.guildId = interaction.guild_id;
  await saveLineup(store, key, next);
  await requestLineupRefresh({ action: 'refresh', key });
  return luEph(`**${slotKey}:** ${name} (Aushilfe)`);
}


// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  if (!verifySignature(event)) return json(401, { error: 'invalid request signature' });

  const interaction = JSON.parse(event.body);

  if (interaction.type === 1) return json(200, { type: 1 }); // PING -> PONG

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

  if (interaction.type === 5 && interaction.data.custom_id.startsWith('kader:nummodal:')) {
    return handleKaderModal(interaction);
  }

  if (interaction.type === 5 && interaction.data.custom_id.startsWith('lineup:guestmodal:')) {
    return handleLineupModal(interaction);
  }

  if (interaction.type === 3) {
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
    if (interaction.data.custom_id.startsWith('genrole:')) {
      return handleRoleButton(interaction);
    }
    return handleButton(interaction, store);
  }

  return json(400, { error: 'unhandled interaction type' });
};
