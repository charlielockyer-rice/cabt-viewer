import { describe, expect, it } from 'vitest';
import { AnimationEventGate } from './gate';
import type { ActionTimelineEvent } from '../game/types';

describe('AnimationEventGate', () => {
  it('never animates the state present at mount', () => {
    const gate = new AnimationEventGate();

    expect(gate.update([event(1), event(2)], 'live-2')).toEqual({ scopeChanged: false, batch: [] });
  });

  it('animates the whole event list when the scope changes', () => {
    const gate = new AnimationEventGate();
    gate.update([event(1)], 'live-1');

    const events = [event(2), event(3)];
    expect(gate.update(events, 'live-3')).toEqual({ scopeChanged: true, batch: events });
  });

  it('animates nothing while the scope is unchanged', () => {
    const gate = new AnimationEventGate();
    gate.update([event(1)], 'step-1');
    gate.update([event(2)], 'step-2');

    expect(gate.update([event(2)], 'step-2')).toEqual({ scopeChanged: false, batch: [] });
    // The interactive view that lands after live playback keeps the last
    // step's scope key; its (empty) event feed must not re-animate.
    expect(gate.update([], 'step-2')).toEqual({ scopeChanged: false, batch: [] });
  });
});

function event(id: number): ActionTimelineEvent {
  return { id, message: `event ${id}`, kind: 'Draw', playerIndex: 0 };
}
