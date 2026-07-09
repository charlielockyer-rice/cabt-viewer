import type { CardView } from './types';

// Stable identity key for a rendered card: its serial when the card is known,
// falling back to id + name. Used to key discard/pile stacks (and the probe's
// stability checks) so a card keeps its DOM node — and its loaded <img> — as
// the stack around it changes.
//
// Hand.svelte deliberately does NOT use this: a hand can hold several face-down
// cards that share no serial, so it keys by position instead. Don't fold that
// variant in here.
export function cardIdentityKey(card: Pick<CardView, 'serial' | 'id' | 'name'> | undefined): string {
  return `${card?.serial ?? ''}-${card?.id ?? ''}-${card?.name ?? ''}`;
}
