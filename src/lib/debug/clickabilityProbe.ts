// Live-client instrument for the clickability-flicker investigation: with
// `?debug=clickability` in the URL, logs every transition that could make a
// board slot's cursor or highlight oscillate — attribute churn, slot
// remounts, visibility claims, and hit-test changes under the pointer.
// Console lines are timestamped; `window.__clickability()` dumps the full
// ring buffer as JSON for a bug report.

type ProbeEntry = Record<string, unknown> & { at: number; kind: string };

const RING_LIMIT = 4000;

export function startClickabilityProbe(): void {
  const buffer: ProbeEntry[] = [];
  const start = performance.now();
  const push = (entry: Omit<ProbeEntry, 'at'>) => {
    const full = { at: Math.round(performance.now() - start), ...entry } as ProbeEntry;
    buffer.push(full);
    if (buffer.length > RING_LIMIT) {
      buffer.splice(0, buffer.length - RING_LIMIT);
    }
    console.warn('[clickability]', JSON.stringify(full));
  };

  const label = (node: Node | null): string => {
    if (!(node instanceof HTMLElement)) {
      return node?.nodeName ?? 'null';
    }
    return node.getAttribute('data-testid')
      ?? node.getAttribute('data-card-anchor')
      ?? `${node.tagName.toLowerCase()}.${String(node.className).split(' ').slice(0, 2).join('.')}`;
  };

  // 1. Attribute churn and remounts on board slots.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const element = record.target as HTMLElement;
        if (!element.classList?.contains('board-slot')) {
          continue;
        }
        push({
          kind: 'slot-attr',
          slot: label(element),
          attr: record.attributeName,
          old: record.oldValue,
          now: element.getAttribute(record.attributeName!),
        });
      } else {
        const removedSlots = [...record.removedNodes].filter((node) =>
          node instanceof HTMLElement && (node.classList.contains('board-slot') || node.querySelector?.('.board-slot')));
        if (removedSlots.length) {
          push({ kind: 'slot-remount', parent: label(record.target), removed: removedSlots.map(label).join(',') });
        }
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['class', 'data-anim-hidden', 'disabled'],
  });

  // 2. Hit-testing under the pointer: which element would receive the click,
  // and what cursor it shows. Logged only on transition.
  let mouseX = -1;
  let mouseY = -1;
  window.addEventListener('mousemove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  }, { passive: true });

  let lastState = '';
  const timer = setInterval(() => {
    if (mouseX < 0) {
      return;
    }
    const hit = document.elementFromPoint(mouseX, mouseY);
    const slot = hit instanceof Element ? hit.closest('.board-slot') : null;
    const state = JSON.stringify({
      hit: label(hit),
      slot: slot ? label(slot) : null,
      selectable: slot?.classList.contains('prompt-selectable') ?? false,
      animHidden: slot?.getAttribute('data-anim-hidden') ?? null,
      cursor: hit ? getComputedStyle(hit).cursor : 'none',
    });
    if (state !== lastState) {
      lastState = state;
      push({ kind: 'pointer', x: mouseX, y: mouseY, ...JSON.parse(state) });
    }
  }, 50);

  (window as unknown as Record<string, unknown>).__clickability = () => {
    console.log(JSON.stringify(buffer, null, 1));
    return `${buffer.length} entries`;
  };
  (window as unknown as Record<string, unknown>).__clickabilityStop = () => {
    observer.disconnect();
    clearInterval(timer);
    return 'stopped';
  };
  console.warn('[clickability] probe active — dump with window.__clickability()');
}
