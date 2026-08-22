import { useEffect } from 'react';

const LEGACY_MARK_PATH = 'M22 12h-4l-3 9L9 3l-3 9H2';
const LOGO_SRC = '/digidaw-logo.svg';

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

export function BrandLogoBehavior() {
  useEffect(() => {
    replaceLegacyMarks();

    const root = document.getElementById('root');
    if (!root) return;

    const observer = new MutationObserver(replaceLegacyMarks);
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
