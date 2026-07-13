export default function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="rso-page-header">
      <div>
        <h1 className="rso-page-title">{title}</h1>
        {subtitle && <p className="rso-page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="rso-page-actions">{actions}</div>}
      {children}
    </div>
  );
}
