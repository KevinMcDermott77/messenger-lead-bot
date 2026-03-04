import { Router, Request, Response } from 'express';
import {
  createBusiness,
  getAllBusinesses,
  getLeadsByPageId,
  updateLeadStatus,
  getBusinessByPageId,
} from '../services/supabase.js';
import {
  exchangeForPermanentPageToken,
  subscribePageToWebhook,
} from '../utils/facebookTokenExchange.js';
import type { Business } from '../types/index.js';

const router = Router();

// ─── GET /health ──────────────────────────────────────────────────────────────
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'messenger-lead-bot' });
});

// ─── GET /api/leads/:pageId — Get all leads for a business ───────────────────
router.get('/leads/:pageId', async (req: Request, res: Response) => {
  try {
    const leads = await getLeadsByPageId(req.params['pageId'] as string);
    res.json({ success: true, count: leads.length, leads });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── PATCH /api/leads/:leadId/status — Update lead status ───────────────────
router.patch('/leads/:leadId/status', async (req: Request, res: Response) => {
  const { status, notes } = req.body as { status: string; notes?: string };
  const validStatuses = ['NEW', 'CONTACTED', 'CONVERTED', 'LOST'];

  if (!validStatuses.includes(status)) {
    res.status(400).json({ success: false, error: `Status must be one of: ${validStatuses.join(', ')}` });
    return;
  }

  try {
    await updateLeadStatus(req.params['leadId'] as string, status as 'NEW' | 'CONTACTED' | 'CONVERTED' | 'LOST', notes);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/businesses/connect — Exchange token + register + subscribe ─────
// Accepts a short-lived Facebook User Token, exchanges it for a permanent
// Page Access Token, subscribes the page to the webhook, and saves the business.
router.post('/businesses/connect', async (req: Request, res: Response) => {
  const { short_lived_token, page_id, business_name, owner_phone, owner_email, trade_type } =
    req.body as {
      short_lived_token: string;
      page_id:           string;
      business_name?:    string;
      owner_phone?:      string;
      owner_email?:      string;
      trade_type?:       string;
    };

  if (!short_lived_token || !page_id) {
    res.status(400).json({ success: false, error: 'short_lived_token and page_id are required' });
    return;
  }

  if (!process.env.FACEBOOK_APP_ID) {
    res.status(500).json({ success: false, error: 'FACEBOOK_APP_ID env var not set' });
    return;
  }

  try {
    // 1. Exchange for permanent page access token
    const { pageAccessToken, pageName } = await exchangeForPermanentPageToken(short_lived_token, page_id);

    // 2. Subscribe page to webhook
    await subscribePageToWebhook(pageAccessToken, page_id);

    // 3. Save to Supabase (upsert via createBusiness)
    const business = await createBusiness({
      business_name:      business_name ?? pageName,
      page_id,
      page_access_token:  pageAccessToken,
      owner_phone:        owner_phone  ?? null,
      owner_email:        owner_email  ?? null,
      trade_type:         trade_type   ?? null,
      active: true,
    });

    const { page_access_token: _hidden, ...safeBusiness } = business;
    res.status(201).json({ success: true, business: safeBusiness });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── POST /api/businesses — Register a new client ────────────────────────────
router.post('/businesses', async (req: Request, res: Response) => {
  const { business_name, page_id, page_access_token, owner_phone, owner_email, trade_type } = req.body as Partial<Business>;

  if (!business_name || !page_id || !page_access_token) {
    res.status(400).json({ success: false, error: 'business_name, page_id, and page_access_token are required' });
    return;
  }

  try {
    const business = await createBusiness({
      business_name,
      page_id,
      page_access_token,
      owner_phone:  owner_phone  ?? null,
      owner_email:  owner_email  ?? null,
      trade_type:   trade_type   ?? null,
      active: true,
    });
    res.status(201).json({ success: true, business });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/businesses — List all active businesses ────────────────────────
router.get('/businesses', async (_req: Request, res: Response) => {
  try {
    const businesses = await getAllBusinesses();
    // Never expose page access tokens in list view
    const safe = businesses.map(({ page_access_token: _, ...b }) => b);
    res.json({ success: true, count: safe.length, businesses: safe });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/businesses/:pageId — Get single business ───────────────────────
router.get('/businesses/:pageId', async (req: Request, res: Response) => {
  try {
    const business = await getBusinessByPageId(req.params['pageId'] as string);
    if (!business) {
      res.status(404).json({ success: false, error: 'Business not found' });
      return;
    }
    const { page_access_token: _, ...safe } = business;
    res.json({ success: true, business: safe });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
