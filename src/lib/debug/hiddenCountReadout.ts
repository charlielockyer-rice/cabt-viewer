// Live-client instrument for the animation visibility system: with
// `?debug=hidden` in the URL, shows a small fixed-position badge with the
// current animVisibility.hiddenCount() — the number of DOM elements hidden
// mid-animation. A count that never returns to 0 while the board is idle is a
// stuck/leaked visibility claim (a card that stays invisible), which is
// otherwise invisible to catch in the moment.
import { animVisibility } from '../anim/visibility';

export function startHiddenCountReadout(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const badge = document.createElement('div');
  badge.setAttribute('data-debug', 'hidden-count');
  Object.assign(badge.style, {
    position: 'fixed',
    right: '8px',
    bottom: '8px',
    zIndex: '2147483647',
    padding: '4px 8px',
    borderRadius: '6px',
    font: '12px/1.4 ui-monospace, monospace',
    color: '#fff',
    background: 'rgba(17, 24, 39, 0.86)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(badge);

  let last = -1;
  const tick = () => {
    const count = animVisibility.hiddenCount();
    if (count !== last) {
      last = count;
      badge.textContent = `anim-hidden: ${count}`;
      // Flag a non-zero count so a stuck claim stands out at a glance.
      badge.style.background = count > 0 ? 'rgba(180, 83, 9, 0.9)' : 'rgba(17, 24, 39, 0.86)';
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
