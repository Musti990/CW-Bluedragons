const API = "https://discord.com/api/v10";
const NO_PINGS = { parse: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * REST-Aufruf mit Rate-Limit-Behandlung: bei 429 wird kurz gewartet und erneut versucht.
 * Gibt das JSON (oder true) zurück, bei Fehlern null.
 */
export async function discord(path, method = "GET", body, { form, reason, maxWait = 6000 } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = { Authorization: `Bot ${(process.env.CUP_DISCORD_TOKEN || process.env.DISCORD_TOKEN)}` };
    if (!form) headers["Content-Type"] = "application/json";
    if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason);
    const res = await fetch(API + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
    if (res.status === 429) {
      const info = await res.json().catch(() => ({}));
      const wait = Math.ceil((info.retry_after ?? 1) * 1000) + 50;
      if (wait > maxWait) { console.error(`Rate-Limit ${method} ${path}: ${wait} ms`); return null; }
      await sleep(wait);
      continue;
    }
    // Vorausschauend bremsen, wenn der Bucket leer ist
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      const after = Number(res.headers.get("x-ratelimit-reset-after") ?? 0) * 1000;
      if (after > 0 && after < maxWait) await sleep(after);
    }
    if (!res.ok) {
      console.error(`Discord ${method} ${path} -> ${res.status}: ${await res.text()}`);
      return null;
    }
    return res.status === 204 ? true : res.json();
  }
  return null;
}

export const sendMessage = (ch, payload) => discord(`/channels/${ch}/messages`, "POST", { allowed_mentions: NO_PINGS, ...payload });
export const editMessage = (ch, id, payload) => discord(`/channels/${ch}/messages/${id}`, "PATCH", { allowed_mentions: NO_PINGS, ...payload });
export const deleteMessage = (ch, id) => discord(`/channels/${ch}/messages/${id}`, "DELETE");
export const pinMessage = (ch, id) => discord(`/channels/${ch}/pins/${id}`, "PUT");
export const editOriginal = (i, payload) =>
  discord(`/webhooks/${i.application_id}/${i.token}/messages/@original`, "PATCH", { allowed_mentions: NO_PINGS, ...payload });
export const followUp = (i, payload) =>
  discord(`/webhooks/${i.application_id}/${i.token}`, "POST", { allowed_mentions: NO_PINGS, ...payload });

/** Nachricht senden oder – wenn es sie schon gibt – bearbeiten. Gibt die Nachrichten-ID zurück. */
export async function upsertMessage(ch, id, payload) {
  if (id) {
    const ok = await editMessage(ch, id, payload);
    if (ok) return id;
  }
  const msg = await sendMessage(ch, payload);
  // Alte Nachricht entfernen (z. B. beim Wechsel auf das neue Layout), damit nichts doppelt steht
  if (msg && id) await deleteMessage(ch, id);
  return msg?.id ?? null;
}

/** Nachricht mit Bild-Anhang (z. B. Siegerbild) */
export async function sendWithFile(ch, payload, filename, buffer, type = "image/png") {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ allowed_mentions: NO_PINGS, ...payload, attachments: [{ id: 0, filename }] }));
  form.append("files[0]", new Blob([buffer], { type }), filename);
  return discord(`/channels/${ch}/messages`, "POST", undefined, { form });
}

/** Nachricht mit mehreren Bildern senden bzw. (mit id) bearbeiten – files: [{ name, buffer }] */
export async function sendFiles(ch, payload, files, id = null) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ allowed_mentions: NO_PINGS, ...payload, attachments: files.map((f, k) => ({ id: k, filename: f.name })) }));
  files.forEach((f, k) => form.append(`files[${k}]`, new Blob([f.buffer], { type: "image/png" }), f.name));
  return discord(`/channels/${ch}/messages${id ? "/" + id : ""}`, id ? "PATCH" : "POST", undefined, { form });
}

const guild = () => (process.env.CUP_GUILD_ID || process.env.GUILD_ID);
export const addRole = (user, role, reason) => discord(`/guilds/${guild()}/members/${user}/roles/${role}`, "PUT", undefined, { reason });
export const removeRole = (user, role, reason) => discord(`/guilds/${guild()}/members/${user}/roles/${role}`, "DELETE", undefined, { reason });
export const getRoles = () => discord(`/guilds/${guild()}/roles`);
export const createRole = (name, color = 0) => discord(`/guilds/${guild()}/roles`, "POST", { name, color, hoist: true, mentionable: true });

/** Alle Mitglieder (braucht „Server Members Intent“) */
export async function listMembers() {
  const all = [];
  let after = "0";
  for (let page = 0; page < 20; page++) {
    const batch = await discord(`/guilds/${guild()}/members?limit=1000&after=${after}`);
    if (!batch) return null;
    all.push(...batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  return all;
}

export async function sendDM(user, payload) {
  const ch = await discord(`/users/@me/channels`, "POST", { recipient_id: user });
  if (!ch) return null;
  return sendMessage(ch.id, payload);
}
