import type { ReleaseClaim } from './visibility';

// Target-owned animations (attach slide-under, evolve glow, prize placement)
// run as CSS on the real element: a data attribute arms the animation and
// custom properties carry per-run geometry. Ref-counted per element and
// attribute so overlapping runs cannot strip each other's state early.
const effectCounts = new Map<HTMLElement, Map<string, number>>();

export function applyTargetEffect(
  element: HTMLElement,
  attribute: string,
  vars: Record<string, string>,
): ReleaseClaim {
  const counts = effectCounts.get(element) ?? new Map<string, number>();
  counts.set(attribute, (counts.get(attribute) ?? 0) + 1);
  effectCounts.set(element, counts);
  element.setAttribute(attribute, 'true');
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value);
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const current = effectCounts.get(element);
    const count = (current?.get(attribute) ?? 1) - 1;
    if (current && count > 0) {
      current.set(attribute, count);
      return;
    }
    current?.delete(attribute);
    if (current && current.size === 0) {
      effectCounts.delete(element);
    }
    element.removeAttribute(attribute);
    for (const name of Object.keys(vars)) {
      element.style.removeProperty(name);
    }
  };
}
