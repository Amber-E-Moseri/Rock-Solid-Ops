export default function EmptyState({ icon = '📋', title, message }) {
  return (
    <div className="rso-empty">
      <div className="rso-empty-icon">{icon}</div>
      {title && <div className="rso-empty-title">{title}</div>}
      {message && <div className="rso-empty-sub">{message}</div>}
    </div>
  );
}
