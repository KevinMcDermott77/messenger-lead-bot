import { Router, Request, Response } from 'express';
import { verifyWebhookSignature } from '../utils/webhookVerification.js';
import {
  getBusinessByPageId,
  getActiveConversation,
  getRecentlyCompletedConversation,
  createConversation,
  updateConversation,
  createLead,
  logError,
} from '../services/supabase.js';
import { sendMessage, setTypingIndicator, getUserFirstName } from '../services/messenger.js';
import {
  generateGreeting,
  generateConversationReply,
  buildHistoryEntry,
} from '../services/claude.js';
import { scoreLead } from '../services/leadScoring.js';
import { notifyBusiness } from '../services/notifications.js';
import type { MessengerWebhookPayload, MessengerEvent } from '../types/index.js';

const router = Router();

// ─── GET /webhook/messenger — Meta verification challenge ─────────────────────
router.get('/messenger', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[webhook] Meta verification successful');
    res.status(200).send(challenge);
  } else {
    console.warn('[webhook] Meta verification failed — wrong verify token');
    res.sendStatus(403);
  }
});

// ─── POST /webhook/messenger — Incoming messages ──────────────────────────────
router.post('/messenger', async (req: Request, res: Response) => {
  // Validate Meta signature
  const signature = req.headers['x-hub-signature-256'] as string;
  const skipSigCheck = process.env.TEST_MODE === 'true';
  if (!skipSigCheck && (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature, process.env.APP_SECRET!))) {
    console.warn('[webhook] Invalid signature — request rejected');
    res.sendStatus(403);
    return;
  }

  // Always respond 200 immediately — Meta retries if we're slow
  res.sendStatus(200);

  const payload = req.body as MessengerWebhookPayload;
  if (payload.object !== 'page') return;

  for (const entry of payload.entry) {
    const pageId = entry.id;

    for (const event of entry.messaging) {
      await processMessengerEvent(pageId, event);
    }
  }
});

// ─── Process a single Messenger event ────────────────────────────────────────
async function processMessengerEvent(pageId: string, event: MessengerEvent): Promise<void> {
  // Only handle text messages sent by users (ignore echoes)
  if (!event.message?.text || event.message?.is_echo) return;

  const senderId   = event.sender.id;
  const userText   = event.message.text.trim();

  try {
    // 1. Look up the business by page ID
    const business = await getBusinessByPageId(pageId);
    if (!business) {
      console.warn(`[webhook] No business found for page_id: ${pageId}`);
      return;
    }

    // 2. Check if conversation was recently completed — ignore repeat messages
    const recentlyCompleted = await getRecentlyCompletedConversation(senderId, pageId);
    if (recentlyCompleted) {
      console.log(`[webhook] Ignoring message — conversation recently completed for ${senderId}`);
      return;
    }

    // Show typing indicator
    await setTypingIndicator(senderId, business.page_access_token, true);

    // 3. Get or create conversation
    let conversation = await getActiveConversation(senderId, pageId);
    const isFirstMessage = !conversation;

    if (!conversation) {
      conversation = await createConversation(senderId, pageId);
    }

    // 3. Handle first message — greet the user
    if (isFirstMessage) {
      const firstName = await getUserFirstName(senderId, business.page_access_token);

      // Save the user's first message to history
      const history = [
        buildHistoryEntry('user', userText),
      ];

      // Get greeting from Claude (or use template)
      const greeting = await generateGreeting(business, firstName);

      // Send greeting
      await setTypingIndicator(senderId, business.page_access_token, false);
      await sendMessage(senderId, greeting, business.page_access_token);

      // Update conversation with greeting in history + first name in state
      await updateConversation(conversation.id, {
        message_history: [
          ...history,
          buildHistoryEntry('assistant', greeting),
        ],
        state: { ...(firstName ? { customerName: firstName } : {}) },
      });
      return;
    }

    // 4. Generate reply via Claude
    const claudeResult = await generateConversationReply(conversation, business, userText);

    // 5. Build updated history
    const updatedHistory = [
      ...conversation.message_history,
      buildHistoryEntry('user', userText),
      buildHistoryEntry('assistant', claudeResult.reply),
    ];

    // 6. Send reply
    await setTypingIndicator(senderId, business.page_access_token, false);
    await sendMessage(senderId, claudeResult.reply, business.page_access_token);

    // 7. Update conversation state
    await updateConversation(conversation.id, {
      state: claudeResult.extractedFields,
      message_history: updatedHistory,
      ...(claudeResult.isComplete ? { status: 'COMPLETE' } : {}),
    });

    // 8. If conversation is complete — score, save lead, notify
    if (claudeResult.isComplete) {
      const fields  = claudeResult.extractedFields;
      const scoring = await scoreLead({ ...conversation, state: fields, message_history: updatedHistory });

      const lead = await createLead({
        page_id:              pageId,
        business_name:        business.business_name,
        messenger_user_id:    senderId,
        customer_first_name:  fields.customerName ?? null,
        customer_phone:       fields.contactPhone ?? null,
        job_type:             fields.jobType ?? null,
        job_description:      fields.jobDescription ?? null,
        location:             fields.location ?? null,
        timeframe:            fields.timeframe ?? null,
        budget:               fields.budget ?? null,
        lead_score:           scoring.score,
        lead_label:           scoring.label,
        ai_summary:           scoring.summary,
        full_conversation:    updatedHistory,
        status:               'NEW',
        notified_at:          new Date().toISOString(),
      });

      await notifyBusiness(business, lead);

      console.log(`[webhook] Lead ${lead.id} saved — ${scoring.label} (${scoring.score}/3) for ${business.business_name}`);
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logError('webhook', `Error processing event from ${senderId}: ${msg}`, { pageId, senderId });
    console.error(`[webhook] Error:`, msg);

    // Best-effort fallback reply so the customer always gets something
    try {
      const business = await getBusinessByPageId(pageId);
      if (business) {
        await sendMessage(
          senderId,
          "Thanks for your message! Someone from our team will be in touch with you shortly.",
          business.page_access_token
        );
      }
    } catch {
      // If this also fails, nothing more we can do
    }
  }
}

export default router;
