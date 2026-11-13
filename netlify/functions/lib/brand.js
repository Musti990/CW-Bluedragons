// Branding: derselbe Bot für verschiedene Server – Texte, Farben, Logo und Signatur.
// Auswahl über die Umgebungsvariable BRAND (z. B. "dynastie"); Standard: Blue Dragons.
const fs = require('fs');
const path = require('path');

const PRESETS = {
  bluedragons: {
    name: 'Blue Dragons', a: 'BLUE', b: 'DRAGONS', small: 'UNITED BY', s1: 'BLUE', s2: 'FIRE', long: 'UNITED BY BLUE FIRE', wm: 'BD',
    colors: {}, logoFile: null, credit: '',
  },
  dynastie: {
    name: 'Esports Dynastie', a: 'ESPORTS', b: 'DYNASTIE', small: 'WE ARE', s1: 'THE', s2: 'DYNASTY', long: 'WE ARE THE DYNASTY', wm: 'ED',
    // Blau → Lila, Gold bleibt Gold
    colors: { '#2f7bff': '#8b5cf6', '#1f6bff': '#7c3aed', '#8fc2ff': '#c4b5fd', '#1240b8': '#4c1d95', '#1d3a8a': '#3b1a7a', '#1a2650': '#26164a', '#0d1530': '#140c2c', '#0a1128': '#0e0820', '#111a3a': '#1b1036', '#2a3f7a': '#4a2f7a' },
    logoFile: 'brand-logo.png', credit: 'MustiBasha',
  },
};

const key = String(process.env.BRAND || 'bluedragons').toLowerCase();
const BRAND = { ...(PRESETS[key] || PRESETS.bluedragons) };
if (process.env.BRAND_CREDIT !== undefined) BRAND.credit = process.env.BRAND_CREDIT;

/** Eigenes Logo (netlify/brand/brand-logo.png) als { b64, w, h, mime } – oder null */
function brandLogo() {
  if (!BRAND.logoFile) return null;
  for (const dir of [path.join(__dirname, '..', '..', 'brand'), path.join(process.cwd(), 'netlify', 'brand'), path.join(process.cwd(), 'brand')]) {
    const f = path.join(dir, BRAND.logoFile);
    if (fs.existsSync(f)) { const buf = fs.readFileSync(f); return { b64: buf.toString('base64'), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: 'image/png' }; }
  }
  return null;
}

/** Farben austauschen + Signatur unten rechts */
function themeSvg(svg) {
  let out = String(svg);
  for (const [from, to] of Object.entries(BRAND.colors)) out = out.split(from).join(to).split(from.toUpperCase()).join(to);
  if (BRAND.credit) {
    const vb = out.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || out.match(/width="([\d.]+)"[^>]*height="([\d.]+)"/);
    if (vb) {
      const W = +vb[1], H = +vb[2];
      const tag = `<text x="${W - 22}" y="${H - 16}" text-anchor="end" font-family="DejaVu Sans" font-weight="bold" font-size="${Math.round(W / 64)}" letter-spacing="1" fill="#ffffff" fill-opacity="0.55">by ${BRAND.credit}</text>`;
      out = out.replace(/<\/svg>\s*$/, `${tag}</svg>`);
    }
  }
  return out;
}

module.exports = { BRAND, brandLogo, themeSvg };
