import { supabase } from '../../../supabase.js';

export async function fetchClasses() {
  const [availRes, logRes] = await Promise.all([
    supabase
      .from('teacher_availability')
      .select('id, subgroup_id, day, time_slot, batch_id, teachers(full_name)')
      .eq('status', 'Active')
      .order('subgroup_id')
      .limit(50),
    supabase
      .from('attendance_log')
      .select('subgroup_id, student_id, present, students(full_name)')
      .limit(500),
  ]);
  if (availRes.error) throw availRes.error;

  const rmap = {};
  (logRes.data || []).forEach(r => {
    const key = r.subgroup_id;
    if (!rmap[key]) rmap[key] = [];
    rmap[key].push({
      name: (r.students && r.students.full_name) || r.student_id,
      student_id: r.student_id,
      status: r.present === true ? 'present' : r.present === false ? 'absent' : null,
    });
  });

  return (availRes.data || []).map(a => {
    let time = '—';
    if (a.time_slot) {
      try { time = new Date('1970-01-01T' + a.time_slot).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); } catch (_) {}
    }
    return {
      id: a.id,
      time: (a.day || 'Sun') + ' · ' + time,
      loc: a.subgroup_id || '—',
      teacher: (a.teachers && a.teachers.full_name) || '—',
      session: a.batch_id || '—',
      flagSessions: [],
      submitted: false,
      roster: rmap[a.subgroup_id] || [],
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
  if (c.submitted) return 'ok';
  const cc = counts(c);
  return cc.m === cc.total ? 'miss' : 'part';
}

export function computeKpis(classes) {
  const miss = classes.filter(c => !c.submitted).length;
  const flagged = classes.filter(c => c.flagSessions && c.flagSessions.length > 1).length;
  const rate = classes.length ? Math.round((classes.length - miss) / classes.length * 100) : 0;
  const totalS = classes.reduce((s, c) => s + (c.roster || []).length, 0);
  const onTimeS = classes.reduce((s, c) => s + (c.roster || []).filter(r => r.status === 'present').length, 0);
  return {
    rate: classes.length ? rate + '%' : '—',
    missing: miss,
    flagged,
    onTime: totalS ? Math.round(onTimeS / totalS * 100) + '%' : '—',
  };
}

export function initials(name) {
  return (name || '').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}
