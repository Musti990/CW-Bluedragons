exports.handler = async () => {
  const appId = process.env.APPLICATION_ID;
  const guildId = process.env.GUILD_ID;
  const token = process.env.DISCORD_TOKEN;

  if (!appId || !token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'APPLICATION_ID oder DISCORD_TOKEN fehlt als Umgebungsvariable in Netlify.' }),
    };
  }

  const commands = [
    {
      name: 'event',
      description: 'Erstellt ein RSVP-Event mit Zusage/Vielleicht/Absage-Buttons',
      options: [
        { name: 'titel', description: 'Titel des Events', type: 3, required: true },
        { name: 'datum', description: 'Datum TT.MM.JJJJ', type: 3, required: true },
        { name: 'uhrzeit', description: 'Uhrzeit HH:MM', type: 3, required: true },
        { name: 'limit', description: 'Maximale Anzahl Zusagen', type: 4, required: true },
        { name: 'info', description: 'Zusatzinfo', type: 3, required: false },
        { name: 'beschreibung', description: 'Ausführlichere Beschreibung des Events', type: 3, required: false },
        { name: 'bild', description: 'Bild für das Event', type: 11, required: false },
        {
          name: 'mannschaft',
          description: 'Für welche Mannschaft?',
          type: 3,
          required: false,
          choices: [
            { name: '1. Mannschaft', value: '1 Mannschaft' },
            { name: '2. Mannschaft', value: '2 Mannschaft' },
            { name: 'Tester', value: 'Tester' },
          ],
        },
      ],
    },
    {
      name: 'position',
      description: 'Postet die Positionsauswahl (Position wird als Rolle vergeben)',
    },
    {
      name: 'rolle',
      description: 'Postet die Rollenwahl (Aushilfe, Tester, Late Night, ProClubs, FUT)',
    },
    {
      name: 'kader',
      description: 'Postet den Kader (Bild + Liste) mit Buttons zum Bearbeiten (nur Admins)',
      options: [
        {
          name: 'team',
          description: 'Welches Team?',
          type: 3,
          required: true,
          choices: [
            { name: 'Blue Dragons 1', value: '1' },
            { name: 'Late Night', value: '2' },
          ],
        },
      ],
    },
    {
      name: 'session',
      description: 'Startet eine Session: prüft alle 2 Minuten auf neue Spiele und postet die Statistiken',
      options: [
        {
          name: 'club',
          description: 'Clubnamen eintippen und aus der Liste wählen',
          type: 3,
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'sessionend',
      description: 'Beendet alle laufenden Sessions und postet die Bilanz (Spieler nach Ø-Rating)',
    },
    {
      name: 'aufstellung',
      description: 'Startet den Aufstellungs-Builder (Formation wählen, Spieler anklicken) – nur Admins',
      options: [
        {
          name: 'team',
          description: 'Welches Team?',
          type: 3,
          required: true,
          choices: [
            { name: 'Blue Dragons 1', value: '1' },
            { name: 'Late Night', value: '2' },
          ],
        },
        { name: 'titel', description: 'Titel (z.B. "Aufstellung Cup")', type: 3, required: false },
      ],
    },
  ];

  commands.push({
    name: 'regeln',
    description: 'Postet die Server-Regeln mit „Regeln akzeptieren“-Button – nur Admins',
    options: [{ name: 'aktion', description: 'Posten (Standard) oder Stand anzeigen', type: 3, required: false, choices: [{ name: 'Posten', value: 'posten' }, { name: 'Status', value: 'status' }] }],
  });

  commands.push({
    name: 'panel',
    description: 'Postet ein Bedien-Panel in diesen Kanal (Session oder Aufstellung) – nur Admins',
    options: [{ name: 'typ', description: 'Welches Panel?', type: 3, required: true, choices: [
      { name: 'Session (Spielberichte starten/beenden)', value: 'session' },
      { name: 'Aufstellung', value: 'aufstellung' },
    ] }],
  });

  const url = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`;

  // Bereits registrierte Cup-Befehle (/ut-…) behalten, sonst würde der PUT sie löschen
  try {
    const existing = await fetch(url, { headers: { Authorization: `Bot ${token}` } }).then((r) => (r.ok ? r.json() : []));
    for (const c of existing) {
      if (String(c.name).startsWith('ut-') && !commands.some((x) => x.name === c.name)) {
        const { id, application_id, guild_id, version, ...keep } = c;
        commands.push(keep);
      }
    }
  } catch (e) { console.error('Cup-Befehle behalten:', e); }

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  const data = await res.json();

  return {
    statusCode: res.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  };
};
