# Messenger Lead Bot

An AI-powered Facebook Messenger chatbot that automatically qualifies job enquiries for tradespeople. When a customer messages a business's Facebook Page, the bot conducts a structured conversation to capture job details, scores the lead, and notifies the business owner instantly by SMS and email.

**Live product:** [usetradebot.app](https://usetradebot.app) — **One deployment. Multiple clients. New client onboarded in under 20 minutes.**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express 5 |
| AI | Anthropic Claude (`claude-haiku-4-5`) |
| Database | Supabase (PostgreSQL) |
| Messaging | Facebook Messenger (Meta Graph API v21) |
| SMS | Twilio |
| Email | Resend |
| Deployment | Railway |

---

## How It Works

```
Customer messages Facebook Page
         │
         ▼
POST /webhook/messenger
         │
         ├─ HMAC-SHA256 signature check
         ├─ Business lookup by page_id
         ├─ Conversation state loaded from Supabase
         │
         ▼
Claude AI drives the conversation
         │
         ├─ Collects: job description → location → timeframe → phone
         ├─ Returns structured JSON with extracted fields
         └─ Sets isComplete: true on final message
                  │
                  ▼
         Lead scored (HOT / WARM / COLD)
         Lead saved to Supabase
                  │
                  ├─ SMS via Twilio → business owner
                  └─ Email via Resend → business owner
```

---

## What It Does

When someone messages a tradesperson's Facebook Page, this bot:
1. Greets them by name and starts a natural conversation
2. Qualifies the lead (job type, location, timeframe, phone number)
3. Saves it to Supabase with a HOT/WARM/COLD score
4. Sends the tradesperson an SMS and email instantly

---

## Quick Start (Local Development)

### 1. Clone and install

```bash
cd messenger-lead-bot
npm install
cp .env.example .env
```

### 2. Fill in .env

| Variable | Where to get it |
|---|---|
| `APP_SECRET` | Meta Developer Console → Your App → Settings → Basic → App Secret |
| `VERIFY_TOKEN` | Make up any random string (e.g. `openssl rand -hex 16`) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase Dashboard → Settings → API → service_role key |
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account Info |
| `TWILIO_FROM_NUMBER` | A Twilio SMS number (not WhatsApp) |
| `RESEND_API_KEY` | resend.com → API Keys |

Keep `TEST_MODE=true` during development — all SMS goes to `TEST_PHONE`.

### 3. Set up Supabase

Run the SQL in `supabase/schema.sql` in your Supabase SQL Editor.

### 4. Add your first client to Supabase

```sql
insert into businesses (business_name, page_id, page_access_token, owner_phone, owner_email, trade_type)
values ('Mike Murphy Plumbing', 'YOUR_PAGE_ID', 'YOUR_PAGE_ACCESS_TOKEN', '+353871234567', 'mike@example.com', 'Plumber');
```

Or use the API:
```bash
curl -X POST http://localhost:3000/api/businesses \
  -H "Content-Type: application/json" \
  -d '{"business_name":"Mike Murphy Plumbing","page_id":"123","page_access_token":"EAAxx","owner_phone":"+353871234567","trade_type":"Plumber"}'
```

### 5. Start the server

```bash
npm run dev
```

### 6. Expose local port with ngrok

```bash
ngrok http 3000
```

Copy the ngrok URL — e.g. `https://abc123.ngrok.io`

### 7. Configure Meta webhook

1. Go to [Meta Developer Console](https://developers.facebook.com)
2. Your App → Messenger → Settings → Webhooks
3. Add callback URL: `https://abc123.ngrok.io/webhook/messenger`
4. Verify token: whatever you set as `VERIFY_TOKEN` in .env
5. Subscribe to `messages` and `messaging_postbacks`
6. Subscribe your Page to the webhook

### 8. Test

Send a message to the Facebook Page from any account (not the admin account).

You should see:
- Bot replies within 2 seconds
- Conversation progresses naturally
- When complete, lead saved to Supabase `leads` table
- SMS arrives on `TEST_PHONE`
- Email arrives on `OWNER_EMAIL`

---

## Onboarding a New Client (Under 20 Minutes)

**What you need from the client:**
- Their Facebook Page name and URL
- Their phone number for SMS notifications
- Their email

**Steps:**

1. **Client creates a Meta Developer App** (or you do it for them)
   - Go to developers.facebook.com → Create App → Business type
   - Add Messenger product
   - Go to Messenger Settings → Generate Page Access Token for their page
   - Copy the Page Access Token and Page ID

2. **Add to Supabase businesses table**
   ```sql
   insert into businesses (business_name, page_id, page_access_token, owner_phone, owner_email, trade_type)
   values ('Client Business Name', 'PAGE_ID_HERE', 'EAAxx...', '+353...', 'owner@email.com', 'Electrician');
   ```

3. **Configure their Meta App webhook**
   - In their Meta Developer App → Messenger Settings → Webhooks
   - Callback URL: `https://your-railway-app.up.railway.app/webhook/messenger`
   - Verify Token: same `VERIFY_TOKEN` from your .env
   - Subscribe to: `messages`, `messaging_postbacks`
   - Subscribe their Page

4. **Send a test message** to their Facebook Page
   - Confirm bot replies
   - Confirm SMS arrives on owner's phone
   - Confirm lead appears in Supabase

5. **Set TEST_MODE=false** when going live (or handle per-business in DB)

**Total time: 15–20 minutes per client. No new deployment needed.**

---

## API Reference

```
GET  /health                     — Health check
GET  /webhook/messenger          — Meta verification (automatic)
POST /webhook/messenger          — Incoming messages from Meta

GET  /api/businesses             — List all active businesses
POST /api/businesses             — Register a new business (manual)
POST /api/businesses/connect     — Onboard client: exchange token + subscribe webhook + save
GET  /api/businesses/:pageId     — Get single business (token hidden)

GET  /api/leads/:pageId          — Get all leads for a business
PATCH /api/leads/:leadId/status  — Update lead status (NEW/CONTACTED/CONVERTED/LOST)
```

---

## Deploy to Railway

```bash
cd messenger-lead-bot
railway login
railway link
railway up
```

Set all env vars in Railway Dashboard → Variables.

Then update the Meta webhook URL from ngrok to your Railway URL.

---

## Architecture Notes

**Multi-client routing:** Every incoming webhook includes the `recipient.id` (the Facebook Page ID). The bot looks this up in the `businesses` table to get the correct Page Access Token and business details. Zero config changes needed per client.

**Conversation state:** Stored in Supabase `conversations` table. Each conversation is keyed by `messenger_user_id + page_id`. Conversations inactive for 24+ hours are automatically abandoned — if the user messages again, a fresh conversation starts.

**Meta 24-hour window:** The bot only ever responds to messages (never proactively contacts users), so the 24-hour window is always satisfied as long as users are actively messaging.

**Fallbacks:** If Claude fails → scripted response. If SMS fails → email always sent. If both fail → error logged to Supabase.

**Lead scoring:**
- 🔥 **HOT (3)** — Urgent, clear job, has phone number, ready to go
- ⚡ **WARM (2)** — Genuine enquiry, some details, not urgent
- 📋 **COLD (1)** — Vague, no contact details, just browsing

---

## File Structure

```
messenger-lead-bot/
├── src/
│   ├── index.ts                    — Express app + startup
│   ├── routes/
│   │   ├── webhook.ts              — Meta webhook handler (core logic)
│   │   └── api.ts                  — CRUD API endpoints
│   ├── services/
│   │   ├── claude.ts               — AI conversation engine
│   │   ├── leadScoring.ts          — HOT/WARM/COLD scoring
│   │   ├── messenger.ts            — Facebook Graph API calls
│   │   ├── notifications.ts        — Twilio SMS + Resend email
│   │   └── supabase.ts             — Database operations
│   ├── types/
│   │   └── index.ts                — TypeScript interfaces
│   └── utils/
│       ├── webhookVerification.ts  — Meta signature validation
│       └── phoneValidator.ts       — IE/UK phone normalisation
├── supabase/
│   └── schema.sql                  — Run this in Supabase SQL Editor
├── .env.example
├── .gitignore
├── docker-compose.yml
├── railway.json
├── package.json
├── tsconfig.json
└── README.md
```
