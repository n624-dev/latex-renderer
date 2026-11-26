import type { DisplayLocale } from "@latex-renderer/shared/locale";
import {
  DEFAULT_RESOURCE_LIMITS,
  type ResourceLimits,
} from "@latex-renderer/shared/resource-limits";
import type { AppMessage } from "../app-messages.js";
import { english } from "../app-english.js";
import { synchronizeDisplayLocale } from "../browser-locale.js";
import {
  formatBytes,
  inspectZipCandidates,
  parseJobStatus,
  parseSourceTicket,
  readSourceLimits,
  resourceWaitLabel,
  runBoundedBatch,
  sha256Hex,
  uploadSourceZip,
  storedZipSize,
  zipSingleTex,
} from "./render-script.js";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Job = ReturnType<typeof parseJobStatus>;
let csrfToken = "";
export interface AppBrowserConfig {
  messages: Readonly<Record<AppMessage, string>>;
  jobActions: Readonly<{
    cancel: string;
    cancelConfirmation: string;
    canceled: string;
    delete: string;
    deleteConfirmation: string;
    retry: string;
  }>;
}

let appMessages: AppBrowserConfig["messages"] = english;
let jobActionLabels: AppBrowserConfig["jobActions"];

function appMessage(
  key: AppMessage,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return appMessages[key].replaceAll(
    /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
    (match, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

function appLanguage(): string {
  return typeof document === "undefined"
    ? "ja"
    : document.documentElement.lang || "en";
}

async function json(
  fetcher: Fetcher,
  path: string,
  init: RequestInit = {},
  mutationCsrf = csrfToken,
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Accept-Language", appLanguage());
  headers.set("Cache-Control", "no-store");
  const method = init.method ?? "GET";
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (mutationCsrf.length === 0)
      throw new Error(appMessage("reloadThePageToRefreshYour"));
    headers.set("X-CSRF-Token", mutationCsrf);
  }
  const response = await fetcher(path, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    ...init,
    headers,
  });
  if (!response.ok) {
    let code = "HTTP_ERROR",
      message = appMessage("theServerReturnedHttpStatus", {
        status: response.status,
      });
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Use the safe status message.
    }
    const error = new Error(message) as Error & {
      code: string;
      status: number;
    };
    error.code = code;
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : ((await response.json()) as unknown);
}

function friendly(error: unknown): { message: string; detail: string } {
  const value = error as { code?: string; message?: string },
    messages: Record<string, string> = {
      ENTRYPOINT_MISSING: appMessage("couldNotCreateThePdfSelect"),
      SOURCE_NOT_READY: appMessage("filesAreNotReadyYetWait"),
      QUEUE_FULL: appMessage("theConversionQueueIsCurrentlyBusy"),
      ACCOUNT_QUEUE_LIMIT: appMessage(
        "concurrentConversionLimitReachedWaitFor",
      ),
      USER_STORAGE_QUOTA: appMessage("storageQuotaReachedDeleteUnneededJobs"),
      STORAGE_PRESSURE: appMessage("theServerIsLowOnDisk"),
      JOB_UNAVAILABLE: appMessage("thisConversionResultHasExpiredAnd"),
      JOB_IDENTITY_REVOKED: appMessage("accessToThisConversionResultHas"),
    };
  return {
    message:
      messages[value.code ?? ""] ??
      (value.code === undefined && value.message
        ? value.message
        : appMessage("couldNotCompleteTheOperationPlease")),
    detail: [value.code, value.message].filter(Boolean).join(": "),
  };
}

function showError(error: unknown) {
  const output = document.querySelector<HTMLElement>("#app-error");
  if (!output) return;
  const shown = friendly(error);
  output.replaceChildren(document.createTextNode(shown.message));
  if (shown.detail) {
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      code = document.createElement("code");
    summary.textContent = appMessage("showTechnicalDetails");
    code.textContent = shown.detail;
    details.append(summary, code);
    output.append(details);
  }
}

function escape(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? `${value}`
        : "";
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jobStatusLabel(status: string, stages: unknown): string {
  if (typeof stages === "object" && stages !== null) {
    const s = stages as {
      pdf?: { status?: unknown };
      svg?: { status?: unknown };
    };
    if (
      s.pdf?.status === "succeeded" &&
      typeof s.svg?.status === "string" &&
      ["failed", "timeout", "canceled"].includes(s.svg.status)
    )
      return appMessage("partialSuccessPdfSucceededSvgSvgstatus", {
        svgStatus: statusLabel(s.svg.status),
      });
  }
  return statusLabel(status);
}

function statusLabel(value: string): string {
  return (
    {
      reserved: appMessage("preparing"),
      uploading: appMessage("uploading"),
      queued: appMessage("queued"),
      validating: appMessage("validating"),
      running: appMessage("converting"),
      succeeded: appMessage("succeeded"),
      failed: appMessage("failed"),
      timeout: appMessage("timedOut"),
      canceled: appMessage("canceled"),
      not_requested: appMessage("notRequested"),
      skipped: appMessage("notRun"),
      rejected: appMessage("rejected"),
      deleting: appMessage("deleting"),
      deleted: appMessage("deleted"),
      expired: appMessage("expired"),
    }[value] ?? value
  );
}

async function establishSession(fetcher: Fetcher) {
  const response = await fetcher("/auth/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) {
    location.replace(
      `/login/?return_to=${encodeURIComponent(location.pathname + location.search)}`,
    );
    return false;
  }
  const session = (await response.json()) as {
    csrfToken?: string;
    error?: { message?: string };
  };
  if (!response.ok || typeof session.csrfToken !== "string")
    throw new Error(session.error?.message ?? appMessage("couldNotSignIn"));
  csrfToken = session.csrfToken;
  const me = (await json(fetcher, "/app/api/v1/me")) as {
    isAdmin: boolean;
    displayLocale?: DisplayLocale | null;
    resolvedDisplayLocale?: string;
    sourceLimits?: unknown;
  };
  const admin = document.querySelector<HTMLElement>("#admin-link");
  if (admin) admin.hidden = !me.isAdmin;
  return me;
}

async function createSource(fetcher: Fetcher, bytes: Uint8Array, key: string) {
  const sha256 = await sha256Hex(bytes),
    value = await json(fetcher, "/app/api/v1/source-tickets", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ size: bytes.length, sha256 }),
    }),
    ticket = parseSourceTicket(value, location.origin);
  if (ticket.uploadRequired)
    await uploadSourceZip(
      fetcher,
      ticket,
      new Blob([bytes.slice().buffer], { type: "application/zip" }),
    );
  return ticket.sourceId;
}

function parseRender(value: unknown) {
  const row = value as Record<string, unknown>;
  if (
    typeof row.jobId !== "string" ||
    !/^job_[a-f0-9]{32}$/.test(row.jobId) ||
    typeof row.jobTicket !== "string" ||
    typeof row.expiresAt !== "string"
  )
    throw new Error(appMessage("invalidResponseWhenStartingConversion"));
  return {
    jobId: row.jobId,
    jobTicket: row.jobTicket,
    expiresAt: row.expiresAt,
  };
}

// Only explicit, pre-admission capacity rejections are safe to retry. Keep
// the caller's request body and idempotency key unchanged across attempts.
export async function retryRenderCapacity<T>(
  operation: () => Promise<T>,
  onWait: () => void,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const value = error as { code?: string; status?: number } | null;
      const capacity =
        (value?.code === "QUEUE_FULL" && value.status === 503) ||
        (["ACCOUNT_QUEUE_LIMIT", "USER_QUEUE_LIMIT"].includes(
          value?.code ?? "",
        ) &&
          value?.status === 429);
      if (!capacity || attempt >= 5) throw error;
      onWait();
      await wait(Math.min(8_000, 1_000 * 2 ** attempt));
    }
  }
}

async function issueAccess(
  fetcher: Fetcher,
  id: string,
  mutationCsrf = csrfToken,
) {
  return parseRender(
    await json(
      fetcher,
      `/app/api/v1/jobs/${encodeURIComponent(id)}/access-ticket`,
      {
        method: "POST",
        body: "{}",
      },
      mutationCsrf,
    ),
  );
}

async function rendererJob(fetcher: Fetcher, id: string, ticket: string) {
  const response = await fetcher(`/api/v1/jobs/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${ticket}` },
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    const error = new Error(
      appMessage("couldNotRetrieveJobStatusHttp", { status: response.status }),
    ) as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }
  return parseJobStatus(await response.json(), id);
}

export function jobTracker(
  fetcher: Fetcher,
  id: string,
  initial?: { jobTicket: string; expiresAt: string },
  mutationCsrf = csrfToken,
) {
  let credential = initial,
    refresh: Promise<{ jobTicket: string; expiresAt: string }> | undefined;
  const ticket = async (force = false) => {
    if (
      !force &&
      credential &&
      Date.parse(credential.expiresAt) - Date.now() > 60_000
    )
      return credential.jobTicket;
    refresh ??= issueAccess(fetcher, id, mutationCsrf)
      .then((next) => {
        credential = next;
        return next;
      })
      .finally(() => {
        refresh = undefined;
      });
    return (await refresh).jobTicket;
  };
  return {
    async get() {
      try {
        return await rendererJob(fetcher, id, await ticket());
      } catch (error) {
        if ((error as { status?: number }).status !== 401) throw error;
        credential = undefined;
        return rendererJob(fetcher, id, await ticket(true));
      }
    },
    clear() {
      credential = undefined;
    },
  };
}

function artifactButton(
  fetcher: Fetcher,
  tracker: ReturnType<typeof jobTracker>,
  job: Job,
  path: string,
  label: string,
) {
  const artifact = [...job.artifacts, ...job.previews].find(
    (item) => item.relativePath === path,
  );
  const requestedPage = Number(
      /^previews\/page-([1-9][0-9]{0,2})\.png$/.exec(path)?.[1],
    ),
    lazyPage =
      Number.isInteger(requestedPage) &&
      requestedPage <= (job.previewPageCount ?? 0);
  if (!artifact && !lazyPage) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = label;
  button.onclick = () => {
    button.disabled = true;
    const opensInWindow = label === "PDF" || label === appMessage("preview"),
      popup = opensInWindow ? window.open("about:blank", "_blank") : null;
    void (async () => {
      try {
        const current = await tracker.get(),
          found = [...current.artifacts, ...current.previews].find(
            (item) => item.relativePath === path,
          );
        if (!found && !lazyPage)
          throw new Error(appMessage("artifactNotFound"));
        const access = await issueAccess(fetcher, job.id),
          url =
            found?.downloadUrl ??
            `/api/v1/jobs/${encodeURIComponent(job.id)}/previews/page-${requestedPage}.png`;
        let response!: Response;
        for (let attempt = 0; attempt < 5; attempt++) {
          response = await fetcher(url, {
            headers: { Authorization: `Bearer ${access.jobTicket}` },
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
          });
          if (!lazyPage || response.status !== 503 || attempt === 4) break;
          await response.body?.cancel();
          button.textContent = appMessage("waitingForPreviewGeneration");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        if (!response.ok)
          throw new Error(
            appMessage("couldNotDownloadArtifactHttpStatus", {
              status: response.status,
            }),
          );
        const blob = await response.blob();
        if (lazyPage) {
          const published = (await tracker.get()).previews.find(
            (a) => a.relativePath === path,
          );
          if (!published || published.size !== blob.size)
            throw new Error(
              appMessage("previewVerificationMetadataDoesNotMatch"),
            );
          const digest = [
            ...new Uint8Array(
              await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
            ),
          ]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
          if (digest !== published.sha256)
            throw new Error(appMessage("previewSha256ChecksumDoesNot"));
        }
        const objectUrl = URL.createObjectURL(blob);
        if (opensInWindow && popup) {
          // The blank window was opened during the user gesture, so Safari and
          // other popup blockers do not reject the later blob navigation.
          popup.opener = null;
          popup.location.href = objectUrl;
        } else {
          const anchor = document.createElement("a");
          anchor.href = objectUrl;
          anchor.download = path.split("/").at(-1) ?? "artifact";
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
        }
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } catch (error) {
        popup?.close();
        showError(error);
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    })();
  };
  return button;
}

export function renderJobResult(
  container: HTMLElement,
  fetcher: Fetcher,
  tracker: ReturnType<typeof jobTracker>,
  job: Job,
  title: string,
  connection = "connected",
) {
  const technicalOpen =
    container.querySelector<HTMLDetailsElement>(".job-technical")?.open ??
    false;
  const svgOpen =
    container.querySelector<HTMLDetailsElement>(".svg-artifacts")?.open ??
    false;
  container.replaceChildren();
  const section = document.createElement("section"),
    heading = document.createElement("h2"),
    state = document.createElement("p"),
    actions = document.createElement("div");
  heading.textContent = title;
  state.textContent = `${statusLabel(job.status)}${resourceWaitLabel(job)}${connection === "connected" ? "" : appMessage("connectionLostReconnecting")}`;
  if (job.stages) {
    const partial =
      job.stages.pdf.status === "succeeded" &&
      ["failed", "timeout", "canceled", "skipped"].includes(
        job.stages.svg.status,
      );
    state.textContent = `${partial ? appMessage("partialSuccess") : ""}PDF: ${statusLabel(job.stages.pdf.status)} / SVG: ${statusLabel(job.stages.svg.status)}${resourceWaitLabel(job)}${connection === "connected" ? "" : appMessage("reconnecting")}`;
  }
  actions.className = "actions";
  const firstPreview = job.previews
    .filter((artifact) =>
      /^previews\/page-0*[1-9][0-9]*\.png$/.test(artifact.relativePath),
    )
    .sort(
      (left, right) =>
        Number(left.relativePath.match(/\d+/)?.[0]) -
        Number(right.relativePath.match(/\d+/)?.[0]),
    )[0]?.relativePath;
  const links: Array<readonly [string, string]> = [
    ["result.pdf", "PDF"],
    ...(firstPreview && (job.previewPageCount ?? 1) <= 1
      ? [[firstPreview, appMessage("preview")] as const]
      : []),
    ["compile.log", appMessage("log")],
    ["errors.json", appMessage("errorDetails")],
    ["svg/compile.log", appMessage("svgLog")],
    ["svg/errors.json", appMessage("svgErrorDetails")],
  ];
  for (const [path, label] of links) {
    const button = artifactButton(fetcher, tracker, job, path, label);
    if (button) actions.append(button);
  }
  if ((job.previewPageCount ?? 0) > 1) {
    const label = document.createElement("label"),
      select = document.createElement("select"),
      selected = document.createElement("span");
    label.textContent = appMessage("previewPage");
    for (let page = 1; page <= (job.previewPageCount ?? 0); page++) {
      const option = document.createElement("option");
      option.value = String(page);
      option.textContent = String(page);
      select.append(option);
    }
    select.value = container.dataset.previewPage ?? "1";
    if (!select.value) select.value = "1";
    const update = () => {
      container.dataset.previewPage = select.value;
      const button = artifactButton(
        fetcher,
        tracker,
        job,
        `previews/page-${select.value}.png`,
        appMessage("preview"),
      );
      selected.replaceChildren(...(button ? [button] : []));
    };
    select.onchange = update;
    update();
    label.append(select);
    actions.append(label, selected);
  }
  if (
    job.stages?.pdf.status === "succeeded" &&
    ["failed", "timeout", "canceled"].includes(job.stages.svg.status) &&
    ["failed", "timeout", "canceled"].includes(job.status) &&
    job.stages.svg.attempt < 8 &&
    job.retentionExpiresAt !== null &&
    Date.parse(job.retentionExpiresAt) > Date.now()
  ) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "secondary";
    let fullRetry =
      job.errorCode === "SVG_RUNTIME_CHANGED" ||
      job.stages.svg.errorCode === "SVG_RUNTIME_CHANGED";
    retry.textContent = fullRetry
      ? appMessage("generatePdfAndSvgInA")
      : appMessage("retrySvgOnly");
    const key = crypto.randomUUID();
    retry.onclick = () => {
      retry.disabled = true;
      void json(
        fetcher,
        `/app/api/v1/jobs/${encodeURIComponent(job.id)}/${fullRetry ? "retry" : "retry-svg"}`,
        { method: "POST", headers: { "Idempotency-Key": key }, body: "{}" },
      )
        .then((value) => {
          const ticket = parseRender(value);
          if (fullRetry) {
            location.assign(`/app/jobs/${encodeURIComponent(ticket.jobId)}/`);
            return;
          }
          return followJob(fetcher, job.id, container, title, ticket);
        })
        .catch((error: unknown) => {
          retry.disabled = false;
          if (
            (error as { code?: string } | null)?.code === "SVG_RUNTIME_CHANGED"
          ) {
            fullRetry = true;
            retry.textContent = appMessage("generatePdfAndSvgInA");
          }
          showError(error);
        });
    };
    actions.append(retry);
  }
  const svgArtifacts = job.artifacts.filter(
    (artifact) => artifact.type === "svg" || artifact.type === "svg_manifest",
  );
  if (svgArtifacts.length > 0) {
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      list = document.createElement("div");
    summary.textContent = appMessage("svgArtifactsCount", {
      count: svgArtifacts.length,
    });
    details.className = "svg-artifacts";
    details.open = svgOpen;
    list.className = "actions";
    for (const artifact of svgArtifacts) {
      const button = artifactButton(
        fetcher,
        tracker,
        job,
        artifact.relativePath,
        artifact.type === "svg_manifest"
          ? "manifest.json"
          : (artifact.relativePath.split("/").at(-1) ?? "SVG"),
      );
      if (button) list.append(button);
    }
    details.append(summary, list);
    actions.append(details);
  }
  const detail = document.createElement("details"),
    summary = document.createElement("summary"),
    code = document.createElement("code");
  summary.textContent = appMessage("showTechnicalDetails");
  detail.className = "job-technical";
  detail.open = technicalOpen;
  code.textContent = [
    appMessage("jobIdId", { id: job.id }),
    job.engine ? appMessage("engineEngine", { engine: job.engine ?? "" }) : "",
    job.runtimeDigest ? `Runtime: ${job.runtimeDigest}` : "",
    job.previousRuntimeDigest
      ? appMessage("previousRuntimeDigest", {
          digest: job.previousRuntimeDigest ?? "",
        })
      : "",
    job.errorCode ? `${job.errorCode}: ${job.errorMessage ?? ""}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  detail.append(summary, code);
  section.append(heading, state);
  if (job.previousRuntimeDigest) {
    const runtimeChange = document.createElement("p");
    runtimeChange.textContent = appMessage("thisRerunUsedADifferentTex");
    section.append(runtimeChange);
  }
  section.append(actions, detail);
  container.append(section);
}

async function followJob(
  fetcher: Fetcher,
  id: string,
  container: HTMLElement,
  title: string,
  initial?: { jobTicket: string; expiresAt: string },
  onStatus?: (status: string) => void,
) {
  const tracker = jobTracker(fetcher, id, initial);
  let failures = 0,
    last: Job | undefined;
  for (;;) {
    try {
      last = await tracker.get();
      failures = 0;
      renderJobResult(container, fetcher, tracker, last, title);
      onStatus?.(last.status);
      if (
        [
          "succeeded",
          "failed",
          "timeout",
          "canceled",
          "rejected",
          "deleted",
          "expired",
        ].includes(last.status)
      )
        return true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      failures += 1;
      if (last)
        renderJobResult(
          container,
          fetcher,
          tracker,
          last,
          title,
          "reconnecting",
        );
      else
        container.textContent = appMessage(
          "lostConnectionToTheConversionService",
        );
      if (failures >= 8) {
        showError(error);
        return false;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10_000, 500 * 2 ** failures)),
      );
    }
  }
}

async function loadJobs(fetcher: Fetcher, container: HTMLElement, limit = 50) {
  let cursor: string | null = null;
  const render = (items: Array<Record<string, unknown>>, hasMore: boolean) => {
    if (items.length === 0) {
      container.textContent = appMessage("noConversionHistory");
      return;
    }
    container.innerHTML = `<div class="table-wrap"><table class="responsive-table"><thead><tr><th>${escape(appMessage("document"))}</th><th>${escape(appMessage("project"))}</th><th>${escape(appMessage("status"))}</th><th>${escape(appMessage("date"))}</th><th>${escape(appMessage("actions"))}</th></tr></thead><tbody>${items
      .map(
        (item) =>
          `<tr><td data-label="${escape(appMessage("document"))}">${escape(item.documentName)}</td><td data-label="${escape(appMessage("project"))}">${escape(item.projectName ?? "—")}</td><td data-label="${escape(appMessage("status"))}">${escape(jobStatusLabel(String(item.status), item.stages))}</td><td data-label="${escape(appMessage("date"))}">${escape(new Date(String(item.createdAt)).toLocaleString(appLanguage()))}</td><td data-label="${escape(appMessage("actions"))}"><a class="button secondary" href="/app/jobs/${encodeURIComponent(String(item.id))}/">${escape(appMessage("result"))}</a></td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div>${hasMore ? `<div class="actions"><button type="button" class="secondary" id="app-jobs-next">${escape(appMessage("nextPage"))}</button></div>` : ""}`;
    const next = document.querySelector<HTMLButtonElement>("#app-jobs-next");
    if (next)
      next.onclick = () => {
        if (next.disabled) return;
        next.disabled = true;
        void loadPage(true).catch((error: unknown) => {
          if (next.isConnected) next.disabled = false;
          showError(error);
        });
      };
  };
  let items: Array<Record<string, unknown>> = [];
  const loadPage = async (append = false) => {
    const query = new URLSearchParams({ pageSize: String(limit) });
    if (cursor) query.set("cursor", cursor);
    const value = (await json(fetcher, `/app/api/v1/jobs?${query}`)) as {
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    items = append ? [...items, ...value.items] : value.items;
    cursor = value.nextCursor;
    render(items, value.hasMore);
  };
  await loadPage();
}

function installRender(
  fetcher: Fetcher,
  limits: Readonly<ResourceLimits> = DEFAULT_RESOURCE_LIMITS,
) {
  const form = document.querySelector<HTMLFormElement>("#app-render-form"),
    input = document.querySelector<HTMLInputElement>("#app-files"),
    svgOutput = document.querySelector<HTMLInputElement>("#app-render-svg"),
    options = document.querySelector<HTMLDetailsElement>("#app-render-options"),
    engineSelect =
      document.querySelector<HTMLSelectElement>("#app-render-engine"),
    engineNotice = document.querySelector<HTMLElement>(
      "#app-render-engine-notice",
    ),
    start = document.querySelector<HTMLButtonElement>("#app-render-start"),
    projectName = document.querySelector<HTMLInputElement>("#app-project-name"),
    projectSelect = document.querySelector<HTMLSelectElement>(
      "#app-project-select",
    ),
    projectNameField = document.querySelector<HTMLElement>(
      "#app-project-name-field",
    ),
    choices = document.querySelector<HTMLElement>("#app-entrypoints"),
    results = document.querySelector<HTMLElement>("#app-render-results"),
    items = document.querySelector<HTMLElement>("#app-render-items"),
    recent = document.querySelector<HTMLElement>("#app-recent-jobs"),
    drop = document.querySelector<HTMLElement>("#app-drop-zone");
  if (
    !form ||
    !input ||
    !svgOutput ||
    !start ||
    !projectName ||
    !projectSelect ||
    !projectNameField ||
    !choices ||
    !results ||
    !items ||
    !recent
  )
    return;
  type Task = {
    label: string;
    original: string;
    entrypoint: string;
    bytes: Uint8Array;
    selected: boolean;
  };
  let tasks: Task[] = [],
    generation = 0,
    busy = false;
  const updateStart = () => {
    start.disabled = busy || !tasks.some((task) => task.selected);
  };
  const inspect = async () => {
    const current = ++generation;
    tasks = [];
    choices.replaceChildren();
    choices.hidden = true;
    updateStart();
    try {
      const files = [...(input.files ?? [])];
      if (files.length === 0) return;
      const assertUploadSize = (bytes: number) => {
        if (bytes > limits.maxUploadBytes)
          throw new Error(
            appMessage("zipArchiveSizeLimit", {
              limit: formatBytes(limits.maxUploadBytes),
            }),
          );
      };
      let inspectedTasks: Task[];
      if (files.length === 1 && files[0]?.name.toLowerCase().endsWith(".zip")) {
        const file = files[0];
        assertUploadSize(file.size);
        const bytes = new Uint8Array(await file.arrayBuffer()),
          inspected = inspectZipCandidates(bytes, limits),
          entrypoints = inspected.hasMainTex
            ? ["main.tex"]
            : inspected.texFiles;
        inspectedTasks = entrypoints.map((entrypoint) => ({
          label: entrypoint,
          original: file.name,
          entrypoint,
          bytes,
          selected: inspected.hasMainTex || entrypoints.length === 1,
        }));
      } else {
        if (files.some((file) => !file.name.toLowerCase().endsWith(".tex")))
          throw new Error(appMessage("whenSelectingMultipleFilesSelectOnly"));
        inspectedTasks = new Array<Task>(files.length);
        await runBoundedBatch(files, 3, async (file, index) => {
          if (current !== generation) return;
          assertUploadSize(
            storedZipSize([{ name: "main.tex", size: file.size }]),
          );
          const bytes = zipSingleTex(new Uint8Array(await file.arrayBuffer()));
          inspectedTasks[index] = {
            label: file.name,
            original: file.name,
            entrypoint: "main.tex",
            bytes,
            selected: true,
          };
        });
      }
      if (current !== generation) return;
      tasks = inspectedTasks;
      projectName.value ||= (files[0]?.name ?? appMessage("document")).replace(
        /\.(?:zip|tex)$/i,
        "",
      );
      choices.replaceChildren();
      if (tasks.length > 1) {
        choices.hidden = false;
        const heading = document.createElement("strong");
        heading.textContent =
          files.length === 1
            ? appMessage("whichDocumentDoYouWantTo")
            : appMessage("documentToConvert");
        choices.append(heading);
        tasks.forEach((task) => {
          const label = document.createElement("label"),
            checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = task.selected;
          checkbox.onchange = () => {
            task.selected = checkbox.checked;
            updateStart();
          };
          label.append(checkbox, document.createTextNode(` ${task.label}`));
          choices.append(label);
        });
      } else choices.hidden = true;
      updateStart();
    } catch (error) {
      if (current !== generation) return;
      tasks = [];
      start.disabled = true;
      showError(error);
    }
  };
  input.onchange = () => void inspect();
  void inspect();
  if (options && engineSelect) {
    let loaded = false;
    const svgSupport = new Map<string, boolean>();
    engineSelect.onchange = () => {
      svgOutput.disabled = svgSupport.get(engineSelect.value) === false;
      if (engineNotice) engineNotice.hidden = !svgOutput.disabled;
    };
    options.ontoggle = () => {
      if (!options.open || loaded) return;
      loaded = true;
      void json(fetcher, "/app/api/v1/environment")
        .then((raw) => {
          const { engines, engineOutputs } = raw as {
            engines?: string[];
            engineOutputs?: Array<{ engine: string; svg: boolean }>;
          };
          for (const { engine, svg } of engineOutputs ?? [])
            svgSupport.set(engine, svg);
          for (const engine of new Set(engines ?? [])) {
            if (engine !== "lualatex")
              engineSelect.add(new Option(engine, engine));
          }
          engineSelect.dispatchEvent(new Event("change"));
        })
        .catch(() => {
          loaded = false;
        });
    };
  }
  projectSelect.onchange = () => {
    projectNameField.hidden = projectSelect.value !== "";
  };
  void (async () => {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ pageSize: "100" });
      if (cursor) query.set("cursor", cursor);
      const value = (await json(fetcher, `/app/api/v1/projects?${query}`)) as {
        items: Array<{ id: string; displayName: string }>;
        hasMore: boolean;
        nextCursor: string | null;
      };
      for (const project of value.items) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = project.displayName;
        projectSelect.append(option);
      }
      if (!value.hasMore) break;
      if (!value.nextCursor || seen.has(value.nextCursor))
        throw new Error("Project pagination did not advance");
      cursor = value.nextCursor;
      seen.add(cursor);
    } while (cursor);
  })().catch(showError);
  if (drop) {
    drop.ondragover = (event) => event.preventDefault();
    drop.ondrop = (event) => {
      event.preventDefault();
      if (event.dataTransfer?.files) {
        input.files = event.dataTransfer.files;
        void inspect();
      }
    };
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    const selected = tasks
      .filter((task) => task.selected)
      .map((task) => ({ ...task }));
    if (selected.length === 0) return;
    const projectId = projectSelect.value,
      name = projectName.value.trim(),
      engine = engineSelect?.value ?? "lualatex",
      outputs =
        svgOutput.checked && !svgOutput.disabled ? ["pdf", "svg"] : ["pdf"];
    busy = true;
    updateStart();
    results.hidden = false;
    items.replaceChildren();
    const cards = selected.map((task) => {
      const container = document.createElement("div");
      container.className = "render-result-card";
      container.textContent = appMessage("taskWaitingToStart", {
        task: task.label,
      });
      items.append(container);
      return { task, container };
    });
    // Every entrypoint from a ZIP retains the same immutable byte array.
    // Share even a rejected promise, so a failed upload cannot cause a storm.
    const sources = new Map<Uint8Array, Promise<string>>();
    let trackingLost = false;
    void runBoundedBatch(cards, 3, async ({ task, container }) => {
      if (trackingLost) {
        container.textContent = appMessage("taskTheStatusCheckWasInterrupted", {
          task: task.label,
        });
        return;
      }
      container.textContent = appMessage("preparingTask", { task: task.label });
      try {
        let sourcePromise = sources.get(task.bytes);
        if (!sourcePromise) {
          sourcePromise = createSource(
            fetcher,
            task.bytes,
            `app-source-${crypto.randomUUID()}`,
          );
          sources.set(task.bytes, sourcePromise);
        }
        const source = await sourcePromise,
          project = projectId
            ? { id: projectId }
            : ((await json(fetcher, "/app/api/v1/projects", {
                method: "POST",
                body: JSON.stringify({
                  displayName:
                    selected.length === 1
                      ? name || task.label
                      : `${name || appMessage("document")} - ${task.label}`,
                }),
              })) as { id: string });
        const request = {
          method: "POST",
          headers: {
            "Idempotency-Key": `app-job-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            sourceId: source,
            entrypoint: task.entrypoint,
            projectId: project.id,
            displayName: task.label,
            originalFilename: task.original,
            ...(engine !== "lualatex" ? { engine } : {}),
            outputs,
          }),
        };
        const ticket = parseRender(
          await retryRenderCapacity(
            () => json(fetcher, "/app/api/v1/render-tickets", request),
            () => {
              container.textContent = appMessage(
                "taskServerBusyWaitingToRetry",
                { task: task.label },
              );
            },
          ),
        );
        history.replaceState(null, "", `/app/jobs/${ticket.jobId}/`);
        if (
          !(await followJob(
            fetcher,
            ticket.jobId,
            container,
            task.label,
            ticket,
          ))
        ) {
          trackingLost = true;
        }
      } catch (error) {
        container.textContent = appMessage("taskCouldNotStartConversion", {
          task: task.label,
        });
        showError(error);
      }
    })
      .catch(showError)
      .finally(() => {
        busy = false;
        updateStart();
        void loadJobs(fetcher, recent, 5).catch(showError);
      });
  };
  void loadJobs(fetcher, recent, 5).catch(showError);
}

function installJob(fetcher: Fetcher) {
  const container = document.querySelector<HTMLElement>("#app-job-detail"),
    match = /^\/app\/jobs\/(job_[a-f0-9]{32})\/$/.exec(location.pathname);
  const id = match?.[1];
  if (!container || !id) return;
  const path = `/app/api/v1/jobs/${id}`;
  const retryKey = crypto.randomUUID();
  const panel = document.createElement("div");
  const feedback = document.createElement("p");
  const controls = document.createElement("div");
  panel.className = "stack";
  feedback.setAttribute("role", "status");
  controls.className = "actions";
  panel.append(controls, feedback);
  container.after(panel);
  let pending = false;
  let lastStatus = "";
  const updateActions = (status: string) => {
    if (status === lastStatus) return;
    lastStatus = status;
    controls.replaceChildren();
    const add = (
      label: string,
      action: () => Promise<void>,
      prompt?: string,
    ) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = label;
      button.disabled = pending;
      button.onclick = () => {
        if (pending || (prompt && !window.confirm(prompt))) return;
        pending = true;
        controls.querySelectorAll("button").forEach((item) => {
          item.disabled = true;
        });
        void action()
          .catch(showError)
          .finally(() => {
            pending = false;
            controls.querySelectorAll("button").forEach((item) => {
              item.disabled = false;
            });
          });
      };
      controls.append(button);
    };
    const terminal = ["succeeded", "failed", "timeout", "canceled", "rejected"];
    if (
      ["reserved", "uploading", "queued", "validating", "running"].includes(
        status,
      )
    ) {
      add(
        jobActionLabels.cancel,
        async () => {
          await json(fetcher, `${path}/cancel`, { method: "POST", body: "{}" });
          feedback.textContent = jobActionLabels.canceled;
        },
        jobActionLabels.cancelConfirmation,
      );
    }
    if (terminal.includes(status)) {
      add(jobActionLabels.retry, async () => {
        const result = parseRender(
          await json(fetcher, `${path}/retry`, {
            method: "POST",
            headers: { "Idempotency-Key": retryKey },
            body: "{}",
          }),
        );
        location.assign(`/app/jobs/${encodeURIComponent(result.jobId)}/`);
      });
    }
    if (terminal.includes(status) || status === "expired") {
      add(
        jobActionLabels.delete,
        async () => {
          await json(fetcher, path, { method: "DELETE" });
          location.assign("/app/jobs/");
        },
        jobActionLabels.deleteConfirmation,
      );
    }
  };
  void (async () => {
    try {
      const meta = (await json(fetcher, path)) as {
        entrypoint: string;
        status: string;
      };
      updateActions(meta.status);
      if (["expired", "deleting", "deleted"].includes(meta.status)) {
        container.textContent = statusLabel(meta.status);
        return;
      }
      await followJob(
        fetcher,
        id,
        container,
        meta.entrypoint,
        undefined,
        updateActions,
      );
    } catch (error) {
      showError(error);
      container.textContent = appMessage("couldNotLoadConversionResult");
    }
  })();
}

function installProjects(fetcher: Fetcher) {
  const list = document.querySelector<HTMLElement>("#app-projects"),
    create = document.querySelector<HTMLFormElement>("#app-project-create"),
    detail = document.querySelector<HTMLElement>("#app-project-detail");
  const load = async () => {
    if (!list) return;
    let cursor: string | null = null,
      items: Array<{
        id: string;
        displayName: string;
        revisionCount: number;
        updatedAt: string;
      }> = [];
    const loadPage = async (append = false) => {
      const query = new URLSearchParams({ pageSize: "50" });
      if (cursor) query.set("cursor", cursor);
      const value = (await json(fetcher, `/app/api/v1/projects?${query}`)) as {
        items: typeof items;
        nextCursor: string | null;
        hasMore: boolean;
      };
      items = append ? [...items, ...value.items] : value.items;
      cursor = value.nextCursor;
      list.innerHTML = items.length
        ? `<div class="grid">${items.map((project) => `<article><h2>${escape(project.displayName)}</h2><p>${escape(appMessage("countRevisionsDate", { count: project.revisionCount, date: new Date(project.updatedAt).toLocaleString(appLanguage()) }))}</p><a class="button secondary" href="/app/projects/${encodeURIComponent(project.id)}/">${escape(appMessage("open"))}</a></article>`).join("")}</div>${value.hasMore ? `<div class="actions"><button type="button" class="secondary" id="app-projects-next">${escape(appMessage("nextPage"))}</button></div>` : ""}`
        : appMessage("noProjectsYet");
      const next =
        document.querySelector<HTMLButtonElement>("#app-projects-next");
      if (next)
        next.onclick = () => {
          if (next.disabled) return;
          next.disabled = true;
          void loadPage(true).catch((error: unknown) => {
            if (next.isConnected) next.disabled = false;
            showError(error);
          });
        };
    };
    await loadPage();
  };
  if (create) {
    create.onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(create);
      void json(fetcher, "/app/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ displayName: data.get("displayName") }),
      })
        .then(() => {
          create.reset();
          return load();
        })
        .catch(showError);
    };
    void load().catch(showError);
  }
  if (detail) {
    const match = /^\/app\/projects\/(project_[a-f0-9]{32})\/$/.exec(
      location.pathname,
    );
    const projectId = match?.[1];
    if (!projectId) return;
    let revisionCursor: string | null = null,
      project: {
        displayName: string;
        revisions: Array<{
          id: string;
          revisionNumber: number;
          displayName: string;
          originalFilename: string;
          entrypoint: string;
          engine?: string;
          createdAt: string;
          jobs: Array<{
            id: string;
            status: string;
            createdAt: string;
            outputs?: string[];
            stages?: Job["stages"];
          }>;
          jobCount: number;
          jobsHasMore: boolean;
          jobsNextCursor: string | null;
        }>;
        revisionsHasMore: boolean;
      } | null = null;
    const pendingJobPages = new Set<string>();
    const pendingRenders = new Set<string>();
    let pendingRevisionPage = false;
    const loadDetail = async (append = false) => {
      if (append && (!project?.revisionsHasMore || !revisionCursor)) return;
      if (pendingRevisionPage) return;
      pendingRevisionPage = true;
      const query = new URLSearchParams({ pageSize: "50" });
      if (append && revisionCursor) query.set("cursor", revisionCursor);
      let raw: unknown;
      try {
        raw = await json(fetcher, `/app/api/v1/projects/${projectId}?${query}`);
      } finally {
        pendingRevisionPage = false;
      }
      const value = raw as typeof project & {
        revisionsNextCursor: string | null;
        revisionsHasMore: boolean;
      };
      if (!append || project === null) project = value;
      else
        project = {
          ...value,
          revisions: [...project.revisions, ...value.revisions],
        };
      revisionCursor = value.revisionsNextCursor;
      renderDetail();
    };
    const renderDetail = () => {
      if (!project) return;
      const rerenderChoices = new Map(
        [
          ...detail.querySelectorAll<HTMLSelectElement>(
            'select[id^="outputs-"]',
          ),
        ].map((select) => [select.id, select.value] as const),
      );
      const currentProject = project;
      detail.innerHTML = `<div class="hero"><h1>${escape(project.displayName)}</h1><a class="button secondary" href="/app/projects/${encodeURIComponent(projectId)}/edit/">${escape(appMessage("editTex"))}</a></div>${
        project.revisions
          .map(
            (revision) =>
              `<section><div class="page-heading"><div><h2>${escape(appMessage("revisionRevisionName", { revision: revision.revisionNumber, name: revision.displayName }))}</h2><p>${escape(revision.originalFilename)}・${escape(revision.engine ?? "lualatex")}・${escape(new Date(revision.createdAt).toLocaleString(appLanguage()))}</p></div><label>${escape(appMessage("outputFormat"))}<select id="outputs-${escape(revision.id)}"><option value="">${escape(appMessage("revisionDefault"))}</option><option value="pdf">PDF</option><option value="svg">PDF＋SVG</option></select></label><button type="button" class="secondary" data-rerender="${escape(revision.id)}">${escape(appMessage("convertAgain"))}</button><a class="button secondary" href="/app/projects/${encodeURIComponent(projectId)}/edit/?revision=${encodeURIComponent(revision.id)}">${escape(appMessage("editFromThisRevision"))}</a></div><ul>${revision.jobs.map((job) => `<li>${escape(jobStatusLabel(job.status, job.stages))}・${escape((job.outputs ?? []).join("＋").toUpperCase())} <a href="/app/jobs/${encodeURIComponent(job.id)}/">${escape(new Date(job.createdAt).toLocaleString(appLanguage()))}</a></li>`).join("") || `<li>${escape(appMessage("noConversionHistory"))}</li>`}</ul>${revision.jobsHasMore && revision.jobsNextCursor ? `<div class="actions"><button type="button" class="secondary" data-revision-jobs-next="${escape(revision.id)}">${escape(appMessage("showMoreHistoryForThisRevision"))}</button><span class="muted">${escape(appMessage("countTotal", { count: revision.jobs.length, total: revision.jobCount }))}</span></div>` : ""}</section>`,
          )
          .join("") ||
        `<section>${escape(appMessage("noRevisionsYet"))}</section>`
      }${project.revisionsHasMore ? `<div class="actions"><button type="button" class="secondary" id="app-revisions-next">${escape(appMessage("nextRevisionsPage"))}</button></div>` : ""}`;
      for (const button of detail.querySelectorAll<HTMLButtonElement>(
        "[data-revision-jobs-next]",
      )) {
        button.disabled = pendingJobPages.has(
          button.dataset.revisionJobsNext ?? "",
        );
        button.onclick = () => {
          if (button.disabled) return;
          const revision = currentProject.revisions.find(
            (item) => item.id === button.dataset.revisionJobsNext,
          );
          if (
            !revision?.jobsHasMore ||
            !revision.jobsNextCursor ||
            pendingJobPages.has(revision.id)
          )
            return;
          pendingJobPages.add(revision.id);
          button.disabled = true;
          const query = new URLSearchParams({
            pageSize: "50",
            cursor: revision.jobsNextCursor,
          });
          void json(
            fetcher,
            `/app/api/v1/projects/${projectId}/revisions/${encodeURIComponent(revision.id)}/jobs?${query}`,
          )
            .then((raw) => {
              const page = raw as {
                items: typeof revision.jobs;
                hasMore: boolean;
                nextCursor: string | null;
              };
              // Another revision page may have been loaded while waiting.
              // The revision object itself remains in the accumulated list.
              const known = new Set(revision.jobs.map((job) => job.id));
              revision.jobs.push(
                ...page.items.filter((job) => !known.has(job.id)),
              );
              revision.jobsHasMore = page.hasMore;
              revision.jobsNextCursor = page.nextCursor;
              pendingJobPages.delete(revision.id);
              renderDetail();
              detail
                .querySelector<HTMLButtonElement>(
                  `[data-revision-jobs-next="${CSS.escape(revision.id)}"], [data-rerender="${CSS.escape(revision.id)}"]`,
                )
                ?.focus();
            })
            .catch((error: unknown) => {
              pendingJobPages.delete(revision.id);
              const current = detail.querySelector<HTMLButtonElement>(
                `[data-revision-jobs-next="${CSS.escape(revision.id)}"]`,
              );
              if (current) current.disabled = false;
              showError(error);
            });
        };
      }
      for (const button of detail.querySelectorAll<HTMLButtonElement>(
        "[data-rerender]",
      )) {
        button.disabled = pendingRenders.has(button.dataset.rerender ?? "");
        button.onclick = () => {
          const revisionId = button.dataset.rerender;
          if (!revisionId || pendingRenders.has(revisionId)) return;
          pendingRenders.add(revisionId);
          button.disabled = true;
          const output = detail.querySelector<HTMLSelectElement>(
            `#outputs-${CSS.escape(revisionId)}`,
          )?.value;
          void json(
            fetcher,
            `/app/api/v1/projects/${projectId}/revisions/${encodeURIComponent(revisionId)}/render`,
            {
              method: "POST",
              headers: {
                "Idempotency-Key": `app-rerender-${crypto.randomUUID()}`,
              },
              body: JSON.stringify(
                output
                  ? { outputs: output === "svg" ? ["pdf", "svg"] : ["pdf"] }
                  : {},
              ),
            },
          )
            .then((value) => {
              const ticket = parseRender(value);
              location.assign(`/app/jobs/${encodeURIComponent(ticket.jobId)}/`);
            })
            .catch((error: unknown) => {
              pendingRenders.delete(revisionId);
              const current = detail.querySelector<HTMLButtonElement>(
                `[data-rerender="${CSS.escape(revisionId)}"]`,
              );
              if (current) current.disabled = false;
              showError(error);
            });
        };
      }
      const heading = detail.querySelector("h1");
      if (heading) {
        const actions = document.createElement("div"),
          rename = document.createElement("button"),
          remove = document.createElement("button");
        actions.className = "actions";
        rename.type = "button";
        rename.className = "secondary";
        rename.textContent = appMessage("rename");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = appMessage("deleteProject");
        rename.onclick = () => {
          const next = prompt(
            appMessage("newProjectName2"),
            currentProject.displayName,
          )?.trim();
          if (!next) return;
          void json(fetcher, `/app/api/v1/projects/${projectId}`, {
            method: "PATCH",
            body: JSON.stringify({ displayName: next }),
          })
            .then(() => location.reload())
            .catch(showError);
        };
        remove.onclick = () => {
          if (!confirm(appMessage("removeThisProjectFromYourList"))) return;
          void json(fetcher, `/app/api/v1/projects/${projectId}`, {
            method: "DELETE",
            body: "{}",
          })
            .then(() => location.assign("/app/projects/"))
            .catch(showError);
        };
        actions.append(rename, remove);
        heading.parentElement?.append(actions);
      }
      const nextRevision = document.querySelector<HTMLButtonElement>(
        "#app-revisions-next",
      );
      if (nextRevision) {
        nextRevision.disabled = pendingRevisionPage;
        nextRevision.onclick = () => {
          if (nextRevision.disabled) return;
          nextRevision.disabled = true;
          void loadDetail(true).catch((error: unknown) => {
            const current = document.querySelector<HTMLButtonElement>(
              "#app-revisions-next",
            );
            if (current) current.disabled = false;
            showError(error);
          });
        };
      }
      for (const [id, value] of rerenderChoices) {
        const select = detail.querySelector<HTMLSelectElement>(
          `#${CSS.escape(id)}`,
        );
        if (select) select.value = value;
      }
    };
    void loadDetail().catch(showError);
  }
}

function installEnvironment(fetcher: Fetcher) {
  const summary = document.querySelector<HTMLElement>(
    "#app-environment-summary",
  );
  if (!summary) return;
  void json(fetcher, "/app/api/v1/environment")
    .then((raw) => {
      const value = raw as {
        texliveVersion: string;
        engines: string[];
        engineOutputs?: Array<{
          engine: string;
          pdf: boolean;
          svg: boolean;
          placement: boolean;
        }>;
        shellEscape: boolean;
        networkAccess: boolean;
      };
      summary.innerHTML = `<h2>${escape(appMessage("currentEnvironment"))}</h2><dl class="details"><dt>TeX Live</dt><dd>${escape(value.texliveVersion)}</dd><dt>${escape(appMessage("engines"))}</dt><dd>${escape(value.engines.join(", "))}</dd><dt>${escape(appMessage("shellEscape"))}</dt><dd>${escape(appMessage(value.shellEscape ? "enabled" : "disabled"))}</dd><dt>${escape(appMessage("networkAccess"))}</dt><dd>${escape(appMessage(value.networkAccess ? "enabled" : "disabled"))}</dd></dl>`;
      if (value.engineOutputs?.length) {
        const features = value.engineOutputs
          .map(
            ({ engine, pdf, svg, placement }) =>
              `<tr><th scope="row">${escape(engine)}</th>${[pdf, svg, placement].map((verified) => `<td>${escape(appMessage(verified ? "verified" : "unverified"))}</td>`).join("")}</tr>`,
          )
          .join("");
        summary.insertAdjacentHTML(
          "beforeend",
          `<div class="table-wrap"><table><caption>${escape(appMessage("verificationByEngine"))}</caption><thead><tr><th>${escape(appMessage("engines"))}</th><th>PDF</th><th>SVG</th><th>${escape(appMessage("svgPlacement"))}</th></tr></thead><tbody>${features}</tbody></table></div>`,
        );
      }
    })
    .catch(showError);
  for (const [kind, formId, outputId] of [
    ["packages", "#app-package-search", "#app-package-results"],
    ["fonts", "#app-font-search", "#app-font-results"],
  ] as const) {
    const form = document.querySelector<HTMLFormElement>(formId),
      output = document.querySelector<HTMLElement>(outputId);
    if (!form || !output) continue;
    form.onsubmit = (event) => {
      event.preventDefault();
      const rawQuery = new FormData(form).get("query"),
        query = typeof rawQuery === "string" ? rawQuery : "";
      void json(
        fetcher,
        `/app/api/v1/environment/${kind}/search?query=${encodeURIComponent(query)}`,
      )
        .then((raw) => {
          const value = raw as { matches: string[] };
          output.textContent = value.matches.length
            ? value.matches.join("、")
            : appMessage("noMatchingItems");
        })
        .catch(showError);
    };
  }
}

export function installApp(
  config: AppBrowserConfig,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<void> {
  appMessages = config.messages;
  jobActionLabels = config.jobActions;
  csrfToken = "";
  const startup = establishSession(fetcher)
    .then(async (authenticated) => {
      if (!authenticated) return;
      const selected = synchronizeDisplayLocale(
        authenticated.displayLocale,
        (locale) =>
          json(fetcher, "/app/api/v1/me/locale", {
            method: "PATCH",
            body: JSON.stringify({ locale }),
          }),
        showError,
      );
      if (selected === false) return;
      const page = document.body.dataset.appPage;
      if (page === "render")
        installRender(fetcher, readSourceLimits(authenticated.sourceLimits));
      if (page === "history") {
        const history = document.querySelector<HTMLElement>("#app-history");
        if (history) void loadJobs(fetcher, history).catch(showError);
        installJob(fetcher);
      }
      if (page === "projects") installProjects(fetcher);
      if (page === "environment") installEnvironment(fetcher);
      if (page === "editor") {
        const path =
          document.getElementById("app-editor-script")?.dataset
            .editorEntrypoint ?? "/app/assets/editor.js";
        const editor = (await import(
          path
        )) as typeof import("../editor/index.js");
        await editor.installEditor(
          (url, init) => json(fetcher, url, init),
          selected ?? authenticated.resolvedDisplayLocale,
        );
      }
    })
    .catch(showError);
  document.querySelector("#app-logout")?.addEventListener("click", () => {
    void fetcher("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": csrfToken },
    }).finally(() => location.replace("/login/"));
  });
  return startup;
}
