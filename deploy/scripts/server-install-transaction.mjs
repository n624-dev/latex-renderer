import { randomBytes, createHash } from "node:crypto";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const phases = new Set(["pending", "owner-ready", "committed"]);
const allowedUnits = new Set(
  [
    "api",
    "admin-api",
    "remote-mcp",
    "internal-api",
    "worker",
    "web",
    "standalone-gateway",
    "ingress",
    "image-manager",
    "update-manager",
  ].map((name) => `latex-renderer-${name}.service`),
);
for (const name of [
  "backup",
  "audit-export",
  "cleanup",
  "image-log-cleanup",
  "image-operation-watchdog",
  "update-refresh",
  "update-recovery-gc",
])
  allowedUnits.add(`latex-renderer-${name}.timer`);
export function validateInstallationJournal(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "after,before,format,id,kind,phase,units" ||
    value.format !== 1 ||
    !phases.has(value.phase) ||
    !["initial", "ingress"].includes(value.kind) ||
    !/^[a-f0-9]{48}$/.test(value.id) ||
    !Array.isArray(value.units) ||
    value.units.length > 24 ||
    value.units.some(
      (unit) => typeof unit !== "string" || !allowedUnits.has(unit),
    ) ||
    new Set(value.units).size !== value.units.length
  )
    throw new Error("Invalid installation recovery journal");
  for (const entries of [value.before, value.after]) {
    if (
      !entries ||
      typeof entries !== "object" ||
      Array.isArray(entries) ||
      Object.keys(entries).length > 12
    )
      throw new Error("Invalid installation files");
    for (const [slot, contents] of Object.entries(entries))
      if (
        !/^[a-zA-Z]+$/.test(slot) ||
        !(
          contents === null ||
          (typeof contents === "string" &&
            Buffer.byteLength(contents) <= 600 * 1024)
        )
      )
        throw new Error("Invalid installation file snapshot");
  }
  if (
    Object.keys(value.before).sort().join() !==
    Object.keys(value.after).sort().join()
  )
    throw new Error("Installation file sets differ");
  return value;
}
/** Called ONLY under the shared host mutation lock. Files use adapter-fixed
 * slots. Owner/key creation is deliberately irreversible: no database backup
 * or credential is ever restored/deleted to undo a failed service start.
 */
export async function reviewInstallation(store, host, candidate) {
  const pending = await store.journal();
  if (
    pending &&
    (pending.phase !== "pending" ||
      (await host.ownerState(pending.id)) !== "none")
  )
    throw new Error("Recover installation first");
  await host.preflight(candidate);
  const before = await store.snapshot(candidate);
  return { candidate, baseSha256: digest(before) };
}
async function stop(host, units) {
  for (const unit of [
    ...units.filter((value) => value === "latex-renderer-ingress.service"),
    ...units.filter((value) => value.endsWith(".timer")),
    ...units.filter(
      (value) =>
        value !== "latex-renderer-ingress.service" &&
        !value.endsWith(".timer") &&
        !value.endsWith("-manager.service"),
    ),
    ...units.filter((value) => value.endsWith("-manager.service")),
  ])
    await host.stop(unit);
  for (const unit of units)
    if (await host.active(unit)) throw new Error("Consumer did not stop");
}
async function finish(store, host, journal) {
  await stop(host, journal.units);
  await store.replace(journal.after);
  await host.validatePublished(journal.after);
  for (const unit of journal.units) await host.start(unit);
  for (const unit of journal.units)
    if (!(await host.active(unit))) throw new Error("Consumer did not start");
  await host.health(journal.after);
  for (const unit of journal.units)
    if (!(await host.active(unit)))
      throw new Error("Consumer stopped during health checks");
  if (
    digest(await store.snapshotFiles(journal.after)) !== digest(journal.after)
  )
    throw new Error("Installation changed during health checks");
  await store.saveJournal({ ...journal, phase: "committed" });
  await host.finalize?.(journal.units);
  await store.clear();
}
export async function recoverInstallation(store, host, beforeStart = false) {
  const journal = await store.journal();
  if (!journal) return { recovered: false };
  validateInstallationJournal(journal);
  await store.assertCompatible(journal); // accepts only before/after per slot
  const owner = await host.ownerState(journal.id);
  if (owner === "foreign")
    throw new Error("Installation owner changed outside transaction");
  if (journal.phase === "committed") {
    if (
      owner !== "ours" ||
      digest(await store.snapshotFiles(journal.after)) !== digest(journal.after)
    )
      throw new Error("Committed installation state does not match");
    await host.finalize?.(journal.units);
    await store.clear();
    return { recovered: true, committed: true };
  }
  if (journal.kind === "ingress") {
    if (owner !== "ours")
      throw new Error("Existing owner was changed or removed");
    if (beforeStart) {
      for (const unit of journal.units)
        if (await host.active(unit))
          throw new Error("Boot recovery requires stopped services");
    } else await stop(host, journal.units);
    await store.replace(journal.before);
    await host.validatePublished(journal.before, beforeStart);
    if (!beforeStart) {
      for (const unit of journal.units) await host.start(unit);
      for (const unit of journal.units)
        if (!(await host.active(unit)))
          throw new Error("Restored consumer did not start");
      await host.health(journal.before);
      for (const unit of journal.units)
        if (!(await host.active(unit)))
          throw new Error("Restored consumer stopped during health checks");
    }
    if (
      digest(await store.snapshotFiles(journal.before)) !==
      digest(journal.before)
    )
      throw new Error("Restored installation changed during recovery");
    await store.clear();
    return { recovered: true, rolledBack: true };
  }
  // Once the initial owner is committed, recover FORWARD using the private
  // journal. Password plaintext is not needed or stored in that journal.
  if (owner === "ours") {
    if (beforeStart) {
      for (const unit of journal.units)
        if (await host.active(unit))
          throw new Error("Boot recovery requires stopped services");
      await store.replace(journal.after);
      await host.validatePublished(journal.after, true);
      // Keep the journal until an explicit foreground recovery proves health.
      return { recovered: true, pendingHealth: true };
    }
    await finish(store, host, journal);
    return { recovered: true, committed: true };
  }
  if (journal.phase !== "pending")
    throw new Error("Committed owner is missing");
  if (beforeStart) {
    for (const unit of journal.units)
      if (await host.active(unit))
        throw new Error("Boot recovery requires stopped services");
  } else await stop(host, journal.units);
  await store.replace(journal.before);
  // Even migration without an owner may already have created a database.
  // Keep the provenance journal so the operator can resubmit credentials,
  // rather than deleting that DB or mistaking it for an unrelated fresh host.
  return { recovered: true, rolledBack: true, awaitingCredentials: true };
}
export async function applyInstallation(store, host, envelope, credentials) {
  if (
    !envelope ||
    Object.keys(envelope).sort().join() !== "baseSha256,candidate" ||
    !/^[a-f0-9]{64}$/.test(envelope.baseSha256)
  )
    throw new Error("Invalid installation approval");
  const reviewed = await reviewInstallation(store, host, envelope.candidate);
  if (reviewed.baseSha256 !== envelope.baseSha256)
    throw new Error("Installation review is stale");
  // Validate secrets/owner policy before creating keys or a journal.
  await host.validateCredentials(envelope.candidate, credentials);
  const before = await store.snapshot(envelope.candidate);
  const after = await host.files(envelope.candidate, credentials);
  const pending = await store.journal();
  if (
    pending &&
    (digest(pending.after) !== digest(after) ||
      digest(pending.before) !== digest(before))
  )
    throw new Error(
      "Pending installation differs; recover the reviewed configuration first",
    );
  const journal =
    pending ??
    validateInstallationJournal({
      format: 1,
      kind: host.kind ?? "initial",
      id: randomBytes(24).toString("hex"),
      phase: "pending",
      before,
      after,
      units: host.units(envelope.candidate),
    });
  await store.saveJournal(journal); // durable BEFORE keys, DB or file changes
  try {
    await stop(host, journal.units);
    if (journal.kind === "initial") {
      await host.ensureSecrets(envelope.candidate, credentials);
      await host.createOwner(journal.id, envelope.candidate, credentials);
    }
    if ((await host.ownerState(journal.id)) !== "ours")
      throw new Error("Initial owner was not committed");
    await store.saveJournal({ ...journal, phase: "owner-ready" });
    await finish(store, host, journal);
  } catch {
    if (journal.kind === "ingress") {
      try {
        await recoverInstallation(store, host);
      } catch {
        throw new Error("INSTALLATION_FAILED_RECOVERY_REQUIRED");
      }
      throw new Error("INGRESS_APPLY_FAILED_PREVIOUS_CONFIGURATION_RESTORED");
    }
    // Never blindly retry irreversible provisioning or delete a healthy old
    // owner. Recover explicitly via the same selected frontend or at boot.
    throw new Error("INSTALLATION_FAILED_RECOVERY_REQUIRED");
  }
  return { installed: true };
}
