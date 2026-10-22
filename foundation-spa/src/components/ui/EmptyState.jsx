// `subtitle` is accepted as an alias of `message`. Twenty pages pass `subtitle`, which was silently dropped,
// so their explanations never rendered.
export default function EmptyState({ icon = '📋', title, message, subtitle }) {
  const text = message ?? subtitle;
  return (
    <div className="rso-empty">
      <div className="rso-empty-icon">{icon}</div>
      {title && <div className="rso-empty-title">{title}</div>}
      {text && <div className="rso-empty-sub">{text}</div>}
    </div>
  );
}
