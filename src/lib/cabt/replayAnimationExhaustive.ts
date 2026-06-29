export function assertUnhandledActionAnimationPhaseKind(kind: never): never {
  throw new Error(`Unhandled replay animation phase kind: ${kind}`);
}
