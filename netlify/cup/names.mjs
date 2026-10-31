// Spitznamen auf dem Server: "Musti | Musti990" (Discord-Name | EA-ID)
import { discord } from "./discord.mjs";

const guild = () => process.env.CUP_GUILD_ID;
const TAIL = /\s+\|\s+.*$/;

/** Grundname ohne eventuellen alten Zusatz */
export function baseNameOf(member, user) {
  const u = user || member?.user || {};
  const raw = member?.nick || u.global_name || u.username || "Spieler";
  return raw.replace(TAIL, "").trim() || "Spieler";
}

/** Spitzname bauen (max. 32 Zeichen, Name wird bei Bedarf gekürzt) */
export function nickFor(base, _role, eaId) {
  const tail = ` | ${eaId}`;
  const room = 32 - tail.length;
  if (room < 2) return String(eaId).slice(0, 32);
  const name = base.length > room ? base.slice(0, Math.max(1, room - 1)) + "…" : base;
  return (name + tail).slice(0, 32);
}

/** Spitzname setzen; null = zurück auf den ursprünglichen (keinen) Spitznamen */
export const setNick = (uid, nick) => discord(`/guilds/${guild()}/members/${uid}`, "PATCH", { nick: nick ?? null }, { reason: "UT Cup: Spielerprofil" });
