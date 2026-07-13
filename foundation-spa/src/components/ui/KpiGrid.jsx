export function KpiGrid({ children, className = '' }) {
  return <div className={`rso-kpi-grid${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function Kpi({ value, label, className = '' }) {
  return (
    <div className={`rso-kpi${className ? ` ${className}` : ''}`}>
      <div className="rso-kpi-value">{value}</div>
      <div className="rso-kpi-label">{label}</div>
    </div>
  );
}
