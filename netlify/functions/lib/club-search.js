// EA-Clubsuche für /session (Autovervollständigung): Name eintippen -> passende Clubs mit ID.
// impit wird nur hier geladen, damit die übrigen Befehle schnell bleiben.

let impit = null;
function client() {
  if (!impit) {
    const { Impit } = require('impit');
    impit = new Impit({ browser: 'chrome' });
  }
  return impit;
}

async function searchClubs(name, timeoutMs = 2200) {
  const q = String(name || '').trim();
  if (q.length < 2) return [];
  const url = `https://proclubs.ea.com/api/fc/allTimeLeaderboard/search?platform=common-gen5&clubName=${encodeURIComponent(q)}`;
  const req = client()
    .fetch(url, { headers: { Accept: 'application/json', Referer: 'https://www.ea.com/' } })
    .then((r) => (r.ok ? r.json() : []));
  const timeout = new Promise((resolve) => setTimeout(() => resolve([]), timeoutMs));
  const list = await Promise.race([req, timeout]).catch(() => []);
  return (Array.isArray(list) ? list : [])
    .map((c) => ({
      clubId: String(c.clubId || c.clubInfo?.clubId || ''),
      name: String(c.clubInfo?.name || '').replace(/\s+/g, ' ').trim(),
      games: Number(c.gamesPlayed) || 0,
    }))
    .filter((c) => c.clubId && c.name);
}

module.exports = { searchClubs };
