import { onMount } from 'svelte';

export function createPrefersReducedMotion() {
  let current = $state(false);

  onMount(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      current = media.matches;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });

  return {
    get current() {
      return current;
    },
  };
}
