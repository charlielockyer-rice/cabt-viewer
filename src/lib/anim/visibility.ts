export type HideMode = 'contents' | 'element';

export type ReleaseClaim = () => void;

// The single owner of animation-time hiding. Claims are ref-counted per
// element so overlapping motions can hide the same DOM without one motion's
// cleanup revealing a card another motion still owns. Everything renders
// through one attribute: [data-anim-hidden].
class AnimVisibility {
  private claims = new Map<HTMLElement, { contents: number; element: number }>();

  claim(element: HTMLElement, mode: HideMode): ReleaseClaim {
    const counts = this.claims.get(element) ?? { contents: 0, element: 0 };
    counts[mode] += 1;
    this.claims.set(element, counts);
    this.sync(element, counts);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const current = this.claims.get(element);
      if (!current) {
        return;
      }
      current[mode] = Math.max(0, current[mode] - 1);
      if (current.contents === 0 && current.element === 0) {
        this.claims.delete(element);
      }
      this.sync(element, current);
    };
  }

  hiddenCount(): number {
    return this.claims.size;
  }

  private sync(element: HTMLElement, counts: { contents: number; element: number }): void {
    if (counts.element > 0) {
      element.dataset.animHidden = 'element';
      return;
    }
    if (counts.contents > 0) {
      element.dataset.animHidden = 'contents';
      return;
    }
    delete element.dataset.animHidden;
  }
}

export const animVisibility = new AnimVisibility();
