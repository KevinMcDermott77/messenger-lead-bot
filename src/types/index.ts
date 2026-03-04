// ─── Business (one row per tradesperson client) ───────────────────────────────
export interface Business {
  id: string;
  business_name: string;
  page_id: string;
  page_access_token: string;
  owner_phone: string | null;
  owner_email: string | null;
  trade_type: string | null;
  active: boolean;
  created_at: string;
}

// ─── Conversation state ───────────────────────────────────────────────────────
export interface ExtractedFields {
  customerName?: string | null;
  jobType?: string | null;
  jobDescription?: string | null;
  location?: string | null;
  timeframe?: string | null;
  budget?: string | null;
  contactPhone?: string | null;
}

export interface MessageHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  messenger_user_id: string;
  page_id: string;
  state: ExtractedFields;
  message_history: MessageHistoryItem[];
  status: 'ACTIVE' | 'COMPLETE' | 'ABANDONED';
  started_at: string;
  last_message_at: string;
}

// ─── Lead ─────────────────────────────────────────────────────────────────────
export interface Lead {
  id?: string;
  created_at?: string;
  page_id: string;
  business_name: string;
  messenger_user_id: string;
  customer_first_name: string | null;
  customer_phone: string | null;
  job_type: string | null;
  job_description: string | null;
  location: string | null;
  timeframe: string | null;
  budget: string | null;
  lead_score: number;
  lead_label: 'HOT' | 'WARM' | 'COLD';
  ai_summary: string;
  full_conversation: MessageHistoryItem[];
  status: 'NEW' | 'CONTACTED' | 'CONVERTED' | 'LOST';
  notified_at?: string | null;
  notes?: string | null;
}

export interface LeadScore {
  score: 1 | 2 | 3;
  label: 'HOT' | 'WARM' | 'COLD';
  summary: string;
}

// ─── Claude response schema ───────────────────────────────────────────────────
export interface ClaudeConversationResponse {
  reply: string;
  isComplete: boolean;
  extractedFields: ExtractedFields;
}

// ─── Meta Messenger webhook payload ──────────────────────────────────────────
export interface MessengerWebhookPayload {
  object: string;
  entry: MessengerEntry[];
}

export interface MessengerEntry {
  id: string;        // page ID
  time: number;
  messaging: MessengerEvent[];
}

export interface MessengerEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text: string;
    is_echo?: boolean;
  };
  postback?: {
    title: string;
    payload: string;
  };
}

// ─── Express request augmentation ────────────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}
