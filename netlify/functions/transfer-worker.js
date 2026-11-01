// Rendert die Transfer-Grafik und postet sie (von interactions.js angestoßen)
const { runJob } = require('./lib/transfers');

exports.handler = async (event) => {
  if (!process.env.CRON_SECRET || event.headers['x-worker-secret'] !== process.env.CRON_SECRET) return { statusCode: 401, body: 'Nicht autorisiert' };
  try {
    const { id } = JSON.parse(event.body || '{}');
    const r = await runJob(id);
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (err) {
    console.error('transfer-worker:', err);
    return { statusCode: 500, body: err.message };
  }
};
