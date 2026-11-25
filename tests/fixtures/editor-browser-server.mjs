import { Buffer } from "node:buffer";
import { once } from "node:events";
import { createRequire } from "node:module";
import { URL } from "node:url";

const require = createRequire(
  new URL("../../apps/admin-web/package.json", import.meta.url),
);
const { createAdaptorServer } = require("@hono/node-server");
const projectId = `project_${"a".repeat(32)}`;
const draftPath = `/app/api/v1/projects/${projectId}/draft`;

function makePdf() {
  const stream = "0 0 0 rg\n10 10 50 50 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 250] /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 5\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return Buffer.from(
    pdf + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}

/** Serve the built Web application with a test-only, in-memory API. */
export async function startEditorBrowserFixture({
  saveConflict = false,
  renderFailure = false,
  onRequest,
} = {}) {
  // Serve the emitted scripts with native Node. Vitest's import rewriting
  // changes the function strings sent by the application.
  const { createWebApp } = require("./dist/app.js");
  const app = createWebApp({ archive: new Uint8Array() });
  const pdf = makePdf();
  const state = {
    text: "\\documentclass{article}\n\\begin{document}\nOriginal\n\\end{document}",
    version: 1,
    job: null,
  };
  const draft = () => ({
    version: state.version,
    entrypoint: "main.tex",
    engine: "lualatex",
    files: [{ path: "main.tex" }],
  });
  const json = (value, status = 200) =>
    globalThis.Response.json(value, { status });
  async function respond(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path === "/auth/config")
      return json({ backend: "native", methods: [{ id: "password" }] });
    if (path === "/auth/password/login" && method === "POST")
      return json({ error: { code: "INVALID_CREDENTIALS" } }, 401);
    if (path === "/auth/session") return json({ csrfToken: "fixture-csrf" });
    if (path === "/app/api/v1/me") return json({ isAdmin: false });
    if (path === "/app/api/v1/environment")
      return json({ engines: ["lualatex"] });
    if (path === draftPath) return json(draft());
    if (path === draftPath + "/file") {
      if (method === "GET")
        return json({ text: state.text, version: state.version });
      if (method === "PUT") {
        const input = await request.json();
        if (saveConflict || state.version !== input.version)
          return json({ error: { code: "DRAFT_VERSION_CONFLICT" } }, 409);
        state.text = input.text;
        state.version++;
        return json(draft());
      }
    }
    if (path === draftPath + "/preview") {
      if (method === "GET")
        return json({
          latest: state.job,
          successful:
            !renderFailure && state.job ? { ...state.job, pageCount: 1 } : null,
        });
      if (method === "POST") {
        const { version } = await request.json();
        if (version !== state.version)
          return json({ error: { code: "DRAFT_VERSION_CONFLICT" } }, 409);
        state.job = {
          jobId: `job_${String(version).padStart(32, "0")}`,
          version,
          status: renderFailure ? "failed" : "succeeded",
        };
        return json(state.job);
      }
    }
    if (path.startsWith("/app/api/v1/jobs/") && state.job) {
      const jobPath = `/app/api/v1/jobs/${state.job.jobId}`;
      if (path === jobPath)
        return json({ status: state.job.status, pdfPageCount: 1 });
      if (path === jobPath + "/artifacts/errors.json")
        return json({
          errors: [
            {
              file: "main.tex",
              line: 2,
              message: "Undefined control sequence",
            },
          ],
        });
      if (path === jobPath + "/artifacts/result.pdf")
        return new globalThis.Response(pdf, {
          headers: { "Content-Type": "application/pdf" },
        });
    }
    return app.fetch(request);
  }
  const server = createAdaptorServer({
    fetch: async (request) => {
      const started = Date.now();
      const response = await respond(request);
      onRequest?.({
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        elapsedMs: Date.now() - started,
      });
      return response;
    },
    overrideGlobalObjects: false,
    hostname: "127.0.0.1",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    editorPath: `/app/projects/${projectId}/edit/`,
    state,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
