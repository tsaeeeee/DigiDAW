import { useEffect } from 'react';

const LEGACY_MARK_PATH = 'M22 12h-4l-3 9L9 3l-3 9H2';
const LOGO_SRC = '/digidaw-logo.svg';
const OPEN_LANDING_EVENT = 'digidaw:open-landing';

function replaceLegacyMarks() {
  const svgs = Array.from(document.querySelectorAll<SVGSVGElement>('svg'));

  svgs.forEach(svg => {
    const path = svg.querySelector('path');
    if (path?.getAttribute('d') !== LEGACY_MARK_PATH) return;

    const parent = svg.parentElement;
    if (!parent || parent.querySelector(':scope > img[data-digidaw-brand-logo="true"]')) return;

    const image = document.createElement('img');
    image.src = LOGO_SRC;
    image.alt = 'DigiDAW';
    image.dataset.digidawBrandLogo = 'true';
    image.draggable = false;
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.display = 'block';
    image.style.objectFit = 'contain';
    image.style.pointerEvents = 'none';

    svg.replaceWith(image);
  });
}

function wireWorkspaceBrandNavigation() {
  const logo = document.querySelector<HTMLImageElement>('header img[data-digidaw-brand-logo="true"]');
  const logoBox = logo?.parentElement;
  const brandGroup = logoBox?.parentElement as HTMLElement | null;
  if (!brandGroup || brandGroup.dataset.digidawLandingBound === '1') return;

  brandGroup.dataset.digidawLandingBound = '1';
  brandGroup.classList.add('digidaw-navbar-brand-home');
  brandGroup.setAttribute('role', 'button');
  brandGroup.setAttribute('tabindex', '0');
  brandGroup.setAttribute('aria-label', 'Back to DigiDAW landing page');
  brandGroup.setAttribute('title', 'Back to landing page');

  const openLanding = () => {
    window.dispatchEvent(new Event(OPEN_LANDING_EVENT));
  };

  brandGroup.addEventListener('click', openLanding);
  brandGroup.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openLanding();
  });
}

function syncBranding() {
  replaceLegacyMarks();
  wireWorkspaceBrandNavigation();
}

export function BrandLogoBehavior() {
  useEffect(() => {
    syncBranding();

    const root = document.getElementById('root');
    if (!root) return;

    const observer = new MutationObserver(syncBranding);
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
