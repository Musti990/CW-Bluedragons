const nacl = require('tweetnacl');
const { getStore } = require('@netlify/blobs');
const { remindEvent, listMissing } = require('./lib/reminder-core');
const {
  berlinToUtcTimestamp,
  getTopRoleName,
  buildEmbed,
  buildComponents,
} = require('./lib/event-core');
const { sessionStore, clubsForTeam, getSession, saveSession, newSession } = require('./lib/session-core');
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


// ---------- Positions-Auswahl im Nickname (/position hp / /position np) ----------
const POSITIONS = ['ZDM', 'ZIV', 'LIV', 'RIV', 'LM', 'RM', 'ZOM', 'ST', 'TW'];

function buildPositionButtons(prefix) {
  const rows = [];
  for (let i = 0; i < POSITIONS.length; i += 5) {
    const chunk = POSITIONS.slice(i, i + 5);
    rows.push({
      type: 1,
      components: chunk.map((p) => ({ type: 2, style: 1, label: p, custom_id: `posnick:${prefix}:${p}` })),
    });
  }
  return rows;
}

async function handlePositionCommand(interaction) {
  const sub = interaction.data.options?.[0]?.name; // 'hp' oder 'np'
  const prefix = sub === 'np' ? 'NP' : 'HP';
  const label = sub === 'np' ? 'Nebenposition' : 'Hauptposition';

  return json(200, {
    type: 4,
    data: {
      content: `Wähle deine ${label}:`,
      components: buildPositionButtons(prefix),
    },
  });
}

async function handlePositionNickButton(interaction) {
  const [, prefix, position] = interaction.data.custom_id.split(':'); // posnick:HP:ZDM
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' };

  const currentNick = interaction.member?.nick || interaction.member?.user?.username || 'Unbekannt';
  const baseName = currentNick.split('|')[0].trim();

  const tags = { HP: [], NP: [] };
  const tagRegex = /(HP|NP):\s*([A-ZÄÖÜ,]+)/g;
  let match;
  while ((match = tagRegex.exec(currentNick)) !== null) {
    tags[match[1]] = match[2].split(',').filter(Boolean);
  }

  const list = tags[prefix];
  const idx = list.indexOf(position);
  if (idx === -1) {
    list.push(position);
  } else {
    list.splice(idx, 1);
  }

  const parts = [baseName];
  if (tags.HP.length > 0) parts.push(`HP:${tags.HP.join(',')}`);
  if (tags.NP.length > 0) parts.push(`NP: ${tags.NP.join(',')}`);
  let newNick = parts.join(' | ');
  if (newNick.length > 32) newNick = newNick.slice(0, 32);

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ nick: newNick }),
  });

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
// name = exakter Rollenname auf dem Server, emoji/info nur für die Anzeige
const GENERAL_ROLES = [
  { name: 'Tester', emoji: '🧪', info: 'testet neue Bot-Funktionen' },
  { name: 'Aushilfe', emoji: '🤝', info: 'springt ein, wenn Spieler fehlen' },
  { name: 'Late Night Spieler', emoji: '🌙', info: 'spielt auch spät abends' },
];

function buildRoleComponents() {
  const rows = [];
  for (let i = 0; i < GENERAL_ROLES.length; i += 5) {
    const chunk = GENERAL_ROLES.slice(i, i + 5);
    rows.push({
      type: 1,
      components: chunk.map((r) => ({ type: 2, style: 1, label: r.name, emoji: { name: r.emoji }, custom_id: `genrole:${r.name}` })),
    });
  }
  return rows;
}

async function handleRoleCommand() {
  const base = process.env.URL || 'https://DEIN-SITE-NAME.netlify.app';
  const list = GENERAL_ROLES.map((r) => `${r.emoji} **${r.name}** – ${r.info}`).join('\n');
  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: '🐉 Blue Dragons · Rollenwahl',
          description: `Hol dir deine Rolle per Klick.\nNochmal klicken entfernt sie wieder.\n\n${list}`,
          color: 0x1f6bff,
          thumbnail: { url: `${base}/blue-dragons-logo.png` },
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

  return json(200, {
    type: 4,
    data: {
      content: hasRole ? `❌ Rolle **${roleName}** entfernt.` : `✅ Rolle **${roleName}** zugewiesen.`,
      flags: 64,
    },
  });
}

// ---------- /session und /sessionend ----------
// Antworten sind nur für den Auslöser sichtbar (flags: 64), damit im Kanal nur die Bilder stehen.
function teamOption(interaction) {
  const opt = (interaction.data.options || []).find((o) => o.name === 'team');
  return opt ? String(opt.value) : 'beide';
}

async function handleSessionStart(interaction) {
  const store = sessionStore();
  const clubs = clubsForTeam(teamOption(interaction));
  const userName = interaction.member?.user?.global_name || interaction.member?.user?.username || '';
  const started = [];
  const already = [];
  for (const club of clubs) {
    if (await getSession(store, club.clubId)) {
      already.push(club.label);
      continue;
    }
    await saveSession(store, newSession(club, userName));
    started.push(club.label);
  }
  const lines = [];
  if (started.length) lines.push(`✅ Session gestartet für **${started.join(' & ')}**. Ich prüfe alle 2 Minuten auf neue Spiele und poste die Statistiken in #match-history.`);
  if (already.length) lines.push(`ℹ️ Läuft schon: ${already.join(' & ')}`);
  lines.push('Beenden mit **/sessionend** – dann kommt die Session-Bilanz.');
  return json(200, { type: 4, data: { content: lines.join('\n'), flags: 64 } });
}

async function handleSessionEnd(interaction) {
  const store = sessionStore();
  const clubs = clubsForTeam(teamOption(interaction));
  const ending = [];
  for (const club of clubs) {
    const session = await getSession(store, club.clubId);
    if (!session) continue;
    session.endRequestedAt = Date.now();
    await saveSession(store, session);
    ending.push(`${club.label} (${session.matches.length} ${session.matches.length === 1 ? 'Spiel' : 'Spiele'} bisher)`);
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
  const { role, players } = await getKaderPlayers(interaction.guild_id, team);
  if (!role) return ephemeral(`⚠️ Die Rolle **${KADER_TEAMS[team].roleName}** gibt es auf dem Server nicht.`);

  // Sofort Liste + Buttons posten, das Bild ergänzt kader-worker ein paar Sekunden später
  await requestKaderRefresh({
    action: 'post',
    team,
    guildId: interaction.guild_id,
    appId: interaction.application_id,
    token: interaction.token,
  });
  return json(200, { type: 4, data: { embeds: [buildKaderEmbed(team, players, role.name)], components: kaderComponents(team) } });
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
