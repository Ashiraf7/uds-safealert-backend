// src/routes/users.js
const router = require('express').Router();
const { body, query } = require('express-validator');
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { haversineSQL } = require('../utils/geo');
const { v4: uuidv4 } = require('uuid');

// ── GET /users/me ────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.phone, u.student_id, u.department, u.hostel,
            u.blood_type, u.allergies, u.medical_notes, u.role,
            u.lat, u.lng, u.alert_radius_m, u.created_at,
            COALESCE(
              json_agg(json_build_object('name',ec.name,'phone',ec.phone))
              FILTER (WHERE ec.id IS NOT NULL), '[]'
            ) AS emergency_contacts
     FROM users u
     LEFT JOIN emergency_contacts ec ON ec.user_id = u.id
     WHERE u.id = $1 GROUP BY u.id`,
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// ── PUT /users/profile ───────────────────────────────────────────────────────
router.put('/profile', requireAuth, async (req, res) => {
  const { name, phone, department, hostel, bloodType,
          allergies, medicalNotes, alertRadiusM,
          emergencyContacts } = req.body;

  await db.query(
    `UPDATE users SET
       name = COALESCE($2, name),
       phone = COALESCE($3, phone),
       department = COALESCE($4, department),
       hostel = COALESCE($5, hostel),
       blood_type = COALESCE($6, blood_type),
       allergies = COALESCE($7, allergies),
       medical_notes = COALESCE($8, medical_notes),
       alert_radius_m = COALESCE($9, alert_radius_m)
     WHERE id = $1`,
    [req.user.id, name||null, phone||null, department||null, hostel||null,
     bloodType||null, allergies||null, medicalNotes||null, alertRadiusM||null]
  );

  // Replace emergency contacts if provided
  if (Array.isArray(emergencyContacts)) {
    await db.query('DELETE FROM emergency_contacts WHERE user_id=$1', [req.user.id]);
    for (const ec of emergencyContacts) {
      if (ec.name && ec.phone) {
        await db.query(
          'INSERT INTO emergency_contacts (id,user_id,name,phone) VALUES ($1,$2,$3,$4)',
          [uuidv4(), req.user.id, ec.name, ec.phone]
        );
      }
    }
  }

  res.json({ updated: true });
});

// ── PUT /users/location ──────────────────────────────────────────────────────
// Called periodically from the client so the server knows where everyone is.
router.put(
  '/location',
  requireAuth,
  validate([body('lat').isFloat(), body('lng').isFloat()]),
  async (req, res) => {
    const { lat, lng } = req.body;
    await db.query(
      'UPDATE users SET lat=$2, lng=$3, location_updated_at=NOW() WHERE id=$1',
      [req.user.id, lat, lng]
    );
    // Also update the user's socket room — useful for real-time targeting
    const io = req.app.get('io');
    if (io) {
      io.to(req.user.id).emit('location:ack', { lat, lng });
    }
    res.json({ updated: true });
  }
);

// ── PUT /users/push-token ────────────────────────────────────────────────────
router.put('/push-token', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  await db.query('UPDATE users SET push_token=$2 WHERE id=$1', [req.user.id, token]);
  res.json({ updated: true });
});

// ── GET /users/nearby ────────────────────────────────────────────────────────
// Returns count (and basic info) of active users near a coordinate.
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

    const params = [];
    const distSQL = haversineSQL('u.lat', 'u.lng', lat, lng, params);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM users u
       WHERE u.lat IS NOT NULL
         AND ${distSQL} <= $${params.length + 1}
         AND u.location_updated_at > NOW() - INTERVAL '10 minutes'`,
      [...params, radius]
    );
    res.json({ count: rows[0].count, radius });
  }
);

module.exports = router;
