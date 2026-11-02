// Aufstellungs-Bild rendern und die ephemere Aufstellungs-Nachricht aktualisieren (nutzt sharp).

const { setupFonts } = require('./fonts');
setupFonts();
const sharp = require('sharp');
const { FORMATIONS } = require('./matchreport-svg');
const { buildLineupSvg } = require('./matchreport-svg');
const { lineupStore, getLineup, lineupEmbed, lineupComponents, KADER_TEAMS } = require('./lineup-core');
const { findKaderRole, getGuildRoles } = require('./kader-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildLineupMessage(lineup) {
  const imageName = `aufstellung-team${lineup.team}.png`;
  const svg = buildLineupSvg({
    teamName: KADER_TEAMS[lineup.team].label,
    title: lineup.title,
    formation: lineup.formation,
    players: lineup.players,
  });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  let roleName;
  try {
    roleName = findKaderRole(await getGuildRoles(lineup.guildId), lineup.team)?.name;
  } catch {
    roleName = undefined;
  }

  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({
      embeds: [lineupEmbed(lineup, roleName, imageName)],
      components: lineupComponents(lineup),
      attachments: [{ id: 0, filename: imageName }],
    })
  );
  form.append('files[0]', new Blob([png], { type: 'image/png' }), imageName);
  return form;
}

function webhook(appId, token, path = '') {
  return `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original${path}`;
}

// Die (ephemere) /aufstellung-Antwort um das Bild ergänzen
async function finishLineupPost({ key, appId, token }) {
  const store = lineupStore();
  const lineup = await getLineup(store, key);
  if (!lineup) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500);
    const res = await fetch(webhook(appId, token), { method: 'PATCH', body: await buildLineupMessage(lineup) });
    if (res.ok) {
      await store.setJSON(`token-${key}`, { appId, token });
      await store.delete(`pending-${key}`);
      await store.delete(`dirty-${key}`);
      return true;
    }
    if (res.status !== 404) throw new Error(`Aufstellung-Post fehlgeschlagen: ${res.status} ${await res.text()}`);
  }
  return false;
}

// Bestehende Aufstellungs-Nachricht neu rendern (über den gemerkten Interaktions-Token)
async function refreshLineup({ key }) {
  const store = lineupStore();
  const lineup = await getLineup(store, key);
  const tok = await store.get(`token-${key}`, { type: 'json' });
  await store.delete(`dirty-${key}`);
  if (!lineup || !tok) return false;
  const res = await fetch(webhook(tok.appId, tok.token), { method: 'PATCH', body: await buildLineupMessage(lineup) });
  if (!res.ok && res.status !== 404) throw new Error(`Aufstellung-Update fehlgeschlagen: ${res.status} ${await res.text()}`);
  return true;
}

// Fertige Aufstellung als Bild in einen Kanal posten
// Nachricht der veröffentlichten Aufstellung bauen (Bild + Embed + „Spieler ersetzen“-Button)
async function publishedPayload(pub, { ping = false } = {}) {
  const imageName = `aufstellung-team${pub.team}.png`;
  const svg = buildLineupSvg({ teamName: KADER_TEAMS[pub.team].label, title: pub.title, formation: pub.formation, players: pub.players });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  let roles = [];
  if (ping) roles = await require('./schedule').pingRoles(pub.guildId, pub.team).catch(() => []);
  const lines = [];
  if (pub.kickoff) lines.push(`⏰ **Anstoß:** <t:${pub.kickoff}:F> · <t:${pub.kickoff}:R>`);
  if (pub.note) lines.push(`📝 ${pub.note}`);
  if (pub.changes?.length) lines.push('', '**🔄 Änderungen**', ...pub.changes.slice(-8));
  const payload = {
    embeds: [{ color: 0x1f6bff, title: `📋 ${String(pub.title || 'Aufstellung').toUpperCase()}`, description: lines.join('\n') || undefined, image: { url: `attachment://${imageName}` }, footer: { text: `${KADER_TEAMS[pub.team].label} · Formation ${pub.formation}` } }],
    components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Spieler ersetzen', emoji: { name: '🔄' }, custom_id: `lineup:pubrep:${pub.id}` }] }],
    attachments: [{ id: 0, filename: imageName }],
  };
  if (ping) { payload.content = roles.map((r) => `<@&${r.id}>`).join(' '); payload.allowed_mentions = { roles: roles.map((r) => r.id) }; }
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), imageName);
  return form;
}

// Fertige Aufstellung als Bild in einen Kanal posten
async function publishLineup({ key, channelId, kickoff, note }) {
  const store = lineupStore();
  const lineup = await getLineup(store, key);
  await store.delete(`publish-${key}`);
  if (!lineup) return false;
  const pub = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), team: lineup.team, title: lineup.title, formation: lineup.formation, players: { ...lineup.players }, guildId: lineup.guildId, channelId, kickoff: kickoff || null, note: note || null, changes: [], createdAt: Date.now() };
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }, body: await publishedPayload(pub, { ping: true }) });
  if (!res.ok) throw new Error(`Aufstellung posten fehlgeschlagen: ${res.status} ${await res.text()}`);
  pub.messageId = (await res.json()).id;
  await store.setJSON(`pub-${pub.id}`, pub);
  await rememberLast(store, pub);
  return true;
}

// Für die Spieler-Umfrage nach der Session: Namen in Aufstellungs-Reihenfolge merken
async function rememberLast(store, pub) {
  const order = (FORMATIONS[pub.formation] || []).map((sl) => pub.players[sl.key]).filter(Boolean);
  await store.setJSON(`last-team-${pub.team}`, { names: order.map((n) => String(n).split('|')[0].trim()), title: pub.title, at: Date.now() });
}

// Nach „Spieler ersetzen“: Bild + Änderungsliste in derselben Nachricht neu setzen
async function republishLineup({ pubId }) {
  const store = lineupStore();
  await store.delete(`repub-${pubId}`);
  const pub = await store.get(`pub-${pubId}`, { type: 'json' });
  if (!pub?.messageId) return false;
  const res = await fetch(`https://discord.com/api/v10/channels/${pub.channelId}/messages/${pub.messageId}`, { method: 'PATCH', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }, body: await publishedPayload(pub) });
  if (!res.ok) throw new Error(`Aufstellung aktualisieren fehlgeschlagen: ${res.status} ${await res.text()}`);
  await rememberLast(store, pub);
  return true;
}

async function processPendingLineups() {
  const store = lineupStore();
  const done = [];
  const { blobs } = await store.list({ prefix: 'pending-' }).catch(() => ({ blobs: [] }));
  for (const b of blobs || []) {
    const pending = await store.get(b.key, { type: 'json' });
    if (pending && Date.now() - pending.createdAt < 14 * 60 * 1000) {
      await finishLineupPost(pending);
      done.push(b.key);
    } else {
      await store.delete(b.key);
    }
  }
  const { blobs: repubs } = await store.list({ prefix: 'repub-' }).catch(() => ({ blobs: [] }));
  for (const b of repubs || []) { await republishLineup({ pubId: b.key.slice(6) }).catch((e) => console.error(e)); done.push(b.key); }
  const { blobs: pubs } = await store.list({ prefix: 'publish-' }).catch(() => ({ blobs: [] }));
  for (const b of pubs || []) {
    const job = await store.get(b.key, { type: 'json' });
    if (job && Date.now() - job.createdAt < 30 * 60 * 1000) { await publishLineup(job).catch((e) => console.error(e)); done.push(b.key); }
    else await store.delete(b.key);
  }
  const { blobs: dirty } = await store.list({ prefix: 'dirty-' }).catch(() => ({ blobs: [] }));
  for (const b of dirty || []) {
    await refreshLineup({ key: b.key.replace('dirty-', '') }).catch(() => store.delete(b.key));
    done.push(b.key);
  }
  return done;
}

module.exports = { finishLineupPost, refreshLineup, processPendingLineups, publishLineup, republishLineup };
