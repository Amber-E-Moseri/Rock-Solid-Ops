import { supabase } from '../../../supabase.js';

// Read-only class and roster contract, from the tracked schema:
//   class_options: class_option_id, teacher_id, teacher_name, subgroup_id, day, class_time, active, deleted_at
//   class_roster:  class_option_id, student_id, status ('Active') -> students(full_name)
// Attendance submission state is not read here. Every submission-derived value is null (unknown), never zero.
export async function fetchClasses() {
  const { data: classes, error } = await supabase
    .from('class_options')
    .select('class_option_id, teacher_id, teacher_name, subgroup_id, day, class_time')
    .eq('active', true)
    .is('deleted_at', null)
    .order('day')
    .limit(200);
  if (error) throw error;

  const ids = (classes || []).map(c => c.class_option_id);
  let rosterRows = [];
  if (ids.length) {
    const { data, error: rosterError } = await supabase
      .from('class_roster')
      .select('class_option_id, student_id, status, students(full_name)')
      .in('class_option_id', ids)
      .eq('status', 'Active')
      .limit(2000);
    if (rosterError) throw rosterError;
    rosterRows = data || [];
  }

  const rosterByClass = {};
  rosterRows.forEach(r => {
    if (!rosterByClass[r.class_option_id]) rosterByClass[r.class_option_id] = [];
    rosterByClass[r.class_option_id].push({
      name: (r.students && r.students.full_name) || r.student_id,
      student_id: r.student_id,
      status: null,
    });
  });

  return (classes || []).map(c => {
    let time = '—';
    if (c.class_time) {
      try { time = new Date('1970-01-01T' + c.class_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); } catch (_) {}
    }
    return {
      id: c.class_option_id,
      time: (c.day || '—') + ' · ' + time,
      loc: c.subgroup_id || '—',
      teacher: c.teacher_name || '—',
      session: '—',
      flagSessions: [],
      submitted: null,
      roster: rosterByClass[c.class_option_id] || [],
    };
  });
}

export function counts(c) {
  let p = 0, l = 0, a = 0, m = 0;
  (c.roster || []).forEach(s => {
    if (s.status === 'present') p++;
    else if (s.status === 'late') l++;
    else if (s.status === 'absent') a++;
    else m++;
  });
  return { p, l, a, m, total: (c.roster || []).length };
}

export function classStatus(c) {
  if (c.submitted === null || c.submitted === undefined) return 'unknown';
  if (c.submitted) return 'ok';
  const cc = counts(c);
  return cc.m === cc.total ? 'miss' : 'part';
}

// Submission-derived KPIs are unavailable unless every class reports a submission state, and the on-time
// rate is unavailable unless a roster status has been recorded. Unknown is shown as '—', never as 0.
export function computeKpis(classes) {
  const submissionKnown = classes.length > 0 && classes.every(c => typeof c.submitted === 'boolean');
  const rosterKnown = classes.some(c => (c.roster || []).some(r => r.status));
  const miss = submissionKnown ? classes.filter(c => !c.submitted).length : null;
  const flagged = submissionKnown ? classes.filter(c => c.flagSessions && c.flagSessions.length > 1).length : null;
  const rate = submissionKnown ? Math.round((classes.length - miss) / classes.length * 100) + '%' : '—';
  const totalS = classes.reduce((s, c) => s + (c.roster || []).length, 0);
  const onTimeS = classes.reduce((s, c) => s + (c.roster || []).filter(r => r.status === 'present').length, 0);
  return {
    rate,
    missing: miss ?? '—',
    flagged: flagged ?? '—',
    onTime: rosterKnown && totalS ? Math.round(onTimeS / totalS * 100) + '%' : '—',
  };
}

export function initials(name) {
  return (name || '').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}
