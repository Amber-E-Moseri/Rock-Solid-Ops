import { createServiceClient } from "../_shared/supabase.ts";
import { validateCronAuth } from "../_shared/auth.ts";

// ── Clients ──────────────────────────────────────────────────
const supabase = createServiceClient()

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!
const BATCH_SIZE      = 50

// ── Types ────────────────────────────────────────────────────

interface EmailQueueRow {
  id: string
  template_key: string | null
  recipient_email: string
  recipient_name: string | null
  student_id: string | null
  subject: string | null
  status: string
  payload: Record<string, unknown>
}

interface EmailTemplate {
  template_key: string
  subject: string
  body_html: string | null
  active?: boolean
}

interface RunResult {
  sent: number
  failed: number
  rateLimited: number
  errors: string[]
}

// ── Entry point ──────────────────────────────────────────────
// Invoked on a cron schedule (see config.toml).
// Also accepts manual POST for operational use.

Deno.serve(async (req): Promise<Response> => {
  const authFailure = validateCronAuth(req);
  if (authFailure) return authFailure;

  const result: RunResult = { sent: 0, failed: 0, rateLimited: 0, errors: [] }

  try {
    // Read sender identity from config table.
    const { data: configRows } = await supabase
      .from('config')
      .select('key, value')
      .in('key', ['SENDER_NAME', 'REPLY_TO'])

    const cfg = Object.fromEntries((configRows ?? []).map(r => [r.key, r.value]))
    const senderName = String(cfg['SENDER_NAME'] ?? 'Foundation School Team')
    const replyTo    = String(cfg['REPLY_TO']    ?? '')

    // Step 0: Recover rows stuck in Processing by a crashed previous run.
    // (email_queue.updated_at is maintained by trigger_set_updated_at.)
    const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    await supabase
      .from('email_queue')
      .update({ status: 'Pending' })
      .eq('status', 'Processing')
      .lt('updated_at', staleCutoff)

    // Step 1: Fetch up to BATCH_SIZE pending email ids.
    const { data: pending, error: qErr } = await supabase
      .from('email_queue')
      .select('id')
      .eq('status', 'Pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (qErr) throw qErr
    if (!pending?.length) {
      await logSync('EMAIL_SENDER_RUN', 'No pending emails.', { sent: 0, failed: 0 })
      return json({ ok: true, ...result, message: 'No pending emails' })
    }

    // Step 1b: Atomically claim the batch. Only rows still Pending transition
    // to Processing, so overlapping runs (cron + manual POST) can never pick
    // up the same row and double-send.
    const { data: queue, error: claimErr } = await supabase
      .from('email_queue')
      .update({ status: 'Processing' })
      .in('id', pending.map(r => r.id))
      .eq('status', 'Pending')
      .select('id, template_key, recipient_email, recipient_name, subject, status, payload, trace_id')

    if (claimErr) throw claimErr
    if (!queue?.length) {
      return json({ ok: true, ...result, message: 'Batch already claimed by a concurrent run' })
    }

    // Load all unique templates needed for this batch in one query.
    const templateKeys = [...new Set(
      queue.map(r => r.template_key).filter(Boolean) as string[]
    )]

    const templateMap = new Map<string, EmailTemplate>()
    if (templateKeys.length) {
      // canonical template source:
      // notification_templates only
      const { data: notificationTemplates } = await supabase
        .from('notification_templates')
        .select('template_key, subject, body_html, active')
        .in('template_key', templateKeys)
        .eq('active', true)

      for (const t of notificationTemplates ?? []) {
        templateMap.set(t.template_key, t)
      }
    }

    // Pre-aggregate sent counts for all recipients in a single query.
    const recipientEmails = [...new Set(queue.map(r => r.recipient_email))]
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: sentCounts } = await supabase
      .from('email_queue')
      .select('recipient_email')
      .in('recipient_email', recipientEmails)
      .eq('status', 'Sent')
      .gt('sent_at', twentyFourHoursAgo)

    const sentCountMap = new Map<string, number>()
    for (const row of sentCounts ?? []) {
      sentCountMap.set(row.recipient_email, (sentCountMap.get(row.recipient_email) ?? 0) + 1)
    }

    // Process each row.
    for (const row of queue as EmailQueueRow[]) {
      try {
        const sentInLast24Hours = sentCountMap.get(row.recipient_email) ?? 0

        if (sentInLast24Hours >= 3) {
          await supabase
            .from('email_queue')
            .update({
              status: 'Failed',
              sent_at: null,
              error_message: 'EMAIL_RATE_LIMITED: max 3 sent emails per 24 hours per recipient',
            })
            .eq('id', row.id)

          await logSync('EMAIL_RATE_LIMITED', 'Skipped send due to per-recipient 24h limit', {
            queue_id: row.id,
            recipient_email: row.recipient_email,
            sent_last_24h: sentInLast24Hours ?? 0,
          })

          result.rateLimited++
          continue
        }

        const { subject, bodyHtml } = resolveContent(row, templateMap)

        // Step 5: Send via Resend.
        const sendErr = await sendEmail({
          from:        `${senderName} <${replyTo || 'noreply@example.com'}>`,
          replyTo,
          to:          row.recipient_email,
          subject,
          html:        bodyHtml
        })

        if (sendErr) {
          // Step 7: Mark Failed.
          await supabase
            .from('email_queue')
            .update({ status: 'Failed', error_message: sendErr, sent_at: null })
            .eq('id', row.id)
          result.failed++
          result.errors.push(`${row.id}: ${sendErr}`)
        } else {
          // Step 6: Mark Sent.
          await supabase
            .from('email_queue')
            .update({ status: 'Sent', sent_at: new Date().toISOString(), error_message: null })
            .eq('id', row.id)
          // Count this send toward the 24h cap so a batch with multiple
          // emails to one recipient still respects the limit.
          sentCountMap.set(row.recipient_email, sentInLast24Hours + 1)
          result.sent++
        }
      } catch (rowErr) {
        const msg = rowErr instanceof Error ? rowErr.message : String(rowErr)
        await supabase
          .from('email_queue')
          .update({ status: 'Failed', error_message: msg })
          .eq('id', row.id)
        result.failed++
        result.errors.push(`${row.id}: ${msg}`)
      }
    }

    // Step 8: Log run summary.
    await logSync('EMAIL_SENDER_RUN', `Sent ${result.sent}, failed ${result.failed}`, {
      sent:   result.sent,
      failed: result.failed,
      errors: result.errors.length ? result.errors : undefined
    })

    // Step 9: Return run summary.
    return json({ ok: true, ...result })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await logSync('EMAIL_SENDER_ERROR', message, { error: message })
    } catch { /* ignore log errors */ }
    return json({ ok: false, error: message, ...result })
  }
})

// ── Content resolution ───────────────────────────────────────

function resolveContent(
  row: EmailQueueRow,
  templateMap: Map<string, EmailTemplate>
): { subject: string; bodyHtml: string } {
  // Step 2: Resolve from template.
  const template = row.template_key ? templateMap.get(row.template_key) : undefined
  if (!template) {
    throw new Error(
      `No template found for key: ${row.template_key ?? '(none)'}`
    )
  }

  // Step 3: Substitute {{recipient_name}} and metadata values.
  const subject  = substituteVariables(template.subject, row)
  const bodyHtml = substituteVariables(template.body_html ?? '', row)
  return { subject, bodyHtml }
}

function substituteVariables(template: string, row: EmailQueueRow): string {
  const vars: Record<string, string> = {
    recipient_name: row.recipient_name ?? '',
    recipient_email: row.recipient_email,
    student_id: row.student_id ?? '',
    // Spread metadata fields so {{batch_id}}, {{class_option_id}}, etc. work.
    ...Object.fromEntries(
      Object.entries(row.payload ?? {}).map(([k, v]) => [k, String(v ?? '')])
    )
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

// ── Resend API ───────────────────────────────────────────────
// Returns an error string on failure, null on success.

async function sendEmail(opts: {
  from: string
  replyTo: string
  to: string
  subject: string
  html: string
}): Promise<string | null> {
  if (!RESEND_API_KEY) return 'RESEND_API_KEY is not configured'

  const body: Record<string, unknown> = {
    from:    opts.from,
    to:      [opts.to],
    subject: opts.subject,
    html:    opts.html || '<p>(empty)</p>'
  }
  if (opts.replyTo) body['reply_to'] = opts.replyTo

  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify(body)
    })
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const resBody = await res.json() as { message?: string; name?: string }
      detail = resBody?.message ?? resBody?.name ?? ''
    } catch { /* ignore parse error */ }
    return `Resend ${res.status}: ${detail || res.statusText}`
  }

  return null
}

// ── Helpers ──────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function logSync(
  phase: string,
  message: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      actor_email: 'email-sender@system',
      action:      phase,
      entity_type: 'email_queue',
      entity_id:   'batch',
      status:      'SUCCESS',
      details:     { message, ...(details ?? {}) },
    })
  } catch { /* ignore log errors */ }
}
