// The CABT engine delivers each player the logs since that player's last
// observation, so consecutive observations from different actors overlap:
// the same log lines arrive twice. appendTimeline must drop the re-delivered
// lines or they get fresh timeline ids and re-animate an entire turn.
//
// Engine logs carry no ids, so identity is the serialized content, deduped
// against a sliding window. The window must cover at least one full turn of
// logs (the human's first observation after an agent turn re-delivers that
// whole turn) while staying small enough that a genuinely repeated action in
// a later turn falls outside it and animates normally.
const DEFAULT_WINDOW = 300;

export type LogDeduper = {
  filterNew: (logs: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
};

export function createLogDeduper(windowSize = DEFAULT_WINDOW): LogDeduper {
  const seen = new Set<string>();
  const order: string[] = [];

  return {
    filterNew(logs) {
      const fresh: Array<Record<string, unknown>> = [];
      for (const log of logs) {
        const signature = JSON.stringify(log);
        if (seen.has(signature)) {
          continue;
        }
        fresh.push(log);
        seen.add(signature);
        order.push(signature);
        if (order.length > windowSize) {
          seen.delete(order.shift()!);
        }
      }
      return fresh;
    },
  };
}
