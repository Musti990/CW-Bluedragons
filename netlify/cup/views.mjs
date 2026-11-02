// Alle Discord-Ansichten (Embeds, Buttons, Formulare). Alle Ränder in Blau.
import { coIds, isCo, MAX_CO } from "./co.mjs";
import { fmtDef, koSizeFor, MODE_NAME, durText, BANNER_V, COLOR, PLATFORMS, FORMATS, KO_SIZE, KO_NAME, BAN_REASONS, BAN_DAYS, BAN_DEFAULT_DAYS, VIDEO_LIMIT, VIDEO_WINDOW_MIN, RULES, FREIGABE_MIN, isFreilos, flagOf, platformOf } from "./data.mjs";
import { fmtOf, nextFmt, standings, currentMatches, winner, koRoundName } from "./tournament.mjs";

const FOOTER = { text: "CW Bluedragons · Ultimate Team Cup" };

// ---------- Neues Discord-Layout („Components V2“): alles in einem Kasten ----------
const V2 = 1 << 15;
const box = (...children) => ({ type: 17, accent_color: COLOR, components: children.flat().filter(Boolean) });
const txt = (content) => ({ type: 10, content });
const line = (divider = true) => ({ type: 14, divider, spacing: 1 });
const gallery = (url) => ({ type: 12, items: [{ media: { url } }] });
const section = (texts, thumb) => ({ type: 9, components: texts.map(txt), accessory: { type: 11, media: { url: thumb } } });
export const esc = (s) => String(s).replace(/([*_`~|\\>])/g, "\\$1");
const unix = (ms) => Math.floor(ms / 1000);
const hhmm = (ms) => `<t:${unix(ms)}:t>`;
const site = () => process.env.SITE_URL || process.env.URL || "";
const btn = (label, custom_id, style = 2, extra = {}) => ({ type: 2, style, label, custom_id, ...extra });
const row = (...components) => ({ type: 1, components });
const ping = (ids) => ids.map((id) => `<@${id}>`).join(" ");
export const teamLine = (c) => `${flagOf(c)} **${esc(c)}**`;
/** Hinweis in Freigaben: Team hat im Shop den „Großen IV“ eingelöst */
export const bigIVNote = (t, clubs) => {
  const iv = clubs.filter((x) => t.bigIV?.includes(x)), bo = clubs.filter((x) => t.boost?.includes(x));
  return (iv.length ? `\n-# 📏 Großer IV: ${iv.map((x) => esc(x)).join(" und ")} ${iv.length === 1 ? "darf" : "dürfen"} je 1 IV bis **1,90 m** einsetzen` : "")
    + (bo.length ? `\n-# 🟣 Große Verstärkung: ${bo.map((x) => esc(x)).join(" und ")} ${bo.length === 1 ? "darf" : "dürfen"} mit dem ganzen Team **lila Verstärkung** benutzen` : "");
};
const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

// ---------- Spieler registrieren ----------
export function regPanel(clubs) {
  const n = Object.keys(clubs).length;
  const per = Object.entries(PLATFORMS).map(([k, p]) => `${p.icon} ${p.short}: **${Object.values(clubs).filter((c) => c.platform === k).length}**`).join("  ·  ");
  return {
    flags: V2,
    components: [box(
      gallery(`${site()}/cup-banner-registrieren.jpg?v=${BANNER_V}`),
      txt(`## 📝 Spieler registrieren\nRegistriere dich **einmal** mit deiner **EA-ID** – danach meldest du dich jeden Tag mit einem Klick zum Cup an.\n\n**So geht's:**\n1️⃣ Auf **Jetzt registrieren** klicken\n2️⃣ Plattform wählen (PS5, Xbox oder PC)\n3️⃣ EA-ID eintragen – genau so, wie sie im Spiel steht\n\n👥 **${n} ${n === 1 ? "Spieler" : "Spieler"} registriert** · ${per}`),
      line(),
      row(btn("Jetzt registrieren", "reg_start", 1, { emoji: { name: "📝" } })),
      txt("-# CW Bluedragons · Ultimate Team Cup · 1 gegen 1 · Regelwerk muss akzeptiert sein"),
    )],
  };
}

/** Schritt 1: Plattform wählen */
export function regPlatforms() {
  return {
    content: "**Schritt 1 · Auf welcher Plattform spielst du?**",
    embeds: [],
    components: [row(...Object.entries(PLATFORMS).map(([k, p]) => btn(p.short, `reg_pf:${k}`, 1, { emoji: { name: p.icon } })))],
  };
}

/** Schritt 2: EA-ID eintragen */
export function eaModal(customId, title, value = "") {
  return {
    type: 9,
    data: {
      custom_id: customId, title: title.slice(0, 45),
      components: [row({ type: 4, custom_id: "ea", label: "EA-ID", style: 1, required: true, min_length: 3, max_length: 32, value: value || undefined, placeholder: "Genau so, wie sie in EA FC steht" })],
    },
  };
}

export function newManagerPost(c, userId) {
  const p = platformOf(c);
  return { embeds: [{ color: COLOR, description: `${flagOf(c)} **Neuer Spieler!**\n<@${userId}> ist jetzt als **${esc(c)}** registriert${p ? ` (${p.short})` : ""}.` }] };
}
export function freeAgainPost(c, reason) {
  return { embeds: [{ color: COLOR, description: `${flagOf(c)} **Profil gelöscht:** ${esc(c)}${reason ? `\n-# ${reason}` : ""}` }] };
}

// ---------- Mein Profil ----------
export function teamPanel() {
  return {
    embeds: [{ color: COLOR, title: "🛡️ MEIN PROFIL", description: "Hier siehst du dein Profil mit **deinen Stats** (Titel, Bilanz, Tore, Siegquote), änderst deine EA-ID oder Plattform oder löschst dein Profil.\nDas Fenster siehst nur du.", thumbnail: { url: `${site()}/blue-dragons-logo.png` }, footer: FOOTER }],
    components: [row(btn("Mein Profil öffnen", "team_open", 1, { emoji: { name: "🛡️" } }))],
  };
}

export function teamDetail(c, data, st = null) {
  const p = platformOf(c);
  const x = st || { g: 0, s: 0, b: 0, cups: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  const games = x.w + x.d + x.l, td = x.gf - x.ga;
  const quote = games ? Math.round((x.w / games) * 100) : 0;
  const vit = "🏆".repeat(Math.min(x.g, 10)) + (x.s ? " " + "🥈".repeat(Math.min(x.s, 10)) : "") + (x.b ? " " + "🥉".repeat(Math.min(x.b, 10)) : "");
  return {
    content: "",
    embeds: [{
      color: COLOR,
      title: `${flagOf(c)} ${c}`,
      description: `<@${data.manager}> · ${p ? p.name : "Plattform unbekannt"}${data.fav ? ` · ❤️ ${esc(data.fav)}` : ""}\n📅 Registriert ${data.since ? `<t:${Math.floor(data.since / 1000)}:D>` : "–"}`,
      thumbnail: { url: `${site()}/blue-dragons-logo.png` },
      fields: [
        { name: "🏆 Titel", value: `**${x.g}**`, inline: true },
        { name: "🥈 Finals", value: `**${x.s}**`, inline: true },
        { name: "🥉 Platz 3", value: `**${x.b}**`, inline: true },
        { name: "🎟️ Cups", value: `**${x.cups}**`, inline: true },
        { name: "⚽ Spiele", value: `**${games}**`, inline: true },
        { name: "📈 Siegquote", value: `**${quote} %**`, inline: true },
        { name: "✅ Bilanz", value: `${x.w} S · ${x.d} U · ${x.l} N`, inline: true },
        { name: "🥅 Tore", value: `${x.gf}:${x.ga} (${td > 0 ? "+" + td : td})`, inline: true },
        { name: "⌀ Tore/Spiel", value: games ? (x.gf / games).toFixed(1).replace(".", ",") : "–", inline: true },
        { name: "🏅 Vitrine", value: vit || "noch leer – hol dir den ersten Titel!", inline: false },
      ],
      footer: { text: "CW Bluedragons · Ultimate Team Cup · nur du siehst dieses Fenster" },
    }],
    components: [
      row(btn("Aktualisieren", "team_open", 2, { emoji: { name: "🔄" } }), btn("EA-ID ändern", "team_ea", 1, { emoji: { name: "✏️" } }), btn("Plattform ändern", "team_pf", 2, { emoji: { name: "🎮" } })),
      row(btn("Profil löschen", "team_del", 4, { emoji: { name: "🗑️" } })),
    ],
  };
}

export function platformPicker() {
  return { content: "**Neue Plattform wählen:**", embeds: [], components: [row(...Object.entries(PLATFORMS).map(([k, p]) => btn(p.short, `team_pf_set:${k}`, 1, { emoji: { name: p.icon } }))), row(btn("Zurück", "team_open"))] };
}

export function confirmView(text, okId, okLabel) {
  return { content: `⚠️ ${text}`, embeds: [], components: [row(btn("Abbrechen", "team_open"), btn(okLabel, okId, 4))] };
}

// ---------- Spielerübersicht ----------
export function overviewMessages(clubs) {
  const all = Object.entries(clubs).sort((a, b) => (b[1].titles || 0) - (a[1].titles || 0) || a[0].localeCompare(b[0]));
  const head = { color: COLOR, title: "📋 SPIELERÜBERSICHT", description: `**${all.length} registrierte Spieler**\n${Object.entries(PLATFORMS).map(([k, p]) => `${p.icon} ${p.short}: **${all.filter(([, c]) => c.platform === k).length}**`).join("  ·  ")}`, footer: { text: "Aktualisiert sich automatisch · sortiert nach Titeln" } };
  const lines = all.map(([name, c], k) => `\`${String(k + 1).padStart(3, " ")}\` ${flagOf(name)} **${esc(name)}** · <@${c.manager}>${c.titles ? ` · 🏆 ${c.titles}` : ""}`);
  // max. 3 Nachrichten à 10 Embeds; pro Embed bis 40 Zeilen
  const chunks = [];
  for (let i = 0; i < lines.length; i += 40) chunks.push(lines.slice(i, i + 40));
  const embeds = [head, ...chunks.map((c) => ({ color: COLOR, description: c.join("\n") }))];
  if (!chunks.length) embeds.push({ color: COLOR, description: "-# Noch keine Spieler registriert." });
  const msgs = [];
  for (let i = 0; i < embeds.length && msgs.length < 3; i += 10) msgs.push({ embeds: embeds.slice(i, i + 10) });
  while (msgs.length < 3) msgs.push({ embeds: [{ color: COLOR, description: "\u200b" }] });
  return msgs;
}

// ---------- Admin-Panel (statt Befehlen) ----------
export function adminPanel(t, cupMode = "auto") {
  const st = t ? { anmeldung: "📝 Anmeldung offen", checkin: "✅ Check-in läuft", gruppen: t.league ? "⚽ Ligaphase läuft" : "⚽ Gruppenphase läuft", ko: "⚔️ K.-o.-Phase läuft" }[t.status] || "–" : "Kein Cup aktiv";
  return {
    embeds: [{
      color: COLOR,
      title: "🛠️ ADMIN-PANEL · ULTIMATE TEAM CUP",
      description: `Alle wichtigen Aktionen per Klick – nur für **Admins** (Rolle mit „Admin“ oder „Owner“ im Namen).\nAntworten sieht nur, wer klickt.\n\n**Aktueller Cup:** ${t ? `${esc(t.name)} · ${st} · ${t.reg?.length ?? 0} angemeldet` : st}\n**Modus:** ${MODE_NAME[(t?.mode) || cupMode] || MODE_NAME.auto}${t?.league ? " · läuft als Liga" : t?.groups?.length ? " · läuft mit Gruppen" : ""}`,
      fields: [
        { name: "⚽ Turnier", value: "Anmeldeschluss · Check-in beenden · offene Spiele · Ergebnis festlegen · Ergebnis bearbeiten", inline: false },
        { name: "👤 Spieler", value: "Spieler abmelden · Profil löschen · Freilos hinzufügen/entfernen", inline: false },
        { name: "🗓️ Cup & Test", value: "Neuen Cup anlegen · **Modus wählen (Gruppenphase oder Ligasystem)** · Cup abbrechen · Test-Cup (8/12/16/20) · Testspiele ausspielen", inline: false },
        { name: "⚙️ Einrichtung", value: "Panels aktualisieren · Rechte setzen · Rollen-Check · Status", inline: false },
      ],
      thumbnail: { url: `${site()}/blue-dragons-logo.png` },
      footer: { text: "Aktualisiert sich bei jedem Klick · Slash-Befehle funktionieren weiterhin" },
    }],
    components: [
      row(btn("Anmeldeschluss", "adm:schluss", 1, { emoji: { name: "⏩" } }), btn("Check-in beenden", "adm:checkin", 1, { emoji: { name: "✅" } }), btn("Offene Spiele", "adm:spiele", 2, { emoji: { name: "📋" } }), btn("Ergebnis festlegen", "adm:ergebnis", 3, { emoji: { name: "✏️" } }), btn("Ergebnis bearbeiten", "adm:edit", 3, { emoji: { name: "🔧" } })),
      row(btn("Spieler abmelden", "adm:abmelden", 2, { emoji: { name: "➖" } }), btn("Profil löschen", "adm:profil", 4, { emoji: { name: "🗑️" } }), btn("Freilos +", "adm:frei_add", 2, { emoji: { name: "🎟️" } }), btn("Freilos −", "adm:frei_rem", 2, { emoji: { name: "🎟️" } })),
      row(btn("Neuer Cup", "adm:neu", 3, { emoji: { name: "🆕" } }), btn("Modus: Gruppen/Liga", "adm:mode", 1, { emoji: { name: "🏟️" } }), btn("Cup abbrechen", "adm:abbrechen", 4, { emoji: { name: "🛑" } }), btn("Testspiele ausspielen", "adm:weiter", 2, { emoji: { name: "⏭️" } })),
      row({ type: 3, custom_id: "adm:testcup", placeholder: "🧪 Test-Cup starten …", options: [
        { label: "8 Spieler · Gruppen → Halbfinale", value: "8" },
        { label: "12 Spieler · Liga → Viertelfinale", value: "12" },
        { label: "16 Spieler · Gruppen → Viertelfinale", value: "16" },
        { label: "20 Spieler · Liga → Viertelfinale", value: "20" },
      ] }),
      row(btn("Panels aktualisieren", "adm:panels", 2, { emoji: { name: "🔄" } }), btn("Rechte setzen", "adm:rechte", 2, { emoji: { name: "🔐" } }), btn("Rollen-Check", "adm:rollen", 2, { emoji: { name: "🔁" } }), btn("Status", "adm:status", 2, { emoji: { name: "📊" } })),
    ],
  };
}

export function modeRow(customId) {
  return row({ type: 3, custom_id: customId, placeholder: "Modus wählen…", options: [
    { label: "Gruppenphase", description: "Gruppen + K.-o.", value: "gruppen", emoji: { name: "⚽" } },
    { label: "Liga (max. 4 Spieltage)", description: "Eine Tabelle · ab 12: Top 8, sonst Top 4", value: "liga", emoji: { name: "🏟️" } },
    { label: "Automatisch", description: "12er/20er Liga, sonst Gruppen", value: "auto", emoji: { name: "🤖" } },
  ] });
}

export function modePicker(cur) {
  return {
    content: "**🏟️ Modus wählen** – gilt für den aktuellen Cup (solange die Anmeldung offen ist) und für alle neuen Cups.",
    components: [row({ type: 3, custom_id: "adm:mode_set", placeholder: "Modus auswählen", options: [
      { label: "Automatisch", description: "12er und 20er als Liga, alle anderen mit Gruppen", value: "auto", emoji: { name: "🤖" }, default: cur === "auto" },
      { label: "Immer Gruppenphase", description: "Gruppen + K.-o. bei jeder Größe", value: "gruppen", emoji: { name: "⚽" }, default: cur === "gruppen" },
      { label: "Immer Ligasystem", description: "Eine Tabelle, 4 Spieltage · ab 12: Top 8, sonst Top 4", value: "liga", emoji: { name: "🏟️" }, default: cur === "liga" },
    ] })],
  };
}

export function editPicker(t) {
  const done = t.matches.filter((m) => m.status === "fertig" && !isFreilos(m.home) && !isFreilos(m.away)).sort((a, b) => b.id - a.id).slice(0, 25);
  if (!done.length) return { content: "Es gibt noch kein fertiges Spiel zum Bearbeiten.", components: [] };
  const where = (m) => (m.phase === "gruppe" ? `${t.league ? "Liga" : "Gruppe " + m.group} · Spieltag ${m.round}` : (m.final ? (m.p3 ? "Spiel um Platz 3" : "Finale") : `K.-o. Runde ${m.round}`));
  return {
    content: "**🔧 Welches Ergebnis bearbeiten?** (die letzten 25 fertigen Spiele)",
    components: [row({ type: 3, custom_id: "adm:edit_pick", placeholder: "Spiel auswählen", options: done.map((m) => ({ label: `#${m.id} ${m.home} ${m.h}:${m.a} ${m.away}${m.pen ? ` (${m.pen[0]}:${m.pen[1]} i.E.)` : ""}`.slice(0, 100), description: where(m).slice(0, 100), value: String(m.id) })) })],
  };
}

export function editModal(m) {
  const f = (id, label, value, req = true) => row({ type: 4, custom_id: id, label, style: 1, required: req, max_length: 10, value: value === undefined || value === null ? undefined : String(value) });
  return { type: 9, data: { custom_id: `adm_m:edit:${m.id}`, title: `#${m.id} bearbeiten`.slice(0, 45), components: [
    f("heim", `Tore ${m.home}`.slice(0, 45), m.h), f("gast", `Tore ${m.away}`.slice(0, 45), m.a),
    ...(m.phase === "ko" ? [f("elfmeter", "Elfmeterschießen (nur bei Unentschieden)", m.pen ? `${m.pen[0]}:${m.pen[1]}` : undefined, false)] : []),
  ] } };
}

export function adminModal(kind) {
  const f = (id, label, req = true, ph = "", style = 1) => row({ type: 4, custom_id: id, label, style, required: req, placeholder: ph || undefined, max_length: 100 });
  const M = {
    ergebnis: ["Ergebnis festlegen", [f("spiel", "Spiel-Nr.", true, "z. B. 7"), f("heim", "Tore Heim", true, "z. B. 2"), f("gast", "Tore Gast", true, "z. B. 1"), f("elfmeter", "Elfmeterschießen (nur K.-o.)", false, "z. B. 4:3")]],
    abmelden: ["Spieler abmelden", [f("spieler", "EA-ID", true, "genau wie in der Liste")]],
    profil: ["Profil löschen", [f("spieler", "EA-ID", true, "genau wie in der Spielerübersicht")]],
    neu: ["Neuen Cup anlegen", [f("name", "Name", false, "Ultimate Team Cup"), f("anpfiff", "Anpfiff (TT.MM.JJJJ HH:MM)", true, "02.11.2026 20:00")]],
  };
  const [title, comps] = M[kind];
  return { type: 9, data: { custom_id: "adm_m:" + kind, title, components: comps } };
}

// ---------- Hall of Fame (Kopf) ----------
export function hofHeader() {
  return {
    flags: V2,
    components: [box(
      gallery(`${site()}/cup-banner-halloffame.jpg?v=${BANNER_V}`),
      txt("## 🏆 Hall of Fame\nNach jedem Cup erscheinen hier die Sieger mit Siegerbild – Platz 1, 2 und 3."),
      txt("-# CW Bluedragons · Ultimate Team Cup"),
    )],
  };
}

// ---------- Anmeldeliste ----------
const SQ = { g: "🟩", y: "🟨", x: "⬛" };
function formatBlock(n, closed, mode) {
  const f = fmtOf(n), next = nextFmt(n);
  const prog = (from, to) => {
    if (!to) return "Maximales Format erreicht – weitere Spieler kommen auf die Warteliste.";
    const fill = Math.round(((n - from) / (to - from)) * 10);
    return `${"▰".repeat(fill)}${"▱".repeat(10 - fill)} noch **${to - n} Spieler** bis zum **${to}er**`;
  };
  if (!f) return `**⚠️ Noch kein Format**\nMindestens **8 Spieler** nötig, damit der Cup stattfindet.\n${prog(0, 8)}`;
  const d = fmtDef(f, mode), mixed = new Set(d.g).size > 1;
  if (d.league) {
    const bar = Array.from({ length: f }, (_, p) => (p < d.top ? SQ.g : SQ.x)).join("");
    return `**🏟️ Format: ${f}er · Ligasystem**\n**Eine Tabelle** · **${d.rounds} Spieltage** gegen zufällige Gegner  ·  **Weiter:** Top ${d.top}  ·  **K.-o. ab:** ${KO_NAME[koSizeFor(f, mode)]}\n${bar}\n${SQ.g} **Platz 1–${d.top}** ${SQ.x} **raus**${closed ? "" : "\n" + prog(f, next)}`;
  }
  const grid = d.g.map((s, k) => `\`${"ABCDEFGH"[k]}\` ${Array.from({ length: s }, (_, p) => (p < d.top ? SQ.g : p === d.top && d.ex ? SQ.y : SQ.x)).join("")}`);
  const rows = [];
  for (let i = 0; i < grid.length; i += 2) rows.push(grid.slice(i, i + 2).join("   "));
  const rule = d.top === 1 ? `${SQ.g} **Gruppensieger** ${SQ.y} **${d.ex} beste Zweite**` : `${SQ.g} **Platz 1 + 2**${d.ex ? ` ${SQ.y} **${d.ex} beste Dritte**` : ""}`;
  return `**🏟️ Format: ${f}er**\n**Gruppen:** ${mixed ? d.g.join(" · ") : `${d.g.length} × ${d.g[0]}`}  ·  **Weiter:** ${KO_SIZE[f]} von ${f}  ·  **K.-o. ab:** ${KO_NAME[KO_SIZE[f]]}\n${rows.join("\n")}\n${rule} ${SQ.x} **raus**${mixed && d.ex ? "\n-# Bei unterschiedlich großen Gruppen zählt der Punkteschnitt pro Spiel." : ""}${closed ? "" : "\n" + prog(f, next)}`;
}

const STATUS = {
  anmeldung: "🟢 **Anmeldung offen**",
  checkin: "🟡 **Check-in läuft** in den Gruppenkanälen",
  gruppen: "⚽ **Gruppen-/Ligaphase läuft**",
  ko: "🔥 **K.-o.-Phase läuft**",
  fertig: "🏆 **Turnier beendet**",
  abgesagt: "⚠️ **Cup abgesagt** – zu wenige Spieler",
  geloescht: "🗑️ **Turnier abgebrochen**",
};

export function signupPanel(t, clubs = {}) {
  const n = t.reg.length, f = fmtOf(n);
  const closed = t.status !== "anmeldung";
  const real = t.reg.filter((c) => !isFreilos(c)), free = t.reg.filter(isFreilos);
  const ordered = [...real.slice(0, f || n), ...free, ...real.slice(f || n)];
  const playing = closed ? (t.playing.length ? t.playing : t.reg) : f ? ordered.slice(0, f) : ordered;
  const wait = closed ? t.wait : f ? ordered.slice(f).filter((c) => !isFreilos(c)) : [];
  const num = (k) => `\`${String(k + 1).padStart(2, "0")}\``;
  const who = (c) => (clubs[c]?.manager ? ` | <@${clubs[c].manager}>` : "");
  const tl = (c, k, waitList) => isFreilos(c)
    ? `${num(k)} 🎟️ **Freilos**`
    : `${num(k)} ${flagOf(c)} **${esc(c)}**${who(c)}${t.status === "checkin" && waitList ? (t.waitChecked.includes(c) ? " ✅" : " ⏳") : ""}`;
  const freeCount = playing.filter(isFreilos).length;
  const target = f || 8;
  const times = t.times;
  const head = [
    `## ${esc(t.name)}`,
    ...(t.ticketOnly ? ["🎫 **Sonderturnier** – Teilnahme nur mit **Sonderturnier-Ticket** aus dem Shop. Das Ticket wird beim Check-in eingelöst."] : []),
    `${STATUS[t.status]}\n⏰ **Anpfiff** <t:${unix(times.kickoff)}:F> · <t:${unix(times.kickoff)}:R>\n👥 **${playing.length}/${closed ? playing.length : target} Spieler** · 20 Min pro Runde`,
  ];
  const teamsText =
    `### 👥 Spieler (${playing.length}${f && !closed ? "/" + f : ""})${freeCount ? ` · davon ${freeCount} Freilos` : ""}\n` +
    (playing.length ? playing.map((c, k) => tl(c, k)).join("\n") : "_Noch keine Anmeldungen_") +
    (wait.length ? `\n\n**⏳ Warteliste**\n${wait.map((c, k) => tl(c, k, true)).join("\n")}\n-# Rückt nach, wenn jemand nicht eincheckt.` : "") +
    (freeCount ? "\n-# 🎟️ Wer gegen ein Freilos spielt, gewinnt automatisch 3:0. Freilose kommen nie weiter." : "");
  const buttons = [];
  if (t.status === "anmeldung") buttons.push(row(btn("Anmelden", "cup_join", 1, { emoji: { name: "⭐" } }), btn("Abmelden", "cup_leave")));
  if (t.status === "checkin" && t.wait.length) buttons.push(row(btn("Warteliste: Einchecken", "cup_waitci", 3, { emoji: { name: "✅" } })));
  return {
    flags: V2,
    components: [box(
      gallery(`${site()}/cup-banner-anmeldung.jpg?v=${BANNER_V}`),
      txt(head.join("\n")),
      line(),
      txt(formatBlock(closed ? t.playing.length || n : n, closed, t.mode).replace(/^\*\*🏟️ Format: (\d+)er\*\*/, "### 🏟️ Turnierplan: $1er-Format").replace(/^\*\*⚠️ Noch kein Format\*\*/, "### ⚠️ Noch kein Format")),
      line(),
      txt(`### ⏰ Ablauf\n${hhmm(times.close)} Anmeldeschluss · ${hhmm(times.close)} Auslosung · ${hhmm(times.checkinEnd)} Check-in-Ende · ${hhmm(times.kickoff)} Anpfiff`),
      line(),
      txt(teamsText.slice(0, 3000)),
      ...(buttons.length ? [line(false), ...buttons] : []),
      txt("-# CW Bluedragons · Ultimate Team Cup · EA-IDs zum Einladen stehen in der Liste"),
    )],
  };
}

export function drawPost(t) {
  const d = fmtDef(t.fmt, t.mode);
  if (d.league) {
    const list = t.groups[0].teams.map((c) => `${flagOf(c)} ${esc(c)}`);
    const half = Math.ceil(list.length / 2);
    return {
      content: `🔒 **Anmeldung geschlossen – ${t.fmt}er-Format · Ligasystem.** Check-in läuft jetzt bis ${hhmm(t.times.checkinEnd)} im Liga-Kanal.${t.wait.length ? ` ${t.wait.length} ${t.wait.length === 1 ? "Spieler steht" : "Spieler stehen"} auf der Warteliste und checkt oben im Anmelde-Post ein.` : ""}`,
      embeds: [{ color: COLOR, title: `⭐ Auslosung · ${t.fmt}er-Format · Liga`, description: `**${d.rounds} Spieltage** gegen zufällige Gegner (nie zweimal derselbe) · **Top ${d.top} → ${KO_NAME[koSizeFor(t.fmt, t.mode)]}**`, fields: [{ name: "Teilnehmer", value: list.slice(0, half).join("\n"), inline: true }, { name: "\u200b", value: list.slice(half).join("\n") || "\u200b", inline: true }] }],
    };
  }
  const rule = d.top === 1 ? `alle Gruppensieger + ${d.ex} beste Zweite` : `Erste und Zweite${d.ex ? ` + ${d.ex} beste Dritte` : ""}`;
  return {
    content: `🔒 **Anmeldung geschlossen – ${t.fmt}er-Format.** Check-in läuft jetzt bis ${hhmm(t.times.checkinEnd)} in eurem Gruppenkanal.${t.wait.length ? ` ${t.wait.length} ${t.wait.length === 1 ? "Spieler steht" : "Spieler stehen"} auf der Warteliste und checkt oben im Anmelde-Post ein.` : ""}`,
    embeds: [{ color: COLOR, title: `⭐ Auslosung · ${t.fmt}er-Format`, fields: t.groups.map((g) => ({ name: `Gruppe ${g.name}`, value: g.teams.map((c) => `${flagOf(c)} ${esc(c)}`).join("\n"), inline: true })), description: `**Weiter ins ${KO_NAME[KO_SIZE[t.fmt]]}:** ${rule}` }],
  };
}

// ---------- Gruppenkanal ----------
export function groupCheckin(t, g, roleId) {
  const lines = g.teams.map((c) => `${t.checked.includes(c) ? "✅" : t.out.includes(c) ? "❌" : "⏳"} ${flagOf(c)} ${esc(c)}`);
  const open = t.status === "checkin";
  return {
    content: open && roleId ? `<@&${roleId}>` : "",
    allowed_mentions: { roles: open && roleId ? [roleId] : [] },
    embeds: [{
      color: COLOR, title: `⭐ ${t.league ? "Liga" : "Gruppe " + g.name} · Check-in`,
      description: (open ? `Bitte bis ${hhmm(t.times.checkinEnd)} einchecken. Wer nicht eincheckt, wird durch die Warteliste ersetzt.\n\n` : "") + lines.join("\n") + `\n\n-# Eingecheckt: ${g.teams.filter((c) => t.checked.includes(c)).length}/${g.teams.length}`,
    }],
    components: open ? [row(btn("Einchecken", "grp_ci", 3, { emoji: { name: "✅" } }))] : [],
  };
}

export function tableText(t, gName) {
  const rows = standings(t, gName);
  return "```\n#  Spieler           Sp S-U-N  TD Pkt\n" + rows.map((r, i) => `${i + 1}  ${pad(r.id + (t.out.includes(r.id) ? " ✗" : ""), 17)} ${String(r.sp).padStart(2)} ${`${r.s}-${r.u}-${r.n}`.padStart(5)} ${((r.t - r.gt) > 0 ? "+" + (r.t - r.gt) : String(r.t - r.gt)).padStart(3)} ${String(r.p).padStart(3)}`).join("\n") + "\n```";
}

export function matchLine(m, showId = true) {
  const st = m.ff ? "gewertet" : m.status === "fertig" ? "" : m.status === "konflikt" ? "⚠️" : "";
  const id = showId ? `\`#${m.id}\` ` : "";
  if (m.status !== "fertig") return `${id}${flagOf(m.home)} ${esc(m.home)} – ${esc(m.away)} ${flagOf(m.away)} ${st}`.trim();
  const w = m.phase === "ko" ? winner(m) : m.h > m.a ? m.home : m.a > m.h ? m.away : null;
  const nm = (c) => (c === w ? `**${esc(c)}**` : esc(c));
  return `${id}${flagOf(m.home)} ${nm(m.home)} **${m.h}:${m.a}**${m.pen ? ` (${m.pen[0]}:${m.pen[1]} i.E.)` : ""} ${nm(m.away)} ${flagOf(m.away)}${m.ff ? " · gewertet" : ""}`;
}

export function groupPlan(t, g, resultChannel) {
  const ms = t.matches.filter((m) => m.phase === "gruppe" && m.group === g.name);
  const rounds = [...new Set(ms.map((m) => m.round))];
  // Kurz und knapp: nur Gegner und Ergebnisse
  const line = (m) => {
    if (m.status !== "fertig") return `${flagOf(m.home)} ${esc(m.home)} – ${esc(m.away)} ${flagOf(m.away)}`;
    const w = m.h > m.a ? m.home : m.a > m.h ? m.away : null;
    const nm = (c) => (c === w ? `**${esc(c)}**` : esc(c));
    return `${flagOf(m.home)} ${nm(m.home)} **${m.h}:${m.a}** ${nm(m.away)} ${flagOf(m.away)}`;
  };
  const desc = rounds.map((r) => `**Spieltag ${r}**\n` + ms.filter((m) => m.round === r).map(line).join("\n")).join("\n\n");
  const fallback = t.status === "gruppen" && !resultChannel; // ohne Ergebniskanal bleiben die Buttons hier
  return {
    embeds: [{ color: COLOR, title: `📋 ${t.league ? "Liga" : "Gruppe " + g.name} · Spielplan`, description: desc.slice(0, 4096) }],
    components: fallback ? [row(btn("Ergebnis melden", "res_open", 1, { emoji: { name: "⚽" } }))] : [],
  };
}

// ---------- Ergebnis melden ----------
export function resultModal(m, koLabel) {
  const input = (id, label, required, max, placeholder) => row({ type: 4, custom_id: id, label: label.slice(0, 45), style: 1, required, max_length: max, placeholder });
  const comps = [input("h", `Tore ${m.home}`, true, 2, "0"), input("a", `Tore ${m.away}`, true, 2, "0")];
  if (m.phase === "ko") comps.push(input("pen", "Elfmeter, nur bei Unentschieden (z. B. 4:3)", false, 5, "leer lassen, wenn kein Remis"));
  return { type: 9, data: { custom_id: `res:${m.id}`, title: (m.phase === "gruppe" ? `Ergebnis · Spiel #${m.id}` : `${koLabel} · Spiel #${m.id}`).slice(0, 45), components: comps } };
}

export function matchPicker(ms) {
  return {
    content: "Für welches Spiel willst du das Ergebnis melden?",
    components: [row({ type: 3, custom_id: "res_pick", placeholder: "Spiel auswählen", options: ms.slice(0, 25).map((m) => ({ label: `#${m.id} ${m.home} vs ${m.away}`.slice(0, 100), value: String(m.id), description: m.phase === "gruppe" ? `Gruppe ${m.group} · Spieltag ${m.round}` : "K.-o.-Runde" })) })],
  };
}

export function resultConfirmed(m, byAdmin) {
  return { embeds: [{ color: COLOR, description: `${byAdmin ? "✏️ **Ergebnis durch die Turnierleitung**" : "✅ **Ergebnis bestätigt**"}\n${matchLine(m, false)}` }] };
}

// ---------- Live-Spielplan ----------
export function livePlan(t) {
  // Fortschritt: ✅ Spieltag 1 › 🔴 Spieltag 2 › Spieltag 3 › Halbfinale › Finale
  const steps = [];
  for (let r = 1; r <= t.maxRounds; r++) steps.push({ k: "g", r, n: `Spieltag ${r}` });
  let n = t.koSize || koSizeFor(t.fmt, t.mode), kr = 1;
  while (n > 2) { steps.push({ k: "k", r: kr, n: KO_NAME[n] }); n /= 2; kr++; }
  steps.push({ k: "k", r: kr, n: "Finale" });
  const on = (s) => (t.status === "gruppen" && s.k === "g" && s.r === t.round) || (t.status === "ko" && s.k === "k" && s.r === t.koRound);
  const done = (s) => t.status === "fertig" || (s.k === "g" && (t.status === "ko" || (t.status === "gruppen" && s.r < t.round))) || (s.k === "k" && t.status === "ko" && s.r < t.koRound);
  const prog = steps.map((s) => (on(s) ? `🔴 **${s.n}**` : done(s) ? `✅ ${s.n}` : s.n)).join(" › ");
  const cur = currentMatches(t);
  const status =
    t.status === "checkin" ? `🕗 **Check-in läuft** · ${t.fmt}er-Format · Anpfiff ${hhmm(t.times.kickoff)}`
    : t.status === "fertig" ? `🏆 **Turnier beendet** · ${t.fmt}er-Format`
    : `🔴 **${t.status === "gruppen" ? `Spieltag ${t.round}` : koRoundName(t) + (cur.some((m) => m.p3) ? " + Spiel um Platz 3" : "")} läuft** · ${cur.filter((m) => m.status === "fertig").length}/${cur.length} Spiele beendet · ${t.fmt}er-Format`;

  // Ein Spiel als Zeile mit Status
  const icon = (m) => (m.status === "fertig" ? "✅" : m.status === "konflikt" ? "⚠️" : m.pendingBy ? "⏳" : t.status === "checkin" ? "🕗" : "🔴");
  const sc = (m) => (m.status === "fertig" ? `\`${m.h}:${m.a}\`${m.pen ? ` (${m.pen[0]}:${m.pen[1]} i.E.)` : ""}` : "`–:–`");
  const mline = (m) => `${icon(m)} ${flagOf(m.home)} **${esc(m.home)}** ${sc(m)} **${esc(m.away)}** ${flagOf(m.away)}`;

  const d = fmtDef(t.fmt, t.mode);
  const parts = [];
  if (t.status === "checkin" || t.status === "gruppen") {
    const r = t.status === "checkin" ? 1 : t.round;
    const budget = Math.floor(3300 / Math.max(1, t.groups.length));
    for (const g of t.groups) {
      const ms = t.matches.filter((m) => m.group === g.name && m.round === r);
      const tab = standings(t, g.name).map((x, k) => {
        const out = isFreilos(x.id) || t.out?.includes(x.id);
        const mark = out ? "⬛" : k < d.top ? "🟩" : k === d.top && d.ex ? "🟨" : "⬛";
        const td = x.t - x.gt;
        return `${mark} \`${k + 1}\` ${flagOf(x.id)} ${esc(x.id)} · **${x.p} Pkt** · TD ${td > 0 ? "+" + td : td}`;
      });
      parts.push(`### ⚽ ${t.league ? "Liga" : "Gruppe " + g.name} · Spieltag ${r}\n${ms.length ? ms.map(mline).join("\n") : "_spielfrei_"}\n\n${tab.join("\n")}`.slice(0, budget));
    }
  }
  if (t.status === "ko") {
    const lbl = (m) => (m.p3 ? "🥉 Platz 3" : m.final ? "🏆 Finale" : `Spiel ${m.slot + 1}`);
    parts.push(`### ⚔️ ${koRoundName(t)}${cur.some((m) => m.p3) ? " + Spiel um Platz 3" : ""}\n` + cur.sort((a, b) => a.slot - b.slot).map((m) => `\`${lbl(m)}\` ${mline(m)}`).join("\n"));
  }
  if (t.status === "fertig" && t.podium) parts.push("### 🏆 Endstand\n" + t.podium.map((c, i) => `${["🥇", "🥈", "🥉"][i]} ${teamLine(c)}`).join("\n"));
  const legend = t.status === "gruppen" || t.status === "checkin"
    ? `-# 🟩 weiter${d.ex ? ` · 🟨 ${d.top === 1 ? "beste Zweite" : "beste Dritte"}` : ""} · ⬛ raus · ✅ bestätigt · 🔴 läuft · ⏳ wartet auf Bestätigung · aktualisiert <t:${unix(Date.now())}:t>`
    : `-# ✅ bestätigt · 🔴 läuft · ⏳ wartet auf Bestätigung · aktualisiert <t:${unix(Date.now())}:t>`;
  return {
    flags: V2,
    components: [box(
      txt(`## 📺 Live-Spielplan · ${esc(t.name)}\n${status}\n-# ${prog}`),
      ...parts.flatMap((p) => [line(), txt(p)]),
      line(),
      txt(legend),
    )],
  };
}

// ---------- K.-o.-Phase ----------
export function koRoundPost(t, members, roleIds, resultChannel) {
  const cur = currentMatches(t).sort((a, b) => a.slot - b.slot);
  const pair = (m) => `${teamLine(m.home)} vs ${teamLine(m.away)}${bigIVNote(t, [m.home, m.away])}\n${ping([...(members[m.home] || []), ...(members[m.away] || [])])}`;
  const fin = cur.find((m) => m.final), p3 = cur.find((m) => m.p3);
  const name = koRoundName(t);
  const roles = fin ? [roleIds["Finale"], p3 ? roleIds["Spiel um Platz 3"] : null] : [roleIds[name]];
  const desc = fin ? `**🏆 Finale**\n${pair(fin)}${p3 ? `\n\n**🥉 Spiel um Platz 3**\n${pair(p3)}` : ""}` : cur.map(pair).join("\n\n");
  const userIds = cur.flatMap((m) => [...(members[m.home] || []), ...(members[m.away] || [])]);
  return {
    content: `${roles.filter(Boolean).map((r) => `<@&${r}>`).join(" ")} 🟢 **FREIGABE · ${fin ? "Finale & Spiel um Platz 3" : name}** – ihr dürft jetzt spielen!${fin ? " Beide Spiele laufen gleichzeitig." : ""}\n${freigabeWindow()}`,
    allowed_mentions: { roles: roles.filter(Boolean), users: userIds },
    embeds: [{ color: COLOR, title: fin ? "🏆 Finale & Spiel um Platz 3" : `⚔️ ${name}`, description: desc + (resultChannel ? `\n\n📋 Ergebnisse & Screenshots: <#${resultChannel}>` : "") + "\n\n-# Unentschieden? Dann Elfmeterschießen mit angeben.", footer: FOOTER }],
    components: resultChannel ? [] : [row(btn("Ergebnis melden", "res_open", 1, { emoji: { name: "⚽" } }))],
  };
}

export function bracket(t) {
  const fields = [];
  for (let r = 1; r <= t.koRound; r++) {
    const ms = t.matches.filter((m) => m.phase === "ko" && m.round === r).sort((a, b) => a.slot - b.slot);
    const fin = ms.find((m) => m.final);
    if (fin) {
      fields.push({ name: "🏆 Finale", value: matchLine(fin, false) });
      const p3 = ms.find((m) => m.p3);
      if (p3) fields.push({ name: "🥉 Spiel um Platz 3", value: matchLine(p3, false) });
    } else fields.push({ name: koRoundName(t, r), value: ms.map((m) => matchLine(m, false)).join("\n").slice(0, 1024) });
  }
  return { embeds: [{ color: COLOR, title: `⭐ Turnierbaum · ${t.name}`, fields, footer: { text: "Aktualisiert sich automatisch" } }] };
}

// ---------- Hall of Fame ----------
export function hofText(t, members, titleNo, finalLine) {
  const [a, b, c] = t.podium;
  const who = (club) => (members[club] || []).map((id) => `<@${id}>`).join(" ");
  const lines = [
    `🥇 **${esc(a)}** ${flagOf(a)} – ${who(a)}\nUltimate-Team-Champion! Finale: ${finalLine}.`,
    `🥈 **${esc(b)}** ${flagOf(b)} – ${who(b)}\nStarke Leistung bis ins Finale – Platz 2!`,
    c ? `🥉 **${esc(c)}** ${flagOf(c)} – ${who(c)}\nSpiel um Platz 3 gewonnen – Bronze!` : null,
  ].filter(Boolean);
  return {
    content: `🏆 **Glückwunsch an die Sieger der ${esc(t.name)}!**\n\n${lines.join("\n\n")}\n\n-# ${t.playing.length - t.out.length} Spieler · ${t.fmt}er-Format · Titel Nr. ${titleNo} für ${esc(a)}`,
    allowed_mentions: { users: t.podium.flatMap((x) => members[x] || []) },
  };
}

// ---------- Sperrliste ----------
export function banPanel(bans, clubs) {
  const clubOf = (u) => Object.entries(clubs).find(([, c]) => c.manager === u || isCo(c, u))?.[0];
  const lines = bans.map((b) => {
    const c = clubOf(b.user) || b.club;
    return `🚫 <@${b.user}>${c ? ` · ${flagOf(c)} **${esc(c)}**` : ""}\n${BAN_REASONS[b.reason]} · bis <t:${unix(b.until)}:f> (<t:${unix(b.until)}:R>)`;
  });
  return {
    embeds: [{
      color: COLOR,
      title: "🚫 ULTIMATE TEAM CUP | SPERRLISTE",
      description:
        "Hier landen Spieler, die den Turnierabend kaputt machen, nicht auftauchen oder den Ablauf unnötig bremsen.\n\n" +
        "**Gründe**\n" + BAN_REASONS.map((r) => `• ${r}`).join("\n") +
        "\n\n**Dauer**\n• Standardsperre 7 Tage – möglich von 1 Tag bis 12 Monate\n• Abgelaufene Sperren werden automatisch entfernt\n\n" +
        `**Aktuell gesperrt (${bans.length})**\n` + (lines.length ? lines.join("\n\n") : "_Aktuell ist niemand gesperrt._"),
      footer: { text: "Aktualisiert sich automatisch · Sperren: Turnierleitung & Mods" },
    }],
    components: [row(btn("Person sperren", "ban_start", 4, { emoji: { name: "🚫" } }), btn("Sperre aufheben", "ban_lift", 2, { disabled: !bans.length }))],
  };
}

export const banStep1 = () => ({ content: "**Schritt 1 · Wen sperren?** Wähle die Person.", embeds: [], components: [row({ type: 5, custom_id: "ban_user", placeholder: "Mitglied auswählen", min_values: 1, max_values: 1 })] });

export const banStep2 = (u) => ({
  content: `**Schritt 2 · Grund** für <@${u}>`, embeds: [],
  components: [row({ type: 3, custom_id: `ban_r:${u}`, placeholder: "Grund auswählen", options: BAN_REASONS.map((r, i) => ({ label: r.slice(0, 100), value: String(i) })) })],
});

export const banStep3 = (u, r) => ({
  content: `**Schritt 3 · Dauer** für <@${u}> – ${BAN_REASONS[r]}`, embeds: [],
  components: [row({ type: 3, custom_id: `ban_d:${u}:${r}`, placeholder: "Dauer auswählen", options: BAN_DAYS.map((d) => ({ label: `${durText(d)}${d === BAN_DEFAULT_DAYS ? " (Standard)" : ""}`, value: String(d), default: d === BAN_DEFAULT_DAYS })) })],
});

export const banStep4 = (u, r, d, partners = []) => ({
  content: `**Bestätigen:** <@${u}> für **${durText(d)}** sperren – ${BAN_REASONS[r]}${partners.length ? `\n-# ${partners.map((p) => `<@${p}>`).join(", ")} ${partners.length > 1 ? "gehören" : "gehört"} dazu und ${partners.length > 1 ? "können" : "kann"} mitgesperrt werden.` : ""}`,
  embeds: [],
  components: [row(
    btn("Sperren", `ban_ok:${u}:${r}:${d}:1`, 4),
    ...(partners.length ? [btn(partners.length > 1 ? "Alle sperren" : "Beide sperren", `ban_ok:${u}:${r}:${d}:2`, 4)] : []),
    btn("Mit Notiz sperren", `ban_note:${u}:${r}:${d}:${partners.length ? 2 : 1}`, 2),
  )],
});

export const banNoteModal = (rest) => ({ type: 9, data: { custom_id: `ban_m:${rest}`, title: "Sperre mit Notiz", components: [row({ type: 4, custom_id: "note", label: "Notiz (nur für die Turnierleitung)", style: 2, required: true, max_length: 300 })] } });

export const banLiftPicker = (bans) => ({
  content: "**Welche Sperre aufheben?**", embeds: [],
  components: [row({ type: 3, custom_id: "ban_lift_pick", placeholder: "Gesperrte Person auswählen", options: bans.slice(0, 25).map((b) => ({ label: `${b.club || "ohne Profil"} – bis ${new Date(b.until).toLocaleDateString("de-AT")}`.slice(0, 100), description: BAN_REASONS[b.reason].slice(0, 100), value: b.user })) })],
});

// ---------- Ergebniskanal pro Gruppe ----------
export function resultPanel(t, g) {
  const r = t.status === "gruppen" ? t.round : t.status === "checkin" ? 1 : null;
  const ms = r ? t.matches.filter((m) => m.group === g.name && m.round === r) : [];
  const open = t.status === "gruppen";
  return {
    embeds: [{
      color: COLOR,
      title: `📋 ${t.league ? "Liga" : "Gruppe " + g.name} · Ergebnisse`,
      description:
        "Hier tragt ihr eure Ergebnisse ein.\n\n" +
        "• **Ergebnis eintragen:** ein Spieler trägt ein, der Gegner hat **2 Minuten** zum Bestätigen – sonst gilt das Ergebnis. Bei unterschiedlichen Ergebnissen wird die Turnierleitung markiert.\n" +
        "• **📸 Screenshot:** Nach dem Spiel postet der Sieger ein Foto vom Endstand hier im Kanal.\n\n" +
        (t.status === "checkin" ? "_Los geht’s nach dem Check-in._" : r ? `**Spieltag ${r}**\n${ms.length ? ms.map((m) => matchLine(m)).join("\n") : "_spielfrei_"}` : "_Die Gruppenphase ist beendet._"),
      footer: { text: "Aktualisiert sich automatisch" },
    }],
    components: open ? [row(btn("Ergebnis eintragen", "res_open", 1, { emoji: { name: "⚽" } }))] : [],
  };
}

export function videoPost(v, users) {
  return {
    content: users.map((u) => `<@${u}>`).join(" "),
    allowed_mentions: { users },
    embeds: [{
      color: COLOR, title: "📏 Größenvideo angefordert",
      description: `${flagOf(v.by)} **${esc(v.by)}** fordert von ${flagOf(v.to)} **${esc(v.to)}** ein Größenvideo an (Spiel #${v.matchId}${v.minute ? `, ${v.minute}. Spielminute` : ""}).\n\n⏳ **Bis nach Ende des Spiels hast du Zeit, das Video in diesem Kanal zu posten.**`,
    }],
  };
}
export const videoModal = (id) => ({ type: 9, data: { custom_id: `vid_m:${id}`, title: "Größenvideo einreichen", components: [row({ type: 4, custom_id: "link", label: "Video-Link (YouTube, Streamable, Medal …)", style: 1, required: true, max_length: 300, placeholder: "https://" })] } });

export function koResultPanel(t) {
  const open = t.status === "ko";
  const cur = open ? currentMatches(t).sort((a, b) => a.slot - b.slot) : [];
  const lbl = (m) => (m.p3 ? "Platz 3" : m.final ? "Finale" : `Spiel ${m.slot + 1}`);
  const title = open ? koRoundName(t) + (cur.some((m) => m.p3) ? " + Spiel um Platz 3" : "") : null;
  return {
    embeds: [{
      color: COLOR,
      title: "📋 K.-o.-Phase · Ergebnisse",
      description:
        "Hier tragt ihr eure K.-o.-Ergebnisse ein.\n\n" +
        "• **Ergebnis eintragen:** ein Spieler trägt ein, der Gegner hat **2 Minuten** zum Bestätigen. Bei Unentschieden das Elfmeterschießen mit angeben.\n" +
        "• **📸 Screenshot:** Nach dem Spiel postet der Sieger ein Foto vom Endstand hier im Kanal.\n\n" +
        (open ? `**${title}**\n${cur.map((m) => `\`${lbl(m)}\` ${matchLine(m, false)}`).join("\n")}` : t.status === "fertig" ? "_Das Turnier ist beendet._" : t.status === "vorbei" ? "_Diese Runde ist beendet – die nächste Runde steht weiter unten._" : "_Die K.-o.-Phase hat noch nicht begonnen._"),
      footer: { text: "Aktualisiert sich automatisch" },
    }],
    components: open ? [row(btn("Ergebnis eintragen", "res_open", 1, { emoji: { name: "⚽" } }))] : [],
  };
}

/** Nachricht an den Gegner: bestätigen oder anderes Ergebnis */
export function confirmAsk(m, reporter, users, h, a, pen, state = "offen") {
  const score = `${flagOf(m.home)} **${esc(m.home)} ${h}:${a}${pen ? ` (${pen[0]}:${pen[1]} i.E.)` : ""} ${esc(m.away)}** ${flagOf(m.away)}`;
  const until = Math.floor((Date.now() + 3 * 60 * 1000) / 1000); // 2 Min. Frist + bis zu 1 Min., bis der Timer läuft
  const text = {
    offen: `📨 **${esc(reporter)}** hat für Spiel #${m.id} eingetragen: ${score}\n⏳ Bitte innerhalb von 2 Minuten bestätigen – sonst gilt das Ergebnis automatisch (spätestens <t:${until}:R>).`,
    bestaetigt: `✅ Ergebnis bestätigt: ${score}`,
    auto: `✅ Ergebnis automatisch bestätigt (keine Reaktion in 2 Minuten): ${score}`,
    konflikt: `⚠️ Unterschiedliche Ergebnisse für Spiel #${m.id} – die Turnierleitung entscheidet.`,
  }[state];
  return {
    content: state === "offen" ? `${users.map((u) => `<@${u}>`).join(" ")} ${text}` : text,
    allowed_mentions: { users: state === "offen" ? users : [] },
    components: state === "offen" ? [row(btn("Bestätigen", `res_ok:${m.id}`, 3, { emoji: { name: "✅" } }), btn("Anderes Ergebnis", "res_open", 2, { emoji: { name: "✏️" } }))] : [],
  };
}

// ---------- Regelwerk ----------
export function rulesPanel(count) {
  return {
    embeds: [{
      color: COLOR,
      title: RULES.title,
      thumbnail: { url: `${site()}/blue-dragons-logo.png` },
      fields: RULES.sections.map(([name, value]) => ({ name, value })),
    }, ...(RULES.highlight ? [{
      color: 0xe02424, // rot, damit die Regel sofort auffällt
      title: RULES.highlight.title,
      description: RULES.highlight.text,
    }] : []), {
      color: COLOR,
      description: "Mit dem Button unten akzeptierst du das Regelwerk.",
      footer: { text: `${count} ${count === 1 ? "Mitglied hat" : "Mitglieder haben"} das Regelwerk akzeptiert · Erst danach ist die Anmeldung zum Cup möglich` },
    }],
    components: [row(btn("Regeln akzeptieren", "rules_ok", 3, { emoji: { name: "✅" } }))],
  };
}

export const videoMinuteModal = (limit) => ({ type: 9, data: { custom_id: "vid_min", title: "Größenvideo anfordern", components: [row({ type: 4, custom_id: "min", label: `Aktuelle Spielminute (nur bis zur ${limit}.)`, style: 1, required: true, max_length: 3, placeholder: "z. B. 23" })] } });

// ---------- Willkommen & Rollenauswahl ----------
export function welcomePost() { return { content: "" }; }
export function rolesPanel() { return { content: "" }; }

// ---------- Spielfreigabe ----------
/** Freigabe einer Runde im Gruppenkanal: Ping an die Gruppe, Paarungen mit Managern */
/** Freigabe-Zeitfenster, z. B. 20:00 – 20:05 (auf die Minute abgerundet) */
export function freigabeWindow(at = Date.now()) {
  const start = Math.floor(at / 60000) * 60000, end = start + FREIGABE_MIN * 60000;
  return `🕗 **Freigabe:** <t:${unix(start)}:t> – <t:${unix(end)}:t> · spätestens <t:${unix(end)}:t> anpfeifen (<t:${unix(end)}:R>)`;
}

export function freigabePost(t, g, round, roleId, resultCh) {
  const ms = t.matches.filter((m) => m.group === g.name && m.round === round);
  const mgr = (c) => (isFreilos(c) ? "" : t.members?.[c]?.[0] ? ` <@${t.members[c][0]}>` : "");
  const pairs = ms.map((m) => {
    const free = isFreilos(m.home) || isFreilos(m.away);
    return `${flagOf(m.home)} **${esc(m.home)}**${mgr(m.home)}  vs  **${esc(m.away)}**${mgr(m.away)} ${flagOf(m.away)}${free ? "\n-# 🎟️ Freilos – wird automatisch 3:0 gewertet" : ""}${bigIVNote(t, [m.home, m.away])}`;
  });
  const playing = new Set(ms.flatMap((m) => [m.home, m.away]));
  const bye = g.teams.filter((c) => !playing.has(c) && !isFreilos(c));
  return {
    flags: V2,
    allowed_mentions: { roles: roleId ? [roleId] : [] },
    components: [box(
      txt(`${roleId ? `<@&${roleId}> ` : ""}\n## 🟢 FREIGABE · Spieltag ${round}${t.league ? ` von ${t.maxRounds}` : ""}\n${t.league ? "Liga" : "Gruppe " + g.name} – **ihr dürft jetzt spielen!**\n${freigabeWindow()}`),
      line(),
      txt("### ⚽ Paarungen\n" + (pairs.length ? pairs.join("\n") : "_spielfrei_") + (bye.length ? `\n\n💤 Spielfrei: ${bye.map((c) => `${flagOf(c)} ${esc(c)}`).join(", ")}` : "")),
      line(),
      txt(`📋 Nach dem Spiel das Ergebnis ${resultCh ? `in <#${resultCh}>` : "über den Button im Spielplan"} eintragen – der Gegner bestätigt.\n🎮 Ladet euch über die **EA-ID** ein (Freundschaftsspiel online).\n-# Die nächste Runde wird automatisch freigegeben, sobald alle Spiele dieser Runde bestätigt sind.`),
    )],
  };
}
