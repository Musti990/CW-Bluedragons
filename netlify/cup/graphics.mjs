// Spielplan-Grafiken im CW-Community-World-Look: Tabelle (Gruppe/Liga) und Runden-Übersicht (Spieltag / K.-o.)
import { createCanvas, loadImage } from "@napi-rs/canvas";
import path from "node:path";
import { assetDir, fonts } from "./image.mjs";

const rr = (x, X, Y, w, h, r) => { x.beginPath(); x.roundRect ? x.roundRect(X, Y, w, h, r) : x.rect(X, Y, w, h); };
const PF = { ps: "PS5", xbox: "XBOX", pc: "PC" };
const BLUE = "#2f8bff", ICE = "#9fd0ff", SILVER = ["#ffffff", "#c9d3e3", "#7d8aa3"];

function fit(x, text, font, size, maxW, min = 12) {
  let s = size; while (s > min) { x.font = font.replace("{s}", s); if (x.measureText(text).width <= maxW) break; s -= 1; }
  x.font = font.replace("{s}", s); return s;
}

/** Hintergrund + Kopf mit CW-Logo + großem Silber-Titel. Gibt die y-Position unter dem Titel zurück. */
async function frame(x, W, H, title, sub) {
  const dir = assetDir();
  const bg = await loadImage(path.join(dir, "cw-bg.jpg"));
  // Hintergrund „cover“
  const s = Math.max(W / bg.width, H / bg.height);
  x.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  const fade = x.createLinearGradient(0, 0, 0, H); fade.addColorStop(0, "rgba(2,6,20,.15)"); fade.addColorStop(1, "rgba(2,6,20,.75)");
  x.fillStyle = fade; x.fillRect(0, 0, W, H);
  // Kopf
  const hd = await loadImage(path.join(dir, "cw-header.jpg"));
  const hh = W * (hd.height / hd.width);
  x.drawImage(hd, 0, 0, W, hh);
  const hf = x.createLinearGradient(0, hh * 0.88, 0, hh); hf.addColorStop(0, "rgba(2,6,20,0)"); hf.addColorStop(1, "rgba(2,6,20,.9)");
  x.fillStyle = hf; x.fillRect(0, hh * 0.88, W, hh * 0.12 + 2);
  // Titel in Silber
  let y = hh + W * 0.004;
  const ts = fit(x, title.toUpperCase(), '{s}px "Bebas Neue"', Math.round(W * 0.085), W * 0.86);
  const g = x.createLinearGradient(0, y, 0, y + ts); g.addColorStop(0, SILVER[0]); g.addColorStop(0.55, SILVER[1]); g.addColorStop(1, SILVER[2]);
  x.textBaseline = "top";
  x.shadowColor = "rgba(47,139,255,.9)"; x.shadowBlur = W * 0.02; x.fillStyle = g;
  const T = title.toUpperCase(); x.fillText(T, (W - x.measureText(T).width) / 2, y);
  x.shadowBlur = 0; x.lineWidth = Math.max(1, W * 0.0015); x.strokeStyle = "rgba(10,20,50,.9)"; x.strokeText(T, (W - x.measureText(T).width) / 2, y);
  y += ts + W * 0.012;
  if (sub) {
    // Untertitel-Band wie im Banner
    fit(x, sub, '600 {s}px Montserrat', Math.round(W * 0.022), W * 0.7);
    const sw = x.measureText(sub).width, bh = W * 0.045, bx = (W - sw) / 2 - W * 0.04;
    x.fillStyle = "rgba(4,12,34,.92)"; x.strokeStyle = "rgba(170,200,255,.8)"; x.lineWidth = Math.max(1, W * 0.0018);
    x.beginPath(); x.moveTo(bx, y + bh / 2); x.lineTo(bx + bh * 0.4, y); x.lineTo(W - bx - bh * 0.4, y); x.lineTo(W - bx, y + bh / 2); x.lineTo(W - bx - bh * 0.4, y + bh); x.lineTo(bx + bh * 0.4, y + bh); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = "#e8eefb"; x.textBaseline = "middle"; x.fillText(sub, (W - sw) / 2, y + bh / 2 + 1); x.textBaseline = "top";
    y += bh + W * 0.02;
  }
  return y;
}

function chip(x, X, Y, h, label) {
  x.font = `600 ${Math.round(h * 0.42)}px Montserrat`;
  const w = x.measureText(label).width + h * 0.5;
  x.fillStyle = "rgba(47,139,255,.18)"; x.strokeStyle = "rgba(47,139,255,.7)"; x.lineWidth = 1.5; rr(x, X, Y, w, h, h / 3); x.fill(); x.stroke();
  x.fillStyle = ICE; x.textBaseline = "middle"; x.fillText(label, X + h * 0.25, Y + h / 2 + 1); x.textBaseline = "top";
  return w;
}

/**
 * Tabelle (Gruppe oder Liga).
 * rows: [{ name, platform, sp, s, u, n, td, p, out }], qualify: wie viele gehen sicher weiter, maybe: wie viele auf „Wackelplatz“
 */
export async function tableImage({ title, sub, info, label, rows, qualify = 2, maybe = 0 }) {
  fonts();
  const W = 1600, rowH = 62, head = 470, H = head + 70 + 56 + rows.length * rowH + 110;
  const c = createCanvas(W, H), x = c.getContext("2d");
  let y = await frame(x, W, H, title, sub);
  y = Math.max(y, head - 20);
  const X0 = 70, TW = W - 140;
  // Rahmen
  x.shadowColor = "rgba(47,139,255,.7)"; x.shadowBlur = 24; x.fillStyle = "rgba(3,8,24,.9)"; rr(x, X0, y, TW, 70 + 56 + rows.length * rowH + 8, 14); x.fill(); x.shadowBlur = 0;
  x.strokeStyle = "rgba(160,190,255,.85)"; x.lineWidth = 2.5; x.stroke();
  // Info-Zeile
  x.textBaseline = "middle"; let lx = X0 + 30;
  const leg = (col, t) => { x.fillStyle = col; x.fillRect(lx, y + 26, 8, 22); lx += 18; x.font = "500 23px Montserrat"; x.fillStyle = "#cfd8ee"; x.fillText(t, lx, y + 37); lx += x.measureText(t).width + 34; };
  if (info) leg(BLUE, info);
  if (maybe) leg("#f2c14e", "beste Dritte");
  x.font = '40px "Bebas Neue"'; x.fillStyle = "#ffffff"; const lb = (label || "").toUpperCase(); x.fillText(lb, X0 + TW - 30 - x.measureText(lb).width, y + 38);
  y += 70;
  // Spaltenkopf
  const cols = [["POS", 90], ["SPIELER", 520], ["SP", 110], ["S", 110], ["U", 110], ["N", 110], ["TD", 140], ["PKT", 150]];
  const sc = TW / cols.reduce((a, b) => a + b[1], 0);
  let cx = X0; const cxs = cols.map(([n, w]) => { const r = [cx, w * sc]; cx += w * sc; return r; });
  x.fillStyle = "rgba(47,139,255,.22)"; x.fillRect(X0 + 2, y, TW - 4, 56);
  x.font = "700 22px Montserrat"; x.fillStyle = ICE;
  cols.forEach(([n], k) => { const [a, w] = cxs[k]; const tx = k === 1 ? a + 24 : a + (w - x.measureText(n).width) / 2; x.fillText(n, tx, y + 29); });
  y += 56;
  // Zeilen
  rows.forEach((r, i) => {
    const Y = y + i * rowH;
    const q = !r.out && i < qualify, m = !r.out && !q && i < qualify + maybe;
    x.fillStyle = i % 2 ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.07)"; x.fillRect(X0 + 2, Y, TW - 4, rowH);
    if (q || m) { x.fillStyle = q ? BLUE : "#f2c14e"; x.fillRect(X0 + 2, Y + 6, 6, rowH - 12); }
    x.strokeStyle = "rgba(160,190,255,.15)"; x.lineWidth = 1; x.beginPath(); x.moveTo(X0 + 2, Y + rowH); x.lineTo(X0 + TW - 2, Y + rowH); x.stroke();
    const mid = Y + rowH / 2 + 1;
    x.textBaseline = "middle";
    x.font = "500 30px Montserrat"; x.fillStyle = r.out ? "#6c7690" : "#dfe6f6";
    const pos = String(i + 1); x.fillText(pos, cxs[0][0] + (cxs[0][1] - x.measureText(pos).width) / 2, mid);
    // Name + Plattform
    const [na, nw] = cxs[1];
    let nx = na + 24;
    if (r.platform && PF[r.platform]) nx += chip(x, nx, Y + rowH / 2 - 15, 30, PF[r.platform]) + 14;
    fit(x, r.name, '{s}px "Bebas Neue"', 40, na + nw - nx - 10, 20);
    x.textBaseline = "middle";
    x.fillStyle = r.out ? "#6c7690" : "#ffffff"; x.fillText(r.name, nx, mid + 2);
    const vals = [r.sp, r.s, r.u, r.n, (r.td > 0 ? "+" : "") + r.td, r.p];
    vals.forEach((v, k) => {
      const [a, w] = cxs[k + 2]; const t = String(v);
      x.font = k === 5 ? '44px "Bebas Neue"' : '40px "Bebas Neue"';
      x.fillStyle = r.out ? "#6c7690" : k === 5 ? "#ffffff" : "#dfe6f6";
      x.fillText(t, a + (w - x.measureText(t).width) / 2, mid + 2);
    });
  });
  // Rahmenlinien zwischen Spalten
  x.strokeStyle = "rgba(160,190,255,.18)"; x.lineWidth = 1;
  cxs.slice(1).forEach(([a]) => { x.beginPath(); x.moveTo(a, y - 56); x.lineTo(a, y + rows.length * rowH); x.stroke(); });
  return c.toBuffer("image/png");
}

/**
 * Runden-Übersicht (Spieltag oder K.-o.-Runde), Hochformat.
 * matches: [{ home, away, hp, ap, h, a, pen }] – h/a = Tore oder null
 */
export async function roundImage({ title, sub, matches }) {
  fonts();
  const W = 1080, rowH = 86, gap = 14, head = 380;
  const H = head + matches.length * (rowH + gap) + 80;
  const c = createCanvas(W, H), x = c.getContext("2d");
  let y = await frame(x, W, H, title, sub);
  y = Math.max(y + 10, head - 30);
  const bw = 400, sw = 150, X1 = (W - (bw * 2 + sw + 40)) / 2, Xs = X1 + bw + 20, X2 = Xs + sw + 20;
  const box = (X, Y, w, h, left, win) => {
    const sk = 22;
    x.beginPath();
    if (left) { x.moveTo(X + sk, Y); x.lineTo(X + w, Y); x.lineTo(X + w - sk * 0.6, Y + h / 2); x.lineTo(X + w, Y + h); x.lineTo(X + sk, Y + h); x.lineTo(X, Y + h / 2); }
    else { x.moveTo(X, Y); x.lineTo(X + w - sk, Y); x.lineTo(X + w, Y + h / 2); x.lineTo(X + w - sk, Y + h); x.lineTo(X, Y + h); x.lineTo(X + sk * 0.6, Y + h / 2); }
    x.closePath();
    const g = x.createLinearGradient(0, Y, 0, Y + h); g.addColorStop(0, "rgba(14,28,70,.95)"); g.addColorStop(1, "rgba(3,8,24,.95)");
    x.fillStyle = g; x.fill(); x.lineWidth = win ? 3 : 2; x.strokeStyle = win ? "#ffffff" : "rgba(120,170,255,.85)";
    x.shadowColor = win ? "rgba(47,139,255,1)" : "transparent"; x.shadowBlur = win ? 14 : 0; x.stroke(); x.shadowBlur = 0;
  };
  matches.forEach((m, i) => {
    const Y = y + i * (rowH + gap), mid = Y + rowH / 2 + 1;
    const done = m.h != null && m.a != null;
    const hw = done && (m.h > m.a || (m.h === m.a && m.pen && m.pen[0] > m.pen[1]));
    const aw = done && !hw && !(m.h === m.a && !m.pen);
    box(X1, Y, bw, rowH, true, hw); box(X2, Y, bw, rowH, false, aw);
    // Ergebnisfeld
    x.beginPath(); x.moveTo(Xs + 18, Y + 8); x.lineTo(Xs + sw - 18, Y + 8); x.lineTo(Xs + sw, mid); x.lineTo(Xs + sw - 18, Y + rowH - 8); x.lineTo(Xs + 18, Y + rowH - 8); x.lineTo(Xs, mid); x.closePath();
    x.fillStyle = "rgba(3,8,24,.95)"; x.fill(); x.strokeStyle = "rgba(200,215,240,.9)"; x.lineWidth = 2; x.stroke();
    x.textBaseline = "middle";
    if (done) {
      const t = `${m.h}:${m.a}`; x.font = m.pen ? '44px "Bebas Neue"' : '54px "Bebas Neue"'; x.fillStyle = "#ffffff";
      x.fillText(t, Xs + (sw - x.measureText(t).width) / 2, m.pen ? mid - 7 : mid + 3);
      if (m.pen) { const p = `i.E. ${m.pen[0]}:${m.pen[1]}`; x.font = "700 15px Montserrat"; x.fillStyle = ICE; x.fillText(p, Xs + (sw - x.measureText(p).width) / 2, mid + 22); }
    } else { x.font = '34px "Bebas Neue"'; x.fillStyle = "rgba(170,190,230,.6)"; const t = "VS"; x.fillText(t, Xs + (sw - x.measureText(t).width) / 2, mid + 2); }
    // Namen + Plattform
    const nameAt = (name, pf, X, left, win, lose) => {
      const chipW = pf && PF[pf] ? (x.font = "600 13px Montserrat", x.measureText(PF[pf]).width + 13) : 0;
      fit(x, name, '{s}px "Bebas Neue"', 40, bw - 80 - chipW, 18);
      const nw = x.measureText(name).width;
      x.fillStyle = lose ? "#7f8aa6" : "#ffffff";
      const tx = left ? X + bw - 40 - nw : X + 40;
      x.fillText(name, tx, mid + 2);
      if (chipW) { chip(x, left ? X + 28 : X + bw - 28 - chipW, Y + rowH / 2 - 13, 26, PF[pf]); x.textBaseline = "middle"; }
    };
    nameAt(m.home, m.hp, X1, true, hw, done && aw);
    nameAt(m.away, m.ap, X2, false, aw, done && hw);
    x.textBaseline = "top";
  });
  return c.toBuffer("image/png");
}
