export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <main className="to-shell">
      <section className="to-card" aria-labelledby="to-page-title">
        <h1 id="to-page-title" className="to-title">{title}</h1>
        {subtitle && <p className="to-subtitle">{subtitle}</p>}
        {children}
        {footer && <div className="to-footer">{footer}</div>}
      </section>
    </main>
  );
}
