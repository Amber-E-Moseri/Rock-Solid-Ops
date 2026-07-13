import { forwardRef } from 'react';

const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', children, className = '', ...props },
  ref
) {
  const cls = `rso-btn rso-btn-${variant} rso-btn-${size}${className ? ` ${className}` : ''}`;
  return (
    <button ref={ref} className={cls} {...props}>
      {children}
    </button>
  );
});

export default Button;
