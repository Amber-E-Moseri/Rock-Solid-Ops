// Applicant-side calls against the PR #22 contract. Reads go only through the applicant view
// (teacher_applications_applicant), never the base table. Writes go only through the lifecycle
// functions. Nothing here touches teachers, profiles or role columns.

export const APPLICANT_VIEW = 'teacher_applications_applicant';
export const APPLICANT_VIEW_COLUMNS =
  'id,status,version,full_name,phone,fellowship_code,notes,review_message,submitted_at,updated_at';

export async function fetchApplicantRole(client, userId) {
  const { data, error } = await client
    .from('profiles')
    .select('role,full_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function fetchMyApplications(client) {
  const { data, error } = await client
    .from(APPLICANT_VIEW)
    .select(APPLICANT_VIEW_COLUMNS)
    .order('submitted_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  return data ?? [];
}

export async function fetchActiveFellowships(client) {
  const { data, error } = await client
    .from('fellowship_map')
    .select('fellowship_code,campus_name')
    .eq('active', true)
    .order('campus_name');
  if (error) throw error;
  return data ?? [];
}

export async function submitApplication(client, values) {
  const { data, error } = await client.rpc('submit_teacher_application', {
    p_full_name: values.fullName.trim(),
    p_phone: values.phone.trim() || null,
    p_fellowship_code: values.fellowshipCode,
    p_notes: values.notes.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function withdrawApplication(client, application) {
  const { data, error } = await client.rpc('withdraw_teacher_application', {
    p_application_id: application.id,
    p_expected_version: application.version,
  });
  if (error) throw error;
  return data;
}

// The current application is the most recent one. Earlier rows are history and do not drive the UI.
export function currentApplicationView(applications) {
  const current = applications[0] ?? null;
  if (!current || current.status === 'WITHDRAWN') return { current, view: 'apply' };
  const views = {
    SUBMITTED: 'pending',
    INFO_REQUESTED: 'info',
    REJECTED: 'rejected',
    APPROVED: 'approved',
  };
  return { current, view: views[current.status] || 'error' };
}
