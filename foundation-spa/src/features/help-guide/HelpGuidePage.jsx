import { useState, useMemo } from 'react';
import { PageHeader, Button, Badge, SearchInput } from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import {
  ROLES, TABS, TROUBLE, STATUS, MILESTONES, CONTACTS,
  readChecks, writeChecks, stepKey, progressForRole, visibleRoleKeys,
} from './lib/guideData.js';

const STATUS_VARIANT = { ASSIGNED: 'success', PENDING: 'warning', WAITLISTED: 'info', DUPLICATE: 'danger', REVIEW: 'neutral' };

export default function HelpGuidePage() {
  const { profile } = useAuth();
  const keys = useMemo(() => visibleRoleKeys(profile?.role), [profile]);

  const [role, setRole] = useState(() => (keys.length === 1 ? keys[0] : ''));
  const [tab, setTab] = useState('getting-started');
  const [search, setSearch] = useState('');
  const [checks, setChecks] = useState(readChecks);

  const searchIndex = useMemo(
    () => keys.flatMap((k) => ROLES[k].tasks.map((t) => ({ role: k, label: ROLES[k].label, color: ROLES[k].color, id: t[0], title: t[1], body: t[2].join(' ') }))),
    [keys],
  );
  const hits = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return [];
    return searchIndex.filter((x) => `${x.title} ${x.body} ${x.label}`.toLowerCase().includes(s)).slice(0, 40);
  }, [search, searchIndex]);

  const toggleStep = (key, checked) => {
    const next = { ...checks, [key]: checked };
    setChecks(next);
    writeChecks(next);
  };

  const r = role ? ROLES[role] : null;
  const progress = role ? progressForRole(role, checks) : null;

  return (
    <div>
      <PageHeader
        title="Help Guide"
        subtitle="Role-based guides, common tasks, quick reference, and troubleshooting."
        actions={role && <Button variant="secondary" onClick={() => { setRole(''); setSearch(''); }}>← All roles</Button>}
      />

      <div style={{ maxWidth: 420, marginBottom: 14 }}>
        <SearchInput placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {hits.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', marginBottom: 16, overflow: 'hidden' }}>
          {hits.map((h) => (
            <div key={`${h.role}-${h.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ display: 'inline-block', borderRadius: 999, padding: '2px 8px', background: h.color, color: '#fff', fontSize: 11, fontWeight: 700, marginRight: 8 }}>{h.label}</span>
                <strong style={{ fontSize: 13 }}>{h.title}</strong>
                <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.body.slice(0, 140)}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => { setRole(h.role); setTab('common-tasks'); setSearch(''); }}>Open</Button>
            </div>
          ))}
        </div>
      )}

      {!role ? (
        /* Landing: role cards */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {keys.map((k) => {
            const rr = ROLES[k];
            return (
              <article key={k} style={{ border: '1px solid var(--border)', borderLeft: `4px solid ${rr.color}`, borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 2px' }}>{rr.label}</h3>
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>{rr.oneLine}</p>
                <Button size="sm" variant="primary" onClick={() => { setRole(k); setTab('getting-started'); }} style={{ background: rr.color, borderColor: rr.color }}>
                  View Guide
                </Button>
              </article>
            );
          })}
        </div>
      ) : (
        /* Guide view */
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ display: 'inline-block', borderRadius: 999, padding: '4px 12px', background: r.color, color: '#fff', fontSize: 12, fontWeight: 800 }}>{r.label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{progress.done}/{progress.total} tasks completed</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
              {TABS.map(([id, label]) => (
                <Button key={id} size="sm" variant={tab === id ? 'primary' : 'secondary'} onClick={() => setTab(id)}>{label}</Button>
              ))}
            </div>
          </div>

          {tab === 'getting-started' && (
            <Card title="Getting Started" sub="Start here to learn your entry points and core pages.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {r.gs.map((x, i) => (
                  <article key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--surface-2)' }}>
                    <h4 style={{ fontSize: 13, fontWeight: 800, margin: '0 0 4px' }}>{i + 1}. {x.split('. ')[0]}</h4>
                    <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>{x}</p>
                  </article>
                ))}
              </div>
            </Card>
          )}

          {tab === 'common-tasks' && (
            <Card title="Common Tasks" sub="Expand each task and check off steps as you complete them.">
              {r.tasks.map(([taskId, title, steps]) => {
                const done = steps.every((_, i) => checks[stepKey(role, taskId, i)] === true);
                return (
                  <details key={taskId} style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8, background: 'var(--surface)' }}>
                    <summary style={{ cursor: 'pointer', padding: '10px 14px', fontWeight: 700, fontSize: 13.5 }}>
                      {done ? '✅' : '⬜'} {title}
                    </summary>
                    <ul style={{ listStyle: 'none', margin: 0, padding: '4px 14px 12px' }}>
                      {steps.map((s, i) => {
                        const k = stepKey(role, taskId, i);
                        return (
                          <li key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', fontSize: 13, opacity: checks[k] ? 0.65 : 1, textDecoration: checks[k] ? 'line-through' : 'none' }}>
                            <input type="checkbox" checked={Boolean(checks[k])} onChange={(e) => toggleStep(k, e.target.checked)} style={{ marginTop: 2 }} />
                            <span><strong style={{ color: 'var(--primary)' }}>{i + 1}.</strong> {s}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                );
              })}
            </Card>
          )}

          {tab === 'quick-reference' && (
            <Card title="Quick Reference" sub="Cheat sheet for statuses, milestones, and support contacts.">
              <div className="rso-table-wrap" style={{ marginBottom: 16 }}>
                <table className="rso-table">
                  <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
                  <tbody>
                    {STATUS.map(([s, meaning]) => (
                      <tr key={s}><td><Badge variant={STATUS_VARIANT[s] || 'neutral'}>{s}</Badge></td><td>{meaning}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h4 style={{ fontSize: 13.5, fontWeight: 800, margin: '0 0 6px' }}>Milestone definitions</h4>
              <ul style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px', paddingLeft: 20 }}>
                {MILESTONES.map((m) => <li key={m}>{m}</li>)}
              </ul>
              <h4 style={{ fontSize: 13.5, fontWeight: 800, margin: '0 0 6px' }}>Who to contact for issues</h4>
              <div className="rso-table-wrap">
                <table className="rso-table">
                  <thead><tr><th>Issue area</th><th>Contact</th></tr></thead>
                  <tbody>{CONTACTS.map(([area, who]) => <tr key={area}><td>{area}</td><td>{who}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
          )}

          {tab === 'troubleshooting' && (
            <Card title="Troubleshooting" sub="Find the symptom, check the likely cause, then run the fix steps in order.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {TROUBLE.map(([title, symptom, cause, steps, contact]) => (
                  <article key={title} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--surface)', fontSize: 13 }}>
                    <h4 style={{ fontSize: 13.5, fontWeight: 800, margin: '0 0 6px' }}>{title}</h4>
                    <p style={{ margin: '0 0 4px' }}><strong>Symptom:</strong> {symptom}</p>
                    <p style={{ margin: '0 0 4px' }}><strong>Likely cause:</strong> <span style={{ color: 'var(--muted)' }}>{cause}</span></p>
                    <p style={{ margin: '0 0 2px' }}><strong>Steps to fix:</strong></p>
                    <ol style={{ margin: '0 0 6px', paddingLeft: 18 }}>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <p style={{ margin: 0 }}><strong>Who to contact if stuck:</strong> {contact}</p>
                  </article>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ title, sub, children }) {
  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 18 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 2px' }}>{title}</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>{sub}</p>
      {children}
    </section>
  );
}
