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
        <section
          className="fixed top-0 right-0 bottom-0 z-[1100] bg-[#151619] text-white font-sans select-none"
          style={{ left: 'var(--digidaw-sidebar-width)' }}
          aria-label="Return to DigiDAW session"
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <div className="w-20 h-20 mb-6">
              <img src="/digidaw-logo.svg" alt="DigiDAW" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-3xl syncopate-regular font-normal tracking-tight text-white">DigiDAW</h1>
              <p className="text-[#8e9299] text-sm mt-2 font-medium">Professional Linear Audio Workstation for Mixing &amp; Mastering</p>
            </div>
            <button
              type="button"
              onClick={returnToSession}
              className="mt-8 px-8 py-3.5 bg-[#ffd900] hover:bg-[#ffe55c] active:scale-95 transition-all rounded-full font-bold tracking-wider text-sm text-black shadow-lg shadow-[#ffd900]/20 cursor-pointer"
            >
              Launch
            </button>
          </div>
          <div className="absolute bottom-12 left-0 right-0 text-center text-xs text-[#71717a] font-medium tracking-wide">
            Powered by Crescentials Record
          </div>
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
