export type ReplayAnimationListItem = {
  id: string | number;
};

export type ReplayAnimationScopeClearOptions<T extends ReplayAnimationListItem> = {
  items: T[];
  timers: ReturnType<typeof setTimeout>[];
  delayMs: number;
  removeIds(ids: ReadonlySet<T['id']>): void;
  afterRemove?: () => void;
};

export function scheduleReplayAnimationScopeClear<T extends ReplayAnimationListItem>({
  items,
  timers,
  delayMs,
  removeIds,
  afterRemove,
}: ReplayAnimationScopeClearOptions<T>): boolean {
  const ids = new Set<T['id']>(items.map((item) => item.id));
  if (!ids.size) {
    return false;
  }
  clearReplayAnimationTimers(timers);
  const timer = setTimeout(() => {
    const timerIndex = timers.indexOf(timer);
    if (timerIndex >= 0) {
      timers.splice(timerIndex, 1);
    }
    removeIds(ids);
    afterRemove?.();
  }, delayMs);
  timers.push(timer);
  return true;
}

export function clearReplayAnimationTimers(timers: ReturnType<typeof setTimeout>[]) {
  for (const timer of timers) {
    clearTimeout(timer);
  }
  timers.length = 0;
}
