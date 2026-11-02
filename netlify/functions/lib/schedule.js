// Spielplan als Bild (Freundschaftsspiele + Liga/Cup), bearbeitbar, mit Ergebnissen
const path = require('path');
const fs = require('fs');
const { getStore } = require('@netlify/blobs');

const API = 'https://discord.com/api/v10';
const auth = () => ({ Authorization: `Bot ${process.env.DISCORD_TOKEN}` });
const store = () => getStore({ name: 'lineups', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
const norm = (n) => String(n || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const DAYS = ['SONNTAG', 'MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG'];

function assetDir() {
  const c = [path.resolve(process.cwd(), 'netlify/cup-assets'), path.resolve(__dirname, '../../cup-assets'), '/var/task/netlify/cup-assets'];
  return c.find((d) => fs.existsSync(path.join(d, 'bd-logo-hd.png'))) || c[0];
}

/** „20:15 vs FCG ESPORTS (A)“ → { time, opp, ha } */
function parseGames(raw) {
  return String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d{1,2}[:.]\d{2})\s*(?:uhr\s*)?(?:vs\.?\s*)?(.+?)\s*(?:\(?\b(h|a|heim|auswärts|auswaerts)\b\)?)?$/i);
    if (!m) return { time: null, opp: l, ha: null };
    return { time: m[1].replace('.', ':'), opp: m[2].trim(), ha: m[3] ? (/^h/i.test(m[3]) ? 'H' : 'A') : null };
  }).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
}
const gameLine = (g) => `${g.time || ''} ${g.opp}${g.ha ? ' ' + g.ha : ''}`.trim();

/** Ergebnis „3-1“, „3:1“, „3 1“ → [3,1] (aus unserer Sicht) */
function parseScore(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})\s*[-:\s]\s*(\d{1,2})$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function weekday(datum) {
  const m = String(datum).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return '';
  const y = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
  return DAYS[new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]), 12)).getUTCDay()];
}

let fontsReady = false;
async function scheduleImage(s) {
  const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
  const dir = assetDir();
  if (!fontsReady) { GlobalFonts.registerFromPath(path.join(dir, 'fonts/BebasNeue-Regular.ttf'), 'Bebas Neue'); GlobalFonts.registerFromPath(path.join(dir, 'fonts/Montserrat.ttf'), 'Montserrat'); fontsReady = true; }
  const W = 1080, rowH = 78, gap = 12;
  const secH = (n) => (n ? 70 + n * (rowH + gap) + 20 : 0);
  const played = [...s.fs, ...s.games].filter((g) => g.res);
  const H = 470 + secH(s.fs.length) + secH(s.games.length) + (played.length ? 80 : 0) + 90;
  const c = createCanvas(W, H), x = c.getContext('2d');
  const gold = '#f2c14e', blue = '#2f7bff';
  const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#071233'); bg.addColorStop(0.5, '#050b22'); bg.addColorStop(1, '#030716');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const gl = x.createRadialGradient(W / 2, 170, 10, W / 2, 170, 520); gl.addColorStop(0, 'rgba(47,123,255,.45)'); gl.addColorStop(1, 'rgba(5,11,34,0)'); x.fillStyle = gl; x.fillRect(0, 0, W, 700);
  x.save(); x.translate(W - 170, -80); x.rotate(0.5); [[blue, .25], ['#dbe4f0', .15], [gold, .2]].forEach(([col, a], k) => { x.globalAlpha = a; x.fillStyle = col; x.fillRect(k * 38, 0, 38, 900); }); x.restore();
  x.save(); x.translate(60, -80); x.rotate(0.5); [[blue, .2], ['#dbe4f0', .1], [gold, .15]].forEach(([col, a], k) => { x.globalAlpha = a; x.fillStyle = col; x.fillRect(k * 30, 0, 30, 700); }); x.restore(); x.globalAlpha = 1;
  for (let i = 0; i < 60; i++) { x.globalAlpha = .2 + (i % 5) / 10; x.fillStyle = i % 3 ? '#fff' : gold; x.beginPath(); x.arc((i * 173) % W, (i * 97) % 600, 1 + (i % 3), 0, 7); x.fill(); } x.globalAlpha = 1;
  const logo = await loadImage(path.join(dir, 'bd-logo-hd.png')); const lh = 200, lw = lh * logo.width / logo.height;
  x.shadowColor = blue; x.shadowBlur = 40; x.drawImage(logo, W / 2 - lw / 2, 30, lw, lh); x.shadowBlur = 0;
  x.textBaseline = 'top'; x.textAlign = 'center';
  x.font = '700 24px Montserrat'; x.fillStyle = gold; x.fillText(String(s.teamLabel || '').toUpperCase(), W / 2, 242);
  const tg = x.createLinearGradient(0, 270, 0, 380); tg.addColorStop(0, '#fff'); tg.addColorStop(.6, '#cfd8e6'); tg.addColorStop(1, '#8a97ad');
  x.font = "118px 'Bebas Neue'"; x.fillStyle = tg; x.shadowColor = blue; x.shadowBlur = 22; x.fillText('SPIELPLAN', W / 2, 268); x.shadowBlur = 0;
  const pill = (cx, label, val) => { x.font = '700 24px Montserrat'; const w = Math.max(x.measureText(val).width, 120) + 70; const X = cx - w / 2, Y = 392; x.fillStyle = 'rgba(10,22,60,.9)'; x.strokeStyle = 'rgba(160,190,255,.7)'; x.lineWidth = 2; x.beginPath(); x.roundRect(X, Y, w, 60, 14); x.fill(); x.stroke(); x.font = '700 15px Montserrat'; x.fillStyle = gold; x.fillText(label, cx, Y + 8); x.font = '700 24px Montserrat'; x.fillStyle = '#fff'; x.fillText(val, cx, Y + 27); };
  pill(W / 2 - 170, 'DATUM', `${weekday(s.datum)} · ${s.datum}`.replace(/^ · /, '')); pill(W / 2 + 190, 'TREFFEN', `${s.treffen} UHR`);
  let y = 480;
  const section = (title, list, isComp) => {
    if (!list.length) return;
    x.textAlign = 'left'; x.font = "44px 'Bebas Neue'"; x.fillStyle = '#fff'; x.fillText(title.toUpperCase(), 70, y);
    const tw = x.measureText(title.toUpperCase()).width; x.fillStyle = blue; x.fillRect(70 + tw + 20, y + 22, Math.max(0, W - 140 - tw - 20), 3);
    y += 64;
    list.forEach((g) => {
      const X = 60, w = W - 120;
      const res = g.res; const out = res ? (res[0] > res[1] ? 'S' : res[0] < res[1] ? 'N' : 'U') : null;
      const oc = { S: '#23a55a', U: '#9aa6c4', N: '#e5484d' }[out];
      const rg = x.createLinearGradient(0, y, 0, y + rowH); rg.addColorStop(0, 'rgba(16,32,80,.95)'); rg.addColorStop(1, 'rgba(6,12,34,.95)');
      x.fillStyle = rg; x.strokeStyle = res ? oc : 'rgba(120,170,255,.55)'; x.lineWidth = res ? 3 : 2; x.beginPath(); x.roundRect(X, y, w, rowH, 14); x.fill(); x.stroke();
      x.fillStyle = blue; x.beginPath(); x.roundRect(X, y, 150, rowH, [14, 0, 0, 14]); x.fill();
      // Uhrzeit genau mittig im blauen Feld
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = "46px 'Bebas Neue'"; x.fillStyle = '#fff'; x.fillText(g.time || '–', X + 75, y + rowH / 2 + 3); x.textBaseline = 'top';
      x.textAlign = 'left'; x.textBaseline = 'middle'; x.font = '700 20px Montserrat'; x.fillStyle = gold; x.fillText('VS', X + 180, y + rowH / 2 + 1); x.textBaseline = 'top';
      const right = (isComp && g.ha ? 160 : 0) + (res ? 150 : 0) + 30;
      let fz = 40; const maxW = w - 228 - right; x.font = `${fz}px 'Bebas Neue'`; while (x.measureText(g.opp.toUpperCase()).width > maxW && fz > 24) { fz -= 2; x.font = `${fz}px 'Bebas Neue'`; }
      x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText(g.opp.toUpperCase(), X + 228, y + rowH / 2 + 3); x.textBaseline = 'top';
      let rx = X + w - 20;
      if (isComp && g.ha) { const home = g.ha === 'H'; const t = home ? 'HEIM' : 'AUSWÄRTS'; x.font = '700 18px Montserrat'; const bw = x.measureText(t).width + 30; rx -= bw; x.fillStyle = home ? 'rgba(35,165,90,.25)' : 'rgba(242,193,78,.18)'; x.strokeStyle = home ? '#23a55a' : gold; x.lineWidth = 2; x.beginPath(); x.roundRect(rx, y + 22, bw, 34, 17); x.fill(); x.stroke(); x.fillStyle = home ? '#5fe39a' : gold; x.textAlign = 'center'; x.fillText(t, rx + bw / 2, y + 30); x.textAlign = 'left'; rx -= 14; }
      if (res) { const t = `${res[0]}:${res[1]}`; x.font = "48px 'Bebas Neue'"; const bw = Math.max(110, x.measureText(t).width + 40); rx -= bw; x.fillStyle = oc; x.beginPath(); x.roundRect(rx, y + 12, bw, rowH - 24, 12); x.fill(); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, rx + bw / 2, y + rowH / 2 + 3); x.textBaseline = 'top'; x.textAlign = 'left'; }
      y += rowH + gap;
    });
    y += 20;
  };
  section('Freundschaftsspiele', s.fs, false);
  section(s.wettbewerb || 'Liga / Cup', s.games, true);
  if (played.length) {
    const S = played.filter((g) => g.res[0] > g.res[1]).length, U = played.filter((g) => g.res[0] === g.res[1]).length, N = played.length - S - U;
    const gf = played.reduce((a, g) => a + g.res[0], 0), ga = played.reduce((a, g) => a + g.res[1], 0);
    x.textAlign = 'center'; x.font = "40px 'Bebas Neue'"; x.fillStyle = '#fff';
    x.fillText(`BILANZ  ${S}S · ${U}U · ${N}N   ·   TORE ${gf}:${ga}`, W / 2, y);
    y += 70;
  }
  x.fillStyle = blue; x.fillRect(0, H - 8, W / 3, 8); x.fillStyle = '#dbe4f0'; x.fillRect(W / 3, H - 8, W / 3, 8); x.fillStyle = gold; x.fillRect((2 * W) / 3, H - 8, W / 3, 8);
  x.textAlign = 'center'; x.font = '600 20px Montserrat'; x.fillStyle = '#9fb0d0'; x.fillText('BITTE PÜNKTLICH IN DER LOBBY SEIN  ·  CW BLUEDRAGONS', W / 2, H - 56);
  return c.toBuffer('image/png');
}

/** Rollen für die Markierung: Team 1 → „Blue Dragons“ + „Dragons Tester“ · Late Night → „Late Night …“ */
async function pingRoles(guildId, team) {
  const res = await fetch(`${API}/guilds/${guildId}/roles`, { headers: auth() });
  const roles = res.ok ? await res.json() : [];
  const ok = (r) => r && !r.managed;
  const byIds = (env) => String(env || '').split(',').map((x) => x.trim()).filter(Boolean).map((id) => roles.find((r) => r.id === id)).filter(ok);
  if (String(team) === '2') {
    const fixed = byIds(process.env.LINEUP_PING_ROLE_ID_2);
    if (fixed.length) return fixed;
    return [roles.find((r) => ok(r) && norm(r.name).includes('latenight'))].filter(Boolean);
  }
  const fixed = byIds(process.env.LINEUP_PING_ROLE_ID);
  if (fixed.length) return fixed;
  const blue = roles.find((r) => ok(r) && norm(r.name) === 'bluedragons') || roles.find((r) => ok(r) && norm(r.name).includes('bluedragons'));
  const tester = roles.find((r) => ok(r) && norm(r.name).includes('dragonstester'));
  return [blue, tester].filter(Boolean);
}

function payload(s, imageName) {
  const all = [...s.fs, ...s.games];
  const lines = [`👤 Treffen **${s.treffen} Uhr**${s.kick ? ` (<t:${s.kick}:R>)` : ''}`];
  if (s.lastChange) lines.push(`**🔄 Aktualisiert:** ${s.lastChange}`);
  return {
    embeds: [{ color: 0x1f6bff, title: `🗓️ SPIELPLAN · ${weekday(s.datum)} ${s.datum}`.trim(), description: lines.join('\n'), image: { url: `attachment://${imageName}` }, footer: { text: `${s.teamLabel} · ${all.length} ${all.length === 1 ? 'Spiel' : 'Spiele'}` } }],
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: 'Freundschaftsspiel hinzufügen', emoji: { name: '➕' }, custom_id: `sched:add:${s.id}` },
      { type: 2, style: 1, label: 'Ergebnis eintragen', emoji: { name: '📝' }, custom_id: `sched:res:${s.id}` },
      { type: 2, style: 2, label: 'Bearbeiten', emoji: { name: '✏️' }, custom_id: `sched:edit:${s.id}` },
      { type: 2, style: 4, label: 'Löschen', emoji: { name: '🗑️' }, custom_id: `sched:del:${s.id}` },
    ] }],
    attachments: [{ id: 0, filename: imageName }],
  };
}

/** Posten (neu, mit Markierung) oder bestehende Nachricht aktualisieren (ohne Markierung) */
async function renderAndSend(id) {
  const st = store();
  const s = await st.get(`sched-${id}`, { type: 'json' });
  if (!s) return null;
  await st.delete(`schedjob-${id}`);
  const png = await scheduleImage(s);
  const imageName = 'spielplan.png';
  const body = payload(s, imageName);
  if (!s.messageId) {
    const roles = await pingRoles(s.guildId, s.team).catch(() => []);
    body.content = roles.map((r) => `<@&${r.id}>`).join(' ');
    body.allowed_mentions = { roles: roles.map((r) => r.id) };
  }
  const form = new FormData();
  form.append('payload_json', JSON.stringify(body));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), imageName);
  const url = s.messageId ? `${API}/channels/${s.channelId}/messages/${s.messageId}` : `${API}/channels/${s.channelId}/messages`;
  const res = await fetch(url, { method: s.messageId ? 'PATCH' : 'POST', headers: auth(), body: form });
  if (!res.ok) throw new Error(`Spielplan ${s.messageId ? 'aktualisieren' : 'posten'} fehlgeschlagen: ${res.status} ${await res.text()}`);
  if (!s.messageId) { s.messageId = (await res.json()).id; await st.setJSON(`sched-${id}`, s); }
  return s;
}

async function requestRender(id) {
  await store().setJSON(`schedjob-${id}`, { id, createdAt: Date.now() });
  try {
    await fetch(`${process.env.URL}/.netlify/functions/lineup-worker`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': process.env.CRON_SECRET || '' }, body: JSON.stringify({ action: 'schedule', id }), signal: AbortSignal.timeout(1200) });
  } catch { /* Timeout gewollt */ }
}

async function processPendingSchedules() {
  const { blobs } = await store().list({ prefix: 'schedjob-' });
  const out = [];
  for (const b of blobs) out.push(await renderAndSend(b.key.slice(9)).then(() => 'ok').catch((e) => e.message));
  return out;
}

module.exports = { parseGames, gameLine, parseScore, weekday, scheduleImage, pingRoles, renderAndSend, requestRender, processPendingSchedules, store };
