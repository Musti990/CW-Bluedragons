// /latenight-einrichten: Kategorie „Late Night“ mit LNC-Call (Sprache), Latenight-Chat und Latenight-Abstimmung
const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' });
const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
// fett-kursive Schrift wie bei euren Kanälen (𝑨𝒃𝒄)
const bi = (s) => [...s].map((ch) => { const c = ch.codePointAt(0); if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d468 + c - 65); if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d482 + c - 97); return ch; }).join('');

const P = { VIEW: 1n << 10n, SEND: 1n << 11n, HISTORY: 1n << 16n, EMBED: 1n << 14n, FILES: 1n << 15n, REACT: 1n << 6n, CONNECT: 1n << 20n, SPEAK: 1n << 21n, VIDEO: 1n << 9n, VAD: 1n << 25n };
const bits = (...x) => x.reduce((a, b) => a | b, 0n).toString();

const CATEGORY = `~~~~~~ 🌙 ${bi('LATE NIGHT')} 🌙 ~~~~~~`;
const CHANNELS = [
  { key: 'lnccall', type: 2, name: `🎙️・${bi('LNC-Call')}`, kind: 'voice' },
  { key: 'latenightchat', type: 0, name: `💬・${bi('Latenight-Chat')}`, kind: 'chat' },
  { key: 'latenightabstimmung', type: 0, name: `🗳️・${bi('Latenight-Abstimmung')}`, kind: 'vote' },
];

async function setupLateNight(guildId) {
  const [chRes, roleRes] = await Promise.all([fetch(`${API}/guilds/${guildId}/channels`, { headers: auth() }), fetch(`${API}/guilds/${guildId}/roles`, { headers: auth() })]);
  const channels = chRes.ok ? await chRes.json() : [];
  const roles = roleRes.ok ? await roleRes.json() : [];
  const ln = roles.find((r) => r.id === process.env.LATENIGHT_ROLE_ID) || roles.find((r) => !r.managed && norm(r.name).includes('latenight'));
  if (!ln) return { error: 'Es gibt keine Rolle mit „Late Night“ im Namen (z. B. „Late Night Spieler“). Bitte zuerst anlegen.' };

  const hide = { id: guildId, type: 0, allow: '0', deny: bits(P.VIEW) };
  const ow = (kind) => {
    if (kind === 'voice') return [hide, { id: ln.id, type: 0, allow: bits(P.VIEW, P.CONNECT, P.SPEAK, P.VIDEO, P.VAD, P.SEND, P.HISTORY), deny: '0' }];
    if (kind === 'chat') return [hide, { id: ln.id, type: 0, allow: bits(P.VIEW, P.SEND, P.HISTORY, P.EMBED, P.FILES, P.REACT), deny: '0' }];
    return [hide, { id: ln.id, type: 0, allow: bits(P.VIEW, P.HISTORY, P.REACT), deny: bits(P.SEND) }]; // Abstimmung: nur per Button
  };

  const out = { created: [], found: [], role: ln.name };
  let cat = channels.find((c) => c.type === 4 && norm(c.name) === 'latenight');
  if (cat) out.found.push(CATEGORY);
  else {
    const r = await fetch(`${API}/guilds/${guildId}/channels`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: CATEGORY, type: 4, permission_overwrites: [hide, { id: ln.id, type: 0, allow: bits(P.VIEW), deny: '0' }] }) });
    if (!r.ok) return { error: `Kategorie konnte nicht angelegt werden (${r.status}) – der Bot braucht „Kanäle verwalten“.` };
    cat = await r.json(); out.created.push(CATEGORY);
  }
  for (const c of CHANNELS) {
    const ex = channels.find((x) => x.type === c.type && norm(x.name) === c.key);
    if (ex) {
      await fetch(`${API}/channels/${ex.id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ parent_id: cat.id, permission_overwrites: ow(c.kind) }) });
      out.found.push(ex.name);
      continue;
    }
    const r = await fetch(`${API}/guilds/${guildId}/channels`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: c.name, type: c.type, parent_id: cat.id, permission_overwrites: ow(c.kind) }) });
    if (r.ok) out.created.push(c.name);
  }
  return out;
}

module.exports = { setupLateNight, CATEGORY, CHANNELS };
