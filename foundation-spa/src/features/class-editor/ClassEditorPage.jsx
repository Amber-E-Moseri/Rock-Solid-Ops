import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Plus } from 'lucide-react';
import {
  PageHeader, Button, Badge, Input, Select, Skeleton, EmptyState, Modal,
} from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  DAYS, fetchClassEditorData, fmtTime, toDatetimeLocal, enforceCodesForOnlineMode,
  generateSharedClassId, saveClassEdit, countEnrolled, createClass, splitSharedClass,
  duplicateClass, softDeleteClass, massSetActive, massSetExpiry,
} from './lib/classEditor.js';

export default function ClassEditorPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const role = String(profile?.role || '').toLowerCase();
  const canEdit = ['admin', 'superadmin', 'regional_secretary'].includes(role);
  const canSuperadmin = role === 'superadmin';

  const [groupFilter, setGroupFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [massOpen, setMassOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [massExpiry, setMassExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { message, onYes }

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['class-editor'],
    queryFn: fetchClassEditorData,
    staleTime: 1000 * 60,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return data.classes.filter((c) => {
      if (activeOnly && (c.deleted_at || c.active === false)) return false;
      if (groupFilter && c.group_id !== groupFilter) return false;
      return true;
    });
  }, [data, activeOnly, groupFilter]);

  const groups = useMemo(() => (data ? [...new Set(data.classes.map((c) => c.group_id).filter(Boolean))] : []), [data]);

  useEffect(() => {
    if (rows.length && (!openId || !rows.some((r) => r.class_option_id === openId))) {
      setOpenId(rows[0].class_option_id);
    }
  }, [rows, openId]);

  const selected = rows.find((r) => r.class_option_id === openId) || null;

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ['class-editor'] }), [queryClient]);

  const run = useCallback(async (fn, successMsg) => {
    setBusy(true);
    try {
      const result = await fn();
      toast(typeof successMsg === 'function' ? successMsg(result) : successMsg, 'success');
      await invalidate();
      return true;
    } catch (err) {
      toast(`${err?.message || err}`, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast, invalidate]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Class Editor" subtitle="Loading classes…" />
        <Skeleton variant="row" count={8} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Class Editor"
        subtitle="Build and edit classes, times, teachers and seats."
        actions={
          <>
            {canEdit && <Button variant="primary" onClick={() => setNewOpen((v) => !v)}><Plus size={14} /> New Class</Button>}
            {canEdit && <Button variant="secondary" onClick={() => { setMassOpen((v) => !v); setSelectedIds(new Set()); }}>{massOpen ? 'Done' : 'Mass Manage'}</Button>}
            <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={14} className={isFetching ? 'spin' : ''} /> Refresh
            </Button>
          </>
        }
      />

      {/* Filters + mass bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <Select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="">All Groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
        </label>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{rows.length} {rows.length === 1 ? 'class' : 'classes'}</span>
        {massOpen && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{selectedIds.size} selected</span>
            <Button size="sm" variant="secondary" disabled={busy || !selectedIds.size}
              onClick={() => run(() => massSetActive([...selectedIds], true), `${selectedIds.size} class(es) activated.`).then((ok) => ok && setSelectedIds(new Set()))}>
              Activate
            </Button>
            <Button size="sm" variant="secondary" disabled={busy || !selectedIds.size}
              onClick={() => run(() => massSetActive([...selectedIds], false), `${selectedIds.size} class(es) deactivated.`).then((ok) => ok && setSelectedIds(new Set()))}>
              Deactivate
            </Button>
            <Input type="datetime-local" value={massExpiry} onChange={(e) => setMassExpiry(e.target.value)} style={{ width: 'auto' }} />
            <Button size="sm" variant="secondary" disabled={busy || !selectedIds.size}
              onClick={() => run(() => massSetExpiry([...selectedIds], massExpiry), `Expiry set for ${selectedIds.size} class(es).`).then((ok) => { if (ok) { setSelectedIds(new Set()); setMassExpiry(''); } })}>
              Apply Expiry
            </Button>
          </div>
        )}
      </div>

      {newOpen && canEdit && (
        <NewClassPanel
          data={data}
          actorEmail={profile?.email}
          busy={busy}
          onCancel={() => setNewOpen(false)}
          onCreate={async (form, teacher) => {
            const ok = await run(
              () => createClass({ form, teacher, actorEmail: profile?.email }),
              (r) => (r.mode === 'separate' ? `${r.created} separate classes created` : 'Class created!'),
            );
            if (ok) setNewOpen(false);
          }}
        />
      )}

      {!rows.length ? (
        <EmptyState icon="🏫" title="No classes" message="No class options found for the current filters." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 14, alignItems: 'start' }}>
          {/* Class list */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', overflow: 'hidden', maxHeight: '75vh', overflowY: 'auto' }}>
            {rows.map((co) => {
              const enrolledCount = data.enrolled[co.class_option_id] || 0;
              const capacity = co.max_capacity ?? 25;
              const inactive = co.active === false || co.deleted_at;
              const warn = co.enrollment_open === false;
              const active = openId === co.class_option_id;
              return (
                <div
                  key={co.class_option_id}
                  onClick={() => setOpenId(co.class_option_id)}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)', opacity: inactive ? 0.55 : 1,
                    background: active ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'transparent',
                    borderLeft: `3px solid ${active ? 'var(--primary)' : 'transparent'}`,
                  }}
                >
                  {massOpen ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(co.class_option_id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(co.class_option_id)) next.delete(co.class_option_id); else next.add(co.class_option_id);
                        return next;
                      })}
                    />
                  ) : (
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: warn ? 'var(--warning, #c07400)' : inactive ? 'var(--muted)' : 'var(--success, #22C55E)', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{co.class_option_id}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {co.day || '—'} · {fmtTime(co.class_time)} · {co.teacher_name || 'No teacher'}
                      {warn ? ' · Reg closed' : inactive ? ' · Inactive' : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>{enrolledCount}/{capacity}</span>
                </div>
              );
            })}
          </div>

          {/* Detail editor */}
          {selected ? (
            <DetailEditor
              key={selected.class_option_id}
              co={selected}
              data={data}
              canEdit={canEdit}
              canSuperadmin={canSuperadmin}
              busy={busy}
              onSave={async (payload) => {
                const enrolledCount = await countEnrolled(selected.class_option_id);
                const doSave = (sendNotice) => run(
                  () => saveClassEdit({ ...payload, enrolledCount, actorEmail: profile?.email, sendTimeChangeNotice: sendNotice }),
                  'Saved.',
                );
                const timeChanged = payload.updates.day !== payload.oldDay || payload.updates.class_time !== payload.oldTime;
                if (timeChanged && enrolledCount > 0) {
                  setConfirm({
                    message: `${enrolledCount} student(s) are enrolled in this class. Send them a class time change notification?`,
                    onYes: () => doSave(true),
                    onNo: () => doSave(false),
                  });
                } else {
                  await doSave(false);
                }
              }}
              onDuplicate={() => run(
                () => duplicateClass({ source: selected, actorEmail: profile?.email }),
                (newId) => `Duplicated as ${newId}.`,
              )}
              onSplit={() => setConfirm({
                message: 'This will create separate class IDs per fellowship. Enrolled students will need to be manually reassigned.',
                onYes: () => run(() => splitSharedClass({ source: selected, actorEmail: profile?.email }), (n) => `${n} separate classes created`),
              })}
              onDelete={async () => {
                const count = await countEnrolled(selected.class_option_id);
                setConfirm({
                  message: count > 0 ? `${count} student(s) are enrolled in this class. Soft-delete anyway?` : `Soft-delete class ${selected.class_option_id}?`,
                  onYes: () => run(() => softDeleteClass(selected.class_option_id), `Class ${selected.class_option_id} deleted.`),
                });
              }}
            />
          ) : (
            <EmptyState icon="👈" title="Select a class" message="Pick a class from the list to edit it." />
          )}
        </div>
      )}

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title="Confirm"
          footer={
            <>
              <Button variant="secondary" onClick={() => { const c = confirm; setConfirm(null); c.onNo?.(); }}>{confirm.onNo ? 'No' : 'Cancel'}</Button>
              <Button variant="primary" onClick={() => { const c = confirm; setConfirm(null); c.onYes(); }}>Yes</Button>
            </>
          }
        >
          <p style={{ fontSize: 14 }}>{confirm.message}</p>
        </Modal>
      )}
    </div>
  );
}

function FcChips({ fellowships, codes, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {codes.map((fc) => (
        <button key={fc} onClick={() => onChange(codes.filter((c) => c !== fc))}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '3px 10px', background: 'var(--soft-purple)', color: 'var(--primary)', fontSize: 12, fontWeight: 700, border: 0, cursor: 'pointer' }}>
          {fc} ×
        </button>
      ))}
      <select
        value=""
        onChange={(e) => { if (e.target.value) onChange([...codes, e.target.value]); }}
        style={{ border: '1px dashed var(--border)', background: 'none', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--muted)' }}
      >
        <option value="">+ Add</option>
        {fellowships.filter((f) => !codes.includes(f.fellowship_code)).map((f) => (
          <option key={f.fellowship_code} value={f.fellowship_code}>{f.fellowship_code} – {f.campus_name || ''}</option>
        ))}
      </select>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      {children}
    </div>
  );
}

function DetailEditor({ co, data, canEdit, canSuperadmin, busy, onSave, onDuplicate, onSplit, onDelete }) {
  const [day, setDay] = useState(co.day || '');
  const [time, setTime] = useState(co.class_time || '');
  const [teacherId, setTeacherId] = useState(() => data.teachers.find((t) => t.full_name === co.teacher_name)?.teacher_id || '');
  const [capacity, setCapacity] = useState(co.max_capacity ?? '');
  const [batchId, setBatchId] = useState(data.slotBatches[co.class_option_id]?.[0] || '');
  const [suffix, setSuffix] = useState(co.label_suffix || '');
  const [expiry, setExpiry] = useState(toDatetimeLocal(co.enrollment_closes_at));
  const [isActive, setIsActive] = useState(co.active !== false);
  const [enrollOpen, setEnrollOpen] = useState(co.enrollment_open !== false);
  const [isOnline, setIsOnline] = useState(co.is_online === true);
  const [fcCodes, setFcCodes] = useState(() => [...(co.fellowship_codes || [])]);

  const enrolledCount = data.enrolled[co.class_option_id] || 0;
  const cap = Math.max(Number(co.max_capacity || 0), enrolledCount, 1);
  const fill = Math.min(100, Math.round((enrolledCount / cap) * 100));
  const teacher = data.teachers.find((t) => t.teacher_id === teacherId);

  const handleSave = () => {
    const fc = enforceCodesForOnlineMode(fcCodes, isOnline);
    onSave({
      coId: co.class_option_id,
      oldDay: co.day || '',
      oldTime: co.class_time || '',
      teacher,
      nextBatch: batchId || null,
      currentBatches: data.slotBatches[co.class_option_id] || [],
      updates: {
        teacher_name: teacher?.full_name || null,
        teacher_id: teacher?.teacher_id || null,
        day, class_time: time,
        max_capacity: capacity ? parseInt(capacity, 10) : null,
        label_suffix: suffix || null,
        enrollment_closes_at: expiry ? new Date(expiry).toISOString() : null,
        active: isActive, enrollment_open: enrollOpen, is_online: isOnline,
        fellowship_codes: fc,
      },
    });
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{co.class_option_id}</h2>
          <Badge variant={co.active === false ? 'neutral' : 'success'}>{co.active === false ? 'INACTIVE' : 'ACTIVE'}</Badge>
          <Badge variant={co.enrollment_open === false ? 'danger' : 'info'}>{co.enrollment_open === false ? 'REG CLOSED' : 'REG OPEN'}</Badge>
        </div>
        {canEdit && <Button size="sm" variant="secondary" disabled={busy} onClick={onDuplicate}>Duplicate</Button>}
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Field label="Day">
            <Select value={day} onChange={(e) => setDay(e.target.value)}>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</Select>
          </Field>
          <Field label="Time"><Input type="time" step={1800} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Teacher">
            <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              <option value="">Select teacher</option>
              {data.teachers.map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.full_name} ({t.email || ''})</option>)}
            </Select>
          </Field>
          <Field label="Capacity"><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="25" /></Field>
          <Field label="Batch">
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">No batch</option>
              {data.batches.map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_name || b.batch_id}</option>)}
            </Select>
          </Field>
          <Field label="Label Suffix"><Input value={suffix} onChange={(e) => setSuffix(e.target.value)} /></Field>
          <Field label="Enrollment Closes"><Input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        </div>

        <Field label="Fellowship Codes">
          <FcChips fellowships={data.fellowships} codes={fcCodes}
            onChange={(updated) => setFcCodes(enforceCodesForOnlineMode(updated, isOnline))} />
        </Field>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[
            ['Class Active', isActive, setIsActive],
            ['Registration Open', enrollOpen, setEnrollOpen],
            ['Online Class', isOnline, (v) => { setIsOnline(v); setFcCodes((c) => enforceCodesForOnlineMode(c, v)); }],
          ].map(([label, value, setter]) => (
            <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={value} onChange={(e) => setter(e.target.checked)} /> {label}
            </label>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
          Inactive classes are hidden from teachers and reporting. Closing registration stops new student assignment.
        </p>

        <div>
          <Field label="Capacity Preview">
            <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden', margin: '6px 0' }}>
              <span style={{ display: 'block', height: '100%', width: `${fill}%`, background: 'var(--primary)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
              <span>{Math.max(cap - enrolledCount, 0)} seats available</span>
              <strong style={{ color: 'var(--text)' }}>{enrolledCount} / {cap} enrolled</strong>
            </div>
          </Field>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Button variant="danger" size="sm" disabled={busy || Boolean(co.deleted_at)} onClick={onDelete}>{co.deleted_at ? 'Deleted' : 'Delete'}</Button>
        <div style={{ display: 'flex', gap: 8 }}>
          {canSuperadmin && (co.fellowship_codes || []).length > 1 && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onSplit}>Split class</Button>
          )}
          {canEdit && <Button variant="primary" size="sm" disabled={busy} onClick={handleSave}>✓ Save changes</Button>}
        </div>
      </div>
    </div>
  );
}

function NewClassPanel({ data, busy, onCancel, onCreate }) {
  const [teacherId, setTeacherId] = useState('');
  const [day, setDay] = useState('Sunday');
  const [time, setTime] = useState('');
  const [capacity, setCapacity] = useState('');
  const [batchId, setBatchId] = useState('');
  const [suffix, setSuffix] = useState('');
  const [expiry, setExpiry] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [active, setActive] = useState(true);
  const [enrollOpen, setEnrollOpen] = useState(true);
  const [fcCodes, setFcCodes] = useState([]);
  const [mode, setMode] = useState('shared');
  const [error, setError] = useState('');

  const teacher = data.teachers.find((t) => t.teacher_id === teacherId);
  const previewId = teacherId && day && time ? generateSharedClassId(teacher?.subgroup_id || 'SG', teacherId, day, time) : '';
  const showModePrompt = isOnline && fcCodes.length > 1;

  const handleCreate = () => {
    setError('');
    if (!teacherId || !day || !time) { setError('Teacher, day, and time are required.'); return; }
    onCreate({
      teacherId, day, time,
      capacity: capacity ? parseInt(capacity, 10) : null,
      batchId: batchId || null,
      suffix: suffix.trim() || null,
      expiry: expiry || null,
      isOnline, active, enrollOpen,
      fc: enforceCodesForOnlineMode(fcCodes, isOnline),
      mode, customId: previewId || null,
    }, teacher);
  };

  return (
    <section style={{ border: '1px solid color-mix(in srgb, var(--primary) 30%, var(--border))', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 16, marginBottom: 14 }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 12px' }}>New Class</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Field label="Teacher *">
          <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Select teacher</option>
            {data.teachers.map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.full_name} ({t.email || ''})</option>)}
          </Select>
        </Field>
        <Field label="Day *"><Select value={day} onChange={(e) => setDay(e.target.value)}>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
        <Field label="Time *"><Input type="time" step={1800} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Capacity"><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="25" /></Field>
        <Field label="Batch">
          <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">No batch (create slot later)</option>
            {data.batches.map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_name || b.batch_id}</option>)}
          </Select>
        </Field>
        <Field label="Label Suffix"><Input value={suffix} onChange={(e) => setSuffix(e.target.value)} /></Field>
        <Field label="Enrollment Closes"><Input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        <Field label="Class ID (auto)"><Input value={previewId} readOnly disabled /></Field>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Field label="Fellowship Codes">
          <FcChips fellowships={data.fellowships} codes={fcCodes}
            onChange={(updated) => setFcCodes(enforceCodesForOnlineMode(updated, isOnline))} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={isOnline} onChange={(e) => { setIsOnline(e.target.checked); setFcCodes((c) => enforceCodesForOnlineMode(c, e.target.checked)); }} /> Online Class
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={enrollOpen} onChange={(e) => setEnrollOpen(e.target.checked)} /> Registration Open
        </label>
      </div>
      {showModePrompt && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="multiFcMode" checked={mode === 'shared'} onChange={() => setMode('shared')} /> One shared class
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="multiFcMode" checked={mode === 'separate'} onChange={() => setMode('separate')} /> Separate class per fellowship
          </label>
        </div>
      )}
      {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={handleCreate} disabled={busy}>{busy ? 'Creating…' : 'Create Class'}</Button>
      </div>
    </section>
  );
}
