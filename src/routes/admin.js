// src/routes/admin.js
const router = require('express').Router();
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const logger = require('../utils/logger');

// ── GET /admin/stats ─────────────────────────────────────────────────────────
router.get('/stats', requireAdmin, async (_req, res) => {
  const [users, alerts, active, resolved] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS n FROM users WHERE role != \'admin\''),
    db.query('SELECT COUNT(*)::int AS n FROM alerts'),
    db.query('SELECT COUNT(*)::int AS n FROM alerts WHERE status=\'active\''),
    db.query('SELECT COUNT(*)::int AS n FROM alerts WHERE status=\'resolved\''),
  ]);
  res.json({
    totalUsers:      users.rows[0].n,
    totalAlerts:     alerts.rows[0].n,
    activeAlerts:    active.rows[0].n,
    resolvedAlerts:  resolved.rows[0].n,
    systemOnline:    true,
  });
});

// ── GET /admin/users ─────────────────────────────────────────────────────────
router.get('/users', requireAdmin, async (_req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.phone, u.student_id,
            u.department, u.hostel, u.role, u.created_at,
            (SELECT COUNT(*)::int FROM alerts a WHERE a.reporter_id = u.id) AS alert_count
     FROM users u
     WHERE u.role != 'admin'
     ORDER BY u.created_at DESC`
  );
  res.json(rows);
});

// ── GET /admin/incidents ─────────────────────────────────────────────────────
router.get('/incidents', requireAdmin, async (_req, res) => {
  const { rows } = await db.query(
    `SELECT a.id, a.type, a.title, a.location_label,
            a.status, a.created_at,
            u.name AS reporter,
            COALESCE(COUNT(ar.user_id), 0)::int AS responders
     FROM alerts a
     JOIN users u ON u.id = a.reporter_id
     LEFT JOIN alert_responders ar ON ar.alert_id = a.id
     GROUP BY a.id, u.name
     ORDER BY a.created_at DESC
     LIMIT 100`
  );
  res.json(rows);
});

// ── POST /admin/broadcast ────────────────────────────────────────────────────
router.post(
  '/broadcast',
  requireAdmin,
  validate([
    body('title').trim().notEmpty(),
    body('body').trim().notEmpty(),
  ]),
  async (req, res) => {
    const { title, body: bodyText } = req.body;
    await db.query(
      'INSERT INTO broadcasts (id,title,body,sender_id) VALUES ($1,$2,$3,$4)',
      [uuidv4(), title, bodyText, req.user.id]
    );
    logger.info('Broadcast sent', { title, by: req.user.id });

    const io = req.app.get('io');
    if (io) io.emit('broadcast', { title, body: bodyText, sentAt: new Date() });

    res.status(201).json({ sent: true });
  }
);

// ── DELETE /admin/users/:id ───────────────────────────────────────────────────
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const { rowCount } = await db.query(
    'DELETE FROM users WHERE id=$1 AND role!=\'admin\'',
    [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'User not found' });
  res.json({ deleted: true });
});

module.exports = router;
