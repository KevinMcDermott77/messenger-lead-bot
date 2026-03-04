import Anthropic from '@anthropic-ai/sdk';
import type { Business, Conversation, ClaudeConversationResponse, ExtractedFields, MessageHistoryItem } from '../types/index.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TURNS = 12; // prevent infinite conversations

// ─── Fallback responses when Claude is unavailable ────────────────────────────
const FALLBACK_RESPONSES = [
  "Thanks for your message! Could you tell me a bit more about what you need done?",
  "Thanks for that. What area are you based in?",
  "And how urgently do you need the work done — is it an emergency, this week, or more of a plan-ahead job?",
  "Great, and what's the best phone number to reach you on for a callback?",
];

function getFallback(turnCount: number): ClaudeConversationResponse {
  const idx = Math.min(turnCount, FALLBACK_RESPONSES.length - 1);
  return { reply: FALLBACK_RESPONSES[idx], isComplete: false, extractedFields: {} };
}

// ─── Build Claude system prompt ───────────────────────────────────────────────
function buildSystemPrompt(business: Business, customerName: string | null): string {
  return `You are a friendly, professional assistant managing enquiries for ${business.business_name}${business.trade_type ? `, a ${business.trade_type} business` : ''} in Ireland/Northern Ireland.

Your job is to collect 4 pieces of information from the customer, in this exact order, one question at a time:

STEP 1 — JOB DETAILS: Ask what work they need done. Get a clear description. If vague, ask one follow-up question to clarify.
STEP 2 — LOCATION: Ask what town or county they're in.
STEP 3 — TIMEFRAME: Ask how urgently they need the work done (emergency / this week / next few weeks / just planning ahead).
STEP 4 — PHONE NUMBER: Ask for the best number to reach them on for a callback. Must be a real phone number (at least 7 digits). If they give something too short or unclear, ask them to confirm the full number.

After collecting all 4 required fields, send the CLOSING MESSAGE as described below.

STRICT RULES:
- Follow steps 1→2→3→4 IN ORDER. Do not skip steps or jump ahead.
- Ask ONE question per message — never combine two questions in one message.
- Even if the customer volunteers info for a later step, still complete the earlier steps first.
- Do NOT send the closing message until you have: job description AND location AND timeframe AND a valid phone number.
- A valid phone number has at least 7 digits. "5154" or similar short strings are NOT valid — ask them to confirm the full number.
- Sound warm and human — not a chatbot. Keep messages short (this is chat, not email).
- If someone describes an emergency (burst pipe, no heat, flood) acknowledge the urgency first.
- Irish/NI context is normal — county names, townlands, "grand" etc.
- Never make up prices, availability or promises.
- If someone is rude or abusive, politely disengage.
${customerName ? `\nThe customer's name is ${customerName}.` : ''}

CLOSING MESSAGE — once you have all 4 required fields (job description, location, timeframe, valid phone), send ONE final message that MUST include BOTH of these things:
1. Mention that they can send photos of the job through this chat if it would help.
2. Tell them their enquiry has been passed on and someone will be in touch shortly.
Example: "Perfect, thanks! Just so you know, you're also welcome to send any photos of the job through this chat — it helps the tradesperson get a better idea of what's needed. I've passed your enquiry on and someone will be in touch with you shortly. All the best!"
Set isComplete: true with this message.

CRITICAL: You MUST respond with ONLY a valid JSON object in this exact format. No markdown, no extra text:
{
  "reply": "your message to send to the customer",
  "isComplete": false,
  "extractedFields": {
    "customerName": "their name or null",
    "jobType": "main job category or null",
    "jobDescription": "detailed description or null",
    "location": "town/county or null",
    "timeframe": "urgency/timeframe or null",
    "budget": "budget range or null",
    "contactPhone": "phone number or null"
  }
}

Set isComplete: true ONLY in the closing message (which must mention photos). Never set isComplete: true before sending the closing message.
Only include fields you've actually extracted — set others to null.`;
}

// ─── Generate greeting for first message ─────────────────────────────────────
export async function generateGreeting(
  business: Business,
  customerName: string | null
): Promise<string> {
  const name = customerName ? ` ${customerName}` : '';
  return `Hi${name} 👋 Thanks for getting in touch with ${business.business_name}! I'm here to help get your enquiry to the right person quickly. What kind of work are you looking to get done?`;
}

// ─── Main conversation reply ──────────────────────────────────────────────────
export async function generateConversationReply(
  conversation: Conversation,
  business: Business,
  newUserMessage: string
): Promise<ClaudeConversationResponse> {
  const turnCount = conversation.message_history.filter(m => m.role === 'user').length;

  // Hard limit on conversation turns
  if (turnCount >= MAX_TURNS) {
    return {
      reply: "Thanks so much for your patience! I'll make sure someone gets back to you very shortly.",
      isComplete: true,
      extractedFields: conversation.state,
    };
  }

  // Build messages array from history + new message
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...conversation.message_history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: newUserMessage },
  ];

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: buildSystemPrompt(business, conversation.state.customerName ?? null),
      messages,
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    console.log('[claude] raw response:', rawText.slice(0, 300));

    // Parse JSON — try direct parse first, then regex extraction
    let parsed: ClaudeConversationResponse;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from response (sometimes Claude adds extra text)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          return getFallback(turnCount);
        }
      } else {
        return getFallback(turnCount);
      }
    }

    // Merge extracted fields with existing state (don't overwrite with null)
    const mergedFields: ExtractedFields = { ...conversation.state };
    for (const [key, val] of Object.entries(parsed.extractedFields ?? {})) {
      if (val !== null && val !== undefined && val !== '') {
        (mergedFields as Record<string, unknown>)[key] = val;
      }
    }

    return {
      reply: parsed.reply ?? getFallback(turnCount).reply,
      isComplete: parsed.isComplete === true,
      extractedFields: mergedFields,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[claude] generateConversationReply error:', msg);
    return getFallback(turnCount);
  }
}

// ─── Build message history entry ─────────────────────────────────────────────
export function buildHistoryEntry(
  role: 'user' | 'assistant',
  content: string
): MessageHistoryItem {
  return { role, content, timestamp: new Date().toISOString() };
}
