import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';
import { purgeExpired } from './delivery.js';
import { errorHandler } from './http.js';
import { createRealtime } from './realtime/socket.js';
import authRoutes from './routes/auth.js';
import blockRoutes from './routes/blocks.js';
import chillRoutes from './routes/chill.js';
import coinRoutes from './routes/coins.js';
import conversationRoutes from './routes/conversations.js';
import friendRoutes from './routes/friends.js';
import photoRoutes from './routes/photos.js';
import pushRoutes from './routes/push.js';
import syncRoutes from './routes/sync.js';
import roomRoutes from './routes/rooms.js';
import userRoutes from './routes/users.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render sits behind one proxy

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'capacitor://localhost',
  'https://localhost',
  ...(config.clientOrigin ? [config.clientOrigin] : []),
];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The YouTube IFrame player plays Chill Room songs in full.
        scriptSrc: ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
        frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.mzstatic.com', 'https://i.ytimg.com'],
        mediaSrc: ["'self'", 'blob:', 'https://*.apple.com', 'https://*.mzstatic.com'],
        connectSrc: ["'self'", 'https://itunes.apple.com', 'wss:', 'ws:'],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        // Render serves HTTPS; locally `npm start` runs on plain http, where upgrading would break requests.
        upgradeInsecureRequests: config.isProd && !process.env.LOCAL_HTTP ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    // YouTube refuses to play embeds that arrive without a Referer (helmet's default is no-referrer).
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), autoplay=(self "https://www.youtube.com")');
  next();
});
app.use(compression());
app.use(cookieParser());
app.use('/api', express.json({ limit: '100kb' }));

// ---------- API ----------
const api = express.Router();
api.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});
api.get('/rtc-config', requireAuth, (_req, res) => {
  const iceServers: RTCIceServerLike[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  if (config.turn.url) {
    iceServers.push({ urls: config.turn.url.split(','), username: config.turn.username, credential: config.turn.credential });
  }
  res.json({ iceServers });
});
api.use('/auth', authRoutes);
api.use('/users', requireAuth, userRoutes);
api.use('/friends', requireAuth, friendRoutes);
api.use('/blocks', requireAuth, blockRoutes);
api.use('/coins', requireAuth, coinRoutes);
api.use('/conversations', requireAuth, conversationRoutes);
api.use('/rooms', requireAuth, roomRoutes);
api.use('/chill', requireAuth, chillRoutes);
api.use('/photos', requireAuth, photoRoutes);
api.use('/push', requireAuth, pushRoutes);
api.use('/sync', requireAuth, syncRoutes);
api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string };

// ---------- website (built React app) ----------
const webDir = path.resolve(import.meta.dirname, '../../client/dist');
if (fs.existsSync(webDir)) {
  app.use(
    express.static(webDir, {
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (file.endsWith('sw.js') || file.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  // SPA fallback
  app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDir, 'index.html'));
  });
}

app.use(errorHandler);

const server = http.createServer(app);
createRealtime(server, allowedOrigins);

async function main() {
  await migrate();
  // Delivered messages are removed as devices confirm them; this catches anything past 30 days.
  const sweep = () => purgeExpired().catch((e) => console.error('[delivery] sweep failed', e.message));
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
  server.listen(config.port, () => console.log(`[nivotalk] listening on :${config.port}`));
}

main().catch((e) => {
  console.error('[nivotalk] failed to start', e);
  process.exit(1);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close();
    pool.end().finally(() => process.exit(0));
  });
}
