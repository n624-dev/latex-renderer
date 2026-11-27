import type { AdminMessage } from "../../admin-messages.js";

type Data = Readonly<Record<string, unknown>>;
type JobRow = Data & { id: string; status: string; created_at: string };
type Column = readonly [string, string | ((row: JobRow) => string)];

interface DashboardView {
  adminMessage: (
    key: AdminMessage,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
  locale: string;
  out: Pick<HTMLElement, "innerHTML">;
  request: (path: string) => Promise<unknown>;
  esc: (value: unknown) => string;
  section: (heading: string, content: string) => string;
  table: (
    items: readonly JobRow[],
    columns: readonly Column[],
    action: (row: JobRow) => string,
  ) => string;
  bindAction: (selector: string, action: (button: HTMLElement) => void) => void;
  details: (row: JobRow, title: string) => void;
  fmt: (value: string) => string;
  jobLabel: (value: string) => string;
}

function object(value: unknown): Data | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : undefined;
}

function rows(value: unknown): Data[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const row = object(item);
    return row === undefined ? [] : [row];
  });
}

const maintenanceLabels: Readonly<Record<string, AdminMessage>> = {
  normal: "normalOperation",
  "read-only": "readOnly",
  lockdown: "emergencyLockdown",
};
const workerLabels: Readonly<Record<string, AdminMessage>> = {
  running: "running",
  paused: "paused",
  draining: "waitingForRunningJobsToFinish",
  idle: "standbyStartsOnRequest",
  starting: "starting",
  unavailable: "unavailable",
};
const active = new Set([
  "reserved",
  "uploading",
  "queued",
  "validating",
  "running",
]);

export function createDashboard(view: DashboardView) {
  const { adminMessage: t, esc, request } = view;

  function label(
    value: unknown,
    vocabulary: Readonly<Record<string, AdminMessage>>,
  ): string {
    if (typeof value !== "string" || !value) return t("notSet");
    const key = Object.hasOwn(vocabulary, value)
      ? vocabulary[value]
      : undefined;
    return key === undefined ? value : t(key);
  }

  async function dashboard() {
    const [statusInput, jobsInput, usersInput] = await Promise.all([
      request("/system/status"),
      request("/jobs?pageSize=20"),
      request("/users?pageSize=1"),
    ]);
    const status = object(statusInput),
      jobs = object(jobsInput),
      users = object(usersInput);
    if (
      !status ||
      !jobs ||
      !users ||
      !Array.isArray(jobs.items) ||
      !Array.isArray(users.items)
    )
      throw new Error(t("theServerReturnedAnInvalidResponse"));
    const rendering = object(status.rendering);
    const workerState =
      typeof rendering?.state === "string" &&
      Object.hasOwn(workerLabels, rendering.state)
        ? rendering.state
        : status.worker;
    const httpServices = object(status.httpServices);
    const activeCount = rows(status.jobs).reduce((sum, row) => {
      if (typeof row.status !== "string" || !active.has(row.status)) return sum;
      const count =
        typeof row.count === "number" || typeof row.count === "string"
          ? Number(row.count)
          : 0;
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);
    const healthy =
      status.writeEnabled === true &&
      status.maintenance === "normal" &&
      status.worker === "running" &&
      rendering?.operational !== false &&
      !(
        httpServices?.managed === true &&
        rows(httpServices.services).some((row) => row.state === "unavailable")
      );
    const recent = rows(jobs.items)
      .filter(
        (row): row is JobRow =>
          typeof row.id === "string" &&
          typeof row.status === "string" &&
          typeof row.created_at === "string",
      )
      .slice(0, 20);
    const jobsCount = new Intl.NumberFormat(view.locale).format(
      typeof jobs.total === "number" ? jobs.total : jobs.items.length,
    );
    const usersCount =
      typeof users.total === "number" ? users.total : users.items.length;
    view.out.innerHTML =
      `<div class="grid">
<article class="card"><h2>${esc(t("users"))}</h2><p>${esc(t("itemCount", { count: usersCount }))}</p><a href="/admin/users/">${esc(t("manage"))}</a></article>
<article class="card"><h2>${esc(t("jobs"))}</h2><p>${esc(t("itemCount", { count: jobsCount }))}</p><p class="muted">${esc(t("runningOrQueuedCount", { count: activeCount }))}</p><a href="/admin/jobs/">${esc(t("review"))}</a></article>
<article class="card"><h2>${esc(t("systemStatus"))}</h2><p><span class="status ${healthy ? "active" : "failed"}">${esc(t(healthy ? "healthy" : "needsAttention"))}</span></p>
<dl class="summary-grid"><div><dt>${esc(t("maintenance"))}</dt><dd>${esc(label(status.maintenance, maintenanceLabels))}</dd></div>
<div><dt>${esc(t("worker"))}</dt><dd>${esc(label(workerState, workerLabels))}</dd></div>
<div><dt>${esc(t("writes"))}</dt><dd>${esc(t(status.writeEnabled === true ? "enabled" : "paused"))}</dd></div></dl>
<a href="/admin/system/">${esc(t("viewStatusAndSettings"))}</a></article></div>` +
      view.section(
        t("recentJobs"),
        view.table(
          recent,
          [
            ["ID", "id"],
            [t("status"), (row) => view.jobLabel(row.status)],
            [t("created"), (row) => view.fmt(row.created_at)],
          ],
          (row) =>
            `<button class="secondary" data-detail="${esc(row.id)}">${esc(t("details"))}</button>`,
        ),
      );
    view.bindAction("[data-detail]", (button) => {
      const row = recent.find(({ id }) => id === button.dataset.detail);
      if (row) view.details(row, t("jobDetails"));
    });
  }
  return { dashboard };
}
