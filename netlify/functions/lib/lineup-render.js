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
// ---------- Bestätigen: X Min. vorher Erinnerung, Y Min. später entfernen ----------
const CONFIRM_BEFORE_MIN = 30;
const CONFIRM_GRACE_MIN = 5;
const hhmm = (unix) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(new Date(unix * 1000));
function confirmState(pub) {
  const ids = [...new Set(Object.values(pub.ids || {}).filter(Boolean))];
  const yes = ids.filter((u) => pub.confirm?.[u] === 'yes');
  return { total: ids.length, yes, open: ids.filter((u) => pub.confirm?.[u] !== 'yes'), closed: !!pub.removedDone || (pub.kickoff && Date.now() / 1000 > pub.kickoff) };
}

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
  const conf = confirmState(pub);
  if (conf.total) {
    if (pub.kickoff) lines.push(`✅ **Bitte bis ${hhmm(pub.kickoff - CONFIRM_BEFORE_MIN * 60)} Uhr bestätigen** – sonst wirst du ersetzt.`);
    lines.push('', `**Bestätigt (${conf.yes.length}/${conf.total})**`, conf.yes.length ? conf.yes.map((u) => `✅ <@${u}>`).join(' · ') : '–');
    if (conf.open.length) lines.push(`**Offen (${conf.open.length})**`, conf.open.map((u) => `⏳ <@${u}>`).join(' · '));
  }
  if (pub.changes?.length) lines.push('', '**🔄 Änderungen**', ...pub.changes.slice(-8));
  const payload = {
    embeds: [{ color: 0x1f6bff, title: `📋 ${String(pub.title || 'Aufstellung').toUpperCase()}`, description: lines.join('\n') || undefined, image: { url: `attachment://${imageName}` }, footer: { text: `${KADER_TEAMS[pub.team].label} · Formation ${pub.formation}` } }],
    components: [{ type: 1, components: [
      ...(conf.total && !conf.closed ? [
        { type: 2, style: 3, label: 'Bin dabei', emoji: { name: '✅' }, custom_id: `lineup:pubyes:${pub.id}` },
        { type: 2, style: 4, label: 'Kann nicht', emoji: { name: '❌' }, custom_id: `lineup:pubno:${pub.id}` },
      ] : []),
      { type: 2, style: 2, label: 'Spieler ersetzen', emoji: { name: '🔄' }, custom_id: `lineup:pubrep:${pub.id}` },
    ] }],
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
  const pub = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), team: lineup.team, title: lineup.title, formation: lineup.formation, players: { ...lineup.players }, ids: { ...(lineup.ids || {}) }, confirm: {}, guildId: lineup.guildId, channelId, kickoff: kickoff || null, note: note || null, changes: [], createdAt: Date.now() };
  // Fehlende Discord-IDs über den Kader nachschlagen (Name ohne „| HP:…“)
  try {
    const { getKaderPlayers } = require('./kader-core');
    const { players: pool } = await getKaderPlayers(pub.guildId, pub.team);
    const base = (n) => String(n || '').split('|')[0].trim().toLowerCase();
    for (const [slot, name] of Object.entries(pub.players)) if (!pub.ids[slot]) { const p = pool.find((x) => base(x.name) === base(name)); if (p) pub.ids[slot] = p.id; }
    for (const slot of Object.keys(pub.ids)) if (!pub.players[slot]) delete pub.ids[slot];
  } catch { /* ohne Kader: nur bekannte IDs */ }
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }, body: await publishedPayload(pub, { ping: true }) });
  if (!res.ok) throw new Error(`Aufstellung posten fehlgeschlagen: ${res.status} ${await res.text()}`);
  pub.messageId = (await res.json()).id;
  await store.setJSON(`pub-${pub.id}`, pub);
  await rememberLast(store, pub);
  // Alle eingesetzten Spieler direkt darunter markieren
  const uids = [...new Set(Object.values(pub.ids))];
  if (uids.length) {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
      content: `${uids.map((u) => `<@${u}>`).join(' ')} – ihr steht in der Aufstellung, bitte mit **✅ Bin dabei** bestätigen ☝️${pub.kickoff ? ` (bis ${hhmm(pub.kickoff - CONFIRM_BEFORE_MIN * 60)} Uhr)` : ''}`,
      allowed_mentions: { users: uids }, message_reference: { message_id: pub.messageId, fail_if_not_exists: false },
    }) }).catch(() => {});
  }
  return true;
}

// Für die Spieler-Umfrage nach der Session: Namen in Aufstellungs-Reihenfolge merken
async function rememberLast(store, pub) {
  const order = (FORMATIONS[pub.formation] || []).map((sl) => pub.players[sl.key]).filter(Boolean);
  await store.setJSON(`last-team-${pub.team}`, { names: order.map((n) => String(n).split('|')[0].trim()), title: pub.title, at: Date.now() });
}

/** Schnell: nur Embed-Text und Buttons aktualisieren (Bild bleibt) */
async function updatePublishedText(pub) {
  const form = await publishedPayload(pub);
  const body = JSON.parse(form.get('payload_json'));
  delete body.attachments;
  await fetch(`https://discord.com/api/v10/channels/${pub.channelId}/messages/${pub.messageId}`, { method: 'PATCH', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: body.embeds, components: body.components }) });
}

/** session-check: Erinnerung 30 Min. vorher, 5 Min. später Unbestätigte entfernen */
async function processConfirmations() {
  const store = lineupStore();
  const { blobs } = await store.list({ prefix: 'pub-' }).catch(() => ({ blobs: [] }));
  const now = Date.now() / 1000, out = [];
  const post = (ch, body) => fetch(`https://discord.com/api/v10/channels/${ch}/messages`, { method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const b of blobs || []) {
    const pub = await store.get(b.key, { type: 'json' });
    if (!pub?.kickoff || pub.removedDone || !pub.messageId) continue;
    if (now > pub.kickoff + 3600) { pub.removedDone = true; await store.setJSON(b.key, pub); continue; }
    const deadline = pub.kickoff - CONFIRM_BEFORE_MIN * 60;
    const open = confirmState(pub).open;
    if (!pub.remindedAt && now >= deadline) {
      pub.remindedAt = now;
      await store.setJSON(b.key, pub);
      if (open.length) {
        await post(pub.channelId, { content: open.map((u) => `<@${u}>`).join(' '), allowed_mentions: { users: open }, embeds: [{ color: 0xf2c14e, title: '⏰ LETZTE CHANCE – BITTE BESTÄTIGEN', description: `Ihr habt eure Teilnahme noch nicht bestätigt.\nKlickt **✅ Bin dabei** in der Aufstellung – **bis ${hhmm(now + CONFIRM_GRACE_MIN * 60)} Uhr**, sonst werdet ihr entfernt.` }], message_reference: { message_id: pub.messageId, fail_if_not_exists: false } });
        out.push({ erinnert: open.length });
      }
      continue;
    }
    if (pub.remindedAt && now >= pub.remindedAt + CONFIRM_GRACE_MIN * 60) {
      const removed = [];
      for (const [slot, uid] of Object.entries(pub.ids || {})) {
        if (!open.includes(uid)) continue;
        const name = String(pub.players[slot] || '').split('|')[0].trim();
        removed.push({ slot, name, uid });
        delete pub.players[slot]; delete pub.ids[slot];
        pub.changes = pub.changes || [];
        pub.changes.push(`${labelOf(pub, slot)}: ~~${name}~~ → **frei** (nicht bestätigt)`);
      }
      pub.removedDone = true;
      await store.setJSON(b.key, pub);
      if (removed.length) {
        await republishLineup({ pubId: pub.id }).catch(() => {});
        await post(pub.channelId, { allowed_mentions: { parse: [] }, embeds: [{ color: 0xe5484d, title: '🚫 AUS DER AUFSTELLUNG ENTFERNT', description: `${removed.map((r) => `**${labelOf(pub, r.slot)}:** ${r.name}`).join(' · ')} ${removed.length === 1 ? 'hat' : 'haben'} nicht bestätigt.\nDie Positionen sind jetzt **frei** – Admins: bitte über **🔄 Spieler ersetzen** neu besetzen.` }], message_reference: { message_id: pub.messageId, fail_if_not_exists: false } });
        out.push({ entfernt: removed.length });
      } else await updatePublishedText(pub).catch(() => {});
    }
  }
  return out;
}
const labelOf = (pub, slot) => (FORMATIONS[pub.formation] || []).find((x) => x.key === slot)?.label || slot;

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

module.exports = { finishLineupPost, refreshLineup, processPendingLineups, publishLineup, republishLineup, updatePublishedText, processConfirmations, CONFIRM_BEFORE_MIN };
