// Labelled form field. Pass the control as children and spread fieldAria(...) onto it so the error
// and hint are announced with the input.
export function fieldAria(id, { error, hint } = {}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  };
}

export default function Field({ id, label, error, hint, children }) {
  return (
    <div className="to-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="to-hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="to-error-text">{error}</p>}
    </div>
  );
}
