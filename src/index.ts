import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import webhookRouter from './routes/webhook.js';
import apiRouter from './routes/api.js';

// ─── Validate required env vars on startup ────────────────────────────────────
const REQUIRED_ENV = [
  'APP_SECRET', 'VERIFY_TOKEN', 'ANTHROPIC_API_KEY',
  'SUPABASE_URL', 'SUPABASE_SERVICE_KEY',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT ?? 3000;

// Trust proxy (needed for ngrok + Railway)
app.set('trust proxy', 1);

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: false })); // No CORS needed — webhook calls from Meta

// ─── Rate limiting ────────────────────────────────────────────────────────────
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 200,              // Meta sends bursts during peak; 200/min is safe
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests',
});

// ─── Body parsing — capture rawBody for signature verification ────────────────
app.use(express.json({
  verify: (req: Request, _res: Response, buf: Buffer) => {
    req.rawBody = buf;
  },
}));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/webhook', webhookLimiter, webhookRouter);
app.use('/api',     apiLimiter,     apiRouter);
app.get('/health',  (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🤖 Messenger Lead Bot running on port ${PORT}`);
  console.log(`   Webhook: POST /webhook/messenger`);
  console.log(`   Health:  GET  /health`);
  console.log(`   Mode:    ${process.env.TEST_MODE === 'true' ? '🧪 TEST' : '🟢 PRODUCTION'}`);
  const key = process.env.ANTHROPIC_API_KEY ?? '';
  console.log(`   Claude key: ${key.slice(0, 14)}...${key.slice(-4)} (len=${key.length})\n`);
});

export default app;
