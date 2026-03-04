import twilio from 'twilio';
import { Resend } from 'resend';
import type { Business, Lead } from '../types/index.js';
import { logError } from './supabase.js';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE   = process.env.TEST_MODE === 'true';
const TEST_PHONE  = process.env.TEST_PHONE ?? '';
const DASHBOARD   = process.env.DASHBOARD_URL ?? 'https://dashboard.usetradebot.app';

// ─── Resolve the recipient phone ──────────────────────────────────────────────
function resolvePhone(business: Business): string {
  if (TEST_MODE) return TEST_PHONE;
  return business.owner_phone ?? '';
}

// ─── SMS via Twilio ────────────────────────────────────────────────────────────
export async function sendSMSNotification(business: Business, lead: Lead): Promise<boolean> {
  const to = resolvePhone(business);
  if (!to) {
    await logError('notifications', `No phone for business ${business.page_id}`);
    return false;
  }

  const scoreEmoji = lead.lead_label === 'HOT' ? '🔥' : lead.lead_label === 'WARM' ? '⚡' : '📋';
  const body = [
    `${scoreEmoji} New ${lead.lead_label} lead — ${business.business_name}`,
    `Customer: ${lead.customer_first_name ?? 'Unknown'}`,
    `Job: ${lead.ai_summary}`,
    `Location: ${lead.location ?? 'Not provided'}`,
    `Phone: ${lead.customer_phone ?? 'Not provided'}`,
    `Timeframe: ${lead.timeframe ?? 'Not stated'}`,
    `View leads: ${DASHBOARD}`,
    TEST_MODE ? '[TEST MODE]' : '',
  ].filter(Boolean).join('\n');

  try {
    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER!,
      to,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logError('notifications', `SMS failed for ${business.page_id}: ${msg}`, { leadId: lead.id });
    return false;
  }
}

// ─── Email via Resend ─────────────────────────────────────────────────────────
export async function sendEmailNotification(business: Business, lead: Lead): Promise<boolean> {
  const to = TEST_MODE ? process.env.OWNER_EMAIL! : (business.owner_email ?? process.env.OWNER_EMAIL!);
  if (!to) return false;

  const scoreColor = lead.lead_label === 'HOT' ? '#dc2626' : lead.lead_label === 'WARM' ? '#d97706' : '#6b7280';

  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: #25D366; padding: 20px; border-radius: 8px 8px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 20px;">New Lead — ${business.business_name}</h1>
    </div>
    <div style="background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb;">
      <div style="margin-bottom: 16px;">
        <span style="background: ${scoreColor}; color: white; padding: 4px 12px; border-radius: 9999px; font-weight: bold; font-size: 14px;">
          ${lead.lead_label} — Score ${lead.lead_score}/3
        </span>
      </div>
      <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
        ${[
          ['Customer', lead.customer_first_name ?? '—'],
          ['Phone', lead.customer_phone ?? 'Not provided'],
          ['Job', lead.ai_summary],
          ['Location', lead.location ?? '—'],
          ['Timeframe', lead.timeframe ?? '—'],
          ['Budget', lead.budget ?? 'Not discussed'],
        ].map(([label, value]) => `
          <tr>
            <td style="padding: 10px 16px; font-weight: bold; color: #6b7280; font-size: 13px; border-bottom: 1px solid #f3f4f6; width: 120px;">${label}</td>
            <td style="padding: 10px 16px; color: #111827; font-size: 14px; border-bottom: 1px solid #f3f4f6;">${value}</td>
          </tr>
        `).join('')}
      </table>
      <div style="margin-top: 20px; background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
        <h3 style="margin: 0 0 12px; font-size: 14px; color: #374151;">Full Conversation</h3>
        ${lead.full_conversation.map(m => `
          <div style="margin-bottom: 8px;">
            <strong style="color: ${m.role === 'user' ? '#25D366' : '#6b7280'}; font-size: 12px;">
              ${m.role === 'user' ? 'Customer' : 'Bot'}:
            </strong>
            <span style="font-size: 13px; color: #374151;"> ${m.content}</span>
          </div>
        `).join('')}
      </div>
      <div style="margin-top: 20px; text-align: center;">
        <a href="${DASHBOARD}" style="background: #25D366; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          View All Leads
        </a>
      </div>
      ${TEST_MODE ? '<p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:12px;">[TEST MODE]</p>' : ''}
    </div>
  </div>`;

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'leads@usetradebot.app',
      to,
      subject: `New ${lead.lead_label} Lead — ${lead.job_type ?? 'Job'} in ${lead.location ?? 'Ireland'}`,
      html,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logError('notifications', `Email failed for ${business.page_id}: ${msg}`, { leadId: lead.id });
    return false;
  }
}

// ─── Send both — SMS primary, email always as backup ─────────────────────────
export async function notifyBusiness(business: Business, lead: Lead): Promise<void> {
  const [smsSent, emailSent] = await Promise.all([
    sendSMSNotification(business, lead),
    sendEmailNotification(business, lead),
  ]);

  if (!smsSent && !emailSent) {
    await logError('notifications', `All notifications failed for ${business.page_id}`, { leadId: lead.id });
  }
}
