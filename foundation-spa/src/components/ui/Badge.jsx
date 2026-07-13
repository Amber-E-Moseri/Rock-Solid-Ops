const STATUS_MAP = {
  // Registration
  pending:    'pending',
  assigned:   'assigned',
  waitlisted: 'waitlisted',
  duplicate:  'duplicate',
  review:     'review',
  inactive:   'inactive',
  completed:  'completed',
  // Batch
  draft:      'draft',
  active:     'active',
  upcoming:   'upcoming',
  archived:   'archived',
  // Semantic
  success:    'success',
  danger:     'danger',
  warning:    'warning',
  info:       'info',
  neutral:    'neutral',
};

export default function Badge({ status, variant, children, className = '' }) {
  const key = variant || STATUS_MAP[String(status || '').toLowerCase()] || 'neutral';
  const cls = `rso-badge rso-badge-${key}${className ? ` ${className}` : ''}`;
  return <span className={cls}>{children || status}</span>;
}
