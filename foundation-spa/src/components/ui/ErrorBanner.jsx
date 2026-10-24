import Button from './Button.jsx';

export default function ErrorBanner({ message = 'Something went wrong.', onRetry }) {
  return (
    <div className="rso-error-banner" role="alert">
      <span>{message}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
