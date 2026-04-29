// src/index.js — SafeAlert backend entry point
require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { attachSocket } = require('./services/socket');

const authRouter   = require('./routes/auth');
const alertsRouter = require('./routes/alerts');
const usersRouter  = require('./routes/users');
const adminRouter  = require('./routes/admin');

const app = express();

// ── Trust Railway/Vercel/Render proxy ─────────────────────────────────────
app.set('trust proxy', 1);

// ── Security & parsing ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '100kb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────
const globalLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down.' },
});
const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts — try again in 15 minutes.' },
});
app.use(globalLimit);
app.use('/api/auth', authLimit);

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',   authRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/users',  usersRouter);
app.use('/api/admin',  adminRouter);

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', uptime: process.uptime(), env: process.env.NODE_ENV })
);

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ──────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ──────────────────────────────────────────────────────────
const server = http.createServer(app);
const io = attachSocket(server);
app.set('io', io);

const PORT = parseInt(process.env.PORT) || 4000;
server.listen(PORT, () => {
  logger.info(`🚨  SafeAlert backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = { app, server }; // for testing
