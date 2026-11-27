"use strict";
(() => {
  const data = document.querySelector(
    'meta[name="latex-renderer-setup-copy"]',
  )?.content;
  if (!data) return;
  const { messages, diagnostics } = JSON.parse(data);
  const setupMessage = (key) => messages[key];
  const setupDiagnostic = (value) =>
    Object.hasOwn(diagnostics, value) ? diagnostics[value] : value;
  const byId = (id) => document.getElementById(id);
  const connection = byId("connection");
  const status = byId("status");
  const result = byId("result");
  let sessionToken = "";
  let csrfToken = "";
  let busy = false;

  const show = (target, value) => {
    target.textContent = JSON.stringify(value, null, 2);
    const summary = byId(
      target === status ? "status-summary" : "result-summary",
    );
    summary.replaceChildren();
    const labels = {
      healthy: setupMessage("healthy"),
      degraded: setupMessage("needsAttention"),
      not_installed: setupMessage("notInstalled"),
      pass: setupMessage("healthy"),
      warn: setupMessage("warning"),
      fail: setupMessage("failed"),
      succeeded: setupMessage("succeeded"),
      failed: setupMessage("failed"),
      timeout: setupMessage("timedOut"),
      canceled: setupMessage("canceled"),
      rejected: setupMessage("rejected"),
      queued: setupMessage("queued"),
      running: setupMessage("processing"),
    };
    const message = document.createElement("p");
    const report = value?.doctor || value?.setup || value;
    const state = value?.job?.status || report?.status;
    message.textContent =
      value?.success === false
        ? setupMessage("failurePrefix") +
          (value.message || setupMessage("operationFailed"))
        : labels[state] || setupMessage("operationCompleted");
    summary.append(message);
    if (value?.job?.errorMessage) {
      const error = document.createElement("p");
      error.textContent = value.job.errorMessage;
      summary.append(error);
    }
    const checks = Array.isArray(report?.checks) ? report.checks : [];
    if (checks.length) {
      const list = document.createElement("ul");
      const names = {
        installation: setupMessage("installation"),
        client: setupMessage("client"),
        credential: setupMessage("credentials"),
        skill: setupMessage("skillIntegration"),
        mcp: setupMessage("mcpIntegration"),
        launcher: setupMessage("launcher"),
      };
      for (const check of checks) {
        const item = document.createElement("li");
        const name =
          names[String(check.id).split(".")[0]] ||
          setupMessage("diagnosticCheck");
        item.textContent =
          name +
          ": " +
          (labels[check.status] || setupMessage("unverified")) +
          (check.status === "pass"
            ? ""
            : " — " + setupDiagnostic(check.message));
        list.append(item);
      }
      summary.append(list);
    }
  };
  const setBusy = (value) => {
    busy = value;
    for (const button of document.querySelectorAll("button"))
      button.disabled = value;
  };
  const api = async (path, body = {}) => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + sessionToken,
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok || value.success !== true)
      throw new Error(
        setupDiagnostic(value.error?.message || "Request failed"),
      );
    return value.result;
  };
  const refresh = async () => {
    const [setup, doctor] = await Promise.all([
      api("/api/status"),
      api("/api/doctor"),
    ]);
    const allowed = new Set(["both", "codex", "claude", "none"]);
    if (allowed.has(setup?.state?.skillTarget))
      byId("skill-target").value = setup.state.skillTarget;
    if (allowed.has(setup?.state?.mcpTarget))
      byId("mcp-target").value = setup.state.mcpTarget;
    show(status, { setup, doctor });
  };
  const run = async (operation, target = result) => {
    if (busy) return;
    setBusy(true);
    try {
      show(target, await operation());
      await refresh();
    } catch (error) {
      show(target, {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  const bootstrap = async () => {
    const bootstrapToken = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    if (!bootstrapToken) throw new Error(setupMessage("tokenMissing"));
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bootstrapToken }),
    });
    const value = await response.json();
    if (!response.ok || value.success !== true)
      throw new Error(value.error?.message || "Session bootstrap failed");
    sessionToken = value.result.sessionToken;
    csrfToken = value.result.csrfToken;
    connection.textContent = setupMessage("browserSetup");
    await refresh();
  };

  byId("refresh").addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refresh();
    } catch (error) {
      show(status, {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  });
  byId("save-key").addEventListener("click", () =>
    run(async () => {
      const input = byId("api-key");
      const value = await api("/api/auth", { apiKey: input.value });
      input.value = "";
      return value;
    }),
  );
  byId("remove-key").addEventListener("click", () =>
    run(() => api("/api/auth/logout")),
  );
  const targets = () => ({
    skillTarget: byId("skill-target").value,
    mcpTarget: byId("mcp-target").value,
  });
  byId("repair")?.addEventListener("click", () =>
    run(() => api("/api/repair", targets())),
  );
  byId("update")?.addEventListener("click", () =>
    run(() => api("/api/update", targets())),
  );
  byId("sample").addEventListener("click", () =>
    run(() => api("/api/sample-render")),
  );
  byId("close").addEventListener("click", async () => {
    try {
      await api("/api/close");
    } finally {
      document.body.textContent = setupMessage("closed");
    }
  });
  void bootstrap().catch((error) => {
    connection.classList.add("error");
    connection.textContent =
      error instanceof Error ? error.message : "Session bootstrap failed";
    setBusy(true);
  });
})();
