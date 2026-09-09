export function brokenUpdaterSource(markerPath, nonce) {
  return `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify({nonce:${JSON.stringify(nonce)}, cwd:process.cwd()}), {mode:0o600});
throw new Error('intentional E2E startup failure');
`;
}

export function assertStartupRecovery({
  failure,
  marker,
  nonce,
  brokenRoot,
  state,
  before,
}) {
  if (
    failure?.status !== 1 ||
    !String(failure.stderr).includes("New Updater did not become healthy") ||
    marker?.nonce !== nonce ||
    marker.cwd !== brokenRoot ||
    state.current !== before.current ||
    state.previous !== before.previous ||
    state.candidate !== null ||
    state.pending !== null
  )
    throw new Error(
      "Missing evidence of broken Updater startup and complete recovery",
    );
}
