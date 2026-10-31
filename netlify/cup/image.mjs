// Siegerbild für die Hall of Fame (Stadion bei Nacht, Podest, Flaggen).
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { club } from "./data.mjs";

export function assetDir() {
  const tries = [
    path.resolve(process.cwd(), "netlify/cup-assets"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cup-assets"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../netlify/cup-assets"),
  ];
  return tries.find((p) => fs.existsSync(path.join(p, "fonts"))) || tries[0];
}
let fontsReady = false;
export function fonts() {
  if (fontsReady) return;
  const dir = assetDir();
  GlobalFonts.registerFromPath(path.join(dir, "fonts/BebasNeue-Regular.ttf"), "Bebas Neue");
  GlobalFonts.registerFromPath(path.join(dir, "fonts/Montserrat.ttf"), "Montserrat");
  fontsReady = true;
}

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const rr = (x, X, Y, w, h, r) => { if (x.roundRect) { x.beginPath(); x.roundRect(X, Y, w, h, r); } else { x.beginPath(); x.rect(X, Y, w, h); } };
const star = (x, cx, cy, r, col) => { x.fillStyle = col; x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.42 : r; x.lineTo(cx + q * Math.cos(a), cy + q * Math.sin(a)); } x.closePath(); x.fill(); };
function spaced(x, t, cx, y, sp, col) { const ws = [...t].map((ch) => x.measureText(ch).width), tw = ws.reduce((a, b) => a + b, 0) + sp * (t.length - 1); let px = cx - tw / 2; x.fillStyle = col; [...t].forEach((ch, i) => { x.fillText(ch, px, y); px += ws[i] + sp; }); return tw; }

function stadium(x, W, H, top, bot, pitch, seed) {
  const R = rng(seed), U = (a, b) => a + R() * (b - a);
  let g = x.createLinearGradient(0, 0, 0, top + 60); g.addColorStop(0, "#04081c"); g.addColorStop(1, "#162c6e"); x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 180; i++) { x.fillStyle = `rgba(255,255,255,${U(0.25, 0.8)})`; x.beginPath(); x.arc(U(0, W), U(0, top + 10), U(0.6, 1.8), 0, 7); x.fill(); }
  const bowl = (t, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(0, t + 30); for (let i = 0; i <= 40; i++) x.lineTo((W * i) / 40, t + 30 * Math.pow((2 * i) / 40 - 1, 2)); x.lineTo(W, pitch); x.lineTo(0, pitch); x.closePath(); x.fill(); };
  bowl(top, "#0a1028"); bowl(top + (bot - top) * 0.35, "#0e1634"); bowl(top + (bot - top) * 0.65, "#121c3e");
  const cols = ["255,255,255", "230,200,90", "200,60,60", "70,120,220", "120,200,255"];
  for (let i = 0; i < 9000; i++) { const px = U(0, W), py = U(top + 5, bot), base = top + 30 * Math.pow((2 * px) / W - 1, 2); if (py < base + 6) continue; x.fillStyle = `rgba(${cols[Math.floor(U(0, 5))]},${U(0.1, 0.42)})`; x.beginPath(); x.arc(px, py, U(0.8, 1.6), 0, 7); x.fill(); }
  const vx = W / 2, vy = -1000, at = (xb, y) => vx + ((xb - vx) * (y - vy)) / (H - vy);
  for (let i = 0; i < 16; i++) { const x0 = -W * 0.6 + i * ((W * 2.2) / 16), x1 = x0 + (W * 2.2) / 16; x.fillStyle = i % 2 ? "#1c6e34" : "#22803c"; x.beginPath(); x.moveTo(at(x0, pitch), pitch); x.lineTo(at(x1, pitch), pitch); x.lineTo(x1, H); x.lineTo(x0, H); x.closePath(); x.fill(); }
  x.strokeStyle = "rgba(240,240,240,.8)"; x.lineWidth = 2; x.beginPath(); x.moveTo(0, pitch + 2); x.lineTo(W, pitch + 2); x.stroke();
  for (const fx of [90, W - 90]) {
    const rg = x.createRadialGradient(fx, 60, 0, fx, 60, 170); rg.addColorStop(0, "rgba(225,235,255,.55)"); rg.addColorStop(1, "rgba(225,235,255,0)"); x.fillStyle = rg; x.fillRect(fx - 200, -120, 400, 360);
    x.fillStyle = "#1e243c"; x.fillRect(fx - 3, 70, 6, top + 40); x.fillStyle = "#282e46"; x.fillRect(fx - 42, 38, 84, 32);
    x.fillStyle = "#fffff5"; for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) { x.beginPath(); x.arc(fx - 34 + k * 17, 46 + r * 14, 5, 0, 7); x.fill(); }
  }
}

/** Altes Siegerbild (Fallback, falls die Vorlage fehlt) */
async function hallOfFameDrawn({ podium, title, sub, seed = 21 }) {
  fonts();
  const W = 1200, H = 675, D = 2;
  const c = createCanvas(W * D, H * D), x = c.getContext("2d");
  x.scale(D, D);
  stadium(x, W, H, 200, 440, 470, seed);
  const glow = x.createRadialGradient(W / 2, 430, 0, W / 2, 430, 380); glow.addColorStop(0, "rgba(255,220,120,.18)"); glow.addColorStop(1, "rgba(255,220,120,0)"); x.fillStyle = glow; x.fillRect(0, 0, W, H);
  const R = rng(seed + 77);
  for (let k = 0; k < 140; k++) { const cx = R() * W, cy = 90 + R() * 370; if (Math.abs(cx - W / 2) < 170 && cy < 300) continue; x.save(); x.translate(cx, cy); x.rotate(R() * 3); x.fillStyle = ["#e8c45c", "#ffffff", "#c0c8d7", "#cd7f32"][Math.floor(R() * 4)]; x.fillRect(-4, -1.5, 8, 3); x.restore(); }
  x.textBaseline = "top";
  x.font = '800 20px Montserrat'; const tw = spaced(x, "HALL OF FAME", W / 2, 22, 7, "#d7deee"); star(x, W / 2 - tw / 2 - 26, 34, 9, "#c9a227"); star(x, W / 2 + tw / 2 + 26, 34, 9, "#c9a227");
  x.font = '64px "Bebas Neue"'; const tt = title.toUpperCase();
  let gg = x.createLinearGradient(0, 60, 0, 118); gg.addColorStop(0, "#fce284"); gg.addColorStop(1, "#b8861a");
  x.shadowColor = "rgba(0,0,0,.8)"; x.shadowBlur = 12; x.shadowOffsetY = 4; x.fillStyle = gg; x.fillText(tt, (W - x.measureText(tt).width) / 2, 56);
  x.font = '600 16px Montserrat'; x.fillStyle = "#cdd4e6"; x.fillText(sub, (W - x.measureText(sub).width) / 2, 128);
  x.shadowColor = "transparent"; x.shadowBlur = 0; x.shadowOffsetY = 0;
  // Pokal (eigenes Design)
  const cx = W / 2, tp = 168, sc = 0.36, X = (v) => cx + (v - 512) * sc, Y = (v) => tp + (v - 300) * sc;
  gg = x.createLinearGradient(0, Y(290), 0, Y(640)); gg.addColorStop(0, "#fce284"); gg.addColorStop(1, "#b8861a"); x.fillStyle = gg; x.strokeStyle = gg;
  x.beginPath(); x.moveTo(X(392), Y(300)); x.quadraticCurveTo(X(392), Y(470), X(497), Y(505)); x.lineTo(X(527), Y(505)); x.quadraticCurveTo(X(632), Y(470), X(632), Y(300)); x.closePath(); x.fill();
  x.beginPath(); x.ellipse(cx, Y(302), 120 * sc, 14 * sc, 0, 0, 7); x.fill(); x.fillRect(X(498), Y(500), 28 * sc, 66 * sc);
  x.beginPath(); x.moveTo(X(470), Y(566)); x.lineTo(X(554), Y(566)); x.lineTo(X(586), Y(604)); x.lineTo(X(438), Y(604)); x.closePath(); x.fill(); x.fillRect(X(420), Y(604), 184 * sc, 36 * sc);
  x.lineWidth = 17 * sc; for (const sd of [-1, 1]) { x.beginPath(); x.ellipse(cx + sd * 124 * sc, Y(376), 44 * sc, 50 * sc, 0, 0, 7); x.stroke(); }
  // Podest
  const P = [[1, cx - 300, 150, ["#e6eaf2", "#8c94a6"]], [0, cx, 205, ["#fce284", "#b07e14"]], [2, cx + 300, 110, ["#e8aa6e", "#965824"]]];
  const base = H - 26, bw = 270, dir = assetDir();
  for (const [idx, px, bh, c2] of P) {
    const p = podium[idx]; if (!p) continue;
    const bt = base - bh;
    let gr = x.createLinearGradient(0, bt, 0, base); gr.addColorStop(0, c2[0]); gr.addColorStop(1, c2[1]); x.fillStyle = gr; rr(x, px - bw / 2, bt, bw, bh, 8); x.fill();
    const big = idx === 0 ? 92 : 74; x.font = `${big}px "Bebas Neue"`; x.fillStyle = "rgba(40,30,10,.55)"; const n = String(idx + 1); x.fillText(n, px - x.measureText(n).width / 2, bt + (bh - big) / 2);
    const nf = idx === 0 ? 46 : 38, mf = idx === 0 ? 19 : 16;
    x.font = `${nf}px "Bebas Neue"`; const nm = p.club.toUpperCase(); const nw = x.measureText(nm).width;
    x.font = `600 ${mf}px Montserrat`; const mtext = p.mgr ? "@" + p.mgr : ""; const mw = x.measureText(mtext).width;
    const pw = Math.min(Math.max(nw, mw) + 44, bw + 60), ym = bt - mf - 18, yn = ym - nf - 2;
    x.fillStyle = "rgba(4,10,30,.82)"; x.strokeStyle = c2[0]; x.lineWidth = 2; rr(x, px - pw / 2, yn - 4, pw, ym + mf + 10 - (yn - 4), 10); x.fill(); x.stroke();
    x.font = `${nf}px "Bebas Neue"`; x.fillStyle = "#fff"; x.fillText(nm, px - nw / 2, yn);
    x.font = `600 ${mf}px Montserrat`; x.fillStyle = "#96cdff"; x.fillText(mtext, px - mw / 2, ym);
    const fs_ = idx === 0 ? 62 : 52, code = club(p.club)?.code;
    if (code) { try { const im = await loadImage(path.join(dir, `flags/${code}.png`)); x.drawImage(im, px - fs_ / 2, yn - fs_ - 14, fs_, fs_); } catch {} }
  }
  x.strokeStyle = "#2f7bff"; x.lineWidth = 2; x.strokeRect(10, 10, W - 20, H - 20);
  return c.toBuffer("image/png");
}

/** Text so klein machen, bis er in die Breite passt */
function fit(x, text, font, size, maxW, minSize = 18) {
  let s = size;
  while (s > minSize) { x.font = font.replace("{s}", s); if (x.measureText(text).width <= maxW) break; s -= 2; }
  x.font = font.replace("{s}", s);
  return s;
}

/**
 * Siegerbild mit deiner Vorlage „Champions Cup Hall of Fame“.
 * podium: [{ club, mgr }] (Platz 1–3), title: z. B. "Champions League · Montag, 26.10.", sub: Untertitel
 */
export async function hallOfFameImage({ podium, title, sub, seed }) {
  const dir = assetDir();
  const tpl = path.join(dir, "hof-template.jpg");
  if (!fs.existsSync(tpl)) return hallOfFameDrawn({ podium, title, sub, seed });
  fonts();
  const bg = await loadImage(tpl);
  const W = bg.width, H = bg.height;
  const c = createCanvas(W, H), x = c.getContext("2d");
  x.drawImage(bg, 0, 0, W, H);
  // Felder in den Wappen (Koordinaten der Vorlage 1672 × 941)
  const k = W / 1672;
  const slots = [
    // cx/cy = gemessene Mitte der leeren Wappenfläche
    { i: 0, cx: 823, cy: 683, w: 400, flag: 76, name: 64, mgr: 26, glow: "rgba(255,200,80,.95)", col: "#fff4cf" },
    { i: 1, cx: 297, cy: 688, w: 290, flag: 60, name: 50, mgr: 21, glow: "rgba(200,220,255,.95)", col: "#ffffff" },
    { i: 2, cx: 1364, cy: 700, w: 290, flag: 60, name: 50, mgr: 21, glow: "rgba(255,160,90,.95)", col: "#ffe6d2" },
  ];
  x.textBaseline = "top";
  for (const sl of slots) {
    const p = podium[sl.i];
    if (!p) continue;
    const cx = sl.cx * k, w = sl.w * k;
    // Höhe des ganzen Blocks berechnen und senkrecht mittig setzen
    const nameTxt = p.club.toUpperCase();
    const nsz = fit(x, nameTxt, '{s}px "Bebas Neue"', Math.round(sl.name * k), w);
    const blockH = sl.flag * k + 6 * k + nsz + 4 * k + (p.mgr ? sl.mgr * k : 0);
    let y = sl.cy * k - blockH / 2;
    const code = club(p.club)?.code;
    if (code) {
      try {
        const im = await loadImage(path.join(dir, `flags/${code}.png`));
        const fs_ = sl.flag * k;
        x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 10 * k;
        x.drawImage(im, cx - fs_ / 2, y, fs_, fs_);
        y += fs_ + 6 * k;
      } catch {}
    }
    // Vereinsname
    const name = p.club.toUpperCase();
    const ns = fit(x, name, '{s}px "Bebas Neue"', Math.round(sl.name * k), w);
    x.shadowColor = sl.glow; x.shadowBlur = 18 * k; x.fillStyle = sl.col;
    x.fillText(name, cx - x.measureText(name).width / 2, y);
    x.shadowBlur = 6 * k; x.shadowColor = "rgba(0,0,0,.9)";
    x.fillText(name, cx - x.measureText(name).width / 2, y);
    y += ns + 4 * k;
    // Manager
    if (p.mgr) {
      const m = "@" + p.mgr;
      fit(x, m, '600 {s}px Montserrat', Math.round(sl.mgr * k), w, 12);
      x.shadowColor = "rgba(0,0,0,.9)"; x.shadowBlur = 8 * k; x.fillStyle = "#9fd0ff";
      x.fillText(m, cx - x.measureText(m).width / 2, y);
    }
  }
  // Unten: Cup und Finale
  const line = `${title}${sub ? "   ·   " + sub : ""}`;
  fit(x, line, '600 {s}px Montserrat', Math.round(22 * k), W - 120 * k, 12);
  const lw = x.measureText(line).width, ly = H - 50 * k;
  x.shadowBlur = 0; x.fillStyle = "rgba(4,10,30,.72)";
  const pad = 18 * k, bh = 38 * k;
  if (x.roundRect) { x.beginPath(); x.roundRect(W / 2 - lw / 2 - pad, ly - 8 * k, lw + pad * 2, bh, bh / 2); x.fill(); } else x.fillRect(W / 2 - lw / 2 - pad, ly - 8 * k, lw + pad * 2, bh);
  x.strokeStyle = "rgba(47,123,255,.9)"; x.lineWidth = 2 * k; if (x.roundRect) x.stroke();
  x.fillStyle = "#e8edf8"; x.fillText(line, W / 2 - lw / 2, ly);
  return c.toBuffer("image/png");
}
