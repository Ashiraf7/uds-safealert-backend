// scripts/migrate.js — run once to create all tables
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const schema = `
-- ─────────────────────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";   -- needed for geo queries
-- If PostGIS is unavailable, the nearby queries fall back to haversine SQL below.

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  phone           TEXT,
  password_hash   TEXT NOT NULL,
  student_id      TEXT,
  department      TEXT,
  hostel          TEXT,
  blood_type      TEXT,
  allergies       TEXT,
  medical_notes   TEXT,
  role            TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','staff','admin')),
  -- last known location (updated periodically from the client)
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  location_updated_at TIMESTAMPTZ,
  -- push notification token (Capacitor FCM / APNs)
  push_token      TEXT,
  alert_radius_m  INTEGER NOT NULL DEFAULT 500,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE INDEX IF NOT EXISTS users_location_idx ON users (lat, lng) WHERE lat IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- EMERGENCY CONTACTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  phone   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ec_user_idx ON emergency_contacts (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ALERTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        TEXT NOT NULL CHECK (type IN ('fire','medical','security','accident','sos','flood')),
  title       TEXT NOT NULL,
  description TEXT,
  location_label TEXT,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  radius_m    INTEGER NOT NULL DEFAULT 500,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  reporter_id UUID NOT NULL REFERENCES users(id),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alerts_status_idx  ON alerts (status);
CREATE INDEX IF NOT EXISTS alerts_created_idx ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_location_idx ON alerts (lat, lng);

-- ─────────────────────────────────────────────────────────────────────────────
-- RESPONDERS  (users who tapped "I'm responding")
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_responders (
  alert_id   UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- OTP CODES  (short-lived, cleared after use)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS otp_phone_idx ON otp_codes (phone);

-- ─────────────────────────────────────────────────────────────────────────────
-- BROADCAST MESSAGES  (admin → all users)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcasts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  sender_id  UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATED_AT trigger helper
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_updated_at') THEN
    CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'alerts_updated_at') THEN
    CREATE TRIGGER alerts_updated_at BEFORE UPDATE ON alerts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄  Running migrations…');
    await client.query(schema);
    console.log('✅  Migration complete.');
  } catch (err) {
    // PostGIS may not be installed — retry without it
    if (err.message.includes('postgis') || err.message.includes('extension')) {
      console.warn('⚠️   PostGIS not available — using haversine fallback for geo queries.');
      const fallback = schema.replace(
        "CREATE EXTENSION IF NOT EXISTS \"postgis\";",
        "-- postgis skipped"
      );
      await client.query(fallback);
      console.log('✅  Migration complete (no PostGIS).');
    } else {
      console.error('❌  Migration failed:', err.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
