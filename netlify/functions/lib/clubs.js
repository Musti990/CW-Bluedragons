// Leichtgewichtige Grundeinstellungen (ohne sharp/impit), damit /session-Befehle schnell antworten.
const { getStore } = require('@netlify/blobs');

// Die beiden überwachten Clubs (team = Kürzel für /session team:1 bzw. team:2)
const CLUBS = [
  { clubId: '' /* EA-Club-ID Blue Dragons 1 eintragen */, label: 'Blue Dragons 1', team: '1' },
  { clubId: '' /* EA-Club-ID Blue Dragons 2 eintragen */, label: 'Late Night', team: '2' },
];

function blobStore(name) {
  return getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

module.exports = { CLUBS, blobStore };
