import axios from 'axios';
import { logError } from '../services/supabase.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

interface PageInfo {
  pageAccessToken: string;
  pageName: string;
}

/**
 * Exchanges a short-lived Facebook User Token for a permanent Page Access Token.
 *
 * Flow:
 *  1. Short-lived user token  →  long-lived user token (60-day)
 *  2. Long-lived user token   →  permanent page access token (never expires)
 *
 * The page token is permanent because it is derived from a long-lived user token.
 * It only expires if the user removes the app or changes their Facebook password.
 */
export async function exchangeForPermanentPageToken(
  shortLivedUserToken: string,
  pageId: string,
): Promise<PageInfo> {
  const appId     = process.env.FACEBOOK_APP_ID!;
  const appSecret = process.env.APP_SECRET!;

  // Step 1 — Short-lived user token → long-lived user token (60 days)
  const { data: longLivedData } = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      grant_type:        'fb_exchange_token',
      client_id:         appId,
      client_secret:     appSecret,
      fb_exchange_token: shortLivedUserToken,
    },
  });

  const longLivedUserToken: string = longLivedData.access_token;

  // Step 2 — Get page tokens for all pages managed by this user
  const { data: accountsData } = await axios.get(`${GRAPH_API}/me/accounts`, {
    params: {
      access_token: longLivedUserToken,
      fields:       'id,name,access_token',
    },
  });

  const page = (accountsData.data as Array<{ id: string; name: string; access_token: string }>)
    ?.find(p => p.id === pageId);

  if (!page) {
    throw new Error(`Page ${pageId} not found in the user's managed pages. Make sure the user is an admin of this page.`);
  }

  return { pageAccessToken: page.access_token, pageName: page.name };
}

/**
 * Subscribes a Facebook Page to this app's webhook so Meta sends
 * message events to /webhook/messenger.
 */
export async function subscribePageToWebhook(
  pageAccessToken: string,
  pageId: string,
): Promise<boolean> {
  try {
    await axios.post(`${GRAPH_API}/${pageId}/subscribed_apps`, null, {
      params: {
        access_token:       pageAccessToken,
        subscribed_fields:  'messages,messaging_postbacks',
      },
    });
    console.log(`[facebook] Page ${pageId} subscribed to webhook`);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logError('facebook', `Failed to subscribe page ${pageId} to webhook: ${msg}`);
    return false;
  }
}
