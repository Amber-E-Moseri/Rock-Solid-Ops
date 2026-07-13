import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWA } from '../../hooks/usePWA';

const DISMISS_KEY = 'rso-pwa-install-dismissed';

/*
 * Bottom-right "Install Rock Solid Ops" card. Styling ported from the Nexus
 * reference but rewritten from Tailwind utilities to RSO CSS tokens
 * (--primary / --text / --surface-2 / --border), per the brief.
 */
export function PWAInstallPrompt() {
  const { isInstallable, install } = usePWA();
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isInstallable && sessionStorage.getItem(DISMISS_KEY) !== '1') {
      setVisible(true);
    }
  }, [isInstallable]);

  if (!visible) return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const accepted = await install();
      if (accepted) setVisible(false);
    } finally {
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  return (
    <div className="rso-pwa-install" role="dialog" aria-label="Install Rock Solid Ops">
      <div className="rso-pwa-install-body">
        <div className="rso-pwa-install-text">
          <h3 className="rso-pwa-install-title">Install Rock Solid Ops</h3>
          <p className="rso-pwa-install-desc">
            Add the app to your home screen for quick access and offline support.
          </p>
          <div className="rso-pwa-install-actions">
            <button
              type="button"
              onClick={handleInstall}
              disabled={installing}
              className="rso-pwa-btn rso-pwa-btn-primary"
            >
              <Download size={14} />
              {installing ? 'Installing…' : 'Install'}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="rso-pwa-btn rso-pwa-btn-ghost"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rso-pwa-install-close"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
