// Willkommens- und Abschiedsnachrichten.
// Netlify-Bots bekommen keine Live-Ereignisse von Discord – darum vergleicht der Bot alle 2 Minuten die Mitgliederliste:
// neu dabei → Willkommen, nicht mehr da → Good Bye. Beim allerersten Lauf wird nur die Liste gemerkt (keine 400 Nachrichten).
const { getStore } = require('@netlify/blobs');

const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}` });
const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9äöü]/g, '');
const store = () => getStore({ name: 'greetings', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });

function pick(channels, envId, keys) {
  return channels.find((c) => c.id === envId) || keys.map((k) => channels.find((c) => c.type === 0 && norm(c.name).includes(k))).find(Boolean) || null;
}

function welcomeMessage(uid, count, ch) {
  const steps = [
    ch.rules ? `1️⃣ 📜 Lies die **Regeln** in <#${ch.rules.id}> und klick auf **✅ Regeln akzeptieren**` : '1️⃣ 📜 Lies die **Regeln** und klick auf **✅ Regeln akzeptieren**',
    ch.roles ? `2️⃣ 🎭 Hol dir deine **Rollen** in <#${ch.roles.id}> – ProClubs, FUT, Late Night & mehr` : '2️⃣ 🎭 Hol dir danach deine **Rollen** – ProClubs, FUT, Late Night & mehr',
    '3️⃣ 💬 Sag Hallo, such dir Mitspieler und hab Spaß!',
  ];
  return {
    content: `<@${uid}>`,
    allowed_mentions: { users: [uid] },
    embeds: [{
      color: 0x1f6bff,
      author: { name: 'CW Community World', icon_url: `${process.env.URL}/blue-dragons-logo.png` },
      title: '🌍 WILLKOMMEN BEI CW COMMUNITY WORLD! 🔱',
      description: `Hey <@${uid}>, schön, dass du da bist! 💙\nDu bist unser **${count}. Mitglied** – willkommen in der **CW Community World**.\n\n**So geht's los:**\n${steps.join('\n')}\n\n⚽ Pro Clubs · 🃏 Ultimate Team · 🏆 Turniere · 🌙 Late Night Sessions`,
      thumbnail: { url: `${process.env.URL}/blue-dragons-logo.png` },
      image: { url: `${process.env.URL}/blue-dragons-banner.png` },
      footer: { text: 'CW Community World · Respekt. Zusammenhalt. Leidenschaft. 🔱' },
      timestamp: new Date().toISOString(),
    }],
  };
}

function goodbyeMessage(m, count) {
  return {
    embeds: [{
      color: 0x4e5058,
      author: { name: 'CW Community World', icon_url: `${process.env.URL}/blue-dragons-logo.png` },
      description: `👋 **${m.name}** hat CW Community World verlassen.\nMach's gut – die Tür bleibt offen! 🐉\n\n-# Wir sind jetzt **${count}** Mitglieder.`,
      thumbnail: m.avatar ? { url: m.avatar } : undefined,
      timestamp: new Date().toISOString(),
    }],
  };
}

async function listMembers(guildId) {
  const out = {};
  let after = '0';
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${API}/guilds/${guildId}/members?limit=1000&after=${after}`, { headers: auth() });
    if (!res.ok) throw new Error(`Mitgliederliste ${res.status} – „Server Members Intent“ im Developer Portal an?`);
    const list = await res.json();
    for (const m of list) {
      if (m.user?.bot) continue;
      const u = m.user;
      out[u.id] = { name: m.nick || u.global_name || u.username, avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null };
    }
    if (list.length < 1000) break;
    after = list[list.length - 1].user.id;
  }
  return out;
}

// Rollen, die jeder beim Beitritt automatisch bekommt (Namen tolerant: Emojis/Schrift egal)
// Fest einstellbar per Netlify-Variable AUTO_ROLE_IDS (IDs mit Komma getrennt)
const AUTO_ROLE_NAMES = ['Pro Clubs Member', 'FUT Member', 'CW Member'];

async function giveAutoRoles(guildId, userId, roles) {
  const ids = (process.env.AUTO_ROLE_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const wanted = ids.length ? roles.filter((r) => ids.includes(r.id)) : AUTO_ROLE_NAMES.map((n) => roles.find((r) => !r.managed && norm(r.name) === norm(n))).filter(Boolean);
  const given = [];
  for (const r of wanted) {
    const res = await fetch(`${API}/guilds/${guildId}/members/${userId}/roles/${r.id}`, { method: 'PUT', headers: { ...auth(), 'X-Audit-Log-Reason': encodeURIComponent('Automatisch beim Beitritt') } });
    if (res.ok) given.push(r.name);
  }
  return given;
}

async function guildRoles(guildId) {
  const res = await fetch(`${API}/guilds/${guildId}/roles`, { headers: auth() });
  return res.ok ? res.json() : [];
}

async function post(channelId, body) {
  const res = await fetch(`${API}/channels/${channelId}/messages`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.ok;
}

async function runGreetings(guildId) {
  const now = await listMembers(guildId);
  const st = await store().get('snapshot', { type: 'json' });
  await store().setJSON('snapshot', { members: now, at: Date.now() });
  if (!st) return { init: Object.keys(now).length };

  const joined = Object.keys(now).filter((id) => !st.members[id]);
  const left = Object.keys(st.members).filter((id) => !now[id]);
  if (!joined.length && !left.length) return null;
  // Sicherheitsbremse: bei sehr vielen Änderungen auf einmal (z. B. nach einer Panne) nichts posten
  if (joined.length > 25 || left.length > 25) return { skipped: { joined: joined.length, left: left.length } };

  const chRes = await fetch(`${API}/guilds/${guildId}/channels`, { headers: auth() });
  const channels = chRes.ok ? await chRes.json() : [];
  const ch = {
    welcome: pick(channels, process.env.WELCOME_CHANNEL_ID, ['willkommen', 'welcome']),
    bye: pick(channels, process.env.GOODBYE_CHANNEL_ID, ['byeallesgute', 'goodbye', 'byebye', 'aufwiedersehen', 'tschuess', 'abschied', 'allesgute']),
    rules: pick(channels, process.env.RULES_CHANNEL_ID, ['regeln', 'rules']),
    roles: pick(channels, process.env.ROLES_CHANNEL_ID, ['rollenauswahl', 'rollen']),
  };
  const count = Object.keys(now).length;
  let w = 0, b = 0, roleCount = 0;
  if (joined.length) {
    const roles = await guildRoles(guildId);
    for (const id of joined) roleCount += (await giveAutoRoles(guildId, id, roles)).length;
  }
  if (ch.welcome) for (const id of joined) if (await post(ch.welcome.id, welcomeMessage(id, count, ch))) w++;
  const byeCh = ch.bye || ch.welcome;
  if (byeCh) for (const id of left) if (await post(byeCh.id, goodbyeMessage(st.members[id], count))) b++;
  return { welcome: w, goodbye: b, autoRoles: roleCount, channels: { welcome: ch.welcome?.name || null, goodbye: byeCh?.name || null } };
}

/** /test: Willkommen / Good Bye / Beitritt für sich selbst ausprobieren */
async function testGreeting(guildId, member, typ) {
  const chRes = await fetch(`${API}/guilds/${guildId}/channels`, { headers: auth() });
  const channels = chRes.ok ? await chRes.json() : [];
  const ch = {
    welcome: pick(channels, process.env.WELCOME_CHANNEL_ID, ['willkommen', 'welcome']),
    bye: pick(channels, process.env.GOODBYE_CHANNEL_ID, ['byeallesgute', 'goodbye', 'byebye', 'aufwiedersehen', 'tschuess', 'abschied', 'allesgute']),
    rules: pick(channels, process.env.RULES_CHANNEL_ID, ['regeln', 'rules']),
    roles: pick(channels, process.env.ROLES_CHANNEL_ID, ['rollenauswahl', 'rollen']),
  };
  const uid = member.user.id;
  const count = (await listMembers(guildId).catch(() => ({ x: 1 }))) ;
  const n = Object.keys(count).length;
  const out = [];
  if (typ === 'willkommen' || typ === 'beitritt') {
    if (!ch.welcome) out.push('⚠️ Kein Willkommens-Kanal gefunden (Name mit „Willkommen“).');
    else { const m = welcomeMessage(uid, n, ch); m.embeds[0].footer.text += ' · 🧪 TEST'; out.push((await post(ch.welcome.id, m)) ? `✅ Willkommensnachricht in <#${ch.welcome.id}>` : '⚠️ Konnte nicht in den Willkommens-Kanal posten.'); }
  }
  if (typ === 'beitritt') {
    const given = await giveAutoRoles(guildId, uid, await guildRoles(guildId));
    out.push(given.length ? `✅ Automatische Rollen: **${given.join(', ')}**` : `⚠️ Keine Auto-Rollen vergeben – gibt es „${AUTO_ROLE_NAMES.join('“, „')}“ auf dem Server und steht der Bot darüber?`);
  }
  if (typ === 'goodbye') {
    const byeCh = ch.bye || ch.welcome;
    const name = member.nick || member.user.global_name || member.user.username;
    const avatar = member.user.avatar ? `https://cdn.discordapp.com/avatars/${uid}/${member.user.avatar}.png?size=128` : null;
    const m = goodbyeMessage({ name: `${name} (🧪 TEST)`, avatar }, n);
    out.push(byeCh && (await post(byeCh.id, m)) ? `✅ Good-Bye-Nachricht in <#${byeCh.id}>` : '⚠️ Kein Good-Bye-Kanal gefunden.');
  }
  return out.join('\n');
}

module.exports = { runGreetings, welcomeMessage, goodbyeMessage, testGreeting, giveAutoRoles, AUTO_ROLE_NAMES };
