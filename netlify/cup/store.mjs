import { getStore } from "@netlify/blobs";
import { setPlatformCache } from "./data.mjs";

const data = () => getStore({ name: "ut-cup", consistency: "strong" });

export const get = (key) => data().get(key, { type: "json" });
export const set = (key, value) => data().setJSON(key, value);
export const del = (key) => data().delete(key);

export async function keys(prefix) {
  const { blobs } = await data().list({ prefix });
  return blobs.map((b) => b.key);
}

/**
 * Liest, ändert und speichert nur, wenn niemand zwischendurch gespeichert hat –
 * sonst neuer Versuch. So gehen keine Klicks verloren, wenn mehrere gleichzeitig drücken.
 * initial: Startwert, falls der Eintrag fehlt (sonst Fehler mit missingMessage).
 */
export async function mutate(key, fn, { initial, missing = "Nicht gefunden." } = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await data().getWithMetadata(key, { type: "json" });
    let value, options;
    if (entry?.data != null) {
      value = entry.data;
      options = { onlyIfMatch: entry.etag };
    } else if (initial !== undefined) {
      value = structuredClone(initial);
      options = { onlyIfNew: true };
    } else {
      throw new Error(missing);
    }
    const result = await fn(value);
    const write = await data().setJSON(key, value, options);
    if (write?.modified !== false) return { value, result };
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 160));
  }
  throw new Error("Gerade ist viel los – bitte nochmal versuchen.");
}

// Bequeme Kurzformen
export const getConfig = async () => (await get("config")) ?? { channels: {}, roles: { groups: {}, rounds: {} } };
export const getClubs = async () => { const c = (await get("clubs")) ?? {}; setPlatformCache(c); return c; };
export const mutateClubs = (fn) => mutate("clubs", fn, { initial: {} });
export const tKey = (channelId) => `t:${channelId}`;
