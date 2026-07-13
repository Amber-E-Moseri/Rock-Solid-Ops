import { supabase } from '../../../supabase.js';

// All writes mirror foundation/js/applicant-directory.js exactly:
// same tables, same patches, same audit_logs action names and details.

export async function markApplicantStatus({ app, status, actorEmail }) {
  const now = new Date().toISOString();
  const patch = { registration_status: status, status, updated_at: now };
  if (status === 'WAITLISTED') patch.retry_assignment = true;
  if (status === 'DUPLICATE' || status === 'REVIEW') patch.needs_admin_review = true;

  const { error } = await supabase.from('applicants').update(patch).eq('id', app.id);
  if (error) throw error;

  await supabase.from('audit_logs').insert({
    action: 'APPLICANT_STATUS_SET',
    entity_type: 'applicant',
    entity_id: app.id,
    actor_email: actorEmail || null,
    status: 'SUCCESS',
    details: { previous_status: app.registration_status || app.status || null, new_status: status, source: 'applicants-review-mode' },
    created_at: now,
  });
  return patch;
}

export async function resolveDuplicateGroup({ applicants, email, keepId, resolutionNote, actorEmail }) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const group = applicants.filter((a) => String(a.email || '').toLowerCase().trim() === normalizedEmail);
  if (group.length < 2) return null;
  const keep = group.find((a) => String(a.id) === String(keepId));
  if (!keep) return null;

  const now = new Date().toISOString();
  const others = group.filter((a) => String(a.id) !== String(keepId));

  const { error: keepErr } = await supabase
    .from('applicants')
    .update({
      registration_status: keep.class_option_id ? 'ASSIGNED' : 'PENDING',
      needs_admin_review: false,
      reviewed_at: now,
      updated_at: now,
      updated_by: actorEmail || null,
    })
    .eq('id', keep.id);
  if (keepErr) throw keepErr;

  if (others.length) {
    const { error: dupErr } = await supabase
      .from('applicants')
      .update({
        registration_status: 'DUPLICATE',
        duplicate_status: 'RESOLVED',
        needs_admin_review: true,
        reviewed_at: now,
        updated_at: now,
        updated_by: actorEmail || null,
      })
      .in('id', others.map((rec) => rec.id));
    if (dupErr) throw dupErr;
  }

  await supabase.from('audit_logs').insert({
    action: 'DUPLICATE_GROUP_RESOLVED',
    entity_type: 'applicant',
    entity_id: String(keep.id),
    actor_email: actorEmail || null,
    status: 'SUCCESS',
    details: {
      email: normalizedEmail,
      kept_applicant_id: keep.id,
      duplicate_applicant_ids: others.map((row) => row.id),
      resolution_note: resolutionNote || null,
    },
    created_at: now,
  });

  return { keepId: keep.id, otherIds: others.map((r) => r.id) };
}

export async function correctClass({ app, newClassId, reason, cls, actorEmail }) {
  const now = new Date().toISOString();
  const patch = { class_option_id: newClassId, registration_status: 'ASSIGNED', assigned_at: now, updated_at: now };
  if (cls?.batch_id) patch.batch_id = cls.batch_id;

  const { error } = await supabase.from('applicants').update(patch).eq('id', app.id);
  if (error) throw error;

  await supabase.from('email_queue').insert({
    recipient_email: app.email,
    recipient_name: app.full_name || '',
    template_key: 'class_reassignment_notice',
    subject: 'Your Rock Solid class has been updated',
    status: 'Pending',
    payload: {
      first_name: String(app.full_name || 'Student').split(/\s+/)[0],
      old_class: app.class_option_id || 'Unassigned',
      new_class: newClassId,
      new_teacher: cls?.teacher_name || '',
      new_day: cls?.day || '',
      new_time: cls?.class_time || '',
      reason,
    },
  });

  await supabase.from('moodle_enrollment_sync')
    .update({ class_option_id: newClassId, sync_status: 'PENDING', updated_at: now })
    .eq('applicant_id', app.id);

  await supabase.from('audit_logs').insert({
    action: 'CLASS_CORRECTION',
    entity_type: 'applicant',
    entity_id: app.id,
    actor_email: actorEmail || null,
    status: 'SUCCESS',
    details: { old_class: app.class_option_id, new_class: newClassId, reason },
    created_at: now,
  });

  return patch;
}

export async function toggleFollowUp({ app, actorEmail }) {
  const next = !app.needs_admin_review;
  const now = new Date().toISOString();
  const { error } = await supabase.from('applicants')
    .update({ needs_admin_review: next, updated_at: now })
    .eq('id', app.id);
  if (error) throw error;

  await supabase.from('audit_logs').insert({
    action: 'NEEDS_FOLLOW_UP_TOGGLED',
    entity_type: 'applicant',
    entity_id: app.id,
    actor_email: actorEmail || null,
    status: 'SUCCESS',
    details: { needs_admin_review: next },
    created_at: now,
  });
  return next;
}

export async function bulkStatusChange({ apps, status, actorEmail, onProgress }) {
  const now = new Date().toISOString();
  const bulkOpId = crypto.randomUUID();
  let done = 0;
  for (const app of apps) {
    const { error } = await supabase.from('applicants')
      .update({ status, registration_status: status, updated_at: now })
      .eq('id', app.id);
    if (!error) {
      await supabase.from('audit_logs').insert({
        action: 'BULK_STATUS_CHANGE',
        entity_type: 'applicant',
        entity_id: app.id,
        actor_email: actorEmail || null,
        status: 'SUCCESS',
        details: { old_status: app.status || app.registration_status, new_status: status, bulk_operation_id: bulkOpId },
        created_at: now,
      });
    }
    done++;
    onProgress?.(done, apps.length);
  }
  return done;
}

export async function bulkClassChange({ apps, classId, cls, actorEmail, onProgress }) {
  const now = new Date().toISOString();
  const bulkOpId = crypto.randomUUID();
  let done = 0;
  for (const app of apps) {
    const patch = { class_option_id: classId, registration_status: 'ASSIGNED', assigned_at: now, updated_at: now };
    if (cls?.batch_id) patch.batch_id = cls.batch_id;
    const { error } = await supabase.from('applicants').update(patch).eq('id', app.id);
    if (!error) {
      await supabase.from('moodle_enrollment_sync')
        .update({ class_option_id: classId, sync_status: 'PENDING', updated_at: now })
        .eq('applicant_id', app.id);
      await supabase.from('audit_logs').insert({
        action: 'BULK_CLASS_REASSIGNMENT',
        entity_type: 'applicant',
        entity_id: app.id,
        actor_email: actorEmail || null,
        status: 'SUCCESS',
        details: { old_class: app.class_option_id, new_class: classId, bulk_operation_id: bulkOpId },
        created_at: now,
      });
    }
    done++;
    onProgress?.(done, apps.length);
  }
  return done;
}

export async function retryFailedNotification({ target, source }) {
  return supabase.functions.invoke('retry-worker', {
    body: { action: 'retry', source, id: String(target.id) },
  });
}
