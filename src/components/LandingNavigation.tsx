import { useEffect, useState } from 'react';
import { BookOpen, Disc3 } from 'lucide-react';
import { MarkdownDocument } from './MarkdownDocument';
import '../landing-navigation.css';

type LandingView = 'digidaw' | 'documentation';

const OPEN_LANDING_EVENT = 'digidaw:open-landing';

export function LandingNavigation() {
  const [workspaceActive, setWorkspaceActive] = useState(() => !!document.querySelector('header'));
  const [manualOpen, setManualOpen] = useState(false);
  const [view, setView] = useState<LandingView>('digidaw');

  const visible = !workspaceActive || manualOpen;

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const syncWorkspace = () => {
      setWorkspaceActive(!!document.querySelector('header'));
    };

    syncWorkspace();
    const observer = new MutationObserver(syncWorkspace);
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const openLanding = () => {
      setView('digidaw');
      setManualOpen(true);
    };

    window.addEventListener(OPEN_LANDING_EVENT, openLanding);
    return () => window.removeEventListener(OPEN_LANDING_EVENT, openLanding);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('digidaw-landing-active', visible);
    return () => document.body.classList.remove('digidaw-landing-active');
  }, [visible]);

  if (!visible) return null;

  const returnToSession = () => {
    if (!workspaceActive) return;
    setView('digidaw');
    setManualOpen(false);
  };

  return (
    <>
      <aside className="digidaw-landing-sidebar" aria-label="DigiDAW landing navigation">
        <div className="digidaw-landing-brand">
          <img src="/digidaw-logo.svg" alt="" aria-hidden="true" />
          <div>
            <span>DigiDAW</span>
            <small>by Crescentials Record</small>
          </div>
        </div>

        <nav className="digidaw-landing-menu">
          <button
            type="button"
            className={view === 'digidaw' ? 'is-active' : ''}
            onClick={() => setView('digidaw')}
            aria-pressed={view === 'digidaw'}
          >
            <Disc3 />
            <span>Launch</span>
          </button>
          <button
            type="button"
            className={view === 'documentation' ? 'is-active' : ''}
            onClick={() => setView('documentation')}
            aria-pressed={view === 'documentation'}
          >
            <BookOpen />
            <span>Documentation</span>
          </button>
        </nav>

        <div className="digidaw-landing-sidebar-footer">
          <strong>Free. Legal. Accessible.</strong>
        </div>
      </aside>

      {workspaceActive && manualOpen && view === 'digidaw' && (
        <section className="digidaw-return-launcher" aria-label="Return to DigiDAW session">
          <div className="digidaw-return-launcher-content">
            <img src="/digidaw-logo.svg" alt="DigiDAW" />
            <div>
              <h1>DigiDAW</h1>
              <p>Professional Linear Audio Workstation for Mixing &amp; Mastering</p>
            </div>
            <button type="button" onClick={returnToSession}>Launch</button>
          </div>
          <div className="digidaw-return-launcher-footer">Powered by Crescentials Record</div>
        </section>
      )}

      {view === 'documentation' && (
        <section className="digidaw-documentation-view" aria-label="DigiDAW documentation">
          <div className="digidaw-documentation-scroll">
            <MarkdownDocument src="/documentation.md" />
          </div>
        </section>
      )}
    </>
  );
}
