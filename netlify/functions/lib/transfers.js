// Transfers: Neuzugang/Abgang als Grafik (Logo + Name) → ✅-Transfers bzw. ❌-Abgänge und zusätzlich 📢-ProClubs-News
const path = require('path');
const fs = require('fs');
const { getStore } = require('@netlify/blobs');

const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}` });
const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9äöü]/g, '');
const store = () => getStore({ name: 'transfers', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
const WORKER_URL = () => `${process.env.URL}/.netlify/functions/transfer-worker`;

function assetDir() {
  const c = [path.resolve(process.cwd(), 'netlify/cup-assets'), path.resolve(__dirname, '../../cup-assets'), path.resolve(__dirname, '../cup-assets'), '/var/task/netlify/cup-assets'];
  return c.find((d) => fs.existsSync(path.join(d, 'bd-logo-hd.png'))) || c[0];
}

let fontsReady = false;
async function transferImage({ kind, name, position, number, club }) {
  const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
  const dir = assetDir();
  if (!fontsReady) {
    GlobalFonts.registerFromPath(path.join(dir, 'fonts/BebasNeue-Regular.ttf'), 'Bebas Neue');
    GlobalFonts.registerFromPath(path.join(dir, 'fonts/Montserrat.ttf'), 'Montserrat');
    fontsReady = true;
  }
  const W = 1200, H = 675, c = createCanvas(W, H), x = c.getContext('2d');
  const isIn = kind === 'in';
  const acc = isIn ? '#2f7bff' : '#e5484d', gold = '#f2c14e';
  const bg = x.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#040a1f'); bg.addColorStop(0.55, '#0b1a4a'); bg.addColorStop(1, '#040a1f');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(330, 340, 20, 330, 340, 420); glow.addColorStop(0, isIn ? 'rgba(47,123,255,.55)' : 'rgba(229,72,77,.45)'); glow.addColorStop(1, 'rgba(4,10,31,0)');
  x.fillStyle = glow; x.fillRect(0, 0, W, H);
  x.save(); x.translate(W - 220, -60); x.rotate(0.55);
  [[acc, 0.28], ['#dbe4f0', 0.18], [gold, 0.22]].forEach(([col, a], k) => { x.globalAlpha = a; x.fillStyle = col; x.fillRect(k * 46, 0, 46, 1100); });
  x.restore(); x.globalAlpha = 1;
  for (let i = 0; i < 70; i++) { x.globalAlpha = 0.25 + (i % 5) / 10; x.fillStyle = i % 3 ? '#fff' : gold; x.beginPath(); x.arc((i * 173) % W, (i * 97) % H, 1 + (i % 3), 0, 7); x.fill(); }
  x.globalAlpha = 1;
  const logo = await loadImage(path.join(dir, 'bd-logo-hd.png'));
  const lh = 470, lw = lh * logo.width / logo.height;
  x.shadowColor = acc; x.shadowBlur = 60; x.drawImage(logo, 330 - lw / 2, 340 - lh / 2, lw, lh); x.shadowBlur = 0;
  const X = 640;
  x.textBaseline = 'top';
  x.font = '700 26px Montserrat'; x.fillStyle = gold; x.fillText(isIn ? 'OFFIZIELL · CW BLUEDRAGONS' : 'CW BLUEDRAGONS · ABSCHIED', X, 92);
  const tg = x.createLinearGradient(0, 130, 0, 260); tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.6, '#cfd8e6'); tg.addColorStop(1, '#8a97ad');
  x.font = "150px 'Bebas Neue'"; x.fillStyle = tg; x.shadowColor = acc; x.shadowBlur = 24;
  x.fillText(isIn ? 'NEUZUGANG' : 'ABGANG', X - 4, 125); x.shadowBlur = 0;
  x.fillStyle = acc; x.fillRect(X, 285, 120, 7); x.fillStyle = '#dbe4f0'; x.fillRect(X + 120, 285, 120, 7); x.fillStyle = gold; x.fillRect(X + 240, 285, 120, 7);
  const N = String(name).toUpperCase();
  let fsz = 104; x.font = `${fsz}px 'Bebas Neue'`; while (x.measureText(N).width > W - X - 40 && fsz > 44) { fsz -= 4; x.font = `${fsz}px 'Bebas Neue'`; }
  x.fillStyle = '#ffffff'; x.fillText(N, X, 315);
  let y = 315 + fsz + 16;
  const chip = (label, val) => { x.font = '700 22px Montserrat'; const lab = label + '  '; let v = String(val); while (x.measureText(lab + v).width > W - X - 70 && v.length > 4) v = v.slice(0, -2) + '…'; const w = x.measureText(lab + v).width + 36; x.fillStyle = 'rgba(10,20,55,.85)'; x.strokeStyle = acc; x.lineWidth = 2; x.beginPath(); x.roundRect(X, y, w, 48, 12); x.fill(); x.stroke(); x.fillStyle = gold; x.fillText(label, X + 18, y + 13); x.fillStyle = '#fff'; x.fillText(v, X + 18 + x.measureText(lab).width, y + 13); y += 62; };
  if (position || number) chip(position ? 'POSITION' : 'NUMMER', [position, number ? `#${number}` : ''].filter(Boolean).join('  ·  '));
  if (club) chip(isIn ? 'VON' : 'ZIEL', club);
  x.fillStyle = acc; x.fillRect(0, H - 8, W / 3, 8); x.fillStyle = '#dbe4f0'; x.fillRect(W / 3, H - 8, W / 3, 8); x.fillStyle = gold; x.fillRect((2 * W) / 3, H - 8, W / 3, 8);
  x.font = '600 20px Montserrat'; x.fillStyle = '#9fb0d0'; x.fillText(isIn ? 'WILLKOMMEN BEI DEN DRACHEN!' : 'DANKE FÜR ALLES – ALLES GUTE!', X, H - 60);
  return c.toBuffer('image/png');
}

function findChannels(channels) {
  const pick = (envId, keys) => channels.find((c) => c.id === envId) || keys.map((k) => channels.find((c) => [0, 5].includes(c.type) && norm(c.name).includes(k))).find(Boolean) || null;
  return {
    in: pick(process.env.TRANSFER_IN_CHANNEL_ID, ['transfers', 'transfer', 'zugänge', 'zugaenge']),
    out: pick(process.env.TRANSFER_OUT_CHANNEL_ID, ['abgänge', 'abgaenge', 'abgang']),
    news: pick(process.env.NEWS_CHANNEL_ID, ['proclubsnews', 'news']),
  };
}

function message(t, fileName) {
  const isIn = t.kind === 'in';
  const who = t.userId ? `<@${t.userId}>` : `**${t.name}**`;
  let title, lines;
  if (isIn) {
    // Variante 1: „Here we go!“
    title = '🚨🐉 HERE WE GO!';
    const info = [t.club ? `Kommt von **${t.club}**` : '', t.position ? `Position: **${t.position}**` : ''].filter(Boolean).join(' · ');
    lines = [
      `**${t.name}** ➜ **CW BlueDragons** – deal done! ✅`,
      ...(info ? [info] : []),
      `Unterschrift ist trocken, Medizincheck bestanden, ${t.number ? `Trikot mit der **#${t.number}**` : 'Trikot'} liegt bereit. 🔵🟡`,
      '',
      `Willkommen in der Drachenhöhle, ${who}! 🔥`,
    ];
  } else {
    // Variante 2: „Abschied mit Stil“
    title = `👋 ES WAR UNS EINE EHRE, ${String(t.name).toUpperCase()}!`;
    lines = [
      t.club ? `Nach starker Zeit bei den BlueDragons geht es für dich weiter zu **${t.club}**.` : 'Nach starker Zeit bei den BlueDragons trennen sich unsere Wege.',
      'Alles Gute auf deinem Weg – **einmal Drache, immer Drache.** 🐉💙',
    ];
  }
  if (t.info) lines.push('', `📝 ${t.info}`);
  return {
    content: isIn && t.userId ? `<@${t.userId}>` : '',
    allowed_mentions: { users: isIn && t.userId ? [t.userId] : [] },
    embeds: [{ color: isIn ? 0x2f7bff : 0xe5484d, title: title.slice(0, 256), description: lines.join('\n'), image: { url: `attachment://${fileName}` }, footer: { text: `CW BlueDragons · ${isIn ? 'Neuzugang' : 'Abgang'}` }, timestamp: new Date().toISOString() }],
    attachments: [{ id: 0, filename: fileName }],
  };
}

async function postTransfer(t) {
  const png = await transferImage(t);
  const chRes = await fetch(`${API}/guilds/${t.guildId}/channels`, { headers: auth() });
  const ch = findChannels(chRes.ok ? await chRes.json() : []);
  const targets = [t.kind === 'in' ? ch.in : ch.out, ch.news].filter(Boolean);
  const fileName = `${t.kind === 'in' ? 'neuzugang' : 'abgang'}.png`;
  const done = [];
  for (const target of targets) {
    const form = new FormData();
    const body = message(t, fileName);
    if (target === ch.news) { body.content = ''; body.allowed_mentions = { parse: [] }; } // in den News niemanden pingen
    form.append('payload_json', JSON.stringify(body));
    form.append('files[0]', new Blob([png], { type: 'image/png' }), fileName);
    const res = await fetch(`${API}/channels/${target.id}/messages`, { method: 'POST', headers: auth(), body: form });
    if (res.ok) done.push(target.name); else console.error('transfer post', target.name, res.status, await res.text());
  }
  return { done, missing: { main: !(t.kind === 'in' ? ch.in : ch.out), news: !ch.news } };
}

/** Von interactions.js: Auftrag merken und Worker anstoßen (Rendern dauert länger als 3 s) */
async function requestTransfer(t) {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await store().setJSON(id, { ...t, createdAt: Date.now() });
  try {
    await fetch(WORKER_URL(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': process.env.CRON_SECRET || '' }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(1200) });
  } catch { /* Timeout gewollt */ }
  return id;
}

async function runJob(id) {
  const job = await store().get(id, { type: 'json' });
  if (!job) return null;
  await store().delete(id);
  return postTransfer(job);
}

/** Absicherung (session-check): liegengebliebene Aufträge nachholen */
async function processPendingTransfers() {
  const { blobs } = await store().list({ prefix: 'job-' });
  const out = [];
  for (const b of blobs) out.push(await runJob(b.key).catch((e) => ({ error: e.message })));
  return out;
}

module.exports = { transferImage, postTransfer, requestTransfer, runJob, processPendingTransfers, findChannels };
