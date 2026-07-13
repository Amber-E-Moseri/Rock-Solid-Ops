export default function Skeleton({ variant = 'text', count = 3, className = '', style }) {
  const base = 'rso-skeleton';

  if (variant === 'card') {
    return (
      <div className={`${base} rso-skeleton-card ${className}`} style={style} aria-busy="true" aria-label="Loading" />
    );
  }

  if (variant === 'row') {
    return (
      <div style={style}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={`${base} rso-skeleton-row ${className}`} />
        ))}
      </div>
    );
  }

  // Default: text lines
  return (
    <div style={style} aria-busy="true" aria-label="Loading">
      <div className={`${base} rso-skeleton-heading ${className}`} />
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${base} rso-skeleton-text ${className}`} />
      ))}
    </div>
  );
}
