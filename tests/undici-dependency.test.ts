import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

// Wrangler also embeds Undici in its CLI: fixing Miniflare's installed copy
// alone does not replace that code. Keep both dependency boundaries covered.
function patchedVersion(version: string | undefined) {
  if (version === undefined) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return (
    (major === 7 && (minor > 29 || (minor === 29 && patch >= 1))) ||
    (major === 8 && (minor > 10 || (minor === 10 && patch >= 2)))
  );
}

it("keeps every locked Undici copy outside the six selected advisories", () => {
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  const versions = [...lock.matchAll(/^ {2}undici@([^:]+):/gm)];
  expect(versions.length).toBeGreaterThan(0);
  for (const [, version] of versions) {
    expect(patchedVersion(version), version).toBe(true);
  }
});

it("also checks the Undici implementation embedded in the published Wrangler CLI", () => {
  const root = createRequire(join(process.cwd(), "package.json"));
  const cli = readFileSync(
    join(
      dirname(root.resolve("wrangler/package.json")),
      "wrangler-dist/cli.js",
    ),
    "utf8",
  );
  const versions = [
    ...cli.matchAll(/\.pnpm\/undici@([^/]+)\/node_modules\/undici\//g),
  ];
  // Fail closed if a future bundle removes these provenance markers.
  expect(versions.length).toBeGreaterThan(0);
  for (const version of new Set(versions.map((match) => match[1]))) {
    expect(patchedVersion(version), version).toBe(true);
  }
});

function runUndici(source: string) {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import { createServer } from "node:http";
      import { once } from "node:events";
      const root = createRequire(process.cwd() + "/package.json");
      const wrangler = createRequire(root.resolve("wrangler/package.json"));
      const miniflare = createRequire(wrangler.resolve("miniflare"));
      const { Client, Pool, BalancedPool, interceptors } = miniflare("undici");
      async function withServer(handler, run) {
        const server = createServer(handler);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        try {
          await run("http://127.0.0.1:" + server.address().port);
        } finally {
          server.closeAllConnections();
          await new Promise((resolve, reject) => server.close(error =>
            error ? reject(error) : resolve()));
        }
      }
      ${source}
      `,
    ],
    { timeout: 10_000, stdio: "pipe" },
  );
}

it.each(["connect", "tls", "connector"])(
  "preserves %s callbacks across BalancedPool option cloning (GHSA-w293-vg96-wgc3)",
  (mode) => {
    runUndici(`
      const mode = ${JSON.stringify(mode)};
      const check = () => new Error("fixture custom TLS rejection");
      const connector = () => { throw new Error("must not open a connection"); };
      const options = mode === "connector" ? { connect: connector }
        : { [mode]: { checkServerIdentity: check } };
      const captured = [];
      const pool = new BalancedPool(["https://localhost:443"], {
        ...options,
        factory(origin, opts) {
          captured.push(opts);
          return new Pool(origin, opts);
        }
      });
      try {
        pool.addUpstream("https://localhost:444");
        assert.equal(captured.length, 2);
        for (const opts of captured) {
          if (mode === "connector") assert.equal(opts.connect, connector);
          else assert.equal(opts[mode].checkServerIdentity, check);
        }
      } finally { await pool.destroy(); }
    `);
  },
);

it("does not share cached Set-Cookie but still caches safe public GETs (GHSA-2jfj-6hjv-fm6j)", () => {
  runUndici(`
    let count = 0;
    await withServer((req, res) => {
      count++;
      res.setHeader("cache-control", "public, max-age=60");
      if (req.url === "/cookie") res.setHeader("set-cookie", "session=" + count);
      res.end(String(count));
    }, async origin => {
      const client = new Client(origin).compose(interceptors.cache());
      try {
        const first = await client.request({ origin, path: "/cookie", method: "GET" });
        assert.equal(await first.body.text(), "1");
        const second = await client.request({ origin, path: "/cookie", method: "GET" });
        assert.equal(await second.body.text(), "2");
        assert.notDeepEqual(second.headers["set-cookie"], first.headers["set-cookie"]);
        for (let i = 0; i < 2; i++) {
          const safe = await client.request({ origin, path: "/safe", method: "GET" });
          assert.equal(await safe.body.text(), "3");
        }
        assert.equal(count, 3);
      } finally { await client.destroy(); }
    });
  `);
});

it("sends every unsafe method to the origin instead of replaying cache (GHSA-8436-99hf-9mmv)", () => {
  runUndici(`
    let count = 0;
    await withServer((_req, res) => {
      count++;
      res.writeHead(404, { "cache-control": "max-age=60" });
      res.end(String(count));
    }, async origin => {
      const client = new Client(origin).compose(interceptors.cache());
      try {
        let expected = 0;
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          for (let i = 0; i < 2; i++) {
            const response = await client.request({ origin, path: "/" + method, method });
            assert.equal(await response.body.text(), String(++expected));
          }
        }
        assert.equal(count, 8);
      } finally { await client.destroy(); }
    });
  `);
});

it("still invalidates cached GETs after successful state-changing requests", () => {
  runUndici(`
    let count = 0;
    await withServer((req, res) => {
      count++;
      if (req.method === "GET") res.setHeader("cache-control", "max-age=60");
      res.end(String(count));
    }, async origin => {
      const client = new Client(origin).compose(interceptors.cache());
      try {
        for (let i = 0; i < 2; i++) {
          const response = await client.request({ origin, path: "/", method: "GET" });
          assert.equal(await response.body.text(), "1");
        }
        const mutation = await client.request({ origin, path: "/", method: "POST" });
        assert.equal(await mutation.body.text(), "2");
        const refreshed = await client.request({ origin, path: "/", method: "GET" });
        assert.equal(await refreshed.body.text(), "3");
        assert.equal(count, 3);
      } finally { await client.destroy(); }
    });
  `);
});

it("rejects oversized chunked and declared bodies without rejecting small bodies (GHSA-2gqq-gqf2-x968)", () => {
  runUndici(`
    await withServer((req, res) => {
      if (req.url === "/chunked") {
        res.writeHead(200, { "transfer-encoding": "chunked" });
        res.write("12345");
        res.end("67890");
      } else if (req.url === "/declared") res.end("1234567890");
      else res.end("ok");
    }, async origin => {
      const client = new Client(origin).compose(interceptors.dump({ maxSize: 4 }));
      try {
        for (const path of ["/chunked", "/declared"]) {
          await assert.rejects(async () => {
            const response = await client.request({ path, method: "GET" });
            await response.body.text();
          }, { code: "UND_ERR_ABORTED" });
        }
        const response = await client.request({ path: "/small", method: "GET" });
        assert.equal(response.statusCode, 200);
        await response.body.dump();
      } finally { await client.destroy(); }
    });
  `);
});

// Small, loopback-only forms of the upstream retry regressions. The outer
// process timeout bounds even a dependency that leaves its response pending.
it("settles the original body on a terminal retry error (GHSA-pmjh-fq2x-6v4x)", () => {
  runUndici(`
    let count = 0;
    await withServer((_req, res) => {
      if (++count === 1) {
        res.setHeader("content-length", "5");
        res.write("123", () => res.destroy());
      } else { res.writeHead(400); res.end(); }
    }, async origin => {
      const client = new Client(origin, { bodyTimeout: 100 })
        .compose(interceptors.retry({ minTimeout: 10, maxRetries: 1 }));
      try {
        const response = await client.request({ path: "/", method: "GET" });
        assert.equal(response.statusCode, 200);
        let timer;
        try {
          const error = await Promise.race([
            response.body.text().then(() => null, error => error),
            new Promise(resolve => { timer = setTimeout(() =>
              resolve(new Error("response body did not settle")), 2_000); })
          ]);
          assert.equal(error?.code, "UND_ERR_REQ_RETRY");
          assert.equal(count, 2);
        } finally { clearTimeout(timer); response.body.destroy(); }
      } finally { await client.destroy(); }
    });
  `);
});

it("rejects resumed bytes exceeding original framing and accepts ordinary HEAD (GHSA-r53p-7pc4-xj5r)", () => {
  runUndici(`
    let count = 0;
    await withServer((req, res) => {
      if (req.method === "HEAD") { res.setHeader("content-length", "1234"); res.end(); }
      else if (++count === 1) {
        res.writeHead(404, { "content-length": "2" });
        res.write("1", () => res.destroy());
      } else {
        res.writeHead(206, { "content-range": "bytes 1-3/4", connection: "close" });
        res.end("234");
      }
    }, async origin => {
      const client = new Client(origin).compose(interceptors.retry({
        minTimeout: 10, maxRetries: 1
      }));
      try {
        const response = await client.request({ path: "/", method: "GET" });
        assert.equal(response.statusCode, 404);
        await assert.rejects(response.body.text(), {
          code: "UND_ERR_REQ_RETRY", message: "Content-Range mismatch"
        });
        assert.equal(count, 2);
        const head = await client.request({ path: "/", method: "HEAD" });
        assert.equal(head.statusCode, 200);
        assert.equal(head.headers["content-length"], "1234");
        assert.equal(await head.body.text(), "");
      } finally { await client.destroy(); }
    });
  `);
});
