export default function Card({ icon, title, subtitle, children, className = '', ...props }) {
  return (
    <div className={`rso-card${className ? ` ${className}` : ''}`} {...props}>
      {(icon || title) && (
        <div className="rso-card-header">
          {icon && <div className="rso-card-icon">{icon}</div>}
          <div>
            {title && <div className="rso-card-title">{title}</div>}
            {subtitle && <div className="rso-card-sub">{subtitle}</div>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
