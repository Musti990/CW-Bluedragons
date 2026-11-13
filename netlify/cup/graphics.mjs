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
  // Ruhiger Hintergrund ohne Effekte
  const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#0b1736"); bg.addColorStop(1, "#050a1c");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  // Komplettes CW-Logo (rund, freigestellt) oben mittig – kein abgeschnittener Banner-Streifen mehr
  const logo = await loadImage(path.join(dir, "cw-round.png"));
  const ls = Math.round(W * 0.17);
  x.drawImage(logo, (W - ls) / 2, W * 0.03, ls, ls);
  let y = W * 0.03 + ls + W * 0.012;
  const ts = fit(x, title.toUpperCase(), '{s}px "Bebas Neue"', Math.round(W * 0.075), W * 0.86);
  x.textBaseline = "top";
  const g = x.createLinearGradient(0, y, 0, y + ts); g.addColorStop(0, SILVER[0]); g.addColorStop(0.55, SILVER[1]); g.addColorStop(1, SILVER[2]);
  const T = title.toUpperCase(); x.fillStyle = g; x.fillText(T, (W - x.measureText(T).width) / 2, y);
  y += ts + W * 0.008;
  if (sub) {
    fit(x, sub, '600 {s}px Montserrat', Math.round(W * 0.02), W * 0.7);
    x.fillStyle = "#6fa8ff"; x.fillText(sub, (W - x.measureText(sub).width) / 2, y);
    y += W * 0.04;
  }
  x.fillStyle = BLUE; x.fillRect(W * 0.06, y, W * 0.88, 3);
  return y + W * 0.025;
}

function chip(x, X, Y, h, label) {
  x.font = `600 ${Math.round(h * 0.42)}px Montserrat`;
  const w = x.measureText(label).width + h * 0.5;
  x.fillStyle = "rgba(47,139,255,.18)"; x.strokeStyle = "rgba(47,139,255,.7)"; x.lineWidth = 1.5; rr(x, X, Y, w, h, h / 3); x.fill(); x.stroke();
  x.fillStyle = ICE; x.textBaseline = "middle"; x.fillText(label, X + h * 0.25, Y + h / 2 + 1); x.textBaseline = "top";
  return w;
}

// ================= Arena-Look (CW Community World) =================
const ARENA_BLUE = "#1e90ff", ARENA_ICE = "#8fd3ff";
const metal = (x, y0, y1) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, "#d6e6ff"); g.addColorStop(1, "#4f8fff"); return g; };
function hexBox(x, X, Y, w, h, fill, stroke, lw = 2.5) { const k = h * 0.35; x.beginPath(); x.moveTo(X + k, Y); x.lineTo(X + w - k, Y); x.lineTo(X + w, Y + h / 2); x.lineTo(X + w - k, Y + h); x.lineTo(X + k, Y + h); x.lineTo(X, Y + h / 2); x.closePath(); x.fillStyle = fill; x.fill(); x.strokeStyle = stroke; x.lineWidth = lw; x.shadowColor = stroke; x.shadowBlur = 14; x.stroke(); x.shadowBlur = 0; }
const fitFont = (x, t, font, size, max, min = 14) => { let s = size; do { x.font = font.replace("{s}", s); s--; } while (x.measureText(t).width > max && s > min); };

/** Hintergrund (Rauch, Scheinwerfer, Boden) + Titel. Gibt y unter dem Untertitel zurück. */
/** Hintergrund zeichnen: Kopf (topEnd) und Fuß (ab botStart) bleiben, die Mitte wird gestreckt */
async function drawBg(x, W, H, file, topEnd, botStart) {
  const bg = await loadImage(path.join(assetDir(), file));
  const s = W / bg.width, tH = topEnd * s, bH = (bg.height - botStart) * s;
  x.drawImage(bg, 0, topEnd, bg.width, botStart - topEnd, 0, tH - 1, W, Math.max(1, H - tH - bH + 2));
  x.drawImage(bg, 0, 0, bg.width, topEnd, 0, 0, W, tH);
  x.drawImage(bg, 0, botStart, bg.width, bg.height - botStart, 0, H - bH, W, bH);
}

/** Hintergrund (Flammen-Arena) + Titel. Gibt y unter dem Untertitel zurück. */
async function arenaFrame(x, W, H, title, sub, top, bg = "phase") {
  if (bg === "table") await drawBg(x, W, H, "cw-bg-table.jpg", 230, 470);
  else await drawBg(x, W, H, "cw-bg-phase.jpg", 300, 960);
  x.textAlign = "center"; x.textBaseline = "middle";
  const T = title.toUpperCase();
  fitFont(x, T, "{s}px 'Bebas Neue'", Math.round(W * 0.12), W * 0.86);
  const fs = parseInt(x.font, 10);
  x.fillStyle = metal(x, top - fs / 2, top + fs / 2); x.shadowColor = ARENA_BLUE; x.shadowBlur = 35; x.fillText(T, W / 2, top); x.shadowBlur = 0;
  let y = top + fs / 2 + 8;
  if (sub) { fitFont(x, sub.toUpperCase(), "700 {s}px Montserrat", Math.round(W * 0.018), W * 0.86, 12); x.fillStyle = "#e6f0ff"; x.fillText(sub.toUpperCase(), W / 2, y + 14); y += 38; }
  return y;
}

/** Unten mittig: „PRESENTED BY“ + CW-Logo */
async function presentedBy(x, W, yCenter, size) {
  const logo = await loadImage(path.join(assetDir(), "cw-round.png"));
  x.font = `700 ${Math.round(size * 0.19)}px Montserrat`; x.textBaseline = "middle"; x.textAlign = "right";
  const lx = W / 2 - size / 2 + size * 0.35;
  x.fillStyle = "rgba(200,225,255,.85)"; x.fillText("PRESENTED BY", lx - size * 0.18, yCenter);
  x.shadowColor = ARENA_BLUE; x.shadowBlur = 30; x.drawImage(logo, lx, yCenter - size / 2, size, size); x.shadowBlur = 0;
  x.textAlign = "center";
}
const FOOT = 330; // Platz unten für „Presented by“

function chipAt(x, t, X, yMid, align) {
  x.font = "700 13px Montserrat"; const w = x.measureText(t).width + 18; const cx = align === "l" ? X : X - w;
  x.strokeStyle = ARENA_BLUE; x.lineWidth = 1.5; x.beginPath(); x.roundRect(cx, yMid - 13, w, 26, 6); x.stroke();
  x.fillStyle = ARENA_ICE; x.textAlign = "center"; x.fillText(t, cx + w / 2, yMid + 1); return w;
}

/**
 * LIVE-TABELLE (Gruppe oder Liga).
 * rows: [{ name, platform, sp, s, u, n, td, p, out }]
 */
export async function tableImage({ title = "Live-Tabelle", sub, info, label, rows, qualify = 2, maybe = 0 }) {
  fonts();
  const W = 1219, rh = 66, top = 105;
  const Y0 = top + 90 + 38 + 78;
  const H = Y0 + 48 + rows.length * rh + 14 + FOOT;
  const c = createCanvas(W, H), x = c.getContext("2d");
  let y = await arenaFrame(x, W, H, title, sub || "CW Community World · Ultimate Team Cup", top, "table");
  hexBox(x, 90, y + 10, 360, 48, "rgba(4,12,36,.88)", ARENA_BLUE); x.font = "34px 'Bebas Neue'"; x.fillStyle = "#e8eefb"; x.fillText(String(label || "").toUpperCase(), 270, y + 35);
  hexBox(x, 466, y + 10, 666, 48, "rgba(4,12,36,.88)", ARENA_BLUE); fitFont(x, info || "", "600 {s}px Montserrat", 19, 600, 12); x.fillStyle = "#cfe0ff"; x.fillText(info || "", 799, y + 35);
  const X0 = 84, TW = W - 168, T0 = Y0;
  x.fillStyle = "rgba(3,9,28,.88)"; x.beginPath(); x.roundRect(X0, T0, TW, 48 + rows.length * rh + 14, 14); x.fill(); x.strokeStyle = ARENA_BLUE; x.lineWidth = 3; x.shadowColor = ARENA_BLUE; x.shadowBlur = 22; x.stroke(); x.shadowBlur = 0;
  const cols = [["POS", 70], ["SPIELER", 340], ["SPIELE", 95], ["SIEGE", 95], ["UNENTSCH.", 110], ["NIEDERL.", 110], ["TORDIFF.", 110], ["PUNKTE", 110]];
  const sc = (TW - 16) / cols.reduce((a, b) => a + b[1], 0); let cx = X0 + 8; const xs = cols.map(([, w]) => { const r = [cx, w * sc]; cx += w * sc; return r; });
  x.fillStyle = "rgba(30,144,255,.22)"; x.fillRect(X0 + 8, T0 + 8, TW - 16, 40);
  x.font = "700 15px Montserrat"; x.fillStyle = ARENA_ICE; x.textAlign = "center"; x.textBaseline = "middle"; cols.forEach(([n], k) => x.fillText(n, xs[k][0] + xs[k][1] / 2, T0 + 29));
  rows.forEach((r, i) => {
    const yy = T0 + 54 + i * rh, mid = yy + (rh - 6) / 2;
    const q = !r.out && i < qualify, m = !r.out && !q && i < qualify + maybe;
    x.fillStyle = i % 2 ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.07)"; x.fillRect(X0 + 8, yy, TW - 16, rh - 6);
    if (q || m) { x.fillStyle = q ? ARENA_BLUE : "#f2c14e"; x.fillRect(X0 + 8, yy + 5, 5, rh - 16); }
    const col = r.out ? "#6c7690" : "#fff";
    x.textAlign = "center"; x.font = "40px 'Bebas Neue'"; x.fillStyle = col; x.fillText(String(i + 1), xs[0][0] + xs[0][1] / 2, mid + 2);
    let nx = xs[1][0] + 14;
    if (r.platform && PF[r.platform]) nx += chipAt(x, PF[r.platform], nx, mid, "l") + 12;
    x.textAlign = "left"; fitFont(x, String(r.name).toUpperCase(), "{s}px 'Bebas Neue'", 40, xs[1][0] + xs[1][1] - nx - 8, 20); x.fillStyle = col; x.fillText(String(r.name).toUpperCase(), nx, mid + 3);
    x.textAlign = "center";
    [r.sp, r.s, r.u, r.n, (r.td > 0 ? "+" : "") + r.td, r.p].forEach((v, k) => { x.font = "40px 'Bebas Neue'"; x.fillStyle = col; x.fillText(String(v), xs[k + 2][0] + xs[k + 2][1] / 2, mid + 3); });
  });
  x.strokeStyle = "rgba(160,190,255,.2)"; x.lineWidth = 1; xs.slice(1).forEach(([a]) => { x.beginPath(); x.moveTo(a, T0 + 8); x.lineTo(a, T0 + 48 + rows.length * rh); x.stroke(); });
  await presentedBy(x, W, H - FOOT / 2 + 20, 170);
  return c.toBuffer("image/png");
}

/** Ein Spiel als Zeile (Name | Ergebnis-Kasten | Name) */
function matchRow(x, W, y, rowH, m) {
  x.fillStyle = "rgba(3,9,28,.88)"; x.strokeStyle = "rgba(120,180,255,.7)"; x.lineWidth = 2; x.beginPath(); x.roundRect(50, y, W - 100, rowH, 10); x.fill(); x.stroke();
  const mid = y + rowH / 2;
  const wl = m.hp && PF[m.hp] ? chipAt(x, PF[m.hp], 68, mid, "l") : 0, wr = m.ap && PF[m.ap] ? chipAt(x, PF[m.ap], W - 68, mid, "r") : 0;
  const done = m.h != null && m.a != null;
  const win = !done ? 0 : m.h > m.a || (m.h === m.a && m.pen && m.pen[0] > m.pen[1]) ? 1 : m.h < m.a || (m.h === m.a && m.pen && m.pen[0] < m.pen[1]) ? 2 : 0;
  const max = W / 2 - 110 - Math.max(wl, wr) - 30;
  x.textAlign = "left"; fitFont(x, String(m.home).toUpperCase(), "{s}px 'Bebas Neue'", 40, max, 18); x.fillStyle = win === 2 ? "#7f8aa6" : "#fff"; x.fillText(String(m.home).toUpperCase(), 68 + (wl ? wl + 14 : 0), mid + 3);
  x.textAlign = "right"; fitFont(x, String(m.away).toUpperCase(), "{s}px 'Bebas Neue'", 40, max, 18); x.fillStyle = win === 1 ? "#7f8aa6" : "#fff"; x.fillText(String(m.away).toUpperCase(), W - 68 - (wr ? wr + 14 : 0), mid + 3);
  hexBox(x, W / 2 - 75, y + 9, 150, rowH - 18, "#020a22", done ? ARENA_ICE : "rgba(120,180,255,.6)", 2.5);
  x.textAlign = "center"; x.strokeStyle = "rgba(160,190,255,.6)"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(W / 2, y + 20); x.lineTo(W / 2, y + rowH - 20); x.stroke();
  if (done) {
    x.font = "46px 'Bebas Neue'"; x.fillStyle = "#fff"; x.fillText(String(m.h), W / 2 - 28, mid + 3); x.fillText(String(m.a), W / 2 + 28, mid + 3);
    if (m.pen) { x.font = "700 12px Montserrat"; x.fillStyle = ARENA_ICE; x.fillText(`${m.pen[0]}:${m.pen[1]} i.E.`, W / 2, y + rowH - 4); }
  }
}

/** GRUPPENPHASE / LIGAPHASE: alle Spieltage einer Gruppe untereinander */
export async function groupPhaseImage({ title = "Gruppenphase", sub, label, days }) {
  fonts();
  const W = 1080, rowH = 78, top = 140;
  const body = days.reduce((a, d) => a + 70 + d.matches.length * (rowH + 12) + 8, 0);
  const H = 370 + body + FOOT;
  const c = createCanvas(W, H), x = c.getContext("2d");
  const y0 = await arenaFrame(x, W, H, title, sub || "CW Community World · Ultimate Team Cup", top);
  hexBox(x, 140, y0 + 8, W - 280, 70, "rgba(4,12,36,.9)", ARENA_BLUE, 3); x.font = "54px 'Bebas Neue'"; x.fillStyle = "#e8eefb"; x.textAlign = "center"; x.fillText(String(label || "").toUpperCase(), W / 2, y0 + 45);
  let y = Math.max(370, y0 + 100);
  for (const d of days) {
    x.strokeStyle = ARENA_BLUE; x.lineWidth = 2.5; x.beginPath(); x.moveTo(40, y + 26); x.lineTo(W - 40, y + 26); x.stroke();
    hexBox(x, W / 2 - 150, y, 300, 52, "#081a48", ARENA_ICE, 2.5); x.font = "42px 'Bebas Neue'"; x.fillStyle = "#fff"; x.textAlign = "center"; x.fillText(`SPIELTAG ${d.round}`, W / 2, y + 28);
    y += 70;
    for (const m of d.matches) { matchRow(x, W, y, rowH, m); y += rowH + 12; }
    y += 8;
  }
  await presentedBy(x, W, H - FOOT / 2 + 20, 170);
  return c.toBuffer("image/png");
}

/** K.-o.-Runde / Finale / Spiel um Platz 3 */
export async function roundImage({ title, sub, matches, big = false }) {
  fonts();
  const W = 1080, rowH = big ? 110 : 82, top = 140;
  const H = 300 + matches.length * (rowH + 14) + 40 + FOOT;
  const c = createCanvas(W, H), x = c.getContext("2d");
  const y0 = await arenaFrame(x, W, H, title, sub || "CW Community World · Ultimate Team Cup", top);
  let y = Math.max(300, y0 + 30);
  for (const m of matches) { matchRow(x, W, y, rowH, m); y += rowH + 14; }
  await presentedBy(x, W, H - FOOT / 2 + 20, 170);
  return c.toBuffer("image/png");
}
