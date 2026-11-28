import type { AdminMessage } from "../../admin-messages.js";
import { formText, requireElement, type AdminView } from "./view.js";

interface BackupUnitState {
  active: string;
  result: string;
}

interface BackupStatus {
  backup: BackupUnitState;
  verification: BackupUnitState;
  latestVerification: { archive: string; verifiedAt: string } | null;
}

interface RetentionLimits {
  maxAgeDays: number;
  maxGenerations: number;
  maxTotalBytes: number;
}

interface RetentionPlan {
  delete: string[];
  protected: string[];
  warnings: string[];
}

interface PruneResult {
  at?: string;
  deleted?: string[];
  status: "succeeded" | "failed";
  warnings: string[];
}

interface RetentionStatus {
  schedule: string;
  policy: RetentionLimits | null;
  candidates: RetentionLimits | null;
  plan: RetentionPlan;
  proposedPlan: RetentionPlan | null;
  lastRun: PruneResult | null;
}

interface RetentionConfirmation {
  policy: RetentionLimits;
  prune: PruneResult;
}

const retentionPath = "/backups/retention";
const limitFields = [
  ["maxAgeDays", "retentionMaxAge", 1],
  ["maxGenerations", "retentionMaxGenerations", 1],
  ["maxTotalBytes", "retentionMaxBytes", 0],
] as const;
const warningMessages: Readonly<Partial<Record<string, AdminMessage>>> = {
  PROTECTED_OVER_AGE: "retentionProtectedOverAge",
  PROTECTED_OVER_GENERATIONS: "retentionProtectedOverGenerations",
  PROTECTED_OVER_BYTES: "retentionProtectedOverBytes",
};

export function createBackups({
  adminMessage,
  adminAction,
  bindAction,
  confirmDialog,
  err,
  esc,
  fmt,
  jsonBody,
  out,
  request,
  section,
}: AdminView) {
  const label = (key: AdminMessage) => esc(adminMessage(key));

  function archiveList(archives: string[]) {
    return `<ul>${archives.map((archive) => `<li>${esc(archive)}</li>`).join("")}</ul>`;
  }

  function warnings(codes: string[]) {
    return codes.length
      ? `<div class="notice warning"><strong>${label("errorsAndWarnings")}</strong>
          <ul>${codes
            .map((code) => {
              const key = Object.hasOwn(warningMessages, code)
                ? warningMessages[code]
                : undefined;
              return `<li>${key ? label(key) : esc(code)}</li>`;
            })
            .join("")}</ul></div>`
      : "";
  }

  function planSummary(plan: RetentionPlan) {
    return `<p><strong>${label("retentionDeletionList")}</strong></p>
      ${plan.delete.length ? archiveList(plan.delete) : `<p>${label("retentionNoDeletions")}</p>`}
      <p>${label("retentionProtection")}</p>
      ${plan.protected.length ? archiveList(plan.protected) : ""}
      ${warnings(plan.warnings)}`;
  }

  function runDetails(run: PruneResult) {
    const deleted = run.deleted?.length
      ? `<p>${label("retentionDeletedArchives")}</p>${archiveList(run.deleted)}`
      : `<p>${label("retentionNoDeletedArchives")}</p>`;
    return `${run.at ? `<p>${esc(fmt(run.at))}</p>` : ""}
      ${run.deleted ? deleted : ""}
      ${warnings(run.warnings)}`;
  }

  function limitsSummary(limits: RetentionLimits) {
    return esc(adminMessage("retentionLimitsSummary", { ...limits }));
  }

  function backupControls(status: BackupStatus) {
    const stateLabel = ({ active, result }: BackupUnitState) =>
      active === "activating" || active === "active"
        ? adminMessage("running")
        : result === "success"
          ? adminMessage("queued")
          : result;
    const last = status.latestVerification;
    return `<p>${esc(
      adminMessage("backupsAndVerificationStatus", {
        backupStatus: stateLabel(status.backup),
        verificationStatus: stateLabel(status.verification),
      }),
    )}</p>
      <p>${label("lastVerification")} ${last ? `${esc(fmt(last.verifiedAt))} ${esc(last.archive)}` : label("noRecord")}</p>
      <div class="actions">
        <button type="button" data-backup="create">${label("createBackup")}</button>
        <button type="button" data-backup="verify">${label("verifyLatestBackup")}</button>
      </div>`;
  }

  function retentionSummary(status: RetentionStatus) {
    const schedule =
      status.schedule === "daily"
        ? label("retentionDaily")
        : esc(status.schedule);
    return `<dl class="details">
      <dt>${label("retentionSchedule")}</dt><dd>${schedule}</dd>
      <dt>${label("retentionCurrentPolicy")}</dt><dd data-retention-policy>${status.policy ? limitsSummary(status.policy) : label("retentionUnconfirmed")}</dd>
      <dt>${label("retentionSuggestedLimits")}</dt><dd>${status.candidates ? limitsSummary(status.candidates) : label("retentionFirstBackupRequired")}</dd>
      </dl>
      <details><summary>${label("retentionCurrentPlan")}</summary>${planSummary(status.plan)}</details>
      <h4>${label("retentionLastRun")}</h4>
      ${status.lastRun ? `<p>${label(status.lastRun.status === "succeeded" ? "succeeded" : "failed")}</p>${runDetails(status.lastRun)}` : `<p>${label("noRecord")}</p>`}`;
  }

  function retentionEditor(root: HTMLElement, status: RetentionStatus) {
    const { candidates } = status;
    if (!candidates) return;
    root.insertAdjacentHTML(
      "beforeend",
      `
      <form id="retention-form" class="form-grid">
        ${limitFields
          .map(
            ([name, key, min]) => `<label>${label(key)}
          <input name="${name}" type="number" min="${min}" max="${Number.MAX_SAFE_INTEGER}" step="1" value="${esc(candidates[name])}" required>
        </label>`,
          )
          .join("")}
        <div class="wide actions"><button type="submit">${label("preview")}</button></div>
      </form>
      <div id="retention-preview" aria-live="polite"></div>
      <div class="actions"><button type="button" id="retention-confirm" disabled>${label("retentionConfirm")}</button></div>`,
    );

    const form = requireElement<HTMLFormElement>(root, "#retention-form");
    const preview = requireElement<HTMLElement>(root, "#retention-preview");
    const previewButton = requireElement<HTMLButtonElement>(
      form,
      'button[type="submit"]',
    );
    const confirmButton = requireElement<HTMLButtonElement>(
      root,
      "#retention-confirm",
    );
    const result = requireElement<HTMLElement>(root, "#retention-result");
    const summary = requireElement<HTMLElement>(root, "#retention-summary");
    let revision = 0;
    let previewed: RetentionLimits | undefined;

    function clearPreview() {
      revision++;
      previewed = undefined;
      confirmButton.disabled = true;
      preview.replaceChildren();
    }

    form.addEventListener("input", clearPreview);
    form.onsubmit = adminAction(async () => {
      clearPreview();
      err.textContent = "";
      const currentRevision = revision;
      const fields = new FormData(form);
      const limits = {
        maxAgeDays: Number(fields.get("maxAgeDays")),
        maxGenerations: Number(fields.get("maxGenerations")),
        maxTotalBytes: Number(fields.get("maxTotalBytes")),
      };
      const query = new URLSearchParams();
      for (const [name] of limitFields) query.set(name, String(limits[name]));
      previewButton.disabled = true;
      preview.textContent = adminMessage("loadingPreview");
      try {
        const { proposedPlan } = (await request(
          `${retentionPath}?${query.toString()}`,
        )) as RetentionStatus;
        if (currentRevision !== revision || !form.isConnected) return;
        if (!proposedPlan)
          throw new Error(adminMessage("theServerReturnedAnInvalidResponse"));
        preview.innerHTML = planSummary(proposedPlan);
        previewed = limits;
        confirmButton.disabled = false;
      } catch (error) {
        if (currentRevision !== revision || !form.isConnected) return;
        preview.textContent = "";
        throw error;
      } finally {
        previewButton.disabled = false;
      }
    });

    bindAction("#retention-confirm", () => {
      const limits = previewed;
      if (!limits) return;
      confirmDialog({
        title: adminMessage("retentionConfirm"),
        summary: `<p>${limitsSummary(limits)}</p><p class="notice warning">${label("retentionImmediateDeletion")}</p>`,
        reason: true,
        submitLabel: adminMessage("retentionSaveAndPrune"),
        danger: true,
        reload: false,
        onSubmit: (fields) => {
          const reason = formText(fields, "reason", "").trim();
          if (!reason) throw new Error(adminMessage("retentionReasonRequired"));
          return request(retentionPath, {
            method: "POST",
            ...jsonBody({ ...limits, reason }),
          }) as Promise<RetentionConfirmation>;
        },
        afterSuccess: ({ policy, prune }) => {
          clearPreview();
          const failed = prune.status === "failed";
          result.innerHTML = `<p class="notice ${failed ? "warning" : "success"}">${label(failed ? "retentionSavedPruneFailed" : "retentionSavedPruneSucceeded")}</p>${runDetails(prune)}`;
          requireElement<HTMLElement>(
            summary,
            "dd[data-retention-policy]",
          ).textContent = adminMessage("retentionLimitsSummary", { ...policy });
          void (request(retentionPath) as Promise<RetentionStatus>)
            .then((refreshed) => {
              summary.innerHTML = retentionSummary(refreshed);
            })
            .catch(() => {
              summary.insertAdjacentHTML(
                "beforeend",
                `<p class="notice warning">${label("retentionUnavailable")}</p>`,
              );
            });
        },
      });
    });
  }

  async function backups() {
    out.insertAdjacentHTML(
      "beforeend",
      section(adminMessage("backups"), '<div id="backups-content"></div>'),
    );
    const root = requireElement<HTMLElement>(out, "#backups-content");
    const [status, retention] = await Promise.all([
      (request("/backups/status") as Promise<BackupStatus>).catch(() => null),
      (request(retentionPath) as Promise<RetentionStatus>).catch(() => null),
    ]);
    if (!root.isConnected) return;
    root.innerHTML = `${status ? backupControls(status) : ""}
      <h3>${label("retentionTitle")}</h3>
      <div id="retention-result" aria-live="polite"></div>
      <div id="retention-summary">${retention ? retentionSummary(retention) : `<p class="notice warning">${label("retentionUnavailable")}</p>`}</div>`;
    bindAction("[data-backup]", (button) =>
      confirmDialog({
        title: button.textContent,
        onSubmit: () =>
          request(`/backups/${button.dataset.backup ?? ""}`, {
            method: "POST",
            ...jsonBody({}),
          }),
        successMessage: adminMessage("operationStartedUseRefreshToCheck"),
      }),
    );
    if (retention) retentionEditor(root, retention);
  }

  return { backups };
}
