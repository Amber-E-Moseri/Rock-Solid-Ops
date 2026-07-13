import { forwardRef } from 'react';
import { Search } from 'lucide-react';

export const Input = forwardRef(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`rso-input${className ? ` ${className}` : ''}`} {...props} />;
});

export const Select = forwardRef(function Select({ className = '', children, ...props }, ref) {
  return (
    <select ref={ref} className={`rso-select${className ? ` ${className}` : ''}`} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={`rso-textarea${className ? ` ${className}` : ''}`} {...props} />;
});

export function SearchInput({ className = '', ...props }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
      <Search
        size={14}
        style={{
          position: 'absolute',
          left: 11,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--muted)',
          pointerEvents: 'none',
        }}
      />
      <input
        className={`rso-input${className ? ` ${className}` : ''}`}
        style={{ paddingLeft: 34 }}
        {...props}
      />
    </div>
  );
}
