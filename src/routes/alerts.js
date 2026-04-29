// src/routes/alerts.js
const router = require('express').Router();
const { body, query } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { haversineSQL } = require('../utils/geo');
const logger = require('../utils/logger');

const ALERT_TYPES = ['fire','medical','security','accident','sos','flood'];
const ALERT_ICONS = {
  fire:'🔥', medical:'🏥', security:'🚔', accident:'⚠️', sos:'🚨', flood:'🌧️',
};

// ── GET /alerts ──────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE a.status = $${params.length}`; }

  const { rows } = await db.query(
    `SELECT
       a.*,
       u.name AS reporter_name,
       COALESCE(COUNT(ar.user_id), 0)::int AS responder_count
     FROM alerts a
     JOIN users u ON u.id = a.reporter_id
     LEFT JOIN alert_responders ar ON ar.alert_id = a.id
     ${where}
     GROUP BY a.id, u.name
     ORDER BY a.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  res.json(rows.map(enrichAlert));
});

// ── GET /alerts/nearby ───────────────────────────────────────────────────────
router.get(
  '/nearby',
  requireAuth,
  validate([
    query('lat').isFloat(),
    query('lng').isFloat(),
    query('radius').optional().isInt({ max: 5000 }),
  ]),
  async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseInt(req.query.radius) || 500;

    const params = ['active'];
    const distSQL = haversineSQL('a.lat', 'a.lng', lat, lng, params);

    const { rows } = await db.query(
      `SELECT
         a.*,
         u.name AS reporter_name,
         COALESCE(COUNT(ar.user_id), 0)::int AS responder_count,
         ${distSQL} AS distance_m
       FROM alerts a
       JOIN users u ON u.id = a.reporter_id
       LEFT JOIN alert_responders ar ON ar.alert_id = a.id
       WHERE a.status = $1
         AND ${distSQL} <= $${params.length + 1}
       GROUP BY a.id, u.name
       ORDER BY distance_m ASC`,
      [...params, radius]
    );
    res.json(rows.map(enrichAlert));
  }
);

// ── GET /alerts/:id ──────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, u.name AS reporter_name,
       COALESCE(COUNT(ar.user_id), 0)::int AS responder_count
     FROM alerts a
     JOIN users u ON u.id = a.reporter_id
     LEFT JOIN alert_responders ar ON ar.alert_id = a.id
     WHERE a.id = $1 GROUP BY a.id, u.name`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Alert not found' });
  res.json(enrichAlert(rows[0]));
});

// ── POST /alerts ─────────────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  validate([
    body('type').isIn(ALERT_TYPES),
    body('lat').isFloat(),
    body('lng').isFloat(),
    body('title').trim().notEmpty(),
  ]),
  async (req, res) => {
    const { type, title, description, locationLabel, lat, lng, radiusM } = req.body;
    const radius = parseInt(radiusM) || parseInt(process.env.DEFAULT_ALERT_RADIUS_M) || 500;

    const { rows } = await db.query(
      `INSERT INTO alerts (id,type,title,description,location_label,lat,lng,radius_m,reporter_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [uuidv4(), type, title, description||null, locationLabel||null, lat, lng, radius, req.user.id]
    );
    const alert = enrichAlert(rows[0]);
    logger.info('Alert created', { id: alert.id, type, reporter: req.user.id });

    // Emit real-time event so connected clients receive it immediately
    const io = req.app.get('io');
    if (io) {
      io.emit('alert:new', alert);
      // Also target users within radius (best-effort)
      broadcastToNearbyUsers(io, alert, radius);
    }

    res.status(201).json(alert);
  }
);

// ── PATCH /alerts/:id/resolve ────────────────────────────────────────────────
router.patch('/:id/resolve', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE alerts
     SET status='resolved', resolved_by=$1, resolved_at=NOW()
     WHERE id=$2 AND status='active'
     RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Alert not found or already resolved' });
  const alert = enrichAlert(rows[0]);
  const io = req.app.get('io');
  if (io) io.emit('alert:resolved', alert);
  res.json(alert);
});

// ── POST /alerts/:id/respond ─────────────────────────────────────────────────
router.post('/:id/respond', requireAuth, async (req, res) => {
  await db.query(
    `INSERT INTO alert_responders (alert_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.params.id, req.user.id]
  );
  const { rows } = await db.query(
    `SELECT COALESCE(COUNT(*), 0)::int AS responder_count
     FROM alert_responders WHERE alert_id=$1`,
    [req.params.id]
  );
  const count = rows[0].responder_count;
  const io = req.app.get('io');
  if (io) io.emit('alert:respond', { alertId: req.params.id, responderCount: count });
  res.json({ alertId: req.params.id, responderCount: count });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function enrichAlert(row) {
  return {
    ...row,
    icon: ALERT_ICONS[row.type] || '📢',
    reporter: row.reporter_name,
    responders: row.responder_count ?? 0,
    time: timeAgo(row.created_at),
  };
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

async function broadcastToNearbyUsers(io, alert, radiusM) {
  // Fetch socket IDs of users who opted into alerts and are within radius
  // This is a best-effort background task — errors are silently swallowed
  try {
    const params = [radiusM];
    const distSQL = haversineSQL('u.lat', 'u.lng', alert.lat, alert.lng, params);
    const { rows } = await db.query(
      `SELECT push_token FROM users u
       WHERE u.push_token IS NOT NULL
         AND ${distSQL} <= $1
         AND u.id != $${params.length + 1}`,
      [...params, alert.reporter_id]
    );
    // TODO: send FCM push notification to each rows[i].push_token here
    logger.debug('Nearby users to notify', { count: rows.length });
  } catch {}
}

module.exports = router;
