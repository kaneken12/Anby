import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { config } from './config.js';
import { status, restart, logoutAndReset } from './whatsapp.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function startApi() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  const origins = config.frontendOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false, methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => res.send('ok')); // pour UptimeRobot

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

  const auth = (req, res, next) => {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    try { jwt.verify(t, config.jwtSecret); next(); } catch { res.status(401).json({ error: 'unauthorized' }); }
  };

  app.post('/api/login', loginLimiter, (req, res) => {
    const ok = crypto.timingSafeEqual(sha(req.body?.password), sha(config.adminPassword));
    if (!ok) return res.status(401).json({ error: 'bad_password' });
    res.json({ token: jwt.sign({ r: 'admin' }, config.jwtSecret, { expiresIn: '12h' }) });
  });

  app.use('/api', apiLimiter);
  app.get('/api/status', auth, (_req, res) => res.json({ state: status.state, number: status.number, name: status.name }));
  app.get('/api/qr', auth, async (_req, res) => {
    if (!status.qr) return res.status(404).json({ error: 'no_qr' });
    const image = await QRCode.toDataURL(status.qr, { margin: 2, width: 360, errorCorrectionLevel: 'M' });
    res.json({ qr: status.qr, image }); // "qr" (texte brut) pour le site Lovable, "image" (PNG) pour le site statique
  });
  app.post('/api/logout', auth, async (_req, res) => { await logoutAndReset(); res.json({ ok: true }); });
  app.post('/api/restart', auth, async (_req, res) => { await restart(); res.json({ ok: true }); });

  app.use(express.static('public')); // le site de connexion QR est servi par le bot lui-même
  const host = process.env.HOST || '0.0.0.0'; // 0.0.0.0 pour Render ; mets HOST=127.0.0.1 derrière Caddy sur VPS
  app.listen(config.port, host, () => console.log(`[api] ${host}:${config.port}`));
}
