// Shared vitest setup: happy-dom implements no Web Animations API, but Svelte's
// `animate:flip` (used by Hand.svelte) calls `element.getAnimations()` and
// `element.animate()` during DOM-mounted component tests. Without these, the
// FLIP transition throws an *uncaught* exception that leaves the test file
// green but forces the whole `vitest run` to exit non-zero. Stub them to inert
// no-ops so component tests exercise keying without animation noise.
//
// Guarded on HTMLElement so this is a no-op in the default node environment
// (node test files never touch the DOM).
if (typeof HTMLElement !== 'undefined') {
  const proto = HTMLElement.prototype as unknown as {
    animate?: unknown;
    getAnimations?: unknown;
  };
  if (typeof proto.animate !== 'function') {
    proto.animate = () => ({
      cancel() {},
      finish() {},
      finished: Promise.resolve(),
      onfinish: null,
      addEventListener() {},
      removeEventListener() {},
    });
  }
  if (typeof proto.getAnimations !== 'function') {
    proto.getAnimations = () => [];
  }
}
