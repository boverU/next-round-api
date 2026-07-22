const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./src/config');

const app = express();

// --- Order matters below. Each comment explains why. ---

// 0. Browser calls come cross-origin from the frontend (:8080) carrying a Clerk
//    Bearer token, so CORS must allow that origin and the Authorization header.
//    Server-to-server callers (Clerk webhooks, Prosody) send no Origin and are
//    unaffected. Requests from disallowed origins simply get no CORS headers.
app.use(cors({
  origin(origin, cb) {
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 1. Clerk webhooks need the raw signed bytes, so they must run before
//    express.json() parses (and would discard) the body.
app.use('/webhooks', require('./src/auth/webhooks'));

// 2. Clerk populates req.auth for everything downstream.
if (!config.DEV_AUTH_BYPASS) {
  const { clerkMiddleware } = require('@clerk/express');
  app.use(clerkMiddleware());
} else {
  console.warn('⚠  DEV_AUTH_BYPASS is on — staff auth is disabled. Never do this in production.');
}

app.use(express.json());
// Prosody's mod_reservations posts form-encoded bodies, not JSON.
app.use(express.urlencoded({ extended: false }));

// 3. An invite token in a URL is a bearer secret. Never let it reach a log line.
app.use((req, _res, next) => {
  const safePath = req.path.replace(/nrjoin_[A-Za-z0-9_-]+/g, 'nrjoin_[redacted]');
  console.log(`${req.method} ${safePath}`);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 4. API routes come before any static or fallback handler.
app.use('/api/roles', require('./src/routes/roles'));
app.use('/api/candidates', require('./src/routes/candidates'));
app.use('/api/interviews', require('./src/routes/interviews'));
app.use('/api/interviews', require('./src/routes/invites'));
// Anti-cheat event channel (candidate POSTs, staff read + SSE stream).
app.use('/api/interviews', require('./src/routes/events'));
// Collaborative code editor: sandboxed run proxy to Piston (events-token auth).
app.use('/api/interviews', require('./src/routes/execute'));
app.use('/api/rooms', require('./src/routes/rooms'));
app.use('/api/join', require('./src/routes/join').apiRouter);
// Called by Prosody, not by a browser. Must be reachable from the Jitsi network.
app.use('/api/jitsi', require('./src/routes/jitsi'));

// 5. /api owns its own 404. nextround20/server.js:84 gets this wrong: its
//    `app.get('*')` answers every unmatched path with index.html and a 200,
//    which would turn a typo'd API route into a silent success.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// 6. The public candidate lobby, then static assets.
app.use('/join', require('./src/routes/join').publicRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.PORT, () => {
  console.log(`NextRound API listening on http://localhost:${config.PORT}`);
});
