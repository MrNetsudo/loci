'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./api/middleware/errorHandler');

// Routes
const authRoutes = require('./api/routes/auth');
const presenceRoutes = require('./api/routes/presence');
const venueRoutes = require('./api/routes/venues');
const roomRoutes = require('./api/routes/rooms');
const messageRoutes = require('./api/routes/messages');
const userRoutes = require('./api/routes/users');

const app = express();

// ── Security ──────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://loci.app', 'https://www.loci.app']
    : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Request parsing ───────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// ── Logging ───────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// ── Global rate limit ─────────────────────────────────────
app.use(rateLimit({
  windowMs: Number(process.env.LOCI_RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.LOCI_RATE_LIMIT_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', retry_after_seconds: 60 },
}));

// ── Health check ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'LOCI', version: process.env.LOCI_API_VERSION || 'v1' });
});

// ── API Routes ────────────────────────────────────────────
const API = `/api/${process.env.LOCI_API_VERSION || 'v1'}`;

app.use(`${API}/auth`,     authRoutes);
app.use(`${API}/presence`, presenceRoutes);
app.use(`${API}/venues`,   venueRoutes);
app.use(`${API}/rooms`,    roomRoutes);
app.use(`${API}/messages`, messageRoutes);
app.use(`${API}/users`,    userRoutes);

// ── Error handlers ────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
