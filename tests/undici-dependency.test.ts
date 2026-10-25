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
    (major === 7 && (minor > 30 || (minor === 30 && patch >= 1))) ||
    (major === 8 && (minor > 12 || (minor === 12 && patch >= 2)))
  );
}

it("keeps every locked Undici copy outside the selected advisories", () => {
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
    if (patchedVersion(version)) continue;
    // The published bundle keeps its original provenance marker. Its fixed
    // implementation is exercised below, independently of this pin guard.
    expect(version).toBe("7.29.1");
    const metadata = root("wrangler/package.json") as { version: string };
    expect(metadata.version).toBe("4.151.0");
    expect(readFileSync("pnpm-workspace.yaml", "utf8")).toContain(
      "wrangler@4.151.0: patches/wrangler@4.151.0.patch",
    );
    expect(readFileSync("pnpm-lock.yaml", "utf8")).toMatch(
      /wrangler@4\.151\.0\(patch_hash=[a-f0-9]+\)/,
    );
  }
});

function runUndici(
  source: string,
  implementation: "miniflare" | "wrangler" = "miniflare",
) {
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
      import { Module } from "node:module";
      import { readFileSync } from "node:fs";
      import { dirname } from "node:path";
      const root = createRequire(process.cwd() + "/package.json");
      const wrangler = createRequire(root.resolve("wrangler/package.json"));
      const miniflare = createRequire(wrangler.resolve("miniflare"));
      let undici;
      if (${JSON.stringify(implementation)} === "wrangler") {
        const filename = root.resolve("wrangler");
        const bundle = readFileSync(filename, "utf8");
        const start = bundle.indexOf("var require_undici = __commonJS({");
        const end = bundle.indexOf("\\n// ../workers-utils/src/cfetch/errors.ts", start);
        assert(start > 0 && end > start, "Wrangler bundle boundary changed");
        // Execute the shipped modules verbatim, stopping before CLI commands.
        // Only expose the same private Undici export used by its API caller.
        const loaded = new Module(filename);
        loaded.filename = filename;
        loaded.paths = Module._nodeModulePaths(dirname(filename));
        loaded._compile(bundle.slice(0, end) + "\\nmodule.exports = require_undici();", filename);
        undici = loaded.exports;
      } else undici = miniflare("undici");
      const { fetch, Client, Pool, BalancedPool, interceptors } = undici;
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

it.each(["miniflare", "wrangler"] as const)(
  "%s rejects excessive encodings followed by an early close without crashing",
  (implementation) => {
    runUndici(
      `
      const { createServer: createNetServer } = await import("node:net");
      for (const coding of [Array(6).fill("gzip").join(", "),
        "gzip, deflate, br, GZIP, gzip, gzip, gzip"]) {
        let closed;
        const socketClosed = new Promise(resolve => { closed = resolve; });
        const server = createNetServer(socket => {
          socket.once("close", closed);
          socket.once("data", () => socket.end("HTTP/1.1 200 OK\\r\\n" +
            "Content-Encoding: " + coding + "\\r\\nContent-Length: 1\\r\\n" +
            "Connection: close\\r\\n\\r\\n"));
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        const origin = "http://127.0.0.1:" + server.address().port;
        const client = new Client(origin);
        try {
          await assert.rejects(fetch(origin, { dispatcher: client }),
            error => error.cause?.message.includes("content-encoding"));
          await socketClosed;
        } finally {
          await client.close();
          await new Promise(resolve => server.close(resolve));
        }
      }
      await withServer((_req, res) => res.end("still alive"), async origin => {
        assert.equal(await (await fetch(origin)).text(), "still alive");
      });
    `,
      implementation,
    );
  },
);

it.each(["miniflare", "wrangler"] as const)(
  "%s preserves plain, gzip and the allowed five-encoding response",
  (implementation) => {
    runUndici(
      `
      const { gzipSync } = await import("node:zlib");
      const text = "Small 日本語 response";
      await withServer((req, res) => {
        const count = Number(req.url.slice(1));
        let bytes = Buffer.from(text);
        for (let i = 0; i < count; i++) bytes = gzipSync(bytes);
        if (count) res.setHeader("content-encoding", Array(count).fill("gzip").join(", "));
        res.end(bytes);
      }, async origin => {
        for (const count of [0, 1, 5]) {
          const response = await fetch(origin + "/" + count);
          assert.equal(response.status, 200);
          assert.equal(await response.text(), text);
        }
      });
    `,
      implementation,
    );
  },
);

it("keeps Miniflare's default cf fetch fallback and compressed JSON initialization", () => {
  runUndici(`
    const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createServer: createNetServer } = await import("node:net");
    const directory = mkdtempSync(join(tmpdir(), "undici-cf-fixture-"));
    process.env.NODE_ENV = "development";
    delete process.env.CLOUDFLARE_CF_FETCH_ENABLED;
    process.env.CLOUDFLARE_CF_FETCH_PATH = join(directory, "cf.json");
    const filename = wrangler.resolve("miniflare");
    const loaded = new Module(filename);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(dirname(filename));
    loaded._compile(readFileSync(filename, "utf8") +
      "\\nmodule.exports.fixture = { setupCf, fallbackCf };", filename);
    const { setupCf, fallbackCf } = loaded.exports.fixture;
    const originalFetch = undici.fetch;
    let origin, warnings = 0, requests = 0;
    // Redirect only the fixed upstream cf.json request; retain the real fetch.
    undici.fetch = (url, options) => {
      assert.equal(url, "https://workers.cloudflare.com/cf.json");
      requests++;
      return originalFetch(origin, options);
    };
    const log = { debug() {}, warn() { warnings++; } };
    let closed;
    const socketClosed = new Promise(resolve => { closed = resolve; });
    const bad = createNetServer(socket => {
      socket.once("close", closed);
      socket.once("data", () => socket.end("HTTP/1.1 200 OK\\r\\n" +
        "Content-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\\r\\n" +
        "Content-Length: 1\\r\\nConnection: close\\r\\n\\r\\n"));
    });
    try {
      await once(bad.listen(0, "127.0.0.1"), "listening");
      origin = "http://127.0.0.1:" + bad.address().port;
      assert.deepEqual(await setupCf(log, undefined), fallbackCf);
      await socketClosed;
      assert.equal(warnings, 1);
      assert.equal(existsSync(process.env.CLOUDFLARE_CF_FETCH_PATH), false);
      const { gzipSync } = await import("node:zlib");
      const data = { colo: "TEST", country: "JP" };
      await withServer((_req, res) => {
        res.setHeader("content-encoding", "gzip");
        res.end(gzipSync(JSON.stringify(data)));
      }, async url => {
        origin = url;
        assert.deepEqual(await setupCf(log, undefined), data);
        // The successful cache prevents a second request.
        assert.deepEqual(await setupCf(log, undefined), data);
      });
      assert.equal(requests, 2);
      assert.equal(warnings, 1);
    } finally {
      undici.fetch = originalFetch;
      await new Promise(resolve => bad.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  `);
});

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
