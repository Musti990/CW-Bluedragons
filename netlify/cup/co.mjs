// Co-VMs eines Vereins. Neu: Liste `cos` = [{ id, base, orig }].
// Alte Daten (Felder co / coBase / coOrigNick) werden automatisch mitgelesen und beim nächsten Speichern umgestellt.
export const MAX_CO = 3;

export function coList(c) {
  if (!c) return [];
  const list = Array.isArray(c.cos) ? c.cos.filter((x) => x && x.id).map((x) => ({ ...x })) : [];
  if (c.co && !list.some((x) => x.id === c.co)) list.unshift({ id: c.co, base: c.coBase ?? null, orig: c.coOrigNick ?? null });
  return list;
}
export const coIds = (c) => coList(c).map((x) => x.id);
export const isCo = (c, uid) => !!uid && coIds(c).includes(uid);

export function setCos(c, list) {
  c.cos = list;
  c.co = null; c.coBase = null; c.coOrigNick = null;
}
export function addCo(c, entry) {
  const list = coList(c).filter((x) => x.id !== entry.id);
  list.push(entry);
  setCos(c, list);
}
export function removeCo(c, uid) {
  const list = coList(c);
  const found = list.find((x) => x.id === uid) || null;
  setCos(c, list.filter((x) => x.id !== uid));
  return found;
}
