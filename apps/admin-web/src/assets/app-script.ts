import {
  JOB_STATUSES,
  crc32,
  inspectZipCandidates,
  parseJobArtifact,
  parseJobStatus,
  parseSourceTicket,
  responseError,
  sha256Hex,
  uploadSourceZip,
  zipSingleTex,
} from "./render-script.js";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Job = ReturnType<typeof parseJobStatus>;
let csrfToken = "";

async function json(
  fetcher: Fetcher,
  path: string,
  init: RequestInit = {},
  mutationCsrf = csrfToken,
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Cache-Control", "no-store");
  const method = init.method ?? "GET";
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (mutationCsrf.length === 0)
      throw new Error("セッションを再読み込みしてください。");
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
      message = `サーバーがHTTP ${response.status}を返しました。`;
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
      ENTRYPOINT_MISSING:
        "PDFを作成できませんでした。変換するTeXファイルを選択してください。",
      SOURCE_NOT_READY:
        "ファイルの準備が完了していません。少し待ってからもう一度お試しください。",
      QUEUE_FULL:
        "現在変換が混み合っています。しばらく待ってからお試しください。",
      ACCOUNT_QUEUE_LIMIT:
        "同時に変換できる件数を超えています。実行中の変換が終わるまでお待ちください。",
      USER_STORAGE_QUOTA:
        "保存容量の上限に達しました。不要な履歴を整理してください。",
      STORAGE_PRESSURE:
        "現在サーバーの空き容量が不足しています。管理者へお問い合わせください。",
      JOB_UNAVAILABLE: "この変換結果は保存期間を過ぎたため利用できません。",
      JOB_IDENTITY_REVOKED: "この変換結果へのアクセス権が失効しました。",
    };
  return {
    message:
      messages[value.code ?? ""] ??
      (value.code === undefined && value.message
        ? value.message
        : "処理を完了できませんでした。もう一度お試しください。"),
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
    summary.textContent = "技術情報を表示";
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

function statusLabel(value: string): string {
  return (
    {
      reserved: "準備中",
      uploading: "送信中",
      queued: "待機中",
      validating: "確認中",
      running: "変換中",
      succeeded: "変換成功",
      failed: "変換失敗",
      timeout: "時間切れ",
      canceled: "中止",
      rejected: "受付不可",
      deleting: "削除中",
      deleted: "削除済み",
      expired: "保存期限切れ",
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
    throw new Error(session.error?.message ?? "ログインできませんでした。");
  csrfToken = session.csrfToken;
  const me = (await json(fetcher, "/app/api/v1/me")) as { isAdmin: boolean };
  const admin = document.querySelector<HTMLElement>("#admin-link");
  if (admin) admin.hidden = !me.isAdmin;
  return true;
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
    throw new Error("変換開始の応答形式が不正です。");
  return {
    jobId: row.jobId,
    jobTicket: row.jobTicket,
    expiresAt: row.expiresAt,
  };
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
      `ジョブ状態を取得できませんでした (HTTP ${response.status})。`,
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
  if (!artifact) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = label;
  button.onclick = () => {
    const opensInWindow = label === "PDF" || label === "プレビュー",
      popup = opensInWindow ? window.open("about:blank", "_blank") : null;
    void (async () => {
      try {
        const current = await tracker.get(),
          found = [...current.artifacts, ...current.previews].find(
            (item) => item.relativePath === path,
          );
        if (!found) throw new Error("成果物が見つかりません。");
        const access = await issueAccess(fetcher, job.id),
          response = await fetcher(found.downloadUrl, {
            headers: { Authorization: `Bearer ${access.jobTicket}` },
            cache: "no-store",
          });
        if (!response.ok)
          throw new Error(
            `成果物を取得できませんでした (HTTP ${response.status})。`,
          );
        const blob = await response.blob(),
          url = URL.createObjectURL(blob);
        if (opensInWindow && popup) {
          // The blank window was opened during the user gesture, so Safari and
          // other popup blockers do not reject the later blob navigation.
          popup.opener = null;
          popup.location.href = url;
        } else {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = path.split("/").at(-1) ?? "artifact";
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (error) {
        popup?.close();
        showError(error);
      }
    })();
  };
  return button;
}

function renderJobResult(
  container: HTMLElement,
  fetcher: Fetcher,
  tracker: ReturnType<typeof jobTracker>,
  job: Job,
  title: string,
  connection = "connected",
) {
  container.replaceChildren();
  const section = document.createElement("section"),
    heading = document.createElement("h2"),
    state = document.createElement("p"),
    actions = document.createElement("div");
  heading.textContent = title;
  state.textContent = `${statusLabel(job.status)}${connection === "connected" ? "" : " — 接続が切れました。再接続しています…"}`;
  actions.className = "actions";
  for (const [path, label] of [
    ["result.pdf", "PDF"],
    ["previews/page-1.png", "プレビュー"],
    ["compile.log", "ログ"],
    ["errors.json", "エラー詳細"],
  ] as const) {
    const button = artifactButton(fetcher, tracker, job, path, label);
    if (button) actions.append(button);
  }
  const svgArtifacts = job.artifacts.filter(
    (artifact) => artifact.type === "svg" || artifact.type === "svg_manifest",
  );
  if (svgArtifacts.length > 0) {
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      list = document.createElement("div");
    summary.textContent = `SVG成果物 (${svgArtifacts.length})`;
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
  summary.textContent = "技術情報を表示";
  code.textContent = `Job ID: ${job.id}${job.errorCode ? `\n${job.errorCode}: ${job.errorMessage ?? ""}` : ""}`;
  detail.append(summary, code);
  section.append(heading, state, actions, detail);
  container.append(section);
}

async function followJob(
  fetcher: Fetcher,
  id: string,
  container: HTMLElement,
  title: string,
  initial?: { jobTicket: string; expiresAt: string },
) {
  const tracker = jobTracker(fetcher, id, initial);
  let failures = 0,
    last: Job | undefined;
  for (;;) {
    try {
      last = await tracker.get();
      failures = 0;
      renderJobResult(container, fetcher, tracker, last, title);
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
        return;
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
        container.textContent =
          "変換処理への接続が切れました。処理は継続しているため、再接続しています…";
      if (failures >= 8) {
        showError(error);
        return;
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
      container.textContent = "変換履歴はありません。";
      return;
    }
    container.innerHTML = `<div class="table-wrap"><table><thead><tr><th>文書</th><th>プロジェクト</th><th>状態</th><th>日時</th><th></th></tr></thead><tbody>${items
      .map(
        (item) =>
          `<tr><td>${escape(item.documentName)}</td><td>${escape(item.projectName ?? "—")}</td><td>${escape(statusLabel(String(item.status)))}</td><td>${escape(new Date(String(item.createdAt)).toLocaleString("ja-JP"))}</td><td><a class="button secondary" href="/app/jobs/${encodeURIComponent(String(item.id))}/">結果</a></td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div>${hasMore ? '<div class="actions"><button type="button" class="secondary" id="app-jobs-next">次のページ</button></div>' : ""}`;
    const next = document.querySelector<HTMLButtonElement>("#app-jobs-next");
    if (next)
      next.onclick = () => {
        next.disabled = true;
        void loadPage(true).catch(showError);
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

function installRender(fetcher: Fetcher) {
  const form = document.querySelector<HTMLFormElement>("#app-render-form"),
    input = document.querySelector<HTMLInputElement>("#app-files"),
    svgOutput = document.querySelector<HTMLInputElement>("#app-render-svg"),
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
  let tasks: Task[] = [];
  const inspect = async () => {
    try {
      const files = [...(input.files ?? [])];
      if (files.length === 0) return;
      tasks = [];
      if (files.length === 1 && files[0]?.name.toLowerCase().endsWith(".zip")) {
        const file = files[0],
          bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length > 20 * 1024 * 1024)
          throw new Error("ZIPは20 MiB以下にしてください。");
        const inspected = inspectZipCandidates(bytes),
          entrypoints = inspected.hasMainTex
            ? ["main.tex"]
            : inspected.texFiles;
        tasks = entrypoints.map((entrypoint) => ({
          label: entrypoint,
          original: file.name,
          entrypoint,
          bytes,
          selected: inspected.hasMainTex || entrypoints.length === 1,
        }));
      } else {
        if (files.some((file) => !file.name.toLowerCase().endsWith(".tex")))
          throw new Error("複数選択ではTeXファイルだけを選択してください。");
        tasks = await Promise.all(
          files.map(async (file) => ({
            label: file.name,
            original: file.name,
            entrypoint: "main.tex",
            bytes: zipSingleTex(new Uint8Array(await file.arrayBuffer())),
            selected: true,
          })),
        );
      }
      projectName.value ||= (files[0]?.name ?? "文書").replace(
        /\.(?:zip|tex)$/i,
        "",
      );
      choices.replaceChildren();
      if (tasks.length > 1) {
        choices.hidden = false;
        const heading = document.createElement("strong");
        heading.textContent =
          files.length === 1 ? "どの文書をPDFにしますか？" : "変換する文書";
        choices.append(heading);
        tasks.forEach((task) => {
          const label = document.createElement("label"),
            checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = task.selected;
          checkbox.onchange = () => {
            task.selected = checkbox.checked;
            start.disabled = !tasks.some((item) => item.selected);
          };
          label.append(checkbox, document.createTextNode(` ${task.label}`));
          choices.append(label);
        });
      } else choices.hidden = true;
      start.disabled = !tasks.some((task) => task.selected);
    } catch (error) {
      tasks = [];
      start.disabled = true;
      showError(error);
    }
  };
  input.onchange = () => void inspect();
  projectSelect.onchange = () => {
    projectNameField.hidden = projectSelect.value !== "";
  };
  void json(fetcher, "/app/api/v1/projects")
    .then((raw) => {
      const value = raw as {
        items: Array<{ id: string; displayName: string }>;
      };
      for (const project of value.items) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = project.displayName;
        projectSelect.append(option);
      }
    })
    .catch(showError);
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
    const selected = tasks.filter((task) => task.selected);
    if (selected.length === 0) return;
    start.disabled = true;
    results.hidden = false;
    items.replaceChildren();
    void Promise.all(
      selected.map(async (task) => {
        const container = document.createElement("div");
        container.className = "render-result-card";
        container.textContent = `${task.label} を準備しています…`;
        items.append(container);
        try {
          const source = await createSource(
              fetcher,
              task.bytes,
              `app-source-${crypto.randomUUID()}`,
            ),
            project = projectSelect.value
              ? { id: projectSelect.value }
              : ((await json(fetcher, "/app/api/v1/projects", {
                  method: "POST",
                  body: JSON.stringify({
                    displayName:
                      selected.length === 1
                        ? projectName.value.trim() || task.label
                        : `${projectName.value.trim() || "文書"} - ${task.label}`,
                  }),
                })) as { id: string }),
            ticket = parseRender(
              await json(fetcher, "/app/api/v1/render-tickets", {
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
                  outputs: svgOutput.checked ? ["pdf", "svg"] : ["pdf"],
                }),
              }),
            );
          history.replaceState(null, "", `/app/jobs/${ticket.jobId}/`);
          await followJob(fetcher, ticket.jobId, container, task.label, ticket);
        } catch (error) {
          container.textContent = `${task.label}: 変換を開始できませんでした。`;
          showError(error);
        }
      }),
    ).finally(() => {
      start.disabled = false;
      void loadJobs(fetcher, recent, 5);
    });
  };
  void loadJobs(fetcher, recent, 5);
}

function installJob(fetcher: Fetcher) {
  const container = document.querySelector<HTMLElement>("#app-job-detail"),
    match = /^\/app\/jobs\/(job_[a-f0-9]{32})\/$/.exec(location.pathname);
  if (!container || !match) return;
  void (async () => {
    try {
      const meta = (await json(fetcher, `/app/api/v1/jobs/${match[1]}`)) as {
        entrypoint: string;
      };
      await followJob(fetcher, match[1] as string, container, meta.entrypoint);
    } catch (error) {
      showError(error);
      container.textContent = "変換結果を読み込めませんでした。";
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
        ? `<div class="grid">${items.map((project) => `<article><h2>${escape(project.displayName)}</h2><p>${project.revisionCount} 改訂・${escape(new Date(project.updatedAt).toLocaleString("ja-JP"))}</p><a class="button secondary" href="/app/projects/${encodeURIComponent(project.id)}/">開く</a></article>`).join("")}</div>${value.hasMore ? '<div class="actions"><button type="button" class="secondary" id="app-projects-next">次のページ</button></div>' : ""}`
        : "プロジェクトはありません。";
      const next =
        document.querySelector<HTMLButtonElement>("#app-projects-next");
      if (next)
        next.onclick = () => {
          next.disabled = true;
          void loadPage(true).catch(showError);
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
    void load();
  }
  if (detail) {
    const match = /^\/app\/projects\/(project_[a-f0-9]{32})\/$/.exec(
      location.pathname,
    );
    if (!match) return;
    let revisionCursor: string | null = null,
      project: {
        displayName: string;
        revisions: Array<{
          id: string;
          revisionNumber: number;
          displayName: string;
          originalFilename: string;
          entrypoint: string;
          createdAt: string;
          jobs: Array<{ id: string; status: string; createdAt: string }>;
          jobCount: number;
          jobsHasMore: boolean;
        }>;
        revisionsHasMore: boolean;
      } | null = null;
    const loadDetail = async (append = false) => {
      const query = new URLSearchParams({ pageSize: "50" });
      if (revisionCursor) query.set("cursor", revisionCursor);
      const raw = await json(
        fetcher,
        `/app/api/v1/projects/${match[1]}?${query}`,
      );
      const value = raw as typeof project & {
        revisionsNextCursor: string | null;
        revisionsHasMore: boolean;
      };
      if (!append || project === null) project = value;
      else
        project = {
          ...project,
          revisions: [...project.revisions, ...value.revisions],
        };
      revisionCursor = value.revisionsNextCursor;
      const currentProject = project;
      detail.innerHTML = `<div class="hero"><h1>${escape(project.displayName)}</h1><p class="notice warning">プロジェクトを削除すると、このプロジェクトの記録だけが一覧から消えます。紐付いたSourceとJobの入力・成果物は各自の保存期限まで残ります。完全削除が必要な場合は管理者へ相談してください。</p></div>${
        project.revisions
          .map(
            (revision) =>
              `<section><div class="page-heading"><div><h2>Revision ${revision.revisionNumber}: ${escape(revision.displayName)}</h2><p>${escape(revision.originalFilename)}・${escape(new Date(revision.createdAt).toLocaleString("ja-JP"))}</p></div><button type="button" class="secondary" data-rerender="${escape(revision.id)}">もう一度変換</button></div><ul>${revision.jobs.map((job) => `<li>${escape(statusLabel(job.status))} <a href="/app/jobs/${encodeURIComponent(job.id)}/">${escape(new Date(job.createdAt).toLocaleString("ja-JP"))}</a></li>`).join("") || "<li>変換履歴はありません。</li>"}</ul>${revision.jobCount > revision.jobs.length ? `<p class="muted">Job ${revision.jobs.length} / ${revision.jobCount}件を表示中（詳細APIのcursorで続きへ進めます）。</p>` : ""}</section>`,
          )
          .join("") || "<section>改訂はありません。</section>"
      }${project.revisionsHasMore ? '<div class="actions"><button type="button" class="secondary" id="app-revisions-next">次の改訂ページ</button></div>' : ""}`;
      for (const button of detail.querySelectorAll<HTMLButtonElement>(
        "[data-rerender]",
      ))
        button.onclick = () => {
          button.disabled = true;
          const revisionId = button.dataset.rerender;
          if (!revisionId) return;
          void json(
            fetcher,
            `/app/api/v1/projects/${match[1]}/revisions/${encodeURIComponent(revisionId)}/render`,
            {
              method: "POST",
              headers: {
                "Idempotency-Key": `app-rerender-${crypto.randomUUID()}`,
              },
              body: "{}",
            },
          )
            .then((value) => {
              const ticket = parseRender(value);
              location.assign(`/app/jobs/${encodeURIComponent(ticket.jobId)}/`);
            })
            .catch((error: unknown) => {
              button.disabled = false;
              showError(error);
            });
        };
      const heading = detail.querySelector("h1");
      if (heading) {
        const actions = document.createElement("div"),
          rename = document.createElement("button"),
          remove = document.createElement("button");
        actions.className = "actions";
        rename.type = "button";
        rename.className = "secondary";
        rename.textContent = "名前を変更";
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "プロジェクトを削除";
        rename.onclick = () => {
          const next = prompt(
            "新しいプロジェクト名",
            currentProject.displayName,
          )?.trim();
          if (!next) return;
          void json(fetcher, `/app/api/v1/projects/${match[1]}`, {
            method: "PATCH",
            body: JSON.stringify({ displayName: next }),
          })
            .then(() => location.reload())
            .catch(showError);
        };
        remove.onclick = () => {
          if (
            !confirm(
              "このプロジェクトを一覧から削除しますか？\n\nプロジェクトの記録だけを削除します。紐付いたSourceとJobの入力・成果物は、各自の保存期限まで残ります。完全削除が必要な場合は管理者へ相談してください。",
            )
          )
            return;
          void json(fetcher, `/app/api/v1/projects/${match[1]}`, {
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
      if (nextRevision)
        nextRevision.onclick = () => {
          nextRevision.disabled = true;
          void loadDetail(true).catch(showError);
        };
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
        shellEscape: boolean;
        networkAccess: boolean;
      };
      summary.innerHTML = `<h2>現在の環境</h2><dl class="details"><dt>TeX Live</dt><dd>${escape(value.texliveVersion)}</dd><dt>エンジン</dt><dd>${escape(value.engines.join(", "))}</dd><dt>shell escape</dt><dd>${value.shellEscape ? "有効" : "無効"}</dd><dt>ネットワーク</dt><dd>${value.networkAccess ? "有効" : "無効"}</dd></dl>`;
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
            : "一致する項目はありません。";
        })
        .catch(showError);
    };
  }
}

function installApp() {
  const fetcher = globalThis.fetch.bind(globalThis);
  void establishSession(fetcher)
    .then((authenticated) => {
      if (!authenticated) return;
      const page = document.body.dataset.appPage;
      if (page === "render") installRender(fetcher);
      if (page === "history") {
        const history = document.querySelector<HTMLElement>("#app-history");
        if (history) void loadJobs(fetcher, history);
        installJob(fetcher);
      }
      if (page === "projects") installProjects(fetcher);
      if (page === "environment") installEnvironment(fetcher);
    })
    .catch(showError);
  document.querySelector("#app-logout")?.addEventListener("click", () => {
    void fetcher("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": csrfToken },
    }).finally(() => location.replace("/login/"));
  });
  addEventListener("pagehide", () => {
    // Credentials live only in closures and are discarded with the page.
  });
}

export const appScript = `
(() => {
  let csrfToken = "";
  const JOB_STATUSES = ${JSON.stringify(JOB_STATUSES)};
  const crc32 = ${crc32.toString()};
  const inspectZipCandidates = ${inspectZipCandidates.toString()};
  const zipSingleTex = ${zipSingleTex.toString()};
  const sha256Hex = ${sha256Hex.toString()};
  const parseSourceTicket = ${parseSourceTicket.toString()};
  const responseError = ${responseError.toString()};
  const uploadSourceZip = ${uploadSourceZip.toString()};
  const parseJobArtifact = ${parseJobArtifact.toString()};
  const parseJobStatus = ${parseJobStatus.toString()};
  const json = ${json.toString()};
  const friendly = ${friendly.toString()};
  const showError = ${showError.toString()};
  const escape = ${escape.toString()};
  const statusLabel = ${statusLabel.toString()};
  const establishSession = ${establishSession.toString()};
  const createSource = ${createSource.toString()};
  const parseRender = ${parseRender.toString()};
  const issueAccess = ${issueAccess.toString()};
  const rendererJob = ${rendererJob.toString()};
  const jobTracker = ${jobTracker.toString()};
  const artifactButton = ${artifactButton.toString()};
  const renderJobResult = ${renderJobResult.toString()};
  const followJob = ${followJob.toString()};
  const loadJobs = ${loadJobs.toString()};
  const installRender = ${installRender.toString()};
  const installJob = ${installJob.toString()};
  const installProjects = ${installProjects.toString()};
  const installEnvironment = ${installEnvironment.toString()};
  (${installApp.toString()})();
})();
`;
