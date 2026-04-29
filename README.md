# SafeAlert — Production Backend

Node.js / Express / PostgreSQL / Socket.io backend for the UDS Nyankpala Campus emergency alert system.

---

## Architecture

```
Client (React / Capacitor)
   │  REST  + WebSocket (Socket.io)
   ▼
Express API  :4000
   ├── /api/auth      — register, login, OTP
   ├── /api/alerts    — CRUD, nearby geo, resolve, respond
   ├── /api/users     — profile, location, push token
   └── /api/admin     — stats, user mgmt, broadcast
   │
   ├── Socket.io — real-time events
   │     alert:new · alert:resolved · alert:respond · broadcast
   │
   └── PostgreSQL (pg pool, max 20 conns)
         users · emergency_contacts · alerts
         alert_responders · otp_codes · broadcasts
```

---

## Quick start

### 1. Prerequisites

- Node.js ≥ 18
- PostgreSQL ≥ 14

### 2. Create database

```sql
CREATE USER safealert WITH PASSWORD 'yourpassword';
CREATE DATABASE safealert_db OWNER safealert;
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET at minimum
```

### 4. Install, migrate, seed

```bash
npm install
npm run db:migrate   # creates all tables
npm run db:seed      # adds demo users & alerts
```

### 5. Start

```bash
npm run dev          # development (nodemon)
npm start            # production
```

---

## Frontend changes required

Copy the two updated context files into your React app:

| File in this package | Destination in safealert-v2 |
|---|---|
| `src/context/AuthContext.jsx` | `src/context/AuthContext.jsx` |
| `src/context/AlertContext.jsx` | `src/context/AlertContext.jsx` |

Then add `VITE_API_URL=http://localhost:4000/api` to `safealert-v2/.env.local`.

---

## API reference

### Auth

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | /api/auth/register | name, email, password, … | Returns `{ token, user }` |
| POST | /api/auth/login    | email, password           | Returns `{ token, user }` |
| POST | /api/auth/otp/send   | phone | Sends 6-digit OTP (stub in dev) |
| POST | /api/auth/otp/verify | phone, code | |

### Alerts (all require `Authorization: Bearer <token>`)

| Method | Path | Notes |
|--------|------|-------|
| GET    | /api/alerts              | ?status=active&limit=50 |
| GET    | /api/alerts/nearby       | ?lat=9.4&lng=-0.97&radius=500 |
| GET    | /api/alerts/:id          | |
| POST   | /api/alerts              | type, title, lat, lng, … |
| PATCH  | /api/alerts/:id/resolve  | |
| POST   | /api/alerts/:id/respond  | |

### Users

| Method | Path | Notes |
|--------|------|-------|
| GET | /api/users/me | Full profile + emergency contacts |
| PUT | /api/users/profile | name, phone, department, … |
| PUT | /api/users/location | lat, lng (called periodically) |
| PUT | /api/users/push-token | token |
| GET | /api/users/nearby | ?lat=&lng=&radius= |

### Admin (requires admin role)

| Method | Path |
|--------|------|
| GET    | /api/admin/stats |
| GET    | /api/admin/users |
| GET    | /api/admin/incidents |
| POST   | /api/admin/broadcast |
| DELETE | /api/admin/users/:id |

---

## Socket.io events

Connect with `{ auth: { token } }`.

| Event (server → client) | Payload |
|---|---|
| `alert:new`       | full alert object |
| `alert:resolved`  | updated alert object |
| `alert:respond`   | `{ alertId, responderCount }` |
| `broadcast`       | `{ title, body, sentAt }` |

| Event (client → server) | Payload |
|---|---|
| `location:update` | `{ lat, lng }` |

---

## Deployment checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use a strong random `JWT_SECRET` (32+ chars)
- [ ] Set `CLIENT_ORIGIN` to your exact frontend URL
- [ ] Enable SSL on the database connection (`DATABASE_URL` with `?sslmode=require`)
- [ ] Sit behind nginx with TLS termination
- [ ] Wire up Twilio / Arkesel in `routes/auth.js` OTP section
- [ ] Set up FCM in `routes/alerts.js` `broadcastToNearbyUsers`
- [ ] Point `VITE_API_URL` in the React app to your production URL
