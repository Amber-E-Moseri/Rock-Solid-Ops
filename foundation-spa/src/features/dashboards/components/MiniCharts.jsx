const PALETTE = ['#4C2A92', '#7B52C8', '#A97EE8', '#C9B4F2', '#6B3FA0', '#9B6BD6', '#D4BCF7', '#3D1F7A'];

export function HorizontalBarChart({ rows, labelKey = 'label', valueKey = 'value' }) {
  if (!rows?.length) return null;
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((r, i) => {
        const val = Number(r[valueKey]) || 0;
        const pct = (val / max) * 100;
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 40px', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[labelKey]}</span>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: PALETTE[i % PALETTE.length], borderRadius: 4, transition: 'width .3s ease' }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 11, color: 'var(--muted)' }}>{val.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DoughnutChart({ rows, labelKey = 'label', valueKey = 'value', size = 180 }) {
  if (!rows?.length) return null;
  const total = rows.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0);
  if (total === 0) return null;

  let cumPct = 0;
  const stops = rows.map((r, i) => {
    const pct = ((Number(r[valueKey]) || 0) / total) * 100;
    const start = cumPct;
    cumPct += pct;
    return `${PALETTE[i % PALETTE.length]} ${start}% ${cumPct}%`;
  });

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: `conic-gradient(${stops.join(', ')})`,
        position: 'relative', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', inset: '25%', borderRadius: '50%',
          background: 'var(--surface)',
        }} />
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
            <span style={{ color: 'var(--text)' }}>{r[labelKey]}</span>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{Number(r[valueKey]).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SparklineChart({ points, width = 400, height = 100, labels }) {
  if (!points?.length) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const coords = points.map((v, i) => {
    const x = pad + (i / Math.max(points.length - 1, 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return [x, y];
  });
  const polyline = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const areaPath = `M${coords[0][0]},${pad + h} ${coords.map(([x, y]) => `L${x},${y}`).join(' ')} L${coords[coords.length - 1][0]},${pad + h} Z`;

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height + 20}`} style={{ width: '100%', maxWidth: width, height: 'auto' }}>
        <path d={areaPath} fill="rgba(76,42,146,0.1)" />
        <polyline points={polyline} fill="none" stroke="#4C2A92" strokeWidth="2" strokeLinejoin="round" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill="#4C2A92" />
        ))}
        {labels?.length && coords.map(([x], i) => (
          labels[i] ? (
            <text key={i} x={x} y={height + 14} textAnchor="middle" style={{ fontSize: 9, fill: 'var(--muted)' }}>{labels[i]}</text>
          ) : null
        ))}
      </svg>
    </div>
  );
}

export function ProgressBar({ value, max = 100, variant }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const color = variant === 'danger' ? 'var(--danger)'
    : variant === 'warn' ? 'var(--warn)'
    : pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div style={{ height: 10, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 999, transition: 'width .3s ease' }} />
    </div>
  );
}

export function FunnelGrid({ steps }) {
  if (!steps?.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(steps.length, 5)}, minmax(0,1fr))`, gap: 8 }}>
      {steps.map((s, i) => {
        const prev = i === 0 ? s.count : steps[i - 1].count;
        const pct = prev > 0 ? Math.round((s.count * 100) / prev) : 0;
        return (
          <div key={i} style={{
            border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px',
            background: 'var(--surface-2)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 4, color: 'var(--text)' }}>{s.count.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{i === 0 ? '100%' : `${pct}%`}</div>
          </div>
        );
      })}
    </div>
  );
}
