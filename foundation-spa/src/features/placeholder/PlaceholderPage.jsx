import { useLocation } from 'react-router-dom';

export default function PlaceholderPage() {
  const location = useLocation();
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 320,
      gap: 16,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 40 }}>🚧</div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Coming soon</h2>
      <p style={{ color: 'var(--muted)', margin: 0, maxWidth: 340, fontSize: 14, lineHeight: 1.6 }}>
        This portal is being migrated to the new SPA. The legacy version is still available at{' '}
        <code>/foundation/staff/</code>.
      </p>
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Path: {location.pathname}</p>
    </div>
  );
}
