// Orchestration only: the guarded disposable-host caller supplies all effects.
export function probeFailureReason(error) {
  // execFileSync's first line is a long command. Preserve the diagnostic
  // instead of truncating it behind environment arguments. Probe inputs are
  // fixed disposable fixtures and carry no application credentials.
  const stderr = error?.stderr;
  const detail = typeof stderr === "string" || Buffer.isBuffer(stderr)
    ? stderr.toString().trim()
    : "";
  if (detail) return detail.slice(-1500);
  if (!(error instanceof Error)) return "Probe failed";
  const lines = error.message.split("\n");
  return (lines.slice(1).join("\n").trim() || lines[0]).slice(0, 300);
}
export async function quiesceProbeAccount({ uid, workerUid, run, alive, wait }) {
  const user = "latex-render-probe";
  if (!Number.isSafeInteger(uid) || uid < 1 || uid === workerUid ||
      Number(run("/usr/bin/id", ["-u", user]).trim()) !== uid)
    throw new Error("Refusing to stop an unrelated account");
  const failures = [];
  let terminationError;
  for (const args of [
    ["/usr/bin/loginctl", ["disable-linger", user]],
    ["/usr/bin/loginctl", ["terminate-user", user]],
    ["/usr/bin/systemctl", ["stop", `user@${uid}.service`]],
  ]) {
    try { run(...args); } catch (error) {
      if (args[1][0] === "terminate-user" && error.status === 1) terminationError = error;
      else failures.push(error);
    }
  }
  for (let n = 0; n < 10 && alive(uid); n++) await wait(100);
  if (alive(uid)) {
    try { run("/usr/bin/pkill", ["--signal", "KILL", "--uid", String(uid)]); }
    catch (error) { if (error.status !== 1) failures.push(error); }
  }
  for (let n = 0; n < 50 && alive(uid); n++) await wait(100);
  if (alive(uid)) {
    if (terminationError) failures.push(terminationError);
    failures.push(new Error("Probe account still has processes"));
  }
  if (failures.length) throw new AggregateError(failures, "Probe account did not stop cleanly");
}
