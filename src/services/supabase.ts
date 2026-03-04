import { createClient } from '@supabase/supabase-js';
import type { Business, Conversation, ExtractedFields, Lead, MessageHistoryItem } from '../types/index.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ─── Businesses ───────────────────────────────────────────────────────────────

export async function getBusinessByPageId(pageId: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('page_id', pageId)
    .eq('active', true)
    .single();

  if (error || !data) return null;
  return data as Business;
}

export async function createBusiness(business: Omit<Business, 'id' | 'created_at'>): Promise<Business> {
  const { data, error } = await supabase
    .from('businesses')
    .insert(business)
    .select()
    .single();

  if (error) throw new Error(`Failed to create business: ${error.message}`);
  return data as Business;
}

export async function getAllBusinesses(): Promise<Business[]> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('active', true);

  if (error) throw new Error(`Failed to fetch businesses: ${error.message}`);
  return (data ?? []) as Business[];
}

// ─── Conversations ────────────────────────────────────────────────────────────

const CONVERSATION_TIMEOUT_HOURS = 24;

export async function getRecentlyCompletedConversation(
  messengerUserId: string,
  pageId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('messenger_user_id', messengerUserId)
    .eq('page_id', pageId)
    .eq('status', 'COMPLETE')
    .gte('last_message_at', cutoff)
    .single();
  return !!data;
}

export async function getActiveConversation(
  messengerUserId: string,
  pageId: string
): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('messenger_user_id', messengerUserId)
    .eq('page_id', pageId)
    .eq('status', 'ACTIVE')
    .single();

  if (error || !data) return null;

  // If inactive for 24+ hours, abandon it
  const lastMsg = new Date(data.last_message_at).getTime();
  const hoursElapsed = (Date.now() - lastMsg) / (1000 * 60 * 60);

  if (hoursElapsed >= CONVERSATION_TIMEOUT_HOURS) {
    await supabase
      .from('conversations')
      .update({ status: 'ABANDONED' })
      .eq('id', data.id);
    return null;
  }

  return data as Conversation;
}

export async function createConversation(
  messengerUserId: string,
  pageId: string
): Promise<Conversation> {
  // Upsert — if a row exists (abandoned/complete), replace it
  const { data, error } = await supabase
    .from('conversations')
    .upsert(
      {
        messenger_user_id: messengerUserId,
        page_id: pageId,
        state: {},
        message_history: [],
        status: 'ACTIVE',
        started_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      },
      { onConflict: 'messenger_user_id,page_id' }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return data as Conversation;
}

export async function updateConversation(
  conversationId: string,
  updates: {
    state?: ExtractedFields;
    message_history?: MessageHistoryItem[];
    status?: Conversation['status'];
  }
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ ...updates, last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (error) throw new Error(`Failed to update conversation: ${error.message}`);
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function createLead(lead: Omit<Lead, 'id' | 'created_at'>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert(lead)
    .select()
    .single();

  if (error) throw new Error(`Failed to create lead: ${error.message}`);
  return data as Lead;
}

export async function getLeadsByPageId(pageId: string): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('page_id', pageId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch leads: ${error.message}`);
  return (data ?? []) as Lead[];
}

export async function updateLeadStatus(leadId: string, status: Lead['status'], notes?: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ status, ...(notes ? { notes } : {}) })
    .eq('id', leadId);

  if (error) throw new Error(`Failed to update lead: ${error.message}`);
}

// ─── Error logging ────────────────────────────────────────────────────────────

export async function logError(
  service: string,
  errorMessage: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('errors').insert({ service, error_message: errorMessage, context });
  } catch {
    // If Supabase itself is down, just console.error — don't infinite loop
    console.error(`[${service}] ${errorMessage}`, context);
  }
}
