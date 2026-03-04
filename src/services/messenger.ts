import axios from 'axios';
import { logError } from './supabase.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

// ─── Send a text message to a Messenger user ──────────────────────────────────
export async function sendMessage(
  recipientId: string,
  text: string,
  pageAccessToken: string
): Promise<boolean> {
  try {
    await axios.post(
      `${GRAPH_API}/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'RESPONSE',
      },
      { params: { access_token: pageAccessToken } }
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logError('messenger', `Failed to send message to ${recipientId}: ${msg}`);
    return false;
  }
}

// ─── Show / hide typing indicator ─────────────────────────────────────────────
export async function setTypingIndicator(
  recipientId: string,
  pageAccessToken: string,
  on: boolean
): Promise<void> {
  try {
    await axios.post(
      `${GRAPH_API}/me/messages`,
      {
        recipient: { id: recipientId },
        sender_action: on ? 'typing_on' : 'typing_off',
      },
      { params: { access_token: pageAccessToken } }
    );
  } catch {
    // Non-critical — typing indicators are best-effort
  }
}

// ─── Get user's public profile (first name) ───────────────────────────────────
export async function getUserFirstName(
  userId: string,
  pageAccessToken: string
): Promise<string | null> {
  try {
    const { data } = await axios.get(`${GRAPH_API}/${userId}`, {
      params: {
        fields: 'first_name',
        access_token: pageAccessToken,
      },
    });
    return data.first_name ?? null;
  } catch {
    return null;
  }
}
