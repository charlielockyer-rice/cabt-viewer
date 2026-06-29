export function afterTwoAnimationFrames(callback: () => void, trackedFrameIds: number[] = []): {
  cancel: () => void;
  frameIds: number[];
} {
  const removeFrame = (frameId: number) => {
    const index = trackedFrameIds.indexOf(frameId);
    if (index >= 0) {
      trackedFrameIds.splice(index, 1);
    }
  };
  const firstFrame = requestAnimationFrame(() => {
    removeFrame(firstFrame);
    const secondFrame = requestAnimationFrame(() => {
      removeFrame(secondFrame);
      callback();
    });
    trackedFrameIds.push(secondFrame);
  });
  trackedFrameIds.push(firstFrame);
  return {
    frameIds: trackedFrameIds,
    cancel: () => {
      for (const frameId of [...trackedFrameIds]) {
        cancelAnimationFrame(frameId);
        removeFrame(frameId);
      }
    },
  };
}
