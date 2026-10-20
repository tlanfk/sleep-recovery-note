// 수면 회복 노트 — 같은 기록을 여러 기기에서 보도록 D1에 한 벌로 저장
// GET  /api/state → { version, updatedAt, data }
// PUT  /api/state  { base, data } → base가 서버 버전과 같을 때만 저장, 다르면 409와 최신 기록

let ready = false;
async function init(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS backups (day TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL)')
  ]);
  ready = true;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
  });
}

async function current(db) {
  const row = await db.prepare('SELECT version, updated_at, data FROM state WHERE id = 1').first();
  return row ? { version: row.version, updatedAt: row.updated_at, data: JSON.parse(row.data) } : { version: 0, updatedAt: null, data: null };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/api/state') return env.ASSETS.fetch(req);
    await init(env.DB);

    if (req.method === 'GET') return json(await current(env.DB));

    if (req.method === 'PUT') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: '잘못된 요청' }, 400); }
      if (!body || typeof body.data !== 'object' || body.data === null || typeof body.base !== 'number') return json({ error: '잘못된 요청' }, 400);
      const text = JSON.stringify(body.data);
      if (text.length > 1800000) return json({ error: '기록이 너무 큽니다' }, 413);

      // 하루 한 번, 바뀌기 전 기록을 30일 보관 (실수로 지워도 되돌릴 수 있게)
      const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const old = new Date(Date.now() + 9 * 3600 * 1000 - 30 * 86400 * 1000).toISOString().slice(0, 10);
      const now = new Date().toISOString();
      const res = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO backups (day, version, data) SELECT ?, version, data FROM state WHERE id = 1').bind(day),
        env.DB.prepare('DELETE FROM backups WHERE day < ?').bind(old),
        env.DB.prepare('INSERT INTO state (id, version, updated_at, data) VALUES (1, 1, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET version = state.version + 1, updated_at = excluded.updated_at, data = excluded.data WHERE state.version = ?')
          .bind(now, text, body.base)
      ]);
      const cur = await current(env.DB);
      if (res[2].meta.changes === 0) return json(Object.assign({ conflict: true }, cur), 409);
      return json({ version: cur.version, updatedAt: cur.updatedAt });
    }
    return json({ error: '지원하지 않는 요청' }, 405);
  }
};
