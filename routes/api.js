const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendText, broadcastToPhones } = require('../whatsapp');
const axios = require('axios');

function adminOnly(req, res, next) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Mapa público ──────────────────────────────────────────────────────────────

router.get('/map-data', (req, res) => {
  const activeDisaster = db.prepare(
    'SELECT * FROM disasters WHERE active = 1 ORDER BY triggered_at DESC LIMIT 1'
  ).get();

  if (!activeDisaster) return res.json({ disaster: null, centers: [], safeCount: 0, searches: [] });

  const centers = db.prepare(
    'SELECT id, name, lat, lng, address, current_count, capacity FROM assistance_centers WHERE disaster_id = ? AND active = 1'
  ).all(activeDisaster.id);

  const safeCount = db.prepare(
    'SELECT COUNT(*) as n FROM safe_persons WHERE disaster_id = ?'
  ).get(activeDisaster.id).n;

  const searches = db.prepare(
    `SELECT id, missing_name, description, created_at FROM searches
     WHERE disaster_id = ? AND status = 'active'`
  ).all(activeDisaster.id);

  res.json({ disaster: activeDisaster, centers, safeCount, searches });
});

// ── Admin: activar evento ─────────────────────────────────────────────────────

router.post('/disasters', adminOnly, (req, res) => {
  const { name, lat, lng, radius_km } = req.body;
  if (!name || !lat || !lng) return res.status(400).json({ error: 'name, lat, lng requeridos' });

  db.prepare('UPDATE disasters SET active = 0').run();
  const result = db.prepare(
    'INSERT INTO disasters (name, lat, lng, radius_km, source) VALUES (?, ?, ?, ?, ?)'
  ).run(name, lat, lng, radius_km || 50, 'manual');

  res.json({ id: result.lastInsertRowid, message: 'Evento activado' });
});

// ── Admin: centros asistenciales ──────────────────────────────────────────────

router.post('/centers', adminOnly, (req, res) => {
  const { name, lat, lng, address, capacity } = req.body;
  const activeDisaster = db.prepare('SELECT * FROM disasters WHERE active = 1 LIMIT 1').get();
  if (!activeDisaster) return res.status(400).json({ error: 'No hay evento activo' });

  const result = db.prepare(
    'INSERT INTO assistance_centers (name, lat, lng, address, capacity, disaster_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, lat, lng, address, capacity, activeDisaster.id);

  res.json({ id: result.lastInsertRowid });
});

// ── Admin: estadísticas ───────────────────────────────────────────────────────

router.get('/stats', adminOnly, (req, res) => {
  const activeDisaster = db.prepare('SELECT * FROM disasters WHERE active = 1 LIMIT 1').get();
  if (!activeDisaster) return res.json({ active: false });

  const safe = db.prepare('SELECT COUNT(*) as n FROM safe_persons WHERE disaster_id = ?').get(activeDisaster.id).n;
  const active = db.prepare(`SELECT COUNT(*) as n FROM searches WHERE disaster_id = ? AND status = 'active'`).get(activeDisaster.id).n;
  const found = db.prepare(`SELECT COUNT(*) as n FROM searches WHERE disaster_id = ? AND status = 'found'`).get(activeDisaster.id).n;
  const alerts = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE sent_at > datetime("now", "-1 hour")').get().n;

  res.json({ disaster: activeDisaster, safe, activeSearches: active, resolved: found, alertsLastHour: alerts });
});

// ── USGS Webhook (trigger automático por sismo) ───────────────────────────────

router.post('/usgs-webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const feature = req.body?.features?.[0];
    if (!feature) return;

    const props = feature.properties;
    const [lng, lat] = feature.geometry.coordinates;
    const mag = props.mag;
    const minMag = parseFloat(process.env.USGS_MIN_MAGNITUDE) || 5.5;

    if (mag < minMag) return;

    const name = `Sismo ${mag.toFixed(1)} — ${props.place}`;
    db.prepare('UPDATE disasters SET active = 0').run();
    const result = db.prepare(
      'INSERT INTO disasters (name, lat, lng, source) VALUES (?, ?, ?, ?)'
    ).run(name, lat, lng, 'usgs');

    console.log(`[USGS] Evento activado: ${name} (ID ${result.lastInsertRowid})`);
  } catch (err) {
    console.error('[USGS] Error:', err.message);
  }
});

module.exports = router;
