// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { animVisibility } from './visibility';

afterEach(() => {
  animVisibility.reset();
});

describe('animVisibility', () => {
  it('hides through one attribute and reveals only when the last claim releases', () => {
    const element = document.createElement('div');

    const releaseA = animVisibility.claim(element, 'contents');
    const releaseB = animVisibility.claim(element, 'contents');
    expect(element.dataset.animHidden).toBe('contents');
    expect(animVisibility.hiddenCount()).toBe(1);

    releaseA();
    // A second overlapping claim still owns the hide.
    expect(element.dataset.animHidden).toBe('contents');
    expect(animVisibility.hiddenCount()).toBe(1);

    releaseB();
    expect(element.dataset.animHidden).toBeUndefined();
    expect(animVisibility.hiddenCount()).toBe(0);
  });

  it('element mode wins over contents mode while both are claimed', () => {
    const element = document.createElement('div');
    const releaseContents = animVisibility.claim(element, 'contents');
    const releaseElement = animVisibility.claim(element, 'element');
    expect(element.dataset.animHidden).toBe('element');

    releaseElement();
    expect(element.dataset.animHidden).toBe('contents');
    releaseContents();
    expect(element.dataset.animHidden).toBeUndefined();
  });

  it('a release is idempotent — calling it twice never over-reveals', () => {
    const element = document.createElement('div');
    const release = animVisibility.claim(element, 'contents');
    const other = animVisibility.claim(element, 'contents');
    release();
    release();
    // The other claim must still hold the hide.
    expect(element.dataset.animHidden).toBe('contents');
    other();
    expect(element.dataset.animHidden).toBeUndefined();
  });

  it('hiddenCount counts distinct claimed elements', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    animVisibility.claim(a, 'contents');
    animVisibility.claim(b, 'element');
    expect(animVisibility.hiddenCount()).toBe(2);
  });

  it('reset drops every claim and clears its attribute', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    animVisibility.claim(a, 'contents');
    animVisibility.claim(b, 'element');
    expect(animVisibility.hiddenCount()).toBe(2);

    animVisibility.reset();
    expect(animVisibility.hiddenCount()).toBe(0);
    expect(a.dataset.animHidden).toBeUndefined();
    expect(b.dataset.animHidden).toBeUndefined();
  });
});
