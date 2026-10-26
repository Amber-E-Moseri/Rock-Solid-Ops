import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../../context/ToastContext.jsx';

export const UNAUTHORIZED_NOTICE = 'unauthorized';
export const UNAUTHORIZED_MESSAGE = "You don't have permission to access that page.";

// Shows the role-denied notice once for a redirect that carried it, then clears it from
// history so a refresh or back navigation does not repeat it.
export function useAccessNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const handledKey = useRef(null);

  useEffect(() => {
    if (location.state?.notice !== UNAUTHORIZED_NOTICE) return;
    if (handledKey.current === location.key) return;
    handledKey.current = location.key;
    toast(UNAUTHORIZED_MESSAGE, 'warning');
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [location, navigate, toast]);
}
