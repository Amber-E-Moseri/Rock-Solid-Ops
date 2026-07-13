import { useState, useMemo } from 'react';
import { Modal, Select, Textarea, Button, Input } from '../../../components/ui/index.js';
import { activeClassOptions, classCapacityInfo, getClassInfo, classIdOf } from '../lib/applicants.js';

export default function ClassCorrectionModal({ model, app, open, onClose, onSave, busy }) {
  const [newClassId, setNewClassId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const options = useMemo(
    () => (model && app ? activeClassOptions(model, app.class_option_id) : []),
    [model, app],
  );
  const cls = newClassId ? getClassInfo(model, newClassId) : null;
  const capacity = newClassId ? classCapacityInfo(model, newClassId) : null;

  const reset = () => { setNewClassId(''); setReason(''); setError(''); };

  const handleSave = () => {
    if (!newClassId) { setError('Please select a new class.'); return; }
    if (reason.trim().length < 10) { setError('Reason must be at least 10 characters.'); return; }
    if (capacity?.full) { setError('This class is at capacity. Assignment blocked.'); return; }
    setError('');
    onSave({ newClassId, reason: reason.trim(), cls });
  };

  if (!app) return null;

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Change Class Assignment"
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save & Notify'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Current class</div>
          <Input value={app.class_option_id || 'Unassigned'} readOnly disabled />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>New class</div>
          <Select value={newClassId} onChange={(e) => setNewClassId(e.target.value)}>
            <option value="">Select new class…</option>
            {options.map((c) => (
              <option key={classIdOf(c)} value={classIdOf(c)}>
                {classIdOf(c)} — {c.teacher_name || ''} {c.day || ''} {c.class_time || ''}
              </option>
            ))}
          </Select>
        </div>

        {cls && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: 13 }}>
            <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Teacher</div><strong>{cls.teacher_name || '-'}</strong></div>
            <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Day / Time</div><strong>{cls.day || '-'} {cls.class_time || ''}</strong></div>
            <div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Enrolled</div><strong>{capacity.current}{capacity.max ? ` / ${capacity.max}` : ''}</strong></div>
          </div>
        )}

        {capacity?.full && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--warning-bg, #fff8e6)', color: 'var(--warning, #c07400)', fontSize: 13, fontWeight: 600 }}>
            This class is at capacity. Assignment will be blocked.
          </div>
        )}

        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Reason (required, min 10 characters)</div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this student being moved?" rows={3} />
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
