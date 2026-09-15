import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { githubJson } from "../deploy/scripts/github-json.mjs";

const endpoint =
  "https://api.github.com/repos/n624-dev/latex-renderer/releases/latest";
const agent = "latex-renderer-update-helper";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function outcome() {
  const result = githubJson(endpoint, agent).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  await vi.runAllTimersAsync();
  return result;
}

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) throw new Error("Expected a request failure");
  return error.message;
}

it.each([408, 500, 502, 503, 504])(
  "retries transient HTTP %s and returns only the complete successful JSON",
  async (status) => {
    const cancel = vi.fn();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }), { status }),
      )
      .mockResolvedValueOnce(Response.json({ tag_name: "v9.0.0" }));
    expect(await outcome()).toEqual({
      value: { tag_name: "v9.0.0" },
      error: null,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe(endpoint);
      expect(options?.method).toBe("GET");
      expect(options?.headers).not.toHaveProperty("Authorization");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"delayMs":1000'),
    );
  },
);

it("stops after three attempts and emits only two bounded, URL-free retry events", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      Promise.resolve(new Response("private body", { status: 504 })),
    );
  expect(errorMessage((await outcome()).error)).toContain("attempt 3/3");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(console.error).toHaveBeenCalledTimes(2);
  expect(console.error).toHaveBeenLastCalledWith(
    expect.stringContaining('"delayMs":2000'),
  );
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
    /private body|api\.github\.com/,
  );
});

it.each([400, 401, 403, 404, 422, 501])(
  "does not retry permanent HTTP %s",
  async (status) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status }));
    expect((await outcome()).error).toBeInstanceOf(Error);
    expect(fetch).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  },
);

it.each([
  [429, { "retry-after": "3" }, 3000],
  [503, { "retry-after": "Tue, 15 Sep 2026 00:00:04 GMT" }, 4000],
  [
    403,
    { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1789430402" },
    3000,
  ],
  [
    429,
    {
      "retry-after": "1",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "1789430403",
    },
    4000,
  ],
] as const)(
  "honors bounded server waits (%s, %j)",
  async (status, headers, delay) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status, headers }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    expect((await outcome()).error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`"delayMs":${delay}`),
    );
  },
);

it.each([
  [429, {}],
  [429, { "retry-after": "60" }],
  [503, { "retry-after": "invalid" }],
  [403, { "x-ratelimit-remaining": "0" }],
  [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1789434000" }],
  [503, { "retry-after": "999999999999999999999999999999999999999999999999" }],
] as const)(
  "defers instead of shortening an unusable/long wait (%s, %j)",
  async (status, headers) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status, headers }));
    expect(errorMessage((await outcome()).error)).toContain("deferred");
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it.each(["ECONNRESET", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_BODY_TIMEOUT"])(
  "retries a transient transport cause %s",
  async (code) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("transport"), { code }),
        }),
      )
      .mockResolvedValueOnce(Response.json({ complete: true }));
    expect((await outcome()).error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

it.each([
  new SyntaxError("invalid JSON"),
  Object.assign(new Error("TLS verification failed"), {
    code: "CERT_HAS_EXPIRED",
  }),
  new TypeError("invalid input"),
  new DOMException("cancelled", "AbortError"),
])(
  "does not retry syntax, TLS, programming or cancellation errors: %s",
  async (error) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
    expect((await outcome()).error).toBe(error);
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it("does not retry malformed JSON or oversized declared/streamed metadata", async () => {
  for (const response of [
    new Response('{"partial":'),
    new Response("{}", {
      headers: { "content-length": String(8 * 1024 ** 2 + 1) },
    }),
    new Response(new Uint8Array(8 * 1024 ** 2 + 1)),
  ]) {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    expect((await outcome()).error).toBeInstanceOf(Error);
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockRestore();
  }
});

it("discards a partially read failed body before retrying", async () => {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (++pulls === 1)
        controller.enqueue(new TextEncoder().encode('{"discard":'));
      else
        controller.error(
          new TypeError("terminated", {
            cause: Object.assign(new Error("socket"), {
              code: "UND_ERR_SOCKET",
            }),
          }),
        );
    },
  });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(stream))
    .mockResolvedValueOnce(Response.json({ only: "success" }));
  expect(await outcome()).toEqual({ value: { only: "success" }, error: null });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("bounds stalled headers/bodies by each attempt timeout and the total elapsed budget", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException("deadline", "TimeoutError")),
      ms,
    );
    return controller.signal;
  });
  let lastSignal: AbortSignal | null | undefined;
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((_url, options) => {
      lastSignal = options?.signal;
      return new Promise((_resolve, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => {
            const reason: unknown = options.signal?.reason;
            reject(
              reason instanceof Error
                ? reason
                : new Error("Unexpected abort reason"),
            );
          },
          { once: true },
        ),
      );
    });
  const start = Date.now();
  expect((await outcome()).error).toBeInstanceOf(Error);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(timeout.mock.calls).toEqual([[30000], [30000], [30000]]);
  expect(lastSignal?.aborted).toBe(true);
  expect(Date.now() - start).toBe(93000);
});

it("retries its own stalled-body timeout even if Node reports AbortError", async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              controller.abort(new DOMException("deadline", "TimeoutError"));
              stream.error(new DOMException("body aborted", "AbortError"));
            },
          }),
        ),
      ),
    )
    .mockResolvedValueOnce(Response.json({ recovered: true }));
  expect(await outcome()).toEqual({ value: { recovered: true }, error: null });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["-1", "0.5", "tomorrow"])(
  "does not parse malformed Retry-After %s as a short wait",
  async (value) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("{}", { status: 503, headers: { "retry-after": value } }),
      );
    expect(errorMessage((await outcome()).error)).toContain("deferred");
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it("does not start another request after the total budget expires during backoff", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    vi.advanceTimersByTime(95_000);
    return Promise.resolve(new Response("{}", { status: 504 }));
  });
  expect((await outcome()).error).toBeInstanceOf(Error);
  expect(fetch).toHaveBeenCalledOnce();
});

it("keeps elapsed-time limits independent of a backwards wall-clock adjustment", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => {
      vi.setSystemTime(Date.now() - 86400_000);
      return Promise.resolve(new Response("{}", { status: 504 }));
    })
    .mockResolvedValueOnce(Response.json({ ok: true }));
  expect((await outcome()).error).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("shortens the last attempt to the remaining total budget after server-directed waits", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException("deadline", "TimeoutError")),
      ms,
    );
    return controller.signal;
  });
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, options) =>
      new Promise((resolve, reject) => {
        if (++calls < 3)
          setTimeout(
            () =>
              resolve(
                new Response("{}", {
                  status: 503,
                  headers: { "retry-after": "5" },
                }),
              ),
            29000,
          );
        else
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("deadline", "TimeoutError")),
            { once: true },
          );
      }),
  );
  const start = performance.now();
  expect((await outcome()).error).toBeInstanceOf(Error);
  expect(timeout.mock.calls).toEqual([[30000], [30000], [27000]]);
  expect(performance.now() - start).toBe(95000);
});

it("rejects non-project URLs before any request", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  for (const url of [
    "http://api.github.com/repos/n624-dev/latex-renderer/a",
    "https://example.invalid/a",
    "https://api.github.com/repos/other/project/a",
    "https://token@api.github.com/repos/n624-dev/latex-renderer/a",
    endpoint + "#secret",
  ]) {
    await expect(githubJson(url, agent)).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("ships the shared retry module in attested slots and bootstrap control checks without changing the frozen downloader", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  expect(JSON.parse(read("deploy/updater-files.json"))).toContain(
    "deploy/scripts/github-json.mjs",
  );
  for (const path of [
    "deploy/scripts/update-manager.mjs",
    "deploy/scripts/update-manager-helper.mjs",
  ]) {
    const text = read(path);
    expect(text).toContain('from "./github-json.mjs"');
    expect(text.match(/globalThis\.fetch\(/g)).toHaveLength(1); // asset download only
  }
  expect(read("deploy/scripts/update-manager-helper.mjs")).toContain(
    '"deploy/scripts/github-json.mjs"',
  );
  expect(read("deploy/scripts/published-release.mjs")).not.toContain(
    "github-json.mjs",
  );
});
