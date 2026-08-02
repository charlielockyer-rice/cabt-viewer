export type ReplaySearchAction = {
  label?: string;
  optionIndexes?: number[];
  selected?: boolean;
  prior?: number;
  visits?: number;
  expanded?: boolean;
  qForActor?: number;
  valueSeat0?: number | null;
};

export type ReplaySearchLineStep = {
  depth?: number;
  actorSeat?: number;
  label?: string;
  visits?: number;
  qForActor?: number;
  nodeValueSeat0?: number;
  valueSeat0?: number | null;
};

export type ReplaySearchInspector = {
  schemaVersion?: number;
  actorSeat?: number;
  rootNetworkValueSeat0?: number;
  rootSearchValueSeat0?: number;
  completedTraversals?: number;
  distinctEvaluations?: number;
  depthCutoffs?: number;
  stopReason?: string;
  actions?: ReplaySearchAction[];
  principalLine?: ReplaySearchLineStep[];
  beliefs?: Array<{ id?: number; weight?: number }>;
};

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
  searchInspector?: ReplaySearchInspector;
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
