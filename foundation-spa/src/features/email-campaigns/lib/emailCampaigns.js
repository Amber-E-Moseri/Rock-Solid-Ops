import { supabase } from '../../../supabase.js';

// Sending always goes server-side: browser → email_queue → edge function → Resend.
// The Resend API key is never accessible here. (Mirrors foundation/js/email-campaigns.js)

export const STATUS_LABELS = {
  draft: { label: 'Draft', variant: 'neutral' },
  ready: { label: 'Ready', variant: 'info' },
  sending: { label: 'Sending…', variant: 'warning' },
  sent: { label: 'Sent', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
};

export async function fetchCampaigns() {
  const { data, error } = await supabase
    .from('email_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

export async function fetchFellowships() {
  const { data } = await supabase
    .from('fellowship_map')
    .select('fellowship_code, campus_name')
    .order('fellowship_code');
  return data || [];
}

export async function fetchEmailQueue() {
  const { data, error } = await supabase
    .from('email_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

export function parseIndividuals(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

export async function saveCampaignDraft({ id, data, actorEmail }) {
  if (id) {
    const { error } = await supabase.from('email_campaigns').update({ ...data, updated_by: actorEmail || null }).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('email_campaigns').insert({
      ...data,
      updated_by: actorEmail || null,
      status: 'draft',
      created_by: actorEmail || null,
    });
    if (error) throw error;
  }
}

export async function deleteCampaign(id) {
  const { error } = await supabase.from('email_campaigns').delete().eq('id', id);
  if (error) throw error;
}

export async function countRecipients({ tags, individuals }) {
  let studentCount = 0;
  if (tags.length) {
    const { count, error } = await supabase
      .from('students')
      .select('student_id', { count: 'exact', head: true })
      .in('fellowship_code', tags);
    if (!error) studentCount = count || 0;
  }
  return { studentCount, individualCount: individuals.length, total: studentCount + individuals.length };
}

export async function sendTestEmail({ campaign, adminEmail, adminName }) {
  const { error } = await supabase.from('email_queue').insert({
    recipient_email: adminEmail,
    recipient_name: adminName || 'Admin',
    template_key: 'campaign',
    subject: `[TEST] ${campaign.subject}`,
    status: 'Pending',
    campaign_id: campaign.id,
    payload: {
      campaign_id: campaign.id,
      subject: campaign.subject,
      body_text: campaign.body_text || '',
      body_html: campaign.body_html || '',
      is_test: true,
    },
  });
  if (error) throw error;
}

// Full send flow: atomic lock via campaign_begin_send RPC, recipient collection,
// batched email_queue inserts (50), then campaign_finish_send. Mirrors legacy exactly.
export async function sendCampaign(campaign) {
  const { data: began, error: beginErr } = await supabase.rpc('campaign_begin_send', { p_campaign_id: campaign.id });
  if (beginErr) throw new Error(`Failed to lock campaign: ${beginErr.message}`);
  if (!began) throw new Error('Campaign cannot be sent (already sent or in progress).');

  let recipientEmails = [...(campaign.recipient_emails || [])];

  if ((campaign.recipient_tags || []).length) {
    const { data: students, error: sErr } = await supabase
      .from('students')
      .select('email, full_name, fellowship_code')
      .in('fellowship_code', campaign.recipient_tags);
    if (sErr) {
      await supabase.rpc('campaign_finish_send', { p_campaign_id: campaign.id, p_sent_count: 0, p_success: false });
      throw new Error(`Failed to load recipients: ${sErr.message}`);
    }
    for (const s of students || []) {
      if (s.email && !recipientEmails.includes(s.email.toLowerCase())) {
        recipientEmails.push(s.email.toLowerCase());
      }
    }
  }

  recipientEmails = [...new Set(recipientEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];

  if (!recipientEmails.length) {
    await supabase.rpc('campaign_finish_send', { p_campaign_id: campaign.id, p_sent_count: 0, p_success: false });
    throw new Error('No recipients found for this campaign.');
  }

  const queueRows = recipientEmails.map((email) => ({
    recipient_email: email,
    template_key: 'campaign',
    subject: campaign.subject,
    status: 'Pending',
    campaign_id: campaign.id,
    payload: {
      campaign_id: campaign.id,
      subject: campaign.subject,
      body_text: campaign.body_text || '',
      body_html: campaign.body_html || '',
    },
  }));

  const BATCH = 50;
  let insertFailed = false;
  let failMessage = '';
  for (let i = 0; i < queueRows.length; i += BATCH) {
    const { error: iErr } = await supabase.from('email_queue').insert(queueRows.slice(i, i + BATCH));
    if (iErr) { insertFailed = true; failMessage = iErr.message; break; }
  }

  await supabase.rpc('campaign_finish_send', {
    p_campaign_id: campaign.id,
    p_sent_count: insertFailed ? 0 : recipientEmails.length,
    p_success: !insertFailed,
  });

  if (insertFailed) throw new Error(`Partial failure inserting queue rows: ${failMessage}`);
  return recipientEmails.length;
}
