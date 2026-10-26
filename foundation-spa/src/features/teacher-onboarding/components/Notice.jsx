// Errors use role="alert" so assistive technology announces them at once; other notices are polite.
export default function Notice({ tone = 'info', children }) {
  const role = tone === 'error' ? 'alert' : 'status';
  return <div role={role} className={`to-notice to-notice-${tone}`}>{children}</div>;
}
