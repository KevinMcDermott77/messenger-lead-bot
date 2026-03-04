import Anthropic from '@anthropic-ai/sdk';
import type { Conversation, LeadScore, MessageHistoryItem } from '../types/index.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function formatConversationForScoring(history: MessageHistoryItem[]): string {
  return history
    .map(m => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${m.content}`)
    .join('\n');
}

export async function scoreLead(conversation: Conversation): Promise<LeadScore> {
  const { state, message_history } = conversation;

  const conversationText = formatConversationForScoring(message_history);
  const fieldsText = JSON.stringify(state, null, 2);

  const prompt = `Based on this conversation and extracted fields, score this lead:

EXTRACTED FIELDS:
${fieldsText}

CONVERSATION:
${conversationText}

Score 1-3:
3 = HOT: urgent job, clear description, has phone number, ready to proceed
2 = WARM: genuine enquiry, some details provided, not urgent or missing contact
1 = COLD: vague, no real job description, no contact details, just browsing

Respond with ONLY valid JSON — no markdown, no extra text:
{
  "score": 2,
  "label": "WARM",
  "summary": "one sentence summary of the job enquiry"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    let parsed: LeadScore;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return fallbackScore(state);
      }
    }

    return {
      score: [1, 2, 3].includes(parsed.score) ? parsed.score : 2,
      label: ['HOT', 'WARM', 'COLD'].includes(parsed.label) ? parsed.label : 'WARM',
      summary: parsed.summary ?? 'Job enquiry received',
    };
  } catch {
    return fallbackScore(state);
  }
}

function fallbackScore(state: Conversation['state']): LeadScore {
  // Simple rule-based fallback if Claude fails
  const hasPhone    = !!state.contactPhone;
  const hasJob      = !!(state.jobType || state.jobDescription);
  const hasLocation = !!state.location;
  const isUrgent    = !!(state.timeframe?.toLowerCase().includes('urgent') ||
                         state.timeframe?.toLowerCase().includes('asap') ||
                         state.timeframe?.toLowerCase().includes('today'));

  if (hasPhone && hasJob && hasLocation && isUrgent) {
    return { score: 3, label: 'HOT', summary: state.jobDescription ?? state.jobType ?? 'Urgent job enquiry' };
  }
  if (hasJob && (hasPhone || hasLocation)) {
    return { score: 2, label: 'WARM', summary: state.jobDescription ?? state.jobType ?? 'Job enquiry' };
  }
  return { score: 1, label: 'COLD', summary: 'Incomplete enquiry' };
}
