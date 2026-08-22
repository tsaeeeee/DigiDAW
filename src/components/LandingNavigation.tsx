import { useEffect, useState } from 'react';
import { BookOpen, Disc3 } from 'lucide-react';
import { MarkdownDocument } from './MarkdownDocument';
import '../landing-navigation.css';

type LandingView = 'digidaw' | 'documentation';

export function LandingNavigation() {
  const [visible, setVisible] = useState(() => !document.querySelector('header'));
  const [view, setView] = useState<LandingView>('digidaw');

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const sync = () => {
      const workspaceActive = !!document.querySelector('header');
      const nextVisible = !workspaceActive;
      setVisible(nextVisible);
      document.body.classList.toggle('digidaw-landing-active', nextVisible);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.body.classList.remove('digidaw-landing-active');
    };
  }, []);

  if (!visible) return null;

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
