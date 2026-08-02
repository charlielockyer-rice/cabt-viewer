// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { expect, it, vi } from 'vitest';
import SearchInspector from './SearchInspector.svelte';

it('renders recorded root weights and fixed-seat judge values', () => {
  const close = vi.fn();
  const app = mount(SearchInspector, {
    target: document.body,
    props: {
      close,
      seat0Name: 'Seat Zero',
      seat1Name: 'Seat One',
      analysis: {
        searched: true,
        changed: true,
        policySelection: [0],
        searchSelection: [1],
        legalActions: [{ label: 'Play Ultra Ball' }, { label: 'End turn' }],
        searchInspector: {
          actorSeat: 0,
          rootNetworkValueSeat0: 0.42,
          rootSearchValueSeat0: 0.68,
          completedTraversals: 32,
          distinctEvaluations: 26,
          actions: [
            { optionIndexes: [0], prior: 0.7, visits: 8, qForActor: 0.43, valueSeat0: 0.43, expanded: true },
            { optionIndexes: [1], selected: true, prior: 0.3, visits: 24, qForActor: 0.68, valueSeat0: 0.68, expanded: true },
          ],
          principalLine: [{ actorSeat: 0, visits: 24, valueSeat0: 0.68 }],
          beliefs: [{ id: 0, weight: 0.75 }, { id: 1, weight: 0.25 }],
        },
      },
    },
  });
  flushSync();

  const text = document.body.textContent ?? '';
  expect(text).toContain('Seat Zero 68% · Seat One 32%');
  expect(text).toContain('Play Ultra Ball');
  expect(text).toContain('End turn');
  expect(text).toContain('32 visits');
  expect(text).toContain('Opponent-list beliefs');
  expect(text).toContain('75%');

  document.querySelector<HTMLButtonElement>('button.close')?.click();
  expect(close).toHaveBeenCalledOnce();
  unmount(app);
  document.body.innerHTML = '';
});
