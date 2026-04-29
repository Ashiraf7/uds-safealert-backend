// src/services/socket.js
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Attach Socket.io handlers to an existing http.Server.
 * Returns the io instance so Express can reference it via app.get('io').
 */
function attachSocket(server) {
  const { Server } = require('socket.io');

  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 30_000,
    pingInterval: 10_000,
  });

  // ── Auth middleware ──────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('No token'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ───────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { id, role } = socket.user;
    logger.debug('Socket connected', { userId: id, socketId: socket.id });

    // Join a personal room (for targeted messages)
    socket.join(id);
    if (role === 'admin') socket.join('admin');

    // Client sends its location on connect and periodically
    socket.on('location:update', ({ lat, lng }) => {
      // Stored in memory on the socket for quick geo-fan-out
      socket.userLat = lat;
      socket.userLng = lng;
    });

    socket.on('disconnect', () => {
      logger.debug('Socket disconnected', { userId: id });
    });
  });

  // ── Helper: send alert to all sockets within radiusM ──────────────────
  io.broadcastNearby = (event, data, lat, lng, radiusM) => {
    const { haversineMetres } = require('../utils/geo');
    const sockets = io.sockets.sockets;
    for (const [, socket] of sockets) {
      if (socket.userLat == null || socket.userLng == null) continue;
      const dist = haversineMetres(lat, lng, socket.userLat, socket.userLng);
      if (dist <= radiusM) socket.emit(event, data);
    }
  };

  return io;
}

module.exports = { attachSocket };
