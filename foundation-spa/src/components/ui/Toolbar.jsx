export default function Toolbar({ children, className = '' }) {
  return (
    <div className={`rso-toolbar${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
