export type ReplayDecisionAnalysis = {
  stateIndex: number;
  mode?: string;
  playerIndex?: number;
  playedSelection?: number[];
  policySelection?: number[];
  searchSelection?: number[];
  legalActions?: Array<{ label?: string }>;
  searched?: boolean;
  changed?: boolean;
  completedTraversals?: number;
  distinctEvaluations?: number;
  depthCutoffs?: number;
  stopReason?: string;
  rationale?: string;
  error?: string;
};

export function replayDecisionAnalyses(input: unknown): ReplayDecisionAnalysis[] {
  const frames = (input as { visualize?: unknown })?.visualize;
  if (!Array.isArray(frames)) {
    return [];
  }
  return frames.flatMap((frame, stateIndex) => {
    const analysis = (frame as { analysis?: unknown })?.analysis;
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
      return [];
    }
    return [{ ...(analysis as Omit<ReplayDecisionAnalysis, 'stateIndex'>), stateIndex }];
  });
}

export function nextReplayDisagreement(
  analyses: ReplayDecisionAnalysis[],
  currentStateIndex: number,
): ReplayDecisionAnalysis | null {
  return analyses.find((analysis) =>
    analysis.changed === true && analysis.stateIndex > currentStateIndex
  ) ?? null;
}
