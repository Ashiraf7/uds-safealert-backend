// src/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/pool');
const { validate } = require('../middleware/validate');
const logger = require('../utils/logger');

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── POST /auth/register ──────────────────────────────────────────────────────
router.post(
  '/register',
  validate([
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
  ]),
  async (req, res) => {
    const { name, email, password, phone, studentId, department, hostel,
            bloodType, allergies, medicalNotes,
            emergencyName, emergencyPhone, alertRadius } = req.body;
    try {
      const exists = await db.query('SELECT id FROM users WHERE email=$1', [email]);
      if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });

      const hash = await bcrypt.hash(password, 10);
      const radiusM = parseInt(alertRadius) || 500;
      const { rows } = await db.query(
        `INSERT INTO users
           (id,name,email,password_hash,phone,student_id,department,hostel,
            blood_type,allergies,medical_notes,alert_radius_m,role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'student')
         RETURNING id,name,email,role,student_id,department,hostel,blood_type`,
        [uuidv4(),name,email,hash,phone||null,studentId||null,
         department||null,hostel||null,bloodType||null,
         allergies||null,medicalNotes||null,radiusM]
      );
      const user = rows[0];

      // Emergency contact
      if (emergencyName && emergencyPhone) {
        await db.query(
          'INSERT INTO emergency_contacts (id,user_id,name,phone) VALUES ($1,$2,$3,$4)',
          [uuidv4(), user.id, emergencyName, emergencyPhone]
        );
      }

      logger.info('User registered', { id: user.id, email });
      return res.status(201).json({ token: signToken(user), user });
    } catch (err) {
      logger.error('Register error', { message: err.message });
      return res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// ── POST /auth/login ─────────────────────────────────────────────────────────
router.post(
  '/login',
  validate([
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ]),
  async (req, res) => {
    const { email, password } = req.body;
    try {
      const { rows } = await db.query(
        `SELECT u.*,
                COALESCE(
                  json_agg(json_build_object('name',ec.name,'phone',ec.phone))
                  FILTER (WHERE ec.id IS NOT NULL), '[]'
                ) AS emergency_contacts
         FROM users u
         LEFT JOIN emergency_contacts ec ON ec.user_id = u.id
         WHERE u.email = $1
         GROUP BY u.id`,
        [email]
      );
      if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
      const user = rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      delete user.password_hash;
      logger.info('User logged in', { id: user.id });
      return res.json({ token: signToken(user), user });
    } catch (err) {
      logger.error('Login error', { message: err.message });
      return res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ── POST /auth/otp/send ──────────────────────────────────────────────────────
// Generates a 6-digit OTP. In production wire up Twilio/Arkesel here.
router.post(
  '/otp/send',
  validate([body('phone').isMobilePhone()]),
  async (req, res) => {
    const { phone } = req.body;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await db.query(
      'INSERT INTO otp_codes (id,phone,code,expires_at) VALUES ($1,$2,$3,$4)',
      [uuidv4(), phone, code, expires]
    );
    // TODO: send SMS via Twilio / Arkesel
    logger.info('OTP generated', { phone, code }); // remove code log in production!
    return res.json({ message: 'OTP sent', ...(process.env.NODE_ENV !== 'production' && { code }) });
  }
);

// ── POST /auth/otp/verify ────────────────────────────────────────────────────
router.post(
  '/otp/verify',
  validate([body('phone').isMobilePhone(), body('code').isLength({ min: 6, max: 6 })]),
  async (req, res) => {
    const { phone, code } = req.body;
    const { rows } = await db.query(
      `SELECT * FROM otp_codes
       WHERE phone=$1 AND code=$2 AND used=FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone, code]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' });
    await db.query('UPDATE otp_codes SET used=TRUE WHERE id=$1', [rows[0].id]);
    return res.json({ verified: true });
  }
);

module.exports = router;
